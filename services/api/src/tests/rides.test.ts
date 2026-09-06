// VORA — la boucle complète, SUR UNE VRAIE BASE POSTGIS.
//
//   devis → commande → offre → acceptation → code de montée → course → espèces
//
// Ces tests ne simulent rien : ni la base, ni le dispatch, ni ses minuteries. Ils
// passent par les vraies routes HTTP, avec de vrais jetons, et lisent les vraies lignes.
// C'est la seule façon de vérifier ce qui compte ici — que le prix ne bouge pas d'un
// franc entre le devis et le reçu, que le chauffeur ne voie jamais le code de montée, et
// que le journal `ride_events` raconte exactement ce qui s'est passé.
//
// `npm test` monte `vora_test`, applique les migrations, lance ceci, puis supprime la base.

import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, db } from '../db/client.js';
import { driverEarnings, driverProfiles, quotes, rides } from '../db/schema.js';
import { seedZones } from '../db/seed/geography.js';
import { CANCEL_FEE, FREE_CANCEL_WINDOW_S, NO_SHOW_WAIT_S } from '../domain/rules.js';
import { computeDriverEarnings } from '../modules/pricing/fare.js';
import { driverPresence } from '../modules/dispatch/presence.js';
import * as dispatchRepository from '../modules/dispatch/repository.js';
import * as ridesRepository from '../modules/rides/repository.js';
import { clearBuffers, replay } from '../realtime/bus.js';
import { rideRoom, driverRoom, OPS_ROOM } from '../realtime/events.js';
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

/** Repères réels de Yaoundé, aux coordonnées du seed (cf. `geo.test.ts`). */
const MELEN = { lat: 3.8541, lng: 11.4872, label: 'Carrefour Melen' };
const OBILI = { lat: 3.8482, lng: 11.4931, label: 'Carrefour Obili' };
const POSTE_CENTRALE = { lat: 3.8659, lng: 11.5171, label: 'Poste Centrale' };
/** ~400 m au nord-est de Melen : dans le rayon de la première vague (1 km). */
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

// ─── Outils du scénario ──────────────────────────────────────────────────────

interface QuoteOffer {
  offer: 'eco' | 'confort' | 'moto';
  quoteId: string | null;
  price: number;
  priceFormatted: string;
  etaMin: number | null;
  breakdown: { base: number; distance: number; time: number; surge: number };
  lines: Array<{ key: string; label: string; amount: number }>;
  available: boolean;
  unavailableReason: string | null;
  unavailableZoneId: string | null;
  signature: string | null;
}

interface QuoteResponse {
  expiresAt: string;
  expiresInS: number;
  routing: 'osrm' | 'fallback';
  distanceKm: number;
  durationMin: number;
  routePolyline: string;
  offers: QuoteOffer[];
}

async function goOnline(driver: TestDriver, position = PRES_DE_MELEN): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/driver/online',
    headers: auth(driver),
    payload: { position },
  });
  expect(response.statusCode).toBe(200);
}

async function askQuote(
  passenger: TestAccount,
  pickup = MELEN,
  dropoff = POSTE_CENTRALE,
): Promise<QuoteResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/quotes',
    headers: auth(passenger),
    payload: { pickup, dropoff },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as QuoteResponse;
}

function offerOf(quote: QuoteResponse, name: QuoteOffer['offer']): QuoteOffer {
  const found = quote.offers.find((entry) => entry.offer === name);
  if (!found) throw new Error(`Offre ${name} absente du devis.`);
  return found;
}

async function order(
  passenger: TestAccount,
  quoteId: string,
  offer: QuoteOffer['offer'] = 'eco',
  key = crypto.randomUUID(),
) {
  return app.inject({
    method: 'POST',
    url: '/v1/rides',
    headers: { ...auth(passenger), 'idempotency-key': key },
    payload: { quoteId, offer, paymentMethod: 'cash' },
  });
}

/**
 * Attend que le dispatch ait proposé la course À CE CHAUFFEUR, et rend l'offre.
 *
 * On attend l'ÉVÉNEMENT `ride.offer`, pas la ligne en base : c'est très exactement ce
 * qu'un vrai chauffeur attend, et c'est le seul instant où l'identifiant de l'offre
 * existe de son point de vue. Guetter la ligne en base ferait répondre le test plus tôt
 * qu'aucun client réel ne le peut — et il testerait alors une course de vitesse qui
 * n'existe pas.
 */
async function waitForOffer(rideId: string, driverId: string) {
  const depuis = new Date(Date.now() - 120_000).toISOString();

  const offerId = await waitFor(
    async () => {
      const annonces = replay(driverRoom(driverId), depuis);
      const offre = annonces.find(
        (entry) =>
          entry.event === 'ride.offer' && (entry.payload as { rideId: string }).rideId === rideId,
      );
      return offre ? (offre.payload as { offerId: string }).offerId : null;
    },
    { label: `offre de dispatch pour ${rideId}` },
  );

  const offers = await dispatchRepository.listOffers(rideId);
  const offer = offers.find((entry) => entry.id === offerId);
  if (!offer) throw new Error(`Offre ${offerId} introuvable en base.`);
  return offer;
}

