// VORA — flotte de chauffeurs simulés. Actif UNIQUEMENT si DEMO_MODE=true.
//
// ────────────────────────────────────────────────────────────────────────────
// CE QUE CE FICHIER EST, ET CE QU'IL N'EST PAS
// ────────────────────────────────────────────────────────────────────────────
//
// C'est un CLIENT. Douze faux téléphones de chauffeurs, qui parlent au serveur par les
// mêmes routes HTTP que l'application Flutter :
//
//   POST /v1/driver/online          se mettre en ligne
//   POST /v1/driver/position        remonter sa position, toutes les 5 s
//   POST /v1/driver/offers/:id/accept
//   POST /v1/rides/:id/arrived · /start · /complete
//   POST /v1/rides/:id/payments/cash-confirm
//
// Il n'appelle AUCUN service métier pour faire avancer une course. Il ne connaît ni la
// machine à états, ni le calcul du prix, ni le dispatch : il subit les 15 secondes, la
// concurrence entre chauffeurs et le refus d'une transition invalide exactement comme un
// vrai téléphone. Si le simulateur y arrive, un vrai téléphone y arrive — c'est là tout
// l'intérêt de le faire passer par la porte d'entrée.
//
// Trois exceptions, toutes assumées et toutes documentées à leur ligne :
//   · il lit les offres en attente EN BASE, faute de WebSocket vers lui-même
//     (`repository.pendingOffersFor`) ;
//   · il lit le CODE DE MONTÉE en clair, qu'un vrai chauffeur doit demander de vive voix
//     (voir `readBoardingCode` plus bas) ;
//   · le scénario « annulation tardive » recule une horloge (`timeTravelAcceptedAt`).
//
// AUCUN MODULE MÉTIER N'IMPORTE CE FICHIER. La vérification est automatique :
// `src/tests/unit/architecture.unit.test.ts` échoue si un import apparaît un jour.

import type { FastifyInstance } from 'fastify';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import type { LatLng } from '../db/geography.js';
import { haversineMeters } from '../lib/geodesy.js';
import { route } from '../modules/geo/routing.js';
import { recallBoardingCode } from '../modules/rides/boarding.js';
import { ensureFleet, type FleetAccount } from './fleet.js';
import { advanceAlong, between, pathLength, pickOne } from './movement.js';
import * as repository from './repository.js';

/** Cadence de remontée de position : la même que celle d'un vrai chauffeur. */
const POSITION_INTERVAL_MS = 5_000;
/** Cadence de la chorégraphie (accepter, arriver, démarrer…). */
const TICK_MS = 500;
/** En deçà, le chauffeur considère qu'il est arrivé au point de rendez-vous. */
const ARRIVAL_RADIUS_M = 60;
/** Vitesse de croisière, en km/h. Yaoundé aux heures ouvrées. */
const CRUISE_SPEED_KMH = { min: 20, max: 35 };

type DriverPhase =
  | 'offline'
  | 'cruising'
  | 'considering'
  | 'approaching'
  | 'waiting_boarding'
  | 'driving'
  | 'settling';

interface SimulatedDriver {
  account: FleetAccount;
  token: string;
  phase: DriverPhase;
  position: LatLng;
  /** Itinéraire courant et distance déjà parcourue dessus. */
  path: LatLng[];
  travelledM: number;
  speedKmh: number;
  heading: number;
  /** Course en cours, s'il y en a une. */
  rideId: string | null;
  offerId: string | null;
  /** Instant à partir duquel l'action en attente peut se déclencher. */
  actAt: number;
  /** Le chauffeur refuse la prochaine offre (scénario `aucun_chauffeur`). */
  refuseNext: boolean;
}

export type ScenarioName =
  | 'nominal'
  | 'aucun_chauffeur'
  | 'annulation_tardive'
  | 'pluie'
  | 'moto_zone_interdite'
  | 'sos';

