// VORA — la page d'administration, côté serveur. SUR UNE VRAIE BASE.
//
// Le manuel du hackathon classe l'administration en « recommandé ». On tient donc UNE
// page, mais elle doit être VRAIE : ses compteurs sortent des mêmes tables que les
// applications, sa validation de dossier autorise réellement un chauffeur à travailler,
// et son interrupteur de pluie change réellement le prix du passager suivant.
//
// C'est ce que vérifient ces tests : pas que les routes répondent 200, mais qu'elles
// changent quelque chose ailleurs.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, db } from '../db/client.js';
import { driverProfiles } from '../db/schema.js';
import { seedZones } from '../db/seed/geography.js';
import { driverPresence } from '../modules/dispatch/presence.js';
import { resetSurge } from '../modules/pricing/surge.js';
import { clearBuffers } from '../realtime/bus.js';
import {
  auth,
  createDriver,
  createOps,
  createPassenger,
  seedTariffs,
  type TestAccount,
  type TestDriver,
} from './support/fixtures.js';

let app: FastifyInstance;
let ops: TestAccount;

const MELEN = { lat: 3.8541, lng: 11.4872, label: 'Carrefour Melen' };
const OBILI = { lat: 3.8482, lng: 11.4931, label: 'Carrefour Obili' };
const PRES_DE_MELEN = { lat: 3.857, lng: 11.489 };

beforeAll(async () => {
  await seedZones();
  await seedTariffs();
  app = await buildApp();
  await app.ready();
  ops = await createOps(app);
}, 60_000);

afterAll(async () => {
  resetSurge();
  driverPresence.clear();
  clearBuffers();
  await app?.close();
  await closeDatabase();
});

describe('accès', () => {
  it('toutes les routes ops refusent un passager', async () => {
    const passenger = await createPassenger(app, 'Aïcha Curieuse');

    for (const url of ['/v1/ops/dashboard', '/v1/ops/rides', '/v1/ops/drivers', '/v1/ops/surge']) {
      const response = await app.inject({ method: 'GET', url, headers: auth(passenger) });
      expect(response.statusCode, url).toBe(403);
    }
  });

  it('et refusent une requête sans jeton', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/ops/dashboard' });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /v1/ops/dashboard', () => {
  it('rend les six compteurs, la majoration et l’état du routage', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/ops/dashboard',
      headers: auth(ops),
    });

    expect(response.statusCode).toBe(200);
    const board = response.json();

    expect(Object.keys(board.counters)).toEqual([
      'driversOnline',
      'ridesLive',
      'ridesToday',
      'ridesUnservedToday',
      'grossTodayXaf',
      'driverNetTodayXaf',
    ]);
    for (const value of Object.values(board.counters)) {
      expect(Number.isInteger(value)).toBe(true);
    }

    // Les montants voyagent formatés : les trois surfaces affichent la même espace fine.
    expect(board.formatted.grossToday).toMatch(/ ?F$/);
    // Le disjoncteur de routage doit être VISIBLE avant de passer devant le jury.
    expect(typeof board.routing.circuitOpen).toBe('boolean');
  });

  it('compte les chauffeurs réellement joignables, pas ceux déclarés en ligne', async () => {
    driverPresence.clear();
    const avant = (
      await app.inject({ method: 'GET', url: '/v1/ops/dashboard', headers: auth(ops) })
    ).json().counters.driversOnline;
    expect(avant).toBe(0);

    const driver = await createDriver(app, { displayName: 'Boris Ops' });
    await app.inject({
      method: 'POST',
      url: '/v1/driver/online',
      headers: auth(driver),
      payload: { position: PRES_DE_MELEN },
    });

    const apres = (
      await app.inject({ method: 'GET', url: '/v1/ops/dashboard', headers: auth(ops) })
    ).json().counters.driversOnline;
    expect(apres).toBe(1);

    // La position vient de la MÉMOIRE : si elle disparaît, le chauffeur disparaît de la
    // carte, même si la base le dit encore en ligne. C'est le comportement voulu — on ne
    // propose pas une course à quelqu'un dont on ignore où il est.
    driverPresence.clear();
    const apresOubli = (
      await app.inject({ method: 'GET', url: '/v1/ops/dashboard', headers: auth(ops) })
    ).json().counters.driversOnline;
    expect(apresOubli).toBe(0);
  }, 30_000);
});

