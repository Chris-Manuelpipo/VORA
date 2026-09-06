// VORA — la photo de profil : envoi, relecture, remplacement.
//
// CE QUI SE JOUE ICI. Une photo est la seule donnée que l'utilisateur nous confie sous
// forme de FICHIER, et un fichier est le vecteur d'attaque le plus banal d'une API :
// on annonce « image/jpeg », on envoie du HTML, et le jour où un navigateur ouvre
// `GET /v1/media/:id`, le script s'exécute sur notre domaine.
//
// Le serveur ne croit donc jamais l'en-tête : il lit les octets. Ces tests le vérifient
// avec un vrai fichier déguisé, pas avec une chaîne de caractères improbable.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, db } from '../db/client.js';
import { media, users } from '../db/schema.js';
import { MAX_IMAGE_BYTES } from '../lib/images.js';
import {
  auth,
  createDriver,
  createPassenger,
  type TestAccount,
} from './support/fixtures.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await closeDatabase();
});

/**
 * Un JPEG minimal mais RÉEL : en-tête SOI, segment APP0/JFIF, puis marqueur de fin. Un
 * décodeur le refuserait (il n'y a pas d'image dedans), mais ce n'est pas ce qu'on teste :
 * on teste que le serveur reconnaît un JPEG à ses octets, et il commence bien par FF D8 FF.
 */
function jpeg(size = 512): Buffer {
  const buffer = Buffer.alloc(size, 0x20);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]).copy(buffer);
  Buffer.from([0xff, 0xd9]).copy(buffer, size - 2);
  return buffer;
}

function png(size = 512): Buffer {
  const buffer = Buffer.alloc(size, 0x20);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  return buffer;
}

function webp(size = 512): Buffer {
  const buffer = Buffer.alloc(size, 0x20);
  Buffer.from('RIFF').copy(buffer, 0);
  Buffer.from('WEBP').copy(buffer, 8);
  return buffer;
}

async function upload(account: TestAccount, bytes: Buffer, contentType = 'image/jpeg') {
  return app.inject({
    method: 'POST',
    url: '/v1/me/photo',
    headers: { ...auth(account), 'content-type': contentType },
    payload: bytes,
  });
}

// ─── Le parcours nominal ─────────────────────────────────────────────────────