async function readRide(rideId: string, account: TestAccount) {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/rides/${rideId}`,
    headers: auth(account),
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

// ─── Le devis ────────────────────────────────────────────────────────────────

describe('POST /v1/quotes — le prix s’affiche avant la commande', () => {
  let passenger: TestAccount;

  beforeAll(async () => {
    passenger = await createPassenger(app, 'Aïcha Devis');
  });

  it('rend les trois offres, chacune décomposée ligne par ligne', async () => {
    const quote = await askQuote(passenger, MELEN, OBILI);

    expect(quote.offers.map((entry) => entry.offer)).toEqual(['eco', 'confort', 'moto']);
    expect(['osrm', 'fallback']).toContain(quote.routing);
    expect(quote.distanceKm).toBeGreaterThan(0);
    expect(quote.expiresInS).toBe(120);

    const eco = offerOf(quote, 'eco');
    // La décomposition n'est pas décorative : la somme des lignes EST le prix.
    expect(eco.lines.reduce((total, line) => total + line.amount, 0)).toBe(eco.price);
    expect(eco.lines.map((line) => line.key)).toContain('base');
    // Espace fine insécable imposée par la charte (CLAUDE.md § 6.2).
    expect(eco.priceFormatted).toMatch(/ ?F$/);
  }, 20_000);

  it('Confort coûte plus cher qu’Éco, et Moto moins que les deux', async () => {
    const quote = await askQuote(passenger, MELEN, OBILI);
    const eco = offerOf(quote, 'eco');
    const confort = offerOf(quote, 'confort');
    const moto = offerOf(quote, 'moto');

    expect(confort.price).toBeGreaterThan(eco.price);
    expect(moto.price).toBeLessThan(eco.price);
  }, 20_000);

  it('signe chaque offre disponible : le prix est vérifiable, pas seulement promis', async () => {
    const quote = await askQuote(passenger, MELEN, OBILI);

    for (const offer of quote.offers.filter((entry) => entry.available)) {
      expect(offer.quoteId).toMatch(/^[0-9a-f-]{36}$/);
      expect(offer.signature).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 20_000);

  it('refuse la MOTO quand l’itinéraire touche une zone interdite, et dit laquelle', async () => {
    // Melen → Poste Centrale : l'arrivée est dans le centre urbain, interdit aux motos
    // par arrêté préfectoral. La voiture, elle, passe.
    const quote = await askQuote(passenger, MELEN, POSTE_CENTRALE);
    const moto = offerOf(quote, 'moto');

    expect(moto.available).toBe(false);
    expect(moto.quoteId).toBeNull();
    expect(moto.signature).toBeNull();
    expect(moto.unavailableReason).toMatch(/arrêté préfectoral/i);
    // La zone revient pour être dessinée sur la carte, pas pour un « impossible » sec.
    expect(moto.unavailableZoneId).toMatch(/^[0-9a-f-]{36}$/);

    expect(offerOf(quote, 'eco').available).toBe(true);
  }, 20_000);

  it('la majoration pluie de l’ops apparaît EN LIGNE SÉPARÉE, et reste plafonnée', async () => {
    const ops = await createOps(app);
    const avant = offerOf(await askQuote(passenger, MELEN, OBILI), 'eco');

    const active = await app.inject({
      method: 'POST',
      url: '/v1/ops/surge',
      headers: auth(ops),
      payload: { percent: 50, reason: 'pluie sur Yaoundé' },
    });
    expect(active.statusCode).toBe(200);
    expect(active.json().percent).toBe(50);

    try {
      const pendant = offerOf(await askQuote(passenger, MELEN, OBILI), 'eco');

      // Majoration visible, jamais fondue dans le total (CLAUDE.md § 5.1).
      const ligne = pendant.lines.find((line) => line.key === 'demand');
      expect(ligne?.label).toMatch(/\+50 %/);
      expect(pendant.price).toBeGreaterThan(avant.price);

      // Le plafond global × 1,5 du prix de base n'est jamais dépassé, majorations
      // comprises. C'est la limite qui empêche une nuit de pluie de doubler un prix.
      const base = pendant.lines
        .filter((line) => ['base', 'distance', 'time', 'minimum'].includes(line.key))
        .reduce((total, line) => total + line.amount, 0);
      expect(pendant.price).toBeLessThanOrEqual(Math.round((base * 150) / 100));
      // Et la somme des lignes reste égale au prix, plafond compris.
      expect(pendant.lines.reduce((total, line) => total + line.amount, 0)).toBe(pendant.price);
    } finally {
      // La majoration est un état de processus : on la coupe, sinon elle déborde sur
      // les scénarios suivants.
      await app.inject({
        method: 'POST',
        url: '/v1/ops/surge',
        headers: auth(ops),
        payload: { percent: 0 },
      });
    }
  }, 30_000);

  it('seul l’ops peut actionner la majoration', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ops/surge',
      headers: auth(passenger),
      payload: { percent: 50 },
    });
    expect(response.statusCode).toBe(403);
  });

  it('exige une session : un prix ferme s’attache à quelqu’un', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/quotes',
      payload: { pickup: MELEN, dropoff: OBILI },
    });
    expect(response.statusCode).toBe(401);
  });
});

// ─── La boucle complète ──────────────────────────────────────────────────────

describe('commande → offre → acceptation → code → course → espèces', () => {
  let passenger: TestAccount;
  let driver: TestDriver;
  let rideId: string;
  let priceAtQuote: number;
  let offerId: string;

  beforeAll(async () => {
    passenger = await createPassenger(app, 'Aïcha Mballa');
    driver = await createDriver(app, { displayName: 'Boris Nguema' });
    await goOnline(driver);
  });

  it('1. le passager commande : le prix se fige, la course part en dispatch', async () => {
    const quote = await askQuote(passenger);
    const eco = offerOf(quote, 'eco');
    priceAtQuote = eco.price;

    const response = await order(passenger, eco.quoteId!, 'eco');
    expect(response.statusCode).toBe(201);

    const ride = response.json();
    rideId = ride.id;

    expect(ride.price_quoted).toBe(priceAtQuote);
    expect(['requested', 'offered']).toContain(ride.status);
    expect(ride.payment_method).toBe('cash');
    // Le devis est consommé : il ne servira pas deux fois.
    const [used] = await db.select().from(quotes).where(eq(quotes.id, eco.quoteId!));
    expect(used?.consumedAt).not.toBeNull();
  }, 20_000);

  it('2. le dispatch propose la course à Boris, avec SON NET, pas le brut', async () => {
    const offer = await waitForOffer(rideId, driver.id);
    offerId = offer.id;

    const attendu = computeDriverEarnings(priceAtQuote, 'eco');
    expect(offer.driverNet).toBe(attendu.net);
    expect(offer.driverNet).toBeLessThan(priceAtQuote);
    expect(offer.wave).toBe(1);
    expect(offer.expiresAt.getTime() - offer.sentAt.getTime()).toBeCloseTo(15_000, -3);

    // L'événement est parti dans la salle du chauffeur, avec la décomposition.
    const emitted = replay(driverRoom(driver.id), new Date(Date.now() - 60_000).toISOString());
    const sent = emitted.find((entry) => entry.event === 'ride.offer');
    expect(sent?.payload).toMatchObject({ offerId, netXaf: attendu.net });
  }, 20_000);

  it('3. Boris accepte : les deux surfaces voient « accepted » au même instant', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/driver/offers/${offerId}/accept`,
      headers: auth(driver),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(true);

    // Pas de « dans un instant » : quand le chauffeur a sa réponse, la course EST
    // acceptée, et le passager la lit telle quelle.
    const vuDuPassager = await readRide(rideId, passenger);
    expect(vuDuPassager.status).toBe('accepted');
    expect(vuDuPassager.driver.first_name).toBe('Boris');
    expect(vuDuPassager.vehicle.plate).toMatch(/^CE /);
  });

  it('4. le passager voit le code de montée, le chauffeur JAMAIS', async () => {
    const vuDuPassager = await readRide(rideId, passenger);
    const vuDuChauffeur = await readRide(rideId, driver);

    expect(vuDuPassager.boarding_code).toMatch(/^\d{4}$/);
    // Toute la sécurité de la montée à bord tient dans cette ligne (CLAUDE.md § 5.5).
    expect(vuDuChauffeur.boarding_code).toBeNull();
  });

  it('4 bis. aucun numéro de téléphone ne franchit la frontière', async () => {
    const vuDuPassager = await readRide(rideId, passenger);
    const vuDuChauffeur = await readRide(rideId, driver);

    const brut = JSON.stringify([vuDuPassager, vuDuChauffeur]);
    expect(brut).not.toMatch(/\+237/);
    expect(brut).not.toMatch(/"phone"|"email"/);
    // LISTE POSITIVE, et volontairement rigide : elle échoue dès qu'un champ apparaît
    // dans la vue de l'autre partie. C'est le but — un champ ajouté à `publicUserSchema`
    // doit être une décision prise ici, pas un effet de bord découvert en production.
    // `photo_url` a été ajouté avec l'envoi de photo : c'est l'URL de l'avatar, que le
    // passager doit justement voir avant de monter (charte § 5.6), et elle ne porte
    // qu'un UUID.
    expect(Object.keys(vuDuPassager.driver)).toEqual([
      'vora_id',
      'first_name',
      'photo_key',
      'photo_url',
      'rating',
      'verified',
    ]);
  });

  it('4 ter. le chauffeur voit son net décomposé ; le passager ne voit pas ces lignes', async () => {
    const vuDuChauffeur = await readRide(rideId, driver);
    const attendu = computeDriverEarnings(priceAtQuote, 'eco');

    expect(vuDuChauffeur.earnings).toMatchObject({
      gross: priceAtQuote,
      commission: attendu.commission,
      dgi: attendu.dgi,
      net: attendu.net,
    });
    expect((await readRide(rideId, passenger)).earnings).toBeNull();
  });

  it('5. « Je suis arrivé »', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/arrived`,
      headers: auth(driver),
      payload: { lat: MELEN.lat, lng: MELEN.lng },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('arrived');
  });

  it('6. un code faux ne démarre rien, et ne change pas le statut', async () => {
    const vuDuPassager = await readRide(rideId, passenger);
    const faux = vuDuPassager.boarding_code === '0000' ? '1111' : '0000';

    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/start`,
      headers: auth(driver),
      payload: { boardingCode: faux },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('WRONG_BOARDING_CODE');
    // Le compteur monte — c'est la règle des 3 essais — mais la course, elle, attend.
    expect((await readRide(rideId, driver)).status).toBe('arrived');
  });

  it('7. le bon code démarre la course', async () => {
    const { boarding_code: code } = await readRide(rideId, passenger);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/start`,
      headers: auth(driver),
      payload: { boardingCode: code },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('in_progress');
    // Le code a servi : il disparaît de la vue du passager.
    expect((await readRide(rideId, passenger)).boarding_code).toBeNull();
  });

  it('8. arrivée à destination : le prix final EST le prix du devis', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/complete`,
      headers: auth(driver),
      payload: { lat: POSTE_CENTRALE.lat, lng: POSTE_CENTRALE.lng },
    });

    expect(response.statusCode).toBe(200);
    const ride = response.json();
    expect(ride.status).toBe('completed');
    // LE PREMIER MOMENT DE VÉRITÉ, vérifié de bout en bout : pas un franc d'écart entre
    // ce qui a été affiché avant la commande et ce qui est dû à l'arrivée.
    expect(ride.price_final).toBe(priceAtQuote);
  });

  it('9. espèces confirmées : la course est payée et Boris est crédité au franc près', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/payments/cash-confirm`,
      headers: auth(driver),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('paid');
    expect(response.json().payment_status).toBe('paid');

    const attendu = computeDriverEarnings(priceAtQuote, 'eco');
    const [gain] = await db
      .select()
      .from(driverEarnings)
      .where(and(eq(driverEarnings.rideId, rideId), eq(driverEarnings.source, 'ride')));

    expect(gain).toMatchObject({
      gross: priceAtQuote,
      commission: attendu.commission,
      dgi: attendu.dgi,
      net: attendu.net,
      paymentMethod: 'cash',
    });

    // Payé en espèces : Boris a encaissé le brut, il doit à VORA la commission et la DGI.
    const [profil] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driver.id));
    expect(profil?.cashDebt).toBe(attendu.commission + attendu.dgi);
    expect(profil?.ridesCount).toBe(41);
  });

  it('10. le journal raconte la course entière, dans l’ordre', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/rides/${rideId}/events`,
      headers: auth(passenger),
    });

    const types = response.json().events.map((event: { type: string }) => event.type);
    expect(types).toEqual([
      'ride.created',
      'ride.requested',
      'ride.offer_sent',
      'ride.accepted',
      'ride.arrived',
      'ride.boarding_code_failed',
      'ride.started',
      'ride.completed',
      'ride.paid',
    ]);
  });

  it('11. le fil temps réel de la course a suivi le même chemin', async () => {
    const events = replay(rideRoom(rideId), new Date(Date.now() - 300_000).toISOString());
    const statuts = events
      .filter((entry) => entry.event === 'ride.status')
      .map((entry) => (entry.payload as { status: string }).status);

    expect(statuts).toEqual([
      'requested',
      'accepted',
      'arrived',
      'in_progress',
      'completed',
      'paid',
    ]);
  });

  it('12. une fois payée, la course ne redémarre pas', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/complete`,
      headers: auth(driver),
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('INVALID_TRANSITION');
  });
});

// ─── Ce qui protège la commande ──────────────────────────────────────────────

describe('POST /v1/rides — les garde-fous de la commande', () => {
  let passenger: TestAccount;

  beforeAll(async () => {
    passenger = await createPassenger(app, 'Aïcha Gardefou');
  });

  it('exige une Idempotency-Key', async () => {
    const quote = await askQuote(passenger, MELEN, OBILI);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/rides',
      headers: auth(passenger),
      payload: { quoteId: offerOf(quote, 'eco').quoteId, offer: 'eco', paymentMethod: 'cash' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  }, 20_000);

  it('la même clé deux fois rend la MÊME course, pas deux', async () => {
    const quote = await askQuote(passenger, MELEN, OBILI);
    const key = crypto.randomUUID();
    const quoteId = offerOf(quote, 'eco').quoteId!;

    const premier = await order(passenger, quoteId, 'eco', key);
    expect(premier.statusCode).toBe(201);

    const second = await order(passenger, quoteId, 'eco', key);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(premier.json().id);

    const toutes = await db.select().from(rides).where(eq(rides.quoteId, quoteId));
    expect(toutes).toHaveLength(1);
  }, 20_000);

  it('refuse un devis expiré, avec le code que l’appli sait traiter', async () => {
    const quote = await askQuote(passenger, MELEN, OBILI);
    const quoteId = offerOf(quote, 'eco').quoteId!;

    // Les 2 minutes sont passées. On ne les attend pas : on déplace l'échéance.
    await db
      .update(quotes)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(quotes.id, quoteId));

    const response = await order(passenger, quoteId, 'eco');
    expect(response.statusCode).toBe(410);
    expect(response.json().code).toBe('QUOTE_EXPIRED');
  }, 20_000);

  it('refuse un devis dont le prix a été retouché en base', async () => {
    const quote = await askQuote(passenger, MELEN, OBILI);
    const quoteId = offerOf(quote, 'eco').quoteId!;

    // On simule une altération : le prix change, la signature ne suit pas.
    await db.update(quotes).set({ price: 100 }).where(eq(quotes.id, quoteId));

    const response = await order(passenger, quoteId, 'eco');
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('QUOTE_TAMPERED');
  }, 20_000);

  it('refuse le devis d’un autre passager', async () => {
    const quote = await askQuote(passenger, MELEN, OBILI);
    const intrus = await createPassenger(app, 'Curieux Anonyme');

    const response = await order(intrus, offerOf(quote, 'eco').quoteId!, 'eco');
    expect(response.statusCode).toBe(403);
  }, 20_000);

  it('refuse de commander une offre qui n’est pas celle du devis', async () => {
    const quote = await askQuote(passenger, MELEN, OBILI);
    const response = await order(passenger, offerOf(quote, 'eco').quoteId!, 'confort');

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONFLICT');
  }, 20_000);
});

// ─── Quand personne ne répond ────────────────────────────────────────────────

describe('aucun chauffeur : la course expire, elle ne tourne pas dans le vide', () => {
  it('passe en `expired` après les trois vagues, avec un motif', async () => {
    driverPresence.clear();

    const passenger = await createPassenger(app, 'Aïcha Seule');
    const quote = await askQuote(passenger, MELEN, OBILI);
    const response = await order(passenger, offerOf(quote, 'eco').quoteId!, 'eco');
    const rideId = response.json().id;

    const expired = await waitFor(
      async () => {
        const ride = await ridesRepository.findRideRow(rideId);
        return ride?.status === 'expired' ? ride : null;
      },
      { label: 'expiration de la course' },
    );

    expect(expired.status).toBe('expired');
    // Aucune offre n'a été créée : il n'y avait personne à qui la proposer.
    expect(await dispatchRepository.listOffers(rideId)).toHaveLength(0);
  }, 25_000);
});

// ─── Passager absent et Mobile Money ─────────────────────────────────────────

describe('passager absent et paiement Mobile Money', () => {
  /** Monte une course jusqu'à l'état demandé, et rend ses identifiants. */
  async function courseJusquA(nom: string, cible: 'arrived' | 'completed') {
    driverPresence.clear();

    const passenger = await createPassenger(app, nom);
    const driver = await createDriver(app, { displayName: 'Jean-Pierre Mbarga' });
    await goOnline(driver);

    const quote = await askQuote(passenger, MELEN, OBILI);
    const response = await order(passenger, offerOf(quote, 'eco').quoteId!, 'eco');
    const rideId = response.json().id;
    const price = response.json().price_quoted as number;

    const offer = await waitForOffer(rideId, driver.id);
    const accept = await app.inject({
      method: 'POST',
      url: `/v1/driver/offers/${offer.id}/accept`,
      headers: auth(driver),
    });
    expect(accept.json().accepted).toBe(true);

    const arrived = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/arrived`,
      headers: auth(driver),
      payload: {},
    });
    expect(arrived.json().status).toBe('arrived');

    if (cible === 'arrived') return { passenger, driver, rideId, price };

    const { boarding_code: code } = await readRide(rideId, passenger);
    await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/start`,
      headers: auth(driver),
      payload: { boardingCode: code },
    });
    const completed = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/complete`,
      headers: auth(driver),
      payload: {},
    });
    expect(completed.json().status).toBe('completed');

    return { passenger, driver, rideId, price };
  }

  it('refuse de clôturer avant les 5 minutes d’attente (voiture)', async () => {
    const { driver, rideId } = await courseJusquA('Aïcha Retard', 'arrived');

    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/no-show`,
      headers: auth(driver),
    });

    // Le chauffeur doit attendre : c'est la contrepartie du droit de facturer ensuite.
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/Attendez encore/);
    expect((await ridesRepository.findRideRow(rideId))?.status).toBe('arrived');
  }, 40_000);

  it('après le délai : 300 F, reversés intégralement, course close en `no_show`', async () => {
    const { driver, rideId } = await courseJusquA('Aïcha Absente', 'arrived');

    // Les 5 minutes sont écoulées. On déplace l'horodatage plutôt que d'attendre.
    await db
      .update(rides)
      .set({ arrivedAt: new Date(Date.now() - (NO_SHOW_WAIT_S.car + 30) * 1000) })
      .where(eq(rides.id, rideId));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/no-show`,
      headers: auth(driver),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'no_show', feeXaf: CANCEL_FEE.car });

    const [gain] = await db
      .select()
      .from(driverEarnings)
      .where(and(eq(driverEarnings.rideId, rideId), eq(driverEarnings.source, 'no_show_fee')));
    expect(gain).toMatchObject({ gross: CANCEL_FEE.car, commission: 0, dgi: 0, net: CANCEL_FEE.car });

    // Le chauffeur repart disponible : il n'est pas puni d'avoir attendu.
    expect(driverPresence.get(driver.id)?.availability).toBe('available');
  }, 40_000);

  it('Mobile Money : intention créée, attente de l’opérateur, puis course payée', async () => {
    const { passenger, driver, rideId, price } = await courseJusquA('Aïcha MoMo', 'completed');

    const debut = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/payments/mobile-money`,
      headers: auth(passenger),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'succeeded', amount: price });
    // Le reçu s'écrit en forme longue : « 1 625 FCFA » (CLAUDE.md § 6.2).
    expect(response.json().amountFormatted).toMatch(/FCFA$/);
    // L'adaptateur simule l'aller-retour opérateur : l'écran d'attente du passager est
    // donc déjà le bon écran, celui de la vraie intégration.
    expect(Date.now() - debut).toBeGreaterThanOrEqual(2_500);

    const paid = await readRide(rideId, passenger);
    expect(paid.status).toBe('paid');
    expect(paid.payment_method).toBe('mobile_money');

    // Payée par VORA : le chauffeur ne doit RIEN. Pas de dette d'espèces à rembourser.
    const [profil] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driver.id));
    expect(profil?.cashDebt).toBe(0);

    const [gain] = await db
      .select()
      .from(driverEarnings)
      .where(and(eq(driverEarnings.rideId, rideId), eq(driverEarnings.source, 'ride')));
    expect(gain?.paymentMethod).toBe('mobile_money');
    expect(gain?.net).toBe(computeDriverEarnings(price, 'eco').net);
  }, 60_000);

  it('rejouer le paiement ne prélève pas deux fois', async () => {
    const { passenger, rideId } = await courseJusquA('Aïcha Double-Clic', 'completed');

    const premier = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/payments/mobile-money`,
      headers: auth(passenger),
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/payments/mobile-money`,
      headers: auth(passenger),
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().intentId).toBe(premier.json().intentId);
  }, 60_000);
});

// ─── Après la course : note, SOS, partage, gains ─────────────────────────────

describe('note, SOS, partage de trajet et gains', () => {
  let passenger: TestAccount;
  let driver: TestDriver;
  let rideId: string;
  let price: number;

  beforeAll(async () => {
    driverPresence.clear();
    passenger = await createPassenger(app, 'Aïcha Complète');
    driver = await createDriver(app, { displayName: 'Nadine Complète' });
    await goOnline(driver);

    const quote = await askQuote(passenger, MELEN, OBILI);
    const created = await order(passenger, offerOf(quote, 'eco').quoteId!, 'eco');
    rideId = created.json().id;
    price = created.json().price_quoted;

    const offer = await waitForOffer(rideId, driver.id);
    await app.inject({
      method: 'POST',
      url: `/v1/driver/offers/${offer.id}/accept`,
      headers: auth(driver),
    });
  }, 40_000);

  it('SOS : alerte l’ops sans toucher au statut de la course', async () => {
    const avant = (await readRide(rideId, passenger)).status;

    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/sos`,
      headers: auth(passenger),
      payload: { lat: MELEN.lat, lng: MELEN.lng, note: 'le chauffeur ne suit pas l’itinéraire' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().alertId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.json().notified).toContain('ops');

    // La course continue : c'est précisément le problème d'un SOS.
    expect((await readRide(rideId, passenger)).status).toBe(avant);

    // L'ops est réveillé, avec la plaque et la position — jamais un numéro.
    const alertes = replay(OPS_ROOM, new Date(Date.now() - 60_000).toISOString());
    const sos = alertes.find(
      (entry) => (entry.payload as { kind?: string }).kind === 'sos',
    );
    expect(sos).toBeDefined();
    expect(JSON.stringify(sos?.payload)).not.toMatch(/\+237/);
  });

  it('partage de trajet : un lien public montre la plaque, jamais une coordonnée', async () => {
    const share = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/share`,
      headers: auth(passenger),
    });

    expect(share.statusCode).toBe(200);
    const { url, expiresAt } = share.json();
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

    // Le lien s'ouvre SANS session : c'est tout son objet.
    const token = url.split('/v1/share/')[1];
    const publique = await app.inject({ method: 'GET', url: `/v1/share/${token}` });

    expect(publique.statusCode).toBe(200);
    const vue = publique.json();
    expect(vue.vehicle.plate).toMatch(/^CE /);
    expect(vue.driver.first_name).toBe('Nadine');

    const brut = JSON.stringify(vue);
    expect(brut).not.toMatch(/\+237/);
    // Ni prix, ni ID VORA, ni nom complet : la liste de ce qu'on montre est positive.
    expect(brut).not.toMatch(/vora_id|price|passenger/);
  });

  it('un jeton de partage trafiqué ou inconnu donne 404, sans en dire plus', async () => {
    const bidon = Buffer.from('v1.11111111-1111-4111-8111-111111111111.99999999999.deadbeef').toString(
      'base64url',
    );
    const response = await app.inject({ method: 'GET', url: `/v1/share/${bidon}` });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toMatch(/plus valable/);
  });

  it('on ne note pas une course qui n’est pas finie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/rating`,
      headers: auth(passenger),
      payload: { stars: 5, tags: [] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('INVALID_TRANSITION');
  });

  it('la note du passager clôt la course et fait bouger la moyenne du chauffeur', async () => {
    // On termine la course.
    await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/arrived`,
      headers: auth(driver),
      payload: {},
    });
    const { boarding_code: code } = await readRide(rideId, passenger);
    await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/start`,
      headers: auth(driver),
      payload: { boardingCode: code },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/complete`,
      headers: auth(driver),
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/payments/cash-confirm`,
      headers: auth(driver),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/rating`,
      headers: auth(passenger),
      payload: { stars: 4, tags: ['conduite prudente'], comment: 'très bien' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, alreadyRated: false });
    expect((await readRide(rideId, passenger)).status).toBe('rated');

    // La moyenne est RECALCULÉE depuis la table, pas incrémentée : une seule note, donc 4.
    const [profil] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driver.id));
    expect(Number(profil?.rating)).toBe(4);
  }, 30_000);

  it('noter deux fois ne compte qu’une fois', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/rating`,
      headers: auth(passenger),
      payload: { stars: 1, tags: [] },
    });

    expect(response.json()).toEqual({ ok: true, alreadyRated: true });

    const [profil] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driver.id));
    // La note de 1 n'a pas été prise : la moyenne n'a pas bougé.
    expect(Number(profil?.rating)).toBe(4);
  });

  it('le chauffeur peut noter aussi, sans rouvrir ni refermer la course', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/rating`,
      headers: auth(driver),
      payload: { stars: 5, tags: ['ponctuel'] },
    });

    expect(response.json()).toEqual({ ok: true, alreadyRated: false });
    expect((await readRide(rideId, driver)).status).toBe('rated');
  });

  it('GET /v1/driver/earnings : le net du jour, exact au franc', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/driver/earnings?period=day',
      headers: auth(driver),
    });

    expect(response.statusCode).toBe(200);
    const gains = response.json();
    const attendu = computeDriverEarnings(price, 'eco');

    expect(gains.netXaf).toBe(attendu.net);
    expect(gains.grossXaf).toBe(price);
    expect(gains.commissionXaf).toBe(attendu.commission);
    expect(gains.dgiXaf).toBe(attendu.dgi);
    expect(gains.ridesCount).toBe(1);
    expect(gains.netFormatted).toMatch(/ ?F$/);
    expect(gains.recent[0]).toMatchObject({ rideId, netXaf: attendu.net, source: 'ride' });
    // Le chauffeur est en ligne depuis le début du scénario : quelques minutes au plus.
    expect(gains.onlineMinutes).toBeGreaterThanOrEqual(0);
  });

  it('un passager ne consulte pas les gains d’un chauffeur', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/driver/earnings',
      headers: auth(passenger),
    });
    expect(response.statusCode).toBe(403);
  });
});

// ─── « Attendre 2 min » ──────────────────────────────────────────────────────

describe('course expirée : le passager peut la relancer au même prix', () => {
  it('`expired` → `requested`, et le dispatch repart', async () => {
    driverPresence.clear();

    const passenger = await createPassenger(app, 'Aïcha Patiente');
    const quote = await askQuote(passenger, MELEN, OBILI);
    const created = await order(passenger, offerOf(quote, 'eco').quoteId!, 'eco');
    const rideId = created.json().id;
    const prix = created.json().price_quoted;

    await waitFor(
      async () => {
        const ride = await ridesRepository.findRideRow(rideId);
        return ride?.status === 'expired' ? ride : null;
      },
      { label: 'expiration' },
    );

    // Un chauffeur arrive entre-temps : c'est le cas que « Attendre 2 min » sert.
    const driver = await createDriver(app, { displayName: 'Fatou Tardive' });
    await goOnline(driver);

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/retry`,
      headers: auth(passenger),
    });

    expect(retry.statusCode).toBe(200);
    expect(['requested', 'offered']).toContain(retry.json().status);
    // Le prix ne bouge pas : le devis a déjà été figé et consommé.
    expect(retry.json().price_quoted).toBe(prix);

    // Et cette fois, une offre part.
    const offer = await waitForOffer(rideId, driver.id);
    expect(offer.driverNet).toBe(computeDriverEarnings(prix, 'eco').net);
  }, 40_000);

  it('une course déjà payée ne se relance pas', async () => {
    const passenger = await createPassenger(app, 'Aïcha Insistante');
    const quote = await askQuote(passenger, MELEN, OBILI);
    const created = await order(passenger, offerOf(quote, 'eco').quoteId!, 'eco');

    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${created.json().id}/retry`,
      headers: auth(passenger),
    });

    // `requested` ou `offered` : dans les deux cas, il n'y a rien à relancer.
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('INVALID_TRANSITION');
  }, 30_000);
});

// ─── Annulation (CLAUDE.md § 5.3) ────────────────────────────────────────────

describe('annulation : gratuite dans les 2 min ou sous 300 m, payante ensuite', () => {
  /** Monte une course jusqu'à `accepted`, et rend ses identifiants. */
  async function courseAcceptee(nom: string) {
    // Un seul chauffeur en ligne : le dispatch est SÉQUENTIEL, donc s'il en restait un
    // d'un scénario précédent, c'est lui qui recevrait l'offre et le nôtre attendrait
    // ses 15 secondes. Le test mesurerait alors la patience de la minuterie.
    driverPresence.clear();

    const passenger = await createPassenger(app, nom);
    const driver = await createDriver(app, { displayName: 'Nadine Fouda' });
    await goOnline(driver);

    const quote = await askQuote(passenger, MELEN, OBILI);
    const response = await order(passenger, offerOf(quote, 'eco').quoteId!, 'eco');
    const rideId = response.json().id;

    const offer = await waitForOffer(rideId, driver.id);
    const accept = await app.inject({
      method: 'POST',
      url: `/v1/driver/offers/${offer.id}/accept`,
      headers: auth(driver),
    });
    expect(accept.json().accepted).toBe(true);

    return { passenger, driver, rideId };
  }

  it('annuler dans les 2 minutes ne coûte rien', async () => {
    const { passenger, rideId } = await courseAcceptee('Aïcha Pressée');

    const vue = await readRide(rideId, passenger);
    // Le bouton doit pouvoir dire la vérité du moment : « gratuit encore 1:20 ».
    expect(vue.cancellation).toMatchObject({ free: true, fee_xaf: 0, rule: 'within_2_min' });
    expect(Date.parse(vue.cancellation.free_until)).toBeGreaterThan(Date.now());

    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/cancel`,
      headers: auth(passenger),
      payload: { reason: 'changement de programme' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'cancelled_free', feeXaf: 0 });
  }, 30_000);

  it('après 2 min ET 300 m parcourus : 300 F, reversés INTÉGRALEMENT au chauffeur', async () => {
    const { passenger, driver, rideId } = await courseAcceptee('Aïcha Tardive');

    // Les 2 minutes sont passées…
    await db
      .update(rides)
      .set({ acceptedAt: new Date(Date.now() - (FREE_CANCEL_WINDOW_S + 60) * 1000) })
      .where(eq(rides.id, rideId));

    // …et Boris a roulé : deux relevés de position, ~600 m au total.
    for (const point of [
      { lat: 3.8585, lng: 11.4885 },
      { lat: 3.8541, lng: 11.4872 },
    ]) {
      const moved = await app.inject({
        method: 'POST',
        url: '/v1/driver/position',
        headers: auth(driver),
        payload: point,
      });
      expect(moved.statusCode).toBe(200);
    }

    const vue = await readRide(rideId, passenger);
    expect(vue.cancellation).toMatchObject({ free: false, fee_xaf: CANCEL_FEE.car, rule: 'late' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/cancel`,
      headers: auth(passenger),
      payload: {},
    });

    expect(response.json()).toMatchObject({ status: 'cancelled_late', feeXaf: CANCEL_FEE.car });

    // « Reversés intégralement » : ni commission, ni retenue DGI sur un frais d'annulation.
    const [gain] = await db
      .select()
      .from(driverEarnings)
      .where(and(eq(driverEarnings.rideId, rideId), eq(driverEarnings.source, 'cancel_fee')));

    expect(gain).toMatchObject({
      gross: CANCEL_FEE.car,
      commission: 0,
      dgi: 0,
      net: CANCEL_FEE.car,
    });
  }, 30_000);

  it('un chauffeur qui a DÉJÀ roulé peut accepter : le compteur reste un entier', async () => {
    // Régression. Le compteur kilométrique s'accumule en flottant ; la colonne
    // `driver_odometer_start_m` est un `integer`. Un chauffeur immobile écrivait 0 et
    // passait ; un chauffeur ayant roulé écrivait 292,558… et PostgreSQL refusait
    // l'acceptation. Le bug ne se voyait qu'après un vrai déplacement — c'est le
    // simulateur de démonstration qui l'a fait apparaître.
    driverPresence.clear();

    const passenger = await createPassenger(app, 'Aïcha Compteur');
    const driver = await createDriver(app, { displayName: 'Serge Compteur' });
    await goOnline(driver);

    // Le chauffeur roule AVANT de recevoir la moindre offre.
    for (const point of [
      { lat: 3.8585, lng: 11.4885 },
      { lat: 3.8562, lng: 11.4878 },
    ]) {
      await app.inject({
        method: 'POST',
        url: '/v1/driver/position',
        headers: auth(driver),
        payload: point,
      });
    }

    const odometre = driverPresence.odometer(driver.id);
    expect(odometre).not.toBeNull();
    expect(odometre).toBeGreaterThan(0);
    expect(Number.isInteger(odometre)).toBe(true);

    const quote = await askQuote(passenger, MELEN, OBILI);
    const created = await order(passenger, offerOf(quote, 'eco').quoteId!, 'eco');
    const rideId = created.json().id;

    const offer = await waitForOffer(rideId, driver.id);
    const accept = await app.inject({
      method: 'POST',
      url: `/v1/driver/offers/${offer.id}/accept`,
      headers: auth(driver),
    });

    expect(accept.statusCode).toBe(200);
    expect(accept.json().accepted).toBe(true);

    const ride = await ridesRepository.findRideRow(rideId);
    expect(ride?.status).toBe('accepted');
    expect(Number.isInteger(ride?.driverOdometerStartM)).toBe(true);
  }, 40_000);

  it('le chauffeur redevient disponible dès l’annulation', async () => {
    const { passenger, driver, rideId } = await courseAcceptee('Aïcha Rapide');
    expect(driverPresence.get(driver.id)?.availability).toBe('on_ride');

    await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/cancel`,
      headers: auth(passenger),
      payload: {},
    });

    expect(driverPresence.get(driver.id)?.availability).toBe('available');
  }, 30_000);
});