interface SimulatorState {
  drivers: SimulatedDriver[];
  scenario: ScenarioName;
  positionTimer: NodeJS.Timeout | null;
  tickTimer: NodeJS.Timeout | null;
  app: FastifyInstance | null;
  running: boolean;
}

const state: SimulatorState = {
  drivers: [],
  scenario: 'nominal',
  positionTimer: null,
  tickTimer: null,
  app: null,
  running: false,
};

// ─── Appels à l'API publique ─────────────────────────────────────────────────

/**
 * Un appel HTTP, sans réseau. `app.inject` traverse TOUTE la pile Fastify — routage,
 * authentification, validation zod, limites de débit, sérialisation de sortie — sans
 * ouvrir de port. Le simulateur n'a donc aucun raccourci : ce qu'un client distant se
 * verrait refuser, il se le voit refuser aussi.
 */
async function call(
  driver: SimulatedDriver,
  method: 'POST' | 'GET',
  url: string,
  payload?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!state.app) return { status: 503, body: {} };

  const response = await state.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${driver.token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

  let body: Record<string, unknown> = {};
  try {
    body = response.json() as Record<string, unknown>;
  } catch {
    // Une réponse vide n'est pas une erreur : `204` et les corps non-JSON existent.
  }

  return { status: response.statusCode, body };
}

// ─── Cycle de vie ────────────────────────────────────────────────────────────

export function isRunning(): boolean {
  return state.running;
}

export function currentScenario(): ScenarioName {
  return state.scenario;
}

/** Vue de la flotte pour les endpoints de pilotage. */
export function fleetStatus(): Array<{
  voraId: string;
  name: string;
  kind: 'car' | 'moto';
  phase: DriverPhase;
  lat: number;
  lng: number;
  rideId: string | null;
}> {
  return state.drivers.map((driver) => ({
    voraId: driver.account.voraId,
    name: driver.account.member.displayName,
    kind: driver.account.member.kind,
    phase: driver.phase,
    lat: Number(driver.position.lat.toFixed(5)),
    lng: Number(driver.position.lng.toFixed(5)),
    rideId: driver.rideId,
  }));
}

/**
 * Démarre la flotte. Ne rejette jamais : une démonstration sans chauffeurs simulés reste
 * une démonstration, alors qu'un serveur qui refuse de démarrer n'en est plus une.
 */
export async function startSimulator(app: FastifyInstance): Promise<void> {
  if (state.running) return;

  state.app = app;

  try {
    const accounts = await ensureFleet();
    const [landmarks, motoPoints] = await Promise.all([
      repository.listLandmarks(),
      repository.randomPointsInMotoZones(12),
    ]);

    if (landmarks.length < 2) {
      logger.warn(
        'Simulateur : moins de deux repères en base. Lancez `npm run seed` avant la démonstration.',
      );
      return;
    }

    state.drivers = [];

    for (const account of accounts) {
      // Les voitures partent d'un repère quelconque ; les motos NE partent que d'un
      // point tiré dans une zone où elles ont le droit de rouler (§ 5.5).
      const start =
        account.member.kind === 'moto'
          ? (pickOne(motoPoints) ?? pickOne(landmarks)!)
          : pickOne(landmarks)!;

      const driver: SimulatedDriver = {
        account,
        token: app.jwt.sign({ sub: account.userId, vora_id: account.voraId, role: 'driver' }),
        phase: 'offline',
        position: { lat: start.lat, lng: start.lng },
        path: [],
        travelledM: 0,
        speedKmh: between(CRUISE_SPEED_KMH.min, CRUISE_SPEED_KMH.max),
        heading: between(0, 360),
        rideId: null,
        offerId: null,
        actAt: 0,
        refuseNext: false,
      };

      await goOnline(driver);
      state.drivers.push(driver);
    }

    state.positionTimer = setInterval(() => void publishPositions(), POSITION_INTERVAL_MS);
    state.positionTimer.unref?.();
    state.tickTimer = setInterval(() => void choreograph(), TICK_MS);
    state.tickTimer.unref?.();
    state.running = true;

    logger.info(
      { drivers: state.drivers.length, scenario: state.scenario },
      'Simulateur de chauffeurs démarré',
    );
  } catch (error) {
    logger.error({ err: error }, 'Simulateur : démarrage impossible');
  }
}