describe('validation des dossiers chauffeurs', () => {
  /** Un chauffeur dont le dossier est EN ATTENTE : c'est le cas qui compte. */
  async function chauffeurEnAttente(nom: string): Promise<TestDriver> {
    const driver = await createDriver(app, { displayName: nom });
    await db
      .update(driverProfiles)
      .set({ status: 'pending', verifiedAt: null })
      .where(eq(driverProfiles.userId, driver.id));
    return driver;
  }

  it('un dossier en attente ne peut pas se mettre en ligne', async () => {
    const driver = await chauffeurEnAttente('Samuel En-Attente');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/driver/online',
      headers: auth(driver),
      payload: { position: PRES_DE_MELEN },
    });

    // C'est la promesse « chauffeurs vérifiés », et elle se tient ici, pas dans un écran.
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('DRIVER_NOT_APPROVED');
  });

  it('il apparaît dans la file de revue, sans aucune coordonnée personnelle', async () => {
    const driver = await chauffeurEnAttente('Fatou En-Attente');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/ops/drivers?status=pending',
      headers: auth(ops),
    });

    expect(response.statusCode).toBe(200);
    const file = response.json();
    const dossier = file.drivers.find(
      (row: { display_name: string }) => row.display_name === 'Fatou En-Attente',
    );

    expect(dossier).toBeDefined();
    expect(dossier.vora_id).toMatch(/^\d{8}$/);
    expect(dossier.vehicle.plate).toMatch(/^CE /);
    expect(JSON.stringify(file)).not.toMatch(/\+237/);
    expect(dossier.user_id).toBe(driver.id);
  });

  it('la validation débloque réellement la mise en ligne', async () => {
    const driver = await chauffeurEnAttente('Jean-Pierre Validé');

    const decision = await app.inject({
      method: 'POST',
      url: `/v1/ops/drivers/${driver.id}/decision`,
      headers: auth(ops),
      payload: { decision: 'approve' },
    });

    expect(decision.statusCode).toBe(200);
    expect(decision.json()).toMatchObject({ status: 'approved' });
    expect(decision.json().vora_id).toBe(driver.voraId);

    const online = await app.inject({
      method: 'POST',
      url: '/v1/driver/online',
      headers: auth(driver),
      payload: { position: PRES_DE_MELEN },
    });
    expect(online.statusCode).toBe(200);
  });

  it('une suspension coupe le chauffeur SUR-LE-CHAMP, pas au prochain démarrage', async () => {
    const driver = await createDriver(app, { displayName: 'Nadine Suspendue' });
    await app.inject({
      method: 'POST',
      url: '/v1/driver/online',
      headers: auth(driver),
      payload: { position: PRES_DE_MELEN },
    });
    expect(driverPresence.get(driver.id)).not.toBeNull();

    const decision = await app.inject({
      method: 'POST',
      url: `/v1/ops/drivers/${driver.id}/decision`,
      headers: auth(ops),
      payload: { decision: 'suspend', reason: 'documents expirés' },
    });

    expect(decision.json().status).toBe('suspended');
    // Retiré de la mémoire du dispatch : il ne peut plus recevoir de course, même si
    // son application est toujours ouverte.
    expect(driverPresence.get(driver.id)).toBeNull();

    const [profil] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driver.id));
    expect(profil?.online).toBe(false);
  }, 30_000);

  it('un refus sans motif est refusé', async () => {
    const driver = await chauffeurEnAttente('Sans Motif');

    const response = await app.inject({
      method: 'POST',
      url: `/v1/ops/drivers/${driver.id}/decision`,
      headers: auth(ops),
      payload: { decision: 'reject' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('un dossier inconnu donne 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ops/drivers/11111111-1111-4111-8111-111111111111/decision',
      headers: auth(ops),
      payload: { decision: 'approve' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('interrupteur de majoration', () => {
  it('change réellement le prix du devis suivant, puis se coupe', async () => {
    const passenger = await createPassenger(app, 'Aïcha Pluie');

    const prixOf = async (): Promise<number> => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        headers: auth(passenger),
        payload: { pickup: MELEN, dropoff: OBILI },
      });
      const offers = response.json().offers as Array<{ offer: string; price: number }>;
      return offers.find((entry) => entry.offer === 'eco')!.price;
    };

    const avant = await prixOf();

    await app.inject({
      method: 'POST',
      url: '/v1/ops/surge',
      headers: auth(ops),
      payload: { percent: 30, reason: 'pluie sur Yaoundé' },
    });

    expect(await prixOf()).toBeGreaterThan(avant);

    const etat = await app.inject({
      method: 'GET',
      url: '/v1/ops/surge',
      headers: auth(ops),
    });
    expect(etat.json()).toMatchObject({ percent: 30, reason: 'pluie sur Yaoundé' });

    await app.inject({
      method: 'POST',
      url: '/v1/ops/surge',
      headers: auth(ops),
      payload: { percent: 0 },
    });

    expect(await prixOf()).toBe(avant);
  }, 40_000);

  it('refuse une majoration au-delà du plafond de 50 %', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ops/surge',
      headers: auth(ops),
      payload: { percent: 80 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });
});
