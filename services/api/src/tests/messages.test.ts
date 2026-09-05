// VORA — le canal de messages prédéfinis, sur une vraie course.
//
// Ce que ces tests protègent : trois règles qui ne se voient pas à l'écran, et qui
// tombent en silence si personne ne les vérifie.
//
//   · un TIERS ne lit ni n'écrit dans la conversation de deux autres personnes ;
//   · la conversation n'existe pas avant l'acceptation, et plus 30 min après la fin ;
//   · rien de personnel ne transite : un code, un expéditeur, une heure. Pas de nom, pas
//     d'ID VORA, pas de numéro — c'est ce qui distingue ce canal d'une messagerie.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, db } from '../db/client.js';
import { rides, users } from '../db/schema.js';
import { seedZones } from '../db/seed/geography.js';
import { MAX_MESSAGES_PER_PARTY, MESSAGING_WINDOW_AFTER_END_S } from '../domain/messages.js';
import { driverPresence } from '../modules/dispatch/presence.js';
import * as dispatchRepository from '../modules/dispatch/repository.js';
import { clearBuffers, replay } from '../realtime/bus.js';
import { driverRoom, rideRoom } from '../realtime/events.js';
import {
  auth,
  createDriver,
  createOps,
  createPassenger,
  seedTariffs,
  waitFor,
  type TestAccount,
  type TestDriver,
} from './support/fixtures.js';

let app: FastifyInstance;

const MELEN = { lat: 3.8541, lng: 11.4872, label: 'Carrefour Melen' };
const OBILI = { lat: 3.8482, lng: 11.4931, label: 'Carrefour Obili' };
const PRES_DE_MELEN = { lat: 3.857, lng: 11.489 };

beforeAll(async () => {
  await seedZones();
  await seedTariffs();
  app = await buildApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  driverPresence.clear();
  clearBuffers();
  await app?.close();
  await closeDatabase();
});

interface Scene {
  passenger: TestAccount;
  driver: TestDriver;
  rideId: string;
}

/** Commande une course et la laisse en `requested`/`offered` : PAS encore acceptée. */
async function courseCommandee(nom: string): Promise<Scene> {
  driverPresence.clear();

  const passenger = await createPassenger(app, nom);
  const driver = await createDriver(app, { displayName: 'Boris Messages' });

  const online = await app.inject({
    method: 'POST',
    url: '/v1/driver/online',
    headers: auth(driver),
    payload: { position: PRES_DE_MELEN },
  });
  expect(online.statusCode).toBe(200);

  const quote = await app.inject({
    method: 'POST',
    url: '/v1/quotes',
    headers: auth(passenger),
    payload: { pickup: MELEN, dropoff: OBILI },
  });
  const eco = (quote.json() as { offers: Array<{ offer: string; quoteId: string }> }).offers.find(
    (entry) => entry.offer === 'eco',
  )!;

  const ride = await app.inject({
    method: 'POST',
    url: '/v1/rides',
    headers: { ...auth(passenger), 'idempotency-key': crypto.randomUUID() },
    payload: { quoteId: eco.quoteId, offer: 'eco', paymentMethod: 'cash' },
  });
  expect(ride.statusCode).toBe(201);

  return { passenger, driver, rideId: (ride.json() as { id: string }).id };
}

/** … puis la fait accepter par le chauffeur : le canal s'ouvre à cet instant. */
async function courseAcceptee(nom: string): Promise<Scene> {
  const scene = await courseCommandee(nom);

  const depuis = new Date(Date.now() - 120_000).toISOString();
  const offerId = await waitFor(
    async () => {
      const found = replay(driverRoom(scene.driver.id), depuis).find(
        (entry) =>
          entry.event === 'ride.offer' &&
          (entry.payload as { rideId: string }).rideId === scene.rideId,
      );
      return found ? (found.payload as { offerId: string }).offerId : null;
    },
    { label: 'offre de dispatch' },
  );

  const offers = await dispatchRepository.listOffers(scene.rideId);
  expect(offers.some((entry) => entry.id === offerId)).toBe(true);

  const accept = await app.inject({
    method: 'POST',
    url: `/v1/driver/offers/${offerId}/accept`,
    headers: auth(scene.driver),
  });
  expect(accept.json().accepted).toBe(true);

  return scene;
}

async function send(rideId: string, account: TestAccount, code: string) {
  return app.inject({
    method: 'POST',
    url: `/v1/rides/${rideId}/messages`,
    headers: auth(account),
    payload: { code },
  });
}

async function read(rideId: string, account: TestAccount) {
  return app.inject({
    method: 'GET',
    url: `/v1/rides/${rideId}/messages`,
    headers: auth(account),
  });
}

// ─── Le fil ──────────────────────────────────────────────────────────────────