export async function stopSimulator(): Promise<void> {
  if (state.positionTimer) clearInterval(state.positionTimer);
  if (state.tickTimer) clearInterval(state.tickTimer);
  state.positionTimer = null;
  state.tickTimer = null;

  // On repasse les chauffeurs hors ligne par la route publique : sinon ils resteraient
  // « en ligne » en base et la page ops afficherait une flotte fantôme.
  for (const driver of state.drivers) {
    await call(driver, 'POST', '/v1/driver/offline').catch(() => undefined);
  }

  state.drivers = [];
  state.running = false;
  logger.info('Simulateur de chauffeurs arrêté');
}

async function goOnline(driver: SimulatedDriver): Promise<void> {
  const response = await call(driver, 'POST', '/v1/driver/online', {
    position: { lat: driver.position.lat, lng: driver.position.lng },
    vehicle_id: driver.account.vehicleId,
  });

  if (response.status !== 200) {
    logger.warn(
      { name: driver.account.member.displayName, status: response.status, body: response.body },
      'Simulateur : mise en ligne refusée',
    );
    return;
  }

  driver.phase = 'cruising';
}

// ─── Déplacement ─────────────────────────────────────────────────────────────

/** Trace un nouvel itinéraire depuis la position courante vers une destination plausible. */
async function planRoute(driver: SimulatedDriver, destination?: LatLng): Promise<void> {
  let target = destination ?? null;

  if (!target) {
    // Une moto ne se donne pour destination qu'un point d'une zone autorisée : elle ne
    // doit ni traverser ni stationner dans le centre urbain interdit.
    const candidates =
      driver.account.member.kind === 'moto'
        ? await repository.randomPointsInMotoZones(4)
        : await repository.listLandmarks(60);

    const chosen = pickOne(candidates);
    if (!chosen) return;
    target = { lat: chosen.lat, lng: chosen.lng };
  }

  const routed = await route(driver.position, target);
  driver.path = routed.points.length >= 2 ? routed.points : [driver.position, target];
  driver.travelledM = 0;
}

/**
 * Remonte la position de chaque chauffeur, toutes les 5 secondes, PAR LA ROUTE PUBLIQUE.
 *
 * Le pas de déplacement est calculé sur le temps réel écoulé et la vitesse du véhicule —
 * multipliée par l'accélération quand le chauffeur a un passager à bord, pour qu'une
 * course de vingt minutes tienne dans une démonstration de cinq.
 */
async function publishPositions(): Promise<void> {
  for (const driver of state.drivers) {
    if (driver.phase === 'offline') continue;

    try {
      if (driver.path.length >= 2) {
        // L'accélération vaut pour l'APPROCHE ET pour la course. Sans elle, un chauffeur
        // accepté à 1 km met deux minutes et demie à arriver — sur une démonstration qui
        // en dure cinq, le jury regarderait un point avancer au lieu de voir le produit.
        // En croisière, en revanche, la flotte roule à sa vraie vitesse : c'est le fond
        // de carte, il doit être plausible.
        //
        // Contrepartie à connaître et à assumer devant le jury : l'ETA affiché au
        // passager est calculé sur la vitesse RÉELLE. Il annonce donc 3 minutes là où le
        // chauffeur simulé arrive en 20 secondes. C'est l'accélération qui ment, pas le
        // calcul d'ETA.
        const accelerated = driver.phase === 'driving' || driver.phase === 'approaching';
        const speedup = accelerated ? config.DEMO_RIDE_SPEEDUP : 1;
        const metres = (driver.speedKmh * 1000 * (POSITION_INTERVAL_MS / 3_600_000)) * speedup;

        driver.travelledM += metres;
        const progress = advanceAlong(driver.path, driver.travelledM);
        driver.position = progress.position;
        driver.heading = progress.heading;

        // Bout de l'itinéraire atteint en croisière : on en trace un autre. Pendant une
        // course, c'est la chorégraphie qui décide de la suite.
        if (progress.finished && driver.phase === 'cruising') {
          await planRoute(driver);
        }
      } else if (driver.phase === 'cruising') {
        await planRoute(driver);
      }

      await call(driver, 'POST', '/v1/driver/position', {
        lat: driver.position.lat,
        lng: driver.position.lng,
        heading: Math.round(driver.heading),
        speed: Math.round(driver.phase === 'cruising' ? driver.speedKmh : driver.speedKmh * 0.8),
      });
    } catch (error) {
      logger.debug({ err: error, name: driver.account.member.displayName }, 'Simulateur : position');
    }
  }
}

