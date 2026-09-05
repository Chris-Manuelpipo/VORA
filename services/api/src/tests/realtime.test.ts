// VORA — temps réel : salles, événements, rejeu. SUR UN VRAI SERVEUR SOCKET.IO.
//
// Contrairement aux autres tests d'intégration, celui-ci ouvre un vrai port et de vraies
// WebSockets : ce qu'on veut vérifier — qu'un chauffeur reçoit ses offres et pas celles
// des autres, qu'un passager voit le point bouger, qu'une coupure de réseau ne fait pas
// perdre un statut — ne se voit qu'en connectant deux clients.
//
// Les noms d'événements sont ceux de `docs/API_CONTRACT.md` : c'est le contrat que
// l'équipe mobile implémente en parallèle.

import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase } from '../db/client.js';
import { seedZones } from '../db/seed/geography.js';
import { driverPresence } from '../modules/dispatch/presence.js';
import * as ridesRepository from '../modules/rides/repository.js';
import { clearBuffers, publish, replay } from '../realtime/bus.js';
import { driverRoom, rideRoom } from '../realtime/events.js';
import { closeRealtime, registerRealtime } from '../realtime/gateway.js';
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
let baseUrl: string;
const sockets: ClientSocket[] = [];

const MELEN = { lat: 3.8541, lng: 11.4872, label: 'Carrefour Melen' };
const OBILI = { lat: 3.8482, lng: 11.4931, label: 'Carrefour Obili' };
const PRES_DE_MELEN = { lat: 3.857, lng: 11.489 };

beforeAll(async () => {
  await seedZones();
  await seedTariffs();

  app = await buildApp();
  await app.ready();
  registerRealtime(app);
  // Port 0 : le système en choisit un libre. Deux exécutions en parallèle ne se marchent
  // pas dessus, et rien n'est codé en dur.
  await app.listen({ host: '127.0.0.1', port: 0 });

  const address = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  driverPresence.clear();
  clearBuffers();
  await closeRealtime();
  await app?.close();
  await closeDatabase();
});

/** Ouvre une connexion authentifiée et attend qu'elle soit établie. */
async function open(account: TestAccount, since?: string): Promise<ClientSocket> {
  const socket = connect(baseUrl, {
    transports: ['websocket'],
    auth: { token: account.token, ...(since ? { since } : {}) },
    reconnection: false,
  });
  sockets.push(socket);

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error) => reject(error));
    setTimeout(() => reject(new Error('La connexion Socket.IO n’a pas abouti.')), 5_000).unref?.();
  });

  return socket;
}