describe('les deux parties se coordonnent avec six codes', () => {
  it('le passager et le chauffeur s’écrivent, chacun avec SES codes', async () => {
    const { passenger, driver, rideId } = await courseAcceptee('Aïcha Messages');

    const duChauffeur = await send(rideId, driver, 'ARRIVING');
    expect(duChauffeur.statusCode).toBe(201);
    expect(duChauffeur.json()).toMatchObject({ sender: 'driver', code: 'ARRIVING' });

    const duPassager = await send(rideId, passenger, 'IM_HERE');
    expect(duPassager.statusCode).toBe(201);
    expect(duPassager.json()).toMatchObject({ sender: 'passenger', code: 'IM_HERE' });

    // Les deux lisent le MÊME fil, dans le même ordre : c'est la condition pour qu'un
    // litige soit arbitrable, comme pour le statut de la course.
    for (const account of [passenger, driver]) {
      const fil = await read(rideId, account);
      expect(fil.statusCode).toBe(200);
      expect((fil.json() as { messages: Array<{ code: string }> }).messages.map((m) => m.code)).toEqual(
        ['ARRIVING', 'IM_HERE'],
      );
      expect(fil.json().window.open).toBe(true);
    }
  }, 60_000);

  it('un passager ne peut pas envoyer un message de chauffeur', async () => {
    const { passenger, driver, rideId } = await courseAcceptee('Aïcha Usurpatrice');

    // « J'arrive » est un message de chauffeur : sinon n'importe qui fabriquerait la
    // preuve que l'autre était en route.
    const refus = await send(rideId, passenger, 'ARRIVING');
    expect(refus.statusCode).toBe(400);
    expect(refus.json().code).toBe('VALIDATION_ERROR');

    const inverse = await send(rideId, driver, 'WHERE_ARE_YOU');
    expect(inverse.statusCode).toBe(400);
  }, 60_000);

  it('refuse un code inventé, et tout texte libre', async () => {
    const { passenger, rideId } = await courseAcceptee('Aïcha Bavarde');

    for (const corps of [
      { code: 'BONJOUR' },
      { code: 'IM_HERE', body: 'appelle-moi au 690000000' },
      { code: '' },
    ]) {
      const refus = await app.inject({
        method: 'POST',
        url: `/v1/rides/${rideId}/messages`,
        headers: auth(passenger),
        payload: corps,
      });
      expect(refus.statusCode, JSON.stringify(corps)).toBe(400);
    }
  }, 60_000);

  it('émet message.new dans la salle de la course, avec le code seul', async () => {
    const { driver, rideId } = await courseAcceptee('Aïcha Temps Réel');
    const depuis = new Date(Date.now() - 1000).toISOString();

    await send(rideId, driver, 'IM_OUTSIDE');

    const annonce = replay(rideRoom(rideId), depuis).find((entry) => entry.event === 'message.new');
    expect(annonce, 'aucun message.new dans la salle de la course').toBeTruthy();

    const payload = annonce!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ rideId, sender: 'driver', code: 'IM_OUTSIDE' });
    // Le serveur ne transporte QUE le code : pas de libellé français dans la charge utile.
    expect(JSON.stringify(payload)).not.toContain('Je suis devant');
    expect(Object.keys(payload).sort()).toEqual(['at', 'code', 'id', 'rideId', 'sender']);
  }, 60_000);
});

// ─── Qui a le droit ──────────────────────────────────────────────────────────

describe('un tiers n’entre pas dans la conversation', () => {
  it('403 en lecture comme en écriture, pour un passager étranger à la course', async () => {
    const { rideId } = await courseAcceptee('Aïcha Privée');
    const curieux = await createPassenger(app, 'Passant Curieux');

    const lecture = await read(rideId, curieux);
    expect(lecture.statusCode).toBe(403);
    expect(lecture.json().code).toBe('FORBIDDEN');

    const ecriture = await send(rideId, curieux, 'IM_HERE');
    expect(ecriture.statusCode).toBe(403);
  }, 60_000);

  it('403 aussi pour un autre chauffeur, et pour l’ops', async () => {
    const { rideId } = await courseAcceptee('Aïcha Discrète');
    const autreChauffeur = await createDriver(app, { displayName: 'Nadine Ailleurs' });
    const ops = await createOps(app);

    expect((await read(rideId, autreChauffeur)).statusCode).toBe(403);
    expect((await send(rideId, autreChauffeur, 'ARRIVING')).statusCode).toBe(403);

    // L'ops voit les statuts et la carte, pas les conversations : le brief ne lui ouvre
    // le fil que sur litige, et les litiges sont hors périmètre (CLAUDE.md § 8.3).
    expect((await read(rideId, ops)).statusCode).toBe(403);
  }, 60_000);

  it('exige un jeton', async () => {
    const { rideId } = await courseAcceptee('Aïcha Anonyme');

    const sansJeton = await app.inject({
      method: 'GET',
      url: `/v1/rides/${rideId}/messages`,
    });
    expect(sansJeton.statusCode).toBe(401);
  }, 60_000);
});

// ─── La fenêtre ──────────────────────────────────────────────────────────────