// ─── Chorégraphie d'une course ───────────────────────────────────────────────

async function choreograph(): Promise<void> {
  try {
    await collectOffers();

    for (const driver of state.drivers) {
      if (Date.now() < driver.actAt) continue;

      switch (driver.phase) {
        case 'considering':
          await acceptOrDecline(driver);
          break;
        case 'approaching':
          await maybeArrive(driver);
          break;
        case 'waiting_boarding':
          await maybeStart(driver);
          break;
        case 'driving':
          await maybeComplete(driver);
          break;
        case 'settling':
          await settle(driver);
          break;
        default:
          break;
      }
    }
  } catch (error) {
    logger.debug({ err: error }, 'Simulateur : chorégraphie');
  }
}

/** Repère les offres ouvertes et arme la décision de chaque chauffeur concerné. */
async function collectOffers(): Promise<void> {
  const idle = state.drivers.filter((driver) => driver.phase === 'cruising');
  if (idle.length === 0) return;

  const offers = await repository.pendingOffersFor(idle.map((driver) => driver.account.userId));

  for (const offer of offers) {
    const driver = idle.find((candidate) => candidate.account.userId === offer.driverId);
    if (!driver || driver.offerId === offer.offerId) continue;

    driver.offerId = offer.offerId;
    driver.rideId = offer.rideId;
    driver.phase = 'considering';
    // Entre 4 et 8 secondes : le jury doit voir le compte à rebours de 15 s tourner, et
    // comprendre qu'un chauffeur réfléchit.
    driver.actAt = Date.now() + between(config.DEMO_ACCEPT_MIN_S, config.DEMO_ACCEPT_MAX_S) * 1000;

    logger.info(
      { name: driver.account.member.displayName, netXaf: offer.driverNet },
      'Simulateur : offre reçue',
    );
  }
}

async function acceptOrDecline(driver: SimulatedDriver): Promise<void> {
  if (!driver.offerId) {
    driver.phase = 'cruising';
    return;
  }

  // Scénario `aucun_chauffeur` : tout le monde refuse, la course doit expirer après ses
  // trois vagues. C'est le seul moyen honnête de montrer les deux sorties offertes au
  // passager (§ 5.4) sans éteindre la flotte et vider la carte.
  if (driver.refuseNext || state.scenario === 'aucun_chauffeur') {
    await call(driver, 'POST', `/v1/driver/offers/${driver.offerId}/decline`);
    resetDriver(driver);
    return;
  }

  const response = await call(driver, 'POST', `/v1/driver/offers/${driver.offerId}/accept`);
  const accepted = response.status === 200 && response.body.accepted === true;

  if (!accepted) {
    // Un autre chauffeur a été plus rapide, ou les 15 s sont passées. C'est une course
    // de vitesse réelle, et le simulateur la perd parfois.
    resetDriver(driver);
    return;
  }

  const snapshot = driver.rideId ? await repository.rideSnapshot(driver.rideId) : null;
  if (!snapshot) {
    resetDriver(driver);
    return;
  }

  logger.info({ name: driver.account.member.displayName, rideId: driver.rideId }, 'Simulateur : course acceptée');

  if (state.scenario === 'annulation_tardive') {
    // Voir `repository.timeTravelAcceptedAt` : on recule l'horloge pour que le bouton
    // du passager affiche « Annuler · 300 F reversés à … » sans attendre deux minutes.
    await repository.timeTravelAcceptedAt(driver.rideId!, 180);
    logger.info(
      { rideId: driver.rideId },
      'Simulateur : acceptation reculée de 3 min (scénario annulation tardive)',
    );
  }

  await planRoute(driver, snapshot.pickup);
  driver.phase = 'approaching';
  driver.actAt = 0;
}