/** Attend un événement, ou abandonne. */
function next<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 5_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Aucun « ${event} » reçu en ${timeoutMs} ms.`)),
      timeoutMs,
    );
    timer.unref?.();
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('authentification de la WebSocket', () => {
  it('refuse une connexion sans jeton', async () => {
    const socket = connect(baseUrl, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);

    const error = await new Promise<Error>((resolve) => {
      socket.once('connect_error', resolve);
    });
    expect(error.message).toBe('unauthorized');
  });

  it('refuse un jeton fabriqué', async () => {
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      auth: { token: 'ceci.nest.pas.un.jeton' },
      reconnection: false,
    });
    sockets.push(socket);

    const error = await new Promise<Error>((resolve) => {
      socket.once('connect_error', resolve);
    });
    expect(error.message).toBe('unauthorized');
  });
});

describe('salles par course et par chauffeur', () => {
  let passenger: TestAccount;
  let driver: TestDriver;
  let autreChauffeur: TestDriver;

  beforeAll(async () => {
    driverPresence.clear();
    passenger = await createPassenger(app, 'Aïcha Temps-Réel');
    driver = await createDriver(app, { displayName: 'Samuel Tchinda' });
    autreChauffeur = await createDriver(app, { displayName: 'Fatou Ngo' });
  });

  it('l’offre part dans la salle du chauffeur, et NULLE PART ailleurs', async () => {
    const socketDuChauffeur = await open(driver);
    const socketDuVoisin = await open(autreChauffeur);

    // Seul Samuel est en ligne : c'est lui que le dispatch doit trouver.
    await app.inject({
      method: 'POST',
      url: '/v1/driver/online',
      headers: auth(driver),
      payload: { position: PRES_DE_MELEN },
    });

    const offreRecue = next<{ offerId: string; netXaf: number }>(socketDuChauffeur, 'ride.offer');
    let voisinServi = false;
    socketDuVoisin.once('ride.offer', () => {
      voisinServi = true;
    });

    const quote = await app.inject({
      method: 'POST',
      url: '/v1/quotes',
      headers: auth(passenger),
      payload: { pickup: MELEN, dropoff: OBILI },
    });
    const eco = (quote.json().offers as Array<{ offer: string; quoteId: string }>).find(
      (entry) => entry.offer === 'eco',
    )!;

    await app.inject({
      method: 'POST',
      url: '/v1/rides',
      headers: { ...auth(passenger), 'idempotency-key': crypto.randomUUID() },
      payload: { quoteId: eco.quoteId, offer: 'eco', paymentMethod: 'cash' },
    });

    const offre = await offreRecue;
    expect(offre.offerId).toMatch(/^[0-9a-f-]{36}$/);
    // Le NET, pas le brut : c'est ce que le chauffeur doit lire avant d'accepter.
    expect(offre.netXaf).toBeGreaterThan(0);
    expect(voisinServi).toBe(false);
  }, 30_000);
});

describe('le passager suit son chauffeur', () => {
  let passenger: TestAccount;
  let driver: TestDriver;
  let rideId: string;

  beforeAll(async () => {
    driverPresence.clear();
    passenger = await createPassenger(app, 'Aïcha Suivi');
    driver = await createDriver(app, { displayName: 'Boris Suivi' });

    await app.inject({
      method: 'POST',
      url: '/v1/driver/online',
      headers: auth(driver),
      payload: { position: PRES_DE_MELEN },
    });

    const quote = await app.inject({
      method: 'POST',
      url: '/v1/quotes',
      headers: auth(passenger),
      payload: { pickup: MELEN, dropoff: OBILI },
    });
    const eco = (quote.json().offers as Array<{ offer: string; quoteId: string }>).find(
      (entry) => entry.offer === 'eco',
    )!;

    const ride = await app.inject({
      method: 'POST',
      url: '/v1/rides',
      headers: { ...auth(passenger), 'idempotency-key': crypto.randomUUID() },
      payload: { quoteId: eco.quoteId, offer: 'eco', paymentMethod: 'cash' },
    });
    rideId = ride.json().id;

    // On attend l'ÉVÉNEMENT, pas la ligne en base : c'est le seul instant où
    // l'identifiant de l'offre existe du point de vue du chauffeur, et donc le premier
    // instant où il peut légitimement répondre.
    const depuis = new Date(Date.now() - 120_000).toISOString();
    const offerId = await waitFor(
      async () => {
        const annonce = replay(driverRoom(driver.id), depuis).find(
          (entry) =>
            entry.event === 'ride.offer' && (entry.payload as { rideId: string }).rideId === rideId,
        );
        return annonce ? (annonce.payload as { offerId: string }).offerId : null;
      },
      { label: 'offre de dispatch' },
    );

    const accept = await app.inject({
      method: 'POST',
      url: `/v1/driver/offers/${offerId}/accept`,
      headers: auth(driver),
    });
    expect(accept.json().accepted).toBe(true);
  }, 40_000);

  it('refuse de faire entrer quelqu’un dans une course qui n’est pas la sienne', async () => {
    const intrus = await createPassenger(app, 'Curieux Anonyme');
    const socket = await open(intrus);

    const reponse = await socket.emitWithAck('ride.subscribe', { rideId });
    expect(reponse).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('laisse entrer le passager de la course, et lui dit où elle en est', async () => {
    const socket = await open(passenger);
    const reponse = await socket.emitWithAck('ride.subscribe', { rideId });
    expect(reponse).toMatchObject({ ok: true, status: 'accepted' });
  });

  it('`driver.position` → `ride.driver_position` et `ride.eta` chez le passager', async () => {
    const socketPassager = await open(passenger);
    await socketPassager.emitWithAck('ride.subscribe', { rideId });

    const socketChauffeur = await open(driver);
    const position = next<{ lat: number; lng: number }>(socketPassager, 'ride.driver_position');
    const eta = next<{ etaMin: number }>(socketPassager, 'ride.eta');

    socketChauffeur.emit('driver.position', {
      lat: 3.8555,
      lng: 11.488,
      heading: 210,
      speed: 24,
    });

    expect(await position).toMatchObject({ rideId, lat: 3.8555, lng: 11.488 });
    expect((await eta).etaMin).toBeGreaterThanOrEqual(1);
  }, 15_000);

  it('la première position après l’acceptation fait passer la course en `approaching`', async () => {
    // Le chauffeur a bougé, donc il vient : le statut le dit sans que personne
    // n'appuie sur un bouton.
    const ride = await waitFor(
      async () => {
        const row = await ridesRepository.findRideRow(rideId);
        return row?.status === 'approaching' ? row : null;
      },
      { label: 'passage en approaching' },
    );

    expect(ride.status).toBe('approaching');
  }, 15_000);
});

describe('rejeu des événements manqués (tampon 10 min)', () => {
  it('le tampon garde les événements et sait dire lesquels manquent', async () => {
    const { replay } = await import('../realtime/bus.js');
    const salle = rideRoom('22222222-2222-4222-8222-222222222222');

    publish(salle, 'ride.status', { status: 'requested' });
    const apres = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));
    publish(salle, 'ride.status', { status: 'accepted' });
    publish(salle, 'ride.status', { status: 'arrived' });

    const manques = replay(salle, apres);
    expect(manques.map((entry) => (entry.payload as { status: string }).status)).toEqual([
      'accepted',
      'arrived',
    ]);

    // Sans point de reprise, on ne rejoue rien : un nouveau client lit l'état courant
    // par REST, il n'a que faire de l'historique.
    expect(replay(salle, null)).toEqual([]);
  });

  it('rejoue vraiment à un chauffeur qui se reconnecte sur SA salle', async () => {
    const driver = await createDriver(app, { displayName: 'Jean-Pierre Coupure' });

    const derniereReception = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Pendant sa coupure, une offre lui a été faite.
    const { driverRoom } = await import('../realtime/events.js');
    publish(driverRoom(driver.id), 'ride.offer', { offerId: 'perdue', netXaf: 1_365 });

    const socket = await open(driver, derniereReception);
    const rejoue = await next<{
      count: number;
      events: Array<{ event: string; payload: { netXaf: number } }>;
    }>(socket, 'replay');

    expect(rejoue.count).toBe(1);
    expect(rejoue.events[0]?.event).toBe('ride.offer');
    expect(rejoue.events[0]?.payload.netXaf).toBe(1_365);
  }, 15_000);
});