describe('POST /v1/me/photo', () => {
  it('accepte une image, la range et rend une URL utilisable', async () => {
    const passager = await createPassenger(app, 'Aïcha Photo');
    const image = jpeg();

    const response = await upload(passager, image);
    expect(response.statusCode).toBe(201);

    const body = response.json() as {
      photo_key: string;
      photo_url: string;
      mime: string;
      size_bytes: number;
    };
    expect(body.mime).toBe('image/jpeg');
    expect(body.size_bytes).toBe(image.byteLength);
    expect(body.photo_url).toContain(`/v1/media/${body.photo_key}`);
    // Une barre oblique finale sur PUBLIC_BASE_URL produisait `…io//v1/media/<id>`, qui
    // répond 404 — sans une ligne dans les journaux. La base est normalisée à la lecture
    // de l'environnement ; ici on vérifie le RÉSULTAT, quelle que soit la valeur donnée.
    expect(body.photo_url.replace(/^https?:\/\//, '')).not.toContain('//');

    // L'URL rendue est celle qui marche : on la suit, et on retrouve les MÊMES octets.
    const lecture = await app.inject({
      method: 'GET',
      url: `/v1/media/${body.photo_key}`,
      headers: auth(passager),
    });
    expect(lecture.statusCode).toBe(200);
    expect(lecture.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(lecture.rawPayload, image)).toBe(0);

    // Une image ne change jamais d'identifiant : le téléphone peut la garder pour de bon.
    expect(lecture.headers['cache-control']).toContain('immutable');
    expect(lecture.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);

    // Et `GET /v1/me` la porte, prête à poser dans un widget Image.
    const moi = await app.inject({ method: 'GET', url: '/v1/me', headers: auth(passager) });
    expect(moi.json().photo_key).toBe(body.photo_key);
    expect(moi.json().photo_url).toBe(body.photo_url);
    expect(moi.json().onboarding.missing).not.toContain('photo');
  }, 30_000);

  it('accepte aussi le PNG et le WebP', async () => {
    for (const [nom, bytes, type] of [
      ['PNG', png(), 'image/png'],
      ['WebP', webp(), 'image/webp'],
    ] as const) {
      const passager = await createPassenger(app, `Aïcha ${nom}`);
      const response = await upload(passager, bytes, type);
      expect(response.statusCode, nom).toBe(201);
      expect(response.json().mime).toBe(type);
    }
  }, 30_000);

  it('remplace la précédente au lieu de l’empiler', async () => {
    const passager = await createPassenger(app, 'Aïcha Deux Photos');

    const premiere = (await upload(passager, jpeg(256))).json().photo_key;
    const seconde = (await upload(passager, png(300), 'image/png')).json().photo_key;
    expect(seconde).not.toBe(premiere);

    // Une seule ligne en base : sans remplacement, chaque changement d'avatar laisserait
    // 60 Ko derrière lui, que plus rien ne référence.
    const lignes = await db.select().from(media).where(eq(media.ownerId, passager.id));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.id).toBe(seconde);

    // Et l'ancienne URL ne rend plus rien.
    const ancienne = await app.inject({
      method: 'GET',
      url: `/v1/media/${premiere}`,
      headers: auth(passager),
    });
    expect(ancienne.statusCode).toBe(404);
  }, 30_000);

  it('un onboarding renvoyé APRÈS l’envoi n’efface pas la photo', async () => {
    const passager = await createPassenger(app, 'Aïcha Ordre');
    const key = (await upload(passager, jpeg())).json().photo_key;

    // `photo_key` n'est plus acceptée dans le corps de l'onboarding : c'est l'envoi de
    // photo qui la pose. Un profil enregistré ensuite ne doit donc rien écraser — l'ordre
    // des écrans ne doit pas décider du sort de l'avatar.
    const onboarding = await app.inject({
      method: 'POST',
      url: '/v1/me/onboarding',
      headers: auth(passager),
      payload: { first_name: 'Aïcha', family_name: 'Mballa' },
    });

    expect(onboarding.statusCode).toBe(200);
    expect(onboarding.json().photo_key).toBe(key);
    expect(onboarding.json().photo_url).toContain(key);
  }, 30_000);

  it('refuse une clé de photo envoyée dans un corps de requête', async () => {
    const passager = await createPassenger(app, 'Aïcha Maline');
    const autre = await createPassenger(app, 'Aïcha Voisine');
    const keyDeLautre = (await upload(autre, jpeg())).json().photo_key;

    // Sans ce refus, n'importe qui s'attribuait l'image d'un autre — ou une valeur qui ne
    // pointe sur rien, et l'avatar cassé n'était visible que sur le téléphone d'en face.
    for (const [url, payload] of [
      ['/v1/me/onboarding', { first_name: 'Aïcha', family_name: 'Mballa', photo_key: keyDeLautre }],
      ['/v1/me', { photo_key: keyDeLautre }],
    ] as const) {
      const response = await app.inject({
        method: url === '/v1/me' ? 'PATCH' : 'POST',
        url,
        headers: auth(passager),
        payload,
      });
      expect(response.statusCode, url).toBe(400);
    }

    const moi = await app.inject({ method: 'GET', url: '/v1/me', headers: auth(passager) });
    expect(moi.json().photo_key).toBeNull();
  }, 30_000);

  it('DELETE retire la photo et la clé qui la référence', async () => {
    const passager = await createPassenger(app, 'Aïcha Sans Photo');
    await upload(passager, jpeg());

    const retrait = await app.inject({
      method: 'DELETE',
      url: '/v1/me/photo',
      headers: auth(passager),
    });

    expect(retrait.statusCode).toBe(200);
    expect(retrait.json().photo_key).toBeNull();
    expect(retrait.json().photo_url).toBeNull();
    expect(retrait.json().onboarding.missing).toContain('photo');

    const [row] = await db.select().from(users).where(eq(users.id, passager.id));
    expect(row?.photoKey).toBeNull();
    expect(await db.select().from(media).where(eq(media.ownerId, passager.id))).toHaveLength(0);
  }, 30_000);
});

// ─── Ce qui doit être refusé ─────────────────────────────────────────────────

describe('le serveur ne croit pas l’en-tête, il lit les octets', () => {
  it('refuse un fichier HTML déguisé en image', async () => {
    const passager = await createPassenger(app, 'Aïcha Malicieuse');
    // Le scénario réel : l'en-tête dit « image/jpeg », le contenu est une page qui
    // s'exécuterait dans un navigateur ouvrant l'URL de l'image.
    const html = Buffer.from(
      `<html><script>alert(document.cookie)</script>${'<!-- '.repeat(50)}</html>`,
    );

    const response = await upload(passager, html, 'image/jpeg');

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
    expect(response.json().message).toMatch(/n'est pas une image|JPEG/i);
    // Rien n'a été stocké : le refus est complet, pas partiel.
    expect(await db.select().from(media).where(eq(media.ownerId, passager.id))).toHaveLength(0);
  }, 30_000);

  it('refuse un fichier trop lourd, et dit quoi faire', async () => {
    const passager = await createPassenger(app, 'Aïcha Lourde');
    const trop = jpeg(MAX_IMAGE_BYTES + 1024);

    const response = await upload(passager, trop);

    // 400 du service ou 413 de Fastify selon qui voit la taille en premier : les deux
    // sont des refus francs, et c'est ce qui compte.
    expect([400, 413]).toContain(response.statusCode);
  }, 30_000);

  it('refuse un corps vide et un type non image', async () => {
    const passager = await createPassenger(app, 'Aïcha Vide');

    const vide = await upload(passager, Buffer.alloc(0));
    expect(vide.statusCode).toBe(400);

    // `application/pdf` n'a pas d'analyseur : Fastify refuse avant même la route.
    const pdf = await app.inject({
      method: 'POST',
      url: '/v1/me/photo',
      headers: { ...auth(passager), 'content-type': 'application/pdf' },
      payload: Buffer.from('%PDF-1.4'),
    });
    expect(pdf.statusCode).toBeGreaterThanOrEqual(400);
  }, 30_000);
});

// ─── Qui peut lire ───────────────────────────────────────────────────────────

describe('GET /v1/media/:id', () => {
  it('exige un jeton', async () => {
    const passager = await createPassenger(app, 'Aïcha Publique');
    const key = (await upload(passager, jpeg())).json().photo_key;

    const sansJeton = await app.inject({ method: 'GET', url: `/v1/media/${key}` });
    expect(sansJeton.statusCode).toBe(401);
  }, 30_000);

  it('laisse l’autre partie voir la photo — c’est à ça qu’elle sert', async () => {
    const passager = await createPassenger(app, 'Aïcha Visible');
    const chauffeur = await createDriver(app, { displayName: 'Boris Regardeur' });
    const key = (await upload(passager, jpeg())).json().photo_key;

    // Le passager doit voir le visage de son chauffeur avant de monter, et réciproquement.
    // Un contrôle « êtes-vous sur une course ensemble ? » coûterait une requête par avatar
    // affiché, pour une donnée que l'application montre de toute façon.
    const vue = await app.inject({
      method: 'GET',
      url: `/v1/media/${key}`,
      headers: auth(chauffeur),
    });
    expect(vue.statusCode).toBe(200);
  }, 30_000);

  it('répond 404 sur un identifiant inconnu, sans détail', async () => {
    const passager = await createPassenger(app, 'Aïcha Chercheuse');
    const response = await app.inject({
      method: 'GET',
      url: `/v1/media/${crypto.randomUUID()}`,
      headers: auth(passager),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
  }, 30_000);
});