async function maybeArrive(driver: SimulatedDriver): Promise<void> {
  if (!driver.rideId) {
    resetDriver(driver);
    return;
  }

  const snapshot = await repository.rideSnapshot(driver.rideId);
  if (!snapshot || isClosed(snapshot.status)) {
    resetDriver(driver);
    return;
  }

  const distance = haversineMeters(driver.position, snapshot.pickup);
  if (distance > ARRIVAL_RADIUS_M) return;

  const response = await call(driver, 'POST', `/v1/rides/${driver.rideId}/arrived`, {
    lat: driver.position.lat,
    lng: driver.position.lng,
  });

  if (response.status !== 200) {
    // Course annulée entre-temps, ou déjà arrivée : on reprend la route.
    resetDriver(driver);
    return;
  }

  // Le scénario SOS se déclenche au moment le plus parlant : le chauffeur est sur place,
  // la course est engagée, et l'alerte remonte à l'ops en direct.
  if (state.scenario === 'sos') {
    await call(driver, 'POST', `/v1/rides/${driver.rideId}/sos`, {
      lat: driver.position.lat,
      lng: driver.position.lng,
      note: 'Scénario de démonstration',
    });
  }

  driver.phase = 'waiting_boarding';
  // Le temps de montrer le code sur le téléphone du passager avant que la course démarre.
  driver.actAt = Date.now() + config.DEMO_BOARDING_PAUSE_S * 1000;
}

/**
 * LE SEUL VRAI RACCOURCI DU SIMULATEUR, et il est ici.
 *
 * Le code de montée est visible du passager seulement : un vrai chauffeur le DEMANDE à
 * la personne qui monte (CLAUDE.md § 5.5). Un chauffeur simulé n'a personne à qui le
 * demander — il le lit donc dans la mémoire du serveur.
 *
 * Ce que ça ne change pas, et qu'il faut dire au jury : le serveur, lui, vérifie ce code
 * exactement comme pour un vrai chauffeur. `rides/service.startRide` compare l'empreinte,
 * compte les échecs et alerte l'ops au troisième. Il n'existe aucun chemin dérobé dans le
 * code métier — le raccourci est du côté du faux téléphone, pas du côté du serveur.
 */
function readBoardingCode(rideId: string): string | null {
  return recallBoardingCode(rideId);
}

async function maybeStart(driver: SimulatedDriver): Promise<void> {
  if (!driver.rideId) {
    resetDriver(driver);
    return;
  }

  const snapshot = await repository.rideSnapshot(driver.rideId);
  if (!snapshot || isClosed(snapshot.status)) {
    resetDriver(driver);
    return;
  }

  const code = readBoardingCode(driver.rideId);
  if (!code) {
    // Le passager n'a pas encore ouvert son écran : on repasse dans une seconde.
    driver.actAt = Date.now() + 1_000;
    return;
  }

  const response = await call(driver, 'POST', `/v1/rides/${driver.rideId}/start`, {
    boardingCode: code,
  });

  if (response.status !== 200) {
    driver.actAt = Date.now() + 2_000;
    return;
  }

  await planRoute(driver, snapshot.dropoff);
  driver.phase = 'driving';
  driver.actAt = 0;
}

