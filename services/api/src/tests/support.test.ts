// VORA — l'assistant de support, SUR UNE VRAIE COURSE.
//
// LA QUESTION QUI COMPTE : qu'est-ce qui sort de nos machines quand on interroge un
// modèle de langage hébergé ailleurs ?
//
// La réponse ne peut pas être « rien de sensible, promis ». Ces tests montent une course
// réelle — passager avec numéro, chauffeur avec numéro et plaque, position GPS, code de
// montée — puis inspectent le contexte EXACT qui partirait chez le fournisseur. Un champ
// ajouté demain à `rides` qui remonterait jusque-là ferait échouer ce fichier.
//
// Ils vérifient aussi ce qui doit rester vrai quand le réseau tombe : sans fournisseur
// configuré, le support répond quand même, à partir de la FAQ.

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, db } from '../db/client.js';
import { users, vehicles } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { seedZones } from '../db/seed/geography.js';
import { driverPresence } from '../modules/dispatch/presence.js';
import { buildContext, contextFingerprint } from '../modules/support/context.js';
import { inventsAmount } from '../modules/support/guard.js';
import { QUOTA_PER_HOUR, resetSupportMemory } from '../modules/support/limits.js';
import { renderContext } from '../modules/support/prompt.js';
import { clearBuffers, replay } from '../realtime/bus.js';
import { driverRoom } from '../realtime/events.js';
import * as dispatchRepository from '../modules/dispatch/repository.js';
import {
  auth,
  createDriver,
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
  resetSupportMemory();
  await app?.close();
  await closeDatabase();
});

beforeEach(() => {
  // Le quota est de 10 questions par heure : sans remise à zéro, le onzième `it` du
  // fichier échouerait pour une raison qui n'a rien à voir avec ce qu'il teste.
  resetSupportMemory();
});

async function askSupport(account: TestAccount, question: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/support/ask',
    headers: auth(account),
    payload: { question },
  });
}

/** Monte une course jusqu'à `accepted` : c'est l'état où le contexte est le plus riche. */
async function courseAcceptee(): Promise<{
  passenger: TestAccount;
  driver: TestDriver;
  rideId: string;
}> {
  driverPresence.clear();

  const passenger = await createPassenger(app, 'Aïcha Support');
  const driver = await createDriver(app, { displayName: 'Boris Support' });

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
  const rideId = (ride.json() as { id: string }).id;

  const depuis = new Date(Date.now() - 120_000).toISOString();
  const offerId = await waitFor(
    async () => {
      const found = replay(driverRoom(driver.id), depuis).find(
        (entry) =>
          entry.event === 'ride.offer' && (entry.payload as { rideId: string }).rideId === rideId,
      );
      return found ? (found.payload as { offerId: string }).offerId : null;
    },
    { label: 'offre de dispatch' },
  );
  const offers = await dispatchRepository.listOffers(rideId);
  expect(offers.some((entry) => entry.id === offerId)).toBe(true);

  const accept = await app.inject({
    method: 'POST',
    url: `/v1/driver/offers/${offerId}/accept`,
    headers: auth(driver),
  });
  expect(accept.json().accepted).toBe(true);

  return { passenger, driver, rideId };
}

// ─── Ce qui sort de nos machines ─────────────────────────────────────────────

describe('le contexte envoyé au modèle ne porte AUCUNE donnée personnelle', () => {
  it('ni numéro, ni e-mail, ni position, ni identifiant d’un tiers', async () => {
    const { passenger, driver } = await courseAcceptee();

    // Ce que la base sait vraiment de ces deux personnes. C'est cela qu'on cherche dans
    // le contexte : les vraies valeurs, pas un motif approximatif.
    const [passengerRow] = await db.select().from(users).where(eq(users.id, passenger.id));
    const [driverRow] = await db.select().from(users).where(eq(users.id, driver.id));
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, driver.vehicleId));

    for (const viewer of [
      { id: passenger.id, role: 'passenger' as const },
      { id: driver.id, role: 'driver' as const },
    ]) {
      const context = await buildContext(viewer, 'combien coûte ma course et où est le chauffeur ?');
      expect(context.ride, 'la course en cours doit être dans le contexte').not.toBeNull();

      // On inspecte les DEUX formes : l'objet validé, et la prose réellement envoyée.
      const serialized = `${JSON.stringify(context)}\n${renderContext(context)}`;

      const interdits: Array<[string, string | null]> = [
        ['téléphone du passager', passengerRow?.phone ?? null],
        ['téléphone du chauffeur', driverRow?.phone ?? null],
        ['e-mail du passager', passengerRow?.email ?? null],
        ['e-mail du chauffeur', driverRow?.email ?? null],
        ['identifiant interne du passager', passenger.id],
        ['identifiant interne du chauffeur', driver.id],
        ['ID VORA du passager', passenger.voraId],
        ['ID VORA du chauffeur', driver.voraId],
      ];

      for (const [quoi, valeur] of interdits) {
        if (!valeur) continue;
        expect(serialized, `${quoi} présent dans le contexte`).not.toContain(valeur);
      }

      // Position brute : ni latitude ni longitude, sous aucune forme.
      expect(serialized).not.toContain(String(MELEN.lat));
      expect(serialized).not.toContain(String(MELEN.lng));
      expect(serialized).not.toContain(String(PRES_DE_MELEN.lat));
      expect(serialized).not.toMatch(/\b3\.8\d{2,}\b/);
      expect(serialized).not.toMatch(/\b11\.4\d{2,}\b/);

      // Les noms non plus : le contexte n'a jamais eu besoin de savoir qui parle.
      expect(serialized).not.toContain('Aïcha');
      expect(serialized).not.toContain('Boris');
    }

    // Ce qui DOIT y être, en revanche : la plaque, que le passager lit déjà sur sa fiche.
    const context = await buildContext(
      { id: passenger.id, role: 'passenger' },
      'quelle est la plaque de mon chauffeur ?',
    );
    expect(context.ride?.driver_plate).toBeTruthy();
    expect(vehicle?.plate).toBeTruthy();
  }, 60_000);

  it('le net du chauffeur ne fuit pas vers le passager', async () => {
    const { passenger, driver } = await courseAcceptee();

    const cotePassager = await buildContext({ id: passenger.id, role: 'passenger' }, 'combien je paie ?');
    const coteChauffeur = await buildContext({ id: driver.id, role: 'driver' }, 'combien je gagne ?');

    // La décomposition brut / commission / DGI / net ne regarde que le chauffeur : c'est
    // `toRideDto` qui le décide, et le contexte hérite de sa décision sans la refaire.
    expect(cotePassager.ride?.breakdown).toBeNull();
    expect(coteChauffeur.ride?.breakdown).not.toBeNull();
    expect(coteChauffeur.ride?.breakdown?.net).toBeGreaterThan(0);
  }, 60_000);

  it('sans course en cours, le contexte ne porte que la FAQ', async () => {
    const passenger = await createPassenger(app, 'Sans Course');
    const context = await buildContext({ id: passenger.id, role: 'passenger' }, 'comment payer ?');

    expect(context.ride).toBeNull();
    expect(context.faq.length).toBeGreaterThan(0);
    // Deux personnes sans course partagent la même empreinte : c'est ce qui rend le cache
    // utile, et c'est sans danger — il n'y a aucun fait personnel à partager.
    expect(contextFingerprint(context)).toBe('passenger:sans-course');
  }, 30_000);
});