describe('la conversation s’ouvre à l’acceptation et se ferme 30 min après la fin', () => {
  it('refuse AVANT l’acceptation : il n’y a personne en face', async () => {
    const { passenger, rideId } = await courseCommandee('Aïcha Pressée');

    const refus = await send(rideId, passenger, 'WHERE_ARE_YOU');
    expect(refus.statusCode).toBe(409);
    expect(refus.json().code).toBe('MESSAGING_CLOSED');
    expect(refus.json().message).toMatch(/accepte/i);

    // La lecture, elle, répond : un fil vide et une fenêtre fermée, de quoi griser le
    // bouton et dire pourquoi.
    const fil = await read(rideId, passenger);
    expect(fil.statusCode).toBe(200);
    expect(fil.json().messages).toEqual([]);
    expect(fil.json().window).toMatchObject({ open: false, reason: 'before_accept' });
  }, 60_000);

  it('refuse APRÈS la fenêtre de 30 min, et dit où écrire', async () => {
    const { passenger, driver, rideId } = await courseAcceptee('Aïcha Tardive');

    // On termine la course en base et on recule sa fin d'une heure : rejouer 30 minutes
    // pour de vrai coûterait 30 minutes.
    const finished = new Date(Date.now() - (MESSAGING_WINDOW_AFTER_END_S + 600) * 1000);
    await db
      .update(rides)
      .set({ status: 'completed', completedAt: finished })
      .where(eq(rides.id, rideId));

    const refus = await send(rideId, passenger, 'IM_HERE');
    expect(refus.statusCode).toBe(409);
    expect(refus.json().code).toBe('MESSAGING_CLOSED');
    expect(refus.json().details).toMatchObject({ reason: 'after_end' });

    expect((await send(rideId, driver, 'ARRIVING')).statusCode).toBe(409);

    // Relire reste possible : ce qui a été dit ne disparaît pas avec la fenêtre.
    const fil = await read(rideId, passenger);
    expect(fil.statusCode).toBe(200);
    expect(fil.json().window).toMatchObject({ open: false, reason: 'after_end' });
    expect(fil.json().window.closes_at).toBeTruthy();
  }, 60_000);

  it('reste ouverte juste après la fin de course', async () => {
    const { passenger, rideId } = await courseAcceptee('Aïcha Oublieuse');

    await db
      .update(rides)
      .set({ status: 'completed', completedAt: new Date(Date.now() - 60_000) })
      .where(eq(rides.id, rideId));

    // « J'ai oublié mon sac » : c'est très exactement ce que ces 30 minutes servent.
    const message = await send(rideId, passenger, 'WHERE_ARE_YOU');
    expect(message.statusCode).toBe(201);
  }, 60_000);
});

// ─── Le quota ────────────────────────────────────────────────────────────────

describe('10 messages par course et par personne', () => {
  it('refuse le onzième, mais laisse l’autre partie parler', async () => {
    const { passenger, driver, rideId } = await courseAcceptee('Aïcha Insistante');

    for (let i = 0; i < MAX_MESSAGES_PER_PARTY; i += 1) {
      const response = await send(rideId, passenger, 'WHERE_ARE_YOU');
      expect(response.statusCode, `message ${i + 1}`).toBe(201);
    }

    const refus = await send(rideId, passenger, 'IM_HERE');
    expect(refus.statusCode).toBe(429);
    expect(refus.json().code).toBe('MESSAGE_QUOTA_REACHED');

    // Le quota est PAR PERSONNE : le chauffeur n'est pas puni pour l'insistance du
    // passager, sinon il ne pourrait plus dire qu'il est arrivé.
    expect((await send(rideId, driver, 'ARRIVING')).statusCode).toBe(201);
  }, 60_000);
});

// ─── Vie privée ──────────────────────────────────────────────────────────────

describe('aucune donnée personnelle dans le fil', () => {
  it('un code, un expéditeur, une heure — et rien d’autre', async () => {
    const { passenger, driver, rideId } = await courseAcceptee('Aïcha Confidentielle');
    await send(rideId, driver, 'CANT_FIND');
    await send(rideId, passenger, 'IM_HERE');

    const [driverRow] = await db.select().from(users).where(eq(users.id, driver.id));
    const [passengerRow] = await db.select().from(users).where(eq(users.id, passenger.id));

    const fil = await read(rideId, passenger);
    const brut = fil.body;

    // La forme d'abord : quatre champs, pas un de plus. Une colonne ajoutée demain ne
    // peut pas sortir sans que ce test le dise.
    for (const message of (fil.json() as { messages: Array<Record<string, unknown>> }).messages) {
      expect(Object.keys(message).sort()).toEqual(['code', 'created_at', 'id', 'sender']);
    }

    for (const [quoi, valeur] of [
      ['téléphone du chauffeur', driverRow?.phone],
      ['téléphone du passager', passengerRow?.phone],
      ['ID VORA du chauffeur', driver.voraId],
      ['ID VORA du passager', passenger.voraId],
      ['identifiant interne du chauffeur', driver.id],
    ] as const) {
      if (!valeur) continue;
      expect(brut, `${quoi} dans la réponse`).not.toContain(valeur);
    }

    expect(brut).not.toContain('Boris');
    expect(brut).not.toContain('Aïcha');
    // Le libellé français reste côté client : le serveur ne transporte que le code.
    expect(brut).not.toContain('Je ne vous trouve pas');
  }, 60_000);
});