async function maybeComplete(driver: SimulatedDriver): Promise<void> {
  if (!driver.rideId) {
    resetDriver(driver);
    return;
  }

  const snapshot = await repository.rideSnapshot(driver.rideId);
  if (!snapshot || isClosed(snapshot.status)) {
    resetDriver(driver);
    return;
  }

  if (haversineMeters(driver.position, snapshot.dropoff) > ARRIVAL_RADIUS_M) return;

  const response = await call(driver, 'POST', `/v1/rides/${driver.rideId}/complete`, {
    lat: driver.position.lat,
    lng: driver.position.lng,
  });

  if (response.status !== 200) {
    resetDriver(driver);
    return;
  }

  driver.phase = 'settling';
  driver.actAt = Date.now() + 1_500;
}

async function settle(driver: SimulatedDriver): Promise<void> {
  if (!driver.rideId) {
    resetDriver(driver);
    return;
  }

  const snapshot = await repository.rideSnapshot(driver.rideId);
  if (!snapshot) {
    resetDriver(driver);
    return;
  }

  if (snapshot.paymentMethod === 'cash' && snapshot.status === 'completed') {
    // « Le chauffeur voit son net après la course » : c'est ce geste qui clôt le
    // troisième moment de vérité.
    await call(driver, 'POST', `/v1/rides/${driver.rideId}/payments/cash-confirm`);
  }

  if (snapshot.status === 'completed' && snapshot.paymentMethod === 'mobile_money') {
    // C'est le passager qui paie : on attend, sans rien forcer.
    driver.actAt = Date.now() + 2_000;
    return;
  }

  logger.info({ name: driver.account.member.displayName }, 'Simulateur : course terminée');
  resetDriver(driver);
}

function resetDriver(driver: SimulatedDriver): void {
  driver.phase = 'cruising';
  driver.rideId = null;
  driver.offerId = null;
  driver.actAt = 0;
  driver.refuseNext = false;
  driver.path = [];
  driver.travelledM = 0;
}

function isClosed(status: string): boolean {
  return [
    'expired',
    'cancelled_free',
    'cancelled_late',
    'cancelled_driver',
    'no_show',
    'paid',
    'rated',
  ].includes(status);
}

// ─── Pilotage depuis les scénarios ───────────────────────────────────────────

export function setScenario(name: ScenarioName): void {
  state.scenario = name;
  for (const driver of state.drivers) driver.refuseNext = false;
}

/** Met toute la flotte hors ligne, ou la remet en ligne. */
export async function setFleetOnline(online: boolean): Promise<void> {
  for (const driver of state.drivers) {
    if (online) {
      await goOnline(driver);
    } else {
      await call(driver, 'POST', '/v1/driver/offline');
      driver.phase = 'offline';
      resetDriver(driver);
      driver.phase = 'offline';
    }
  }
}

/**
 * Rapproche les motos d'un point : le scénario « zone interdite » doit montrer un refus
 * réglementaire, pas une absence de chauffeur. Une moto visible à 400 m du départ, et
 * pourtant pas d'offre moto : la démonstration ne tient que si le jury voit la moto.
 */
export async function gatherMotosNear(centre: LatLng): Promise<number> {
  const motos = state.drivers.filter((driver) => driver.account.member.kind === 'moto');

  for (const [index, moto] of motos.entries()) {
    // Quelques centaines de mètres autour du point, en étoile.
    const angle = (index / Math.max(motos.length, 1)) * 2 * Math.PI;
    moto.position = {
      lat: centre.lat + 0.004 * Math.cos(angle),
      lng: centre.lng + 0.004 * Math.sin(angle),
    };
    moto.path = [];
    moto.travelledM = 0;
    await goOnline(moto);
  }

  return motos.length;
}

/** Longueur de l'itinéraire courant d'un chauffeur — utile aux tests et au diagnostic. */
export function currentPathLength(voraId: string): number {
  const driver = state.drivers.find((candidate) => candidate.account.voraId === voraId);
  return driver && driver.path.length >= 2 ? pathLength(driver.path) : 0;
}