// ─── La réponse ──────────────────────────────────────────────────────────────

describe('POST /v1/support/ask', () => {
  it('répond sans fournisseur configuré : la FAQ suffit', async () => {
    const passenger = await createPassenger(app, 'Question Simple');

    const response = await askSupport(passenger, 'Est-ce que le prix peut changer après ma commande ?');

    expect(response.statusCode).toBe(200);
    const body = response.json() as { answer: string; sources: string[]; escalate: boolean };
    expect(body.escalate).toBe(false);
    expect(body.sources).toContain('prix-ferme');
    expect(body.answer).toMatch(/ferme/i);
  }, 30_000);

  it('escalade au lieu d’inventer quand la question sort du périmètre', async () => {
    const passenger = await createPassenger(app, 'Question Hors Sujet');

    const response = await askSupport(passenger, 'Quelle est la capitale de la Mongolie ?');

    expect(response.statusCode).toBe(200);
    const body = response.json() as { answer: string; escalate: boolean };
    expect(body.escalate).toBe(true);
    expect(body.answer).toMatch(/conseiller/i);
    // Surtout pas de réponse : « Oulan-Bator » serait juste, et hors de propos.
    expect(body.answer).not.toMatch(/oulan/i);
  }, 30_000);

  it('la réponse ne contient aucune donnée personnelle, même avec une course en cours', async () => {
    const { passenger, driver } = await courseAcceptee();
    const [driverRow] = await db.select().from(users).where(eq(users.id, driver.id));

    const response = await askSupport(passenger, 'Comment je paie ma course ?');
    const body = response.json() as { answer: string };

    expect(response.statusCode).toBe(200);
    if (driverRow?.phone) expect(body.answer).not.toContain(driverRow.phone);
    expect(body.answer).not.toContain(driver.voraId);
    expect(body.answer).not.toContain('Boris');
  }, 60_000);

  it('refuse la onzième question de l’heure, et dit quand revenir', async () => {
    const passenger = await createPassenger(app, 'Trop Curieux');

    for (let i = 0; i < QUOTA_PER_HOUR; i += 1) {
      // Des questions DIFFÉRENTES : le cache ne doit pas être ce qui fait passer le test.
      const response = await askSupport(passenger, `Question numéro ${i} sur le paiement`);
      expect(response.statusCode).toBe(200);
    }

    const refus = await askSupport(passenger, 'Et une de plus ?');
    expect(refus.statusCode).toBe(429);
    expect(refus.json().code).toBe('SUPPORT_QUOTA_REACHED');
    expect(refus.json().message).toMatch(/revient dans/i);
  }, 60_000);

  it('exige un jeton : le support parle à des gens identifiés', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/support/ask',
      payload: { question: 'Comment payer ?' },
    });

    expect(response.statusCode).toBe(401);
  });
});

// ─── Le garde-fou des montants ───────────────────────────────────────────────

describe('les montants viennent du serveur, jamais du modèle', () => {
  it('accepte un montant du contexte et refuse un montant inventé', async () => {
    const { passenger } = await courseAcceptee();
    const context = await buildContext({ id: passenger.id, role: 'passenger' }, 'combien coûte ma course ?');
    const rendu = renderContext(context);
    const prix = context.ride!.price_xaf;

    expect(inventsAmount(`Votre course est à ${prix} F, et ce prix ne bougera pas.`, rendu)).toBe(
      false,
    );
    // 999 999 n'est nulle part dans le contexte : c'est exactement le cas qu'on refuse.
    expect(inventsAmount('Votre course est à 999 999 F.', rendu)).toBe(true);
  }, 60_000);
});
