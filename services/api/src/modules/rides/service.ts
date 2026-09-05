// VORA — la course, de la commande au paiement.
//
// TOUT changement d'état passe par ici, et par `assertTransition` avant toute écriture.
// Le contrat, à la lettre (CLAUDE.md § 5.7) :
//
//   · la machine à états est STRICTE et vit côté serveur ; le client demande une action,
//     il ne décide jamais d'un statut ;
//   · toute transition écrit une ligne dans `ride_events` ;
//   · une transition invalide renvoie INVALID_TRANSITION SANS RIEN ÉCRIRE — ni sur la
//     course, ni dans le journal. C'est ce qui rend le journal opposable : ce qu'on y
//     lit s'est produit, et ce qui s'est produit y est.
//
// Le journal est doublement protégé : `assertTransition` refuse en amont, et le `where`
// de `applyTransition` porte sur le statut de départ — si un autre acteur a fait avancer
// la course dans l'intervalle, aucune ligne n'est touchée.

import { randomUUID } from 'node:crypto';
import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { haversineMeters } from '../../lib/geodesy.js';
import { logger } from '../../lib/logger.js';
import { DAY_MS, startOfCityDay } from '../../lib/time.js';
import type { LatLng } from '../../db/geography.js';
import type { PaymentMethod, Ride, UserRole } from '../../db/schema.js';
import { formatPlate } from '../../domain/plates.js';
import {
  BOARDING_CODE_MAX_ATTEMPTS,
  CANCEL_FEE,
  FREE_CANCEL_DISTANCE_M,
  FREE_CANCEL_WINDOW_S,
  NO_SHOW_WAIT_S,
  vehicleKindForOffer,
} from '../../domain/rules.js';
import { assertTransition, isActive, type Actor, type RideStatus } from '../../domain/states.js';
import { forget, publish } from '../../realtime/bus.js';
import {
  driverRoom,
  rideRoom,
  OPS_ALERT,
  OPS_ROOM,
  RIDE_CANCELLED,
  RIDE_STATUS,
} from '../../realtime/events.js';
import { computeDriverEarnings, formatAmount } from '../pricing/fare.js';
import { redeemQuote } from '../pricing/service.js';
import { driverPresence } from '../dispatch/presence.js';
import * as dispatch from '../dispatch/service.js';
import {
  boardingCodeMatches,
  forgetBoardingCode,
  generateBoardingCode,
  hashBoardingCode,
  recallBoardingCode,
  rememberBoardingCode,
} from './boarding.js';
import { toRideDto, toSharedRideDto } from './dto.js';
import { readShareToken, signShareToken } from './share.js';
import * as repository from './repository.js';
import type {
  CreateRideBody,
  DriverEarningsDto,
  ListRidesQuery,
  RideDto,
  SharedRideDto,
} from './schemas.js';

const CREATE_RIDE_ENDPOINT = 'POST /v1/rides';

// ─── Lecture ─────────────────────────────────────────────────────────────────

function canSee(
  ride: { passengerId: string; driverId: string | null },
  userId: string,
  role: UserRole,
): boolean {
  if (role === 'ops') return true;
  if (ride.passengerId === userId) return true;
  return ride.driverId === userId;
}

/**
 * Détail d'une course. C'est ici que se calculent les trois informations vivantes que
 * la ligne en base ne porte pas : le code de montée en clair (passager seulement), la
 * politique d'annulation à cet instant précis, et la distance du chauffeur.
 */
export async function getRide(
  rideId: string,
  viewer: { id: string; role: UserRole },
): Promise<RideDto> {
  const bundle = await repository.findRideById(rideId);
  if (!bundle || !canSee(bundle.ride, viewer.id, viewer.role)) {
    throw new AppError('NOT_FOUND', 'Cette course est introuvable.');
  }

  const { ride } = bundle;
  const isPassenger = viewer.role === 'passenger' && viewer.id === ride.passengerId;

  return toRideDto(bundle, { id: viewer.id, role: viewer.role }, {
    // Le code n'est calculé que pour le passager : le chauffeur ne doit pas pouvoir le
    // faire apparaître, fût-ce dans un journal de requêtes.
    boardingCode: isPassenger ? await boardingCodeForPassenger(ride) : null,
    cancellation: isActive(ride.status) ? cancellationPolicy(ride) : undefined,
    approachDistanceM: approachDistanceM(ride),
  });
}

export async function listRides(
  viewer: { id: string; role: UserRole },
  query: ListRidesQuery,
): Promise<{ rides: RideDto[]; next_cursor: string | null }> {
  const rows = await repository.listRidesForUser(viewer.id, {
    limit: query.limit + 1,
    before: query.before ? new Date(query.before) : undefined,
    statuses: query.status ? [query.status] : undefined,
  });

  // On demande une ligne de plus que la page : sa présence dit s'il reste quelque chose
  // à charger, sans compter la table entière.
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  // Pas d'extras dans une liste : ni code de montée, ni politique d'annulation. Ce sont
  // des informations d'INSTANT, qui n'ont de sens que sur la course qu'on regarde — et
  // les calculer pour vingt lignes coûterait vingt lectures de présence pour rien.
  const bundles = await repository.attachParties(page);
  const rides = bundles.map((bundle) => toRideDto(bundle, { id: viewer.id, role: viewer.role }));

  return { rides, next_cursor: hasMore && last ? last.createdAt.toISOString() : null };
}

export interface PayableRide {
  id: string;
  passengerId: string;
  driverId: string | null;
  status: RideStatus;
  paymentMethod: PaymentMethod;
  /** Le montant dû : le prix final s'il existe, sinon le prix ferme du devis. */
  amount: number;
}

/**
 * Ce que le module `payments` a besoin de savoir d'une course pour l'encaisser — et
 * rien de plus.
 *
 * `rides` possède la course : c'est donc lui qui expose cette vue, plutôt que de laisser
 * un autre module lire sa table (CLAUDE.md § 7). Le jour où encaisser demandera une
 * condition supplémentaire, elle s'ajoutera ici, une fois, et vaudra pour tout le monde.
 */
export async function payableRide(rideId: string): Promise<PayableRide | null> {
  const ride = await repository.findRideRow(rideId);
  if (!ride) return null;

  return {
    id: ride.id,
    passengerId: ride.passengerId,
    driverId: ride.driverId,
    status: ride.status,
    paymentMethod: ride.paymentMethod,
    amount: ride.priceFinal ?? ride.priceQuoted,
  };
}

// ─── Diffusion ───────────────────────────────────────────────────────────────

/**
 * Publie le nouveau statut aux deux parties. Les trois surfaces (passager, chauffeur,
 * ops) doivent afficher LE MÊME STATUT AU MÊME MOMENT : c'est la condition pour qu'un
 * litige soit arbitrable (CLAUDE.md § 5.7).
 *
 * Le payload ne porte que le statut et les montants : les DTO complets, eux, sont
 * filtrés par destinataire (`toRideDto`), et une diffusion large ne saurait pas le
 * faire. Le client rappelle `GET /v1/rides/{id}` pour le détail — l'événement dit
 * QUAND, la route dit QUOI.
 */
function announce(ride: Ride, extra: Record<string, unknown> = {}): void {
  publish(rideRoom(ride.id), RIDE_STATUS, {
    rideId: ride.id,
    status: ride.status,
    offer: ride.offer,
    price: ride.priceQuoted,
    at: new Date().toISOString(),
    ...extra,
  });
}

// ─── Commande ────────────────────────────────────────────────────────────────

/**
 * `POST /v1/rides` — le prix se fige ici, et ne bougera plus.
 *
 * L'ordre compte :
 *   1. idempotence — le double appui ne crée pas deux courses ;
 *   2. le devis est vérifié, signé, non expiré, et CONSOMMÉ (une fois) ;
 *   3. le net du chauffeur est calculé maintenant, pas à la fin : c'est ce montant-là
 *      qu'il verra dans la demande, et il devra être encore vrai après la course ;
 *   4. la course naît en `draft`, puis passe en `requested` PAR UNE TRANSITION — les
 *      deux lignes de journal existent, la création et la demande ;
 *   5. le dispatch part ensuite, sans bloquer la réponse : le passager voit son écran
 *      d'attente immédiatement.
 */
export async function requestRide(input: {
  passengerId: string;
  body: CreateRideBody;
  idempotencyKey: string;
}): Promise<RideDto> {
  const existing = await repository.findIdempotentRide(
    input.passengerId,
    CREATE_RIDE_ENDPOINT,
    input.idempotencyKey,
  );
  if (existing) {
    return getRide(existing.id, { id: input.passengerId, role: 'passenger' });
  }

  const quote = await redeemQuote({
    quoteId: input.body.quoteId,
    passengerId: input.passengerId,
    offer: input.body.offer,
  });

  const earnings = computeDriverEarnings(quote.price, quote.offer);
  const code = generateBoardingCode();

  const ride = await repository.insertRide({
    passengerId: input.passengerId,
    quoteId: quote.id,
    offer: quote.offer,
    status: 'draft',
    pickup: quote.pickup,
    pickupLabel: quote.pickupLabel,
    pickupNote: input.body.pickupNote ?? null,
    dropoff: quote.dropoff,
    dropoffLabel: quote.dropoffLabel,
    route: quote.route,
    priceQuoted: quote.price,
    distanceM: quote.distanceM,
    durationS: quote.durationS,
    commission: earnings.commission,
    dgiAmount: earnings.dgi,
    driverNet: earnings.net,
    paymentMethod: input.body.paymentMethod,
    boardingCodeHash: hashBoardingCode(code, config.JWT_SECRET),
  });

  rememberBoardingCode(ride.id, code);
  await repository.appendEvent({
    rideId: ride.id,
    type: 'ride.created',
    actorType: 'passenger',
    actorId: input.passengerId,
    payload: { quoteId: quote.id, offer: quote.offer, price: quote.price },
  });

  const requested = await repository.applyTransition({
    rideId: ride.id,
    from: 'draft',
    to: 'requested',
    actorType: 'passenger',
    actorId: input.passengerId,
    eventType: 'ride.requested',
    payload: { price: quote.price, routing: quote.routing },
    patch: { requestedAt: new Date() },
  });

  await repository.rememberIdempotency({
    userId: input.passengerId,
    endpoint: CREATE_RIDE_ENDPOINT,
    key: input.idempotencyKey,
    rideId: ride.id,
  });

  announce(requested);

  // Import différé : le moteur de dispatch appelle ce service en retour (`markOffered`,
  // `acceptRide`). Le charger ici, à l'exécution, casse le cycle sans indirection
  // artificielle. Il ne bloque pas la réponse : le passager voit son écran d'attente
  // pendant que la première offre part.
  const { startDispatch } = await import('../dispatch/engine.js');
  startDispatch(requested);

  return getRide(requested.id, { id: input.passengerId, role: 'passenger' });
}

// ─── Transitions pilotées par le dispatch ────────────────────────────────────

/** `requested` → `offered`, puis `offered` → `offered` d'un chauffeur à l'autre. */
export async function markOffered(
  rideId: string,
  offerId: string,
  driverId: string,
): Promise<void> {
  const ride = await repository.findRideRow(rideId);
  if (!ride) return;

  assertTransition(ride.status, 'offered', 'system');

  await repository.applyTransition({
    rideId,
    from: ride.status,
    to: 'offered',
    actorType: 'system',
    eventType: 'ride.offer_sent',
    payload: { offerId, driverId },
  });
}

/**
 * `offered` → `accepted`. Le chauffeur, son véhicule et son compteur kilométrique
 * s'inscrivent sur la course dans la même transaction que le statut.
 *
 * `driverOdometerStartM` est le point zéro de la règle des 300 m (CLAUDE.md § 5.3) :
 * sans lui, « le chauffeur a parcouru moins de 300 m » deviendrait « le chauffeur est à
 * moins de 300 m », ce qui n'est pas la même chose et punit celui qui a fait le tour du
 * pâté de maisons.
 */
export async function acceptRide(input: {
  rideId: string;
  driverId: string;
  vehicleId: string;
  etaS: number;
}): Promise<void> {
  const ride = await repository.findRideRow(input.rideId);
  if (!ride) return;

  assertTransition(ride.status, 'accepted', 'driver');

  const accepted = await repository.applyTransition({
    rideId: input.rideId,
    from: ride.status,
    to: 'accepted',
    actorType: 'driver',
    actorId: input.driverId,
    eventType: 'ride.accepted',
    payload: { etaS: input.etaS },
    patch: {
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      acceptedAt: new Date(),
      driverOdometerStartM: driverPresence.odometer(input.driverId) ?? 0,
    },
  });

  driverPresence.setAvailability(input.driverId, 'on_ride');
  announce(accepted, { etaMin: Math.max(1, Math.round(input.etaS / 60)) });
}

/**
 * Plus aucun chauffeur : la course expire. Le passager reçoit DEUX SORTIES, jamais un
 * spinner muet (CLAUDE.md § 5.4) — c'est l'appli qui les affiche, à partir de ce statut.
 */
export async function expireRide(rideId: string, reason: string): Promise<void> {
  const ride = await repository.findRideRow(rideId);
  if (!ride || !isActive(ride.status)) return;

  assertTransition(ride.status, 'expired', 'system');

  const expired = await repository.applyTransition({
    rideId,
    from: ride.status,
    to: 'expired',
    actorType: 'system',
    eventType: 'ride.expired',
    payload: { reason },
  });

  forgetBoardingCode(rideId);
  announce(expired, { reason });
}

/**
 * `accepted` → `approaching`, déclenché par le flux de positions : le chauffeur a
 * bougé, donc il vient. Sans effet si la course n'est plus dans cet état — ce n'est pas
 * une erreur, juste une position arrivée un peu tard.
 */
export async function noteApproaching(rideId: string, driverId: string): Promise<void> {
  const ride = await repository.findRideRow(rideId);
  if (!ride || ride.status !== 'accepted' || ride.driverId !== driverId) return;

  const approaching = await repository.applyTransition({
    rideId,
    from: 'accepted',
    to: 'approaching',
    actorType: 'system',
    actorId: driverId,
    eventType: 'ride.approaching',
  });

  announce(approaching);
}

// ─── Transitions pilotées par le chauffeur ───────────────────────────────────

/** Charge la course et vérifie qu'elle appartient bien à ce chauffeur. */
async function loadForDriver(rideId: string, driverId: string): Promise<Ride> {
  const ride = await repository.findRideRow(rideId);
  if (!ride) throw new AppError('NOT_FOUND', 'Cette course est introuvable.');

  if (ride.driverId !== driverId) {
    throw new AppError('FORBIDDEN', "Cette course n'est pas la vôtre.");
  }

  return ride;
}

/** « Je suis arrivé ». Le chronomètre du passager absent démarre à cet instant. */
export async function driverArrived(
  rideId: string,
  driverId: string,
  position?: LatLng,
): Promise<RideDto> {
  const ride = await loadForDriver(rideId, driverId);
  assertTransition(ride.status, 'arrived', 'driver');

  const kind = vehicleKindForOffer(ride.offer);
  const arrived = await repository.applyTransition({
    rideId,
    from: ride.status,
    to: 'arrived',
    actorType: 'driver',
    actorId: driverId,
    eventType: 'ride.arrived',
    payload: position ? { lat: position.lat, lng: position.lng } : {},
    patch: { arrivedAt: new Date() },
  });

  announce(arrived, { noShowAfterS: NO_SHOW_WAIT_S[kind] });
  return getRide(rideId, { id: driverId, role: 'driver' });
}

/**
 * `arrived` → `in_progress`, code de montée à l'appui. C'est LA porte de la course
 * (CLAUDE.md § 5.5) : sans le bon code, on ne démarre pas.
 *
 * Un code faux n'est PAS une transition invalide : c'est une action valide qui échoue.
 * Elle s'écrit donc au journal et incrémente le compteur — c'est la règle des trois
 * essais qui l'exige. Le statut, lui, ne bouge pas d'un iota.
 */
export async function startRide(
  rideId: string,
  driverId: string,
  code: string,
): Promise<RideDto> {
  const ride = await loadForDriver(rideId, driverId);
  assertTransition(ride.status, 'in_progress', 'driver');

  if (!ride.boardingCodeHash || !boardingCodeMatches(code, ride.boardingCodeHash, config.JWT_SECRET)) {
    const attempts = ride.boardingAttempts + 1;
    await repository.patchRide(rideId, { boardingAttempts: attempts });
    await repository.appendEvent({
      rideId,
      type: 'ride.boarding_code_failed',
      actorType: 'driver',
      actorId: driverId,
      payload: { attempts },
    });

    if (attempts >= BOARDING_CODE_MAX_ATTEMPTS) {
      // Trois échecs : ce n'est plus une faute de frappe. L'ops doit le voir tout de
      // suite — c'est peut-être quelqu'un qui essaie de monter dans la course d'un autre.
      publish(OPS_ROOM, OPS_ALERT, {
        kind: 'boarding_code',
        rideId,
        driverId,
        attempts,
        at: new Date().toISOString(),
      });
      logger.warn({ rideId, attempts }, 'Code de montée : 3 échecs');
    }

    throw new AppError(
      'WRONG_BOARDING_CODE',
      attempts >= BOARDING_CODE_MAX_ATTEMPTS
        ? 'Code incorrect. VORA a été prévenu ; demandez au passager de vérifier son écran.'
        : 'Code incorrect. Demandez au passager les 4 chiffres affichés sur son écran.',
      { attempts, remaining: Math.max(0, BOARDING_CODE_MAX_ATTEMPTS - attempts) },
    );
  }

  const started = await repository.applyTransition({
    rideId,
    from: 'arrived',
    to: 'in_progress',
    actorType: 'driver',
    actorId: driverId,
    eventType: 'ride.started',
    patch: { startedAt: new Date() },
  });

  // Le code a servi : il n'a plus de raison d'exister nulle part.
  forgetBoardingCode(rideId);
  announce(started);
  return getRide(rideId, { id: driverId, role: 'driver' });
}

/**
 * `in_progress` → `completed`. Le prix final est le prix FERME : c'est la promesse
 * du § 5.1, et elle se tient sur cette ligne. Aucun recalcul en fin de course.
 */
export async function completeRide(
  rideId: string,
  driverId: string,
  position?: LatLng,
): Promise<RideDto> {
  const ride = await loadForDriver(rideId, driverId);
  assertTransition(ride.status, 'completed', 'driver');

  const completed = await repository.applyTransition({
    rideId,
    from: 'in_progress',
    to: 'completed',
    actorType: 'driver',
    actorId: driverId,
    eventType: 'ride.completed',
    payload: position ? { lat: position.lat, lng: position.lng } : {},
    patch: { completedAt: new Date(), priceFinal: ride.priceQuoted },
  });

  announce(completed, { price: completed.priceFinal ?? completed.priceQuoted });
  return getRide(rideId, { id: driverId, role: 'driver' });
}

/**
 * Passager absent : le chauffeur a attendu 5 min (voiture) ou 3 min (moto) après
 * « Je suis arrivé ». Mêmes frais qu'une annulation tardive, mêmes reversements.
 */
export async function noShow(
  rideId: string,
  driverId: string,
): Promise<{ status: RideStatus; feeXaf: number }> {
  const ride = await loadForDriver(rideId, driverId);
  assertTransition(ride.status, 'no_show', 'driver');

  const kind = vehicleKindForOffer(ride.offer);
  const waitS = NO_SHOW_WAIT_S[kind];
  const waitedS = ride.arrivedAt ? (Date.now() - ride.arrivedAt.getTime()) / 1000 : 0;

  if (waitedS < waitS) {
    throw new AppError(
      'CONFLICT',
      `Attendez encore ${Math.ceil(waitS - waitedS)} secondes avant de clôturer.`,
      { waited_s: Math.floor(waitedS), required_s: waitS },
    );
  }

  const fee = CANCEL_FEE[kind];
  const closed = await repository.applyTransition({
    rideId,
    from: 'arrived',
    to: 'no_show',
    actorType: 'driver',
    actorId: driverId,
    eventType: 'ride.no_show',
    payload: { waited_s: Math.floor(waitedS), fee },
    patch: { cancelledBy: 'driver', cancelReason: 'passager absent', cancelFee: fee },
  });

  await creditFee(closed, driverId, 'no_show_fee', fee);
  finishRide(closed);
  announce(closed, { feeXaf: fee });

  return { status: closed.status, feeXaf: fee };
}

// ─── Annulation (CLAUDE.md § 5.3) ────────────────────────────────────────────

export interface CancellationPolicy {
  free: boolean;
  feeXaf: number;
  /** Instant jusqu'auquel l'annulation reste gratuite, ou `null` si elle l'est encore. */
  freeUntil: string | null;
  reason: 'no_driver_yet' | 'within_2_min' | 'under_300_m' | 'late';
  /** Distance parcourue par le chauffeur depuis son acceptation, en mètres. */
  driverTravelledM: number | null;
}

/**
 * Gratuit ou payant ? Les deux conditions du § 5.3 sont ALTERNATIVES : la première
 * remplie suffit. Le libellé du bouton d'annulation en découle directement — « Annuler ·
 * gratuit encore 1:20 », puis « Annuler · 300 F reversés à Boris ».
 */
export function cancellationPolicy(ride: Ride, now: Date = new Date()): CancellationPolicy {
  const kind = vehicleKindForOffer(ride.offer);
  const fee = CANCEL_FEE[kind];

  // Aucun chauffeur engagé : personne n'a perdu de temps, donc rien à payer.
  if (!ride.driverId || !ride.acceptedAt) {
    return {
      free: true,
      feeXaf: 0,
      freeUntil: null,
      reason: 'no_driver_yet',
      driverTravelledM: null,
    };
  }

  const freeUntil = new Date(ride.acceptedAt.getTime() + FREE_CANCEL_WINDOW_S * 1000);
  if (now < freeUntil) {
    return {
      free: true,
      feeXaf: 0,
      freeUntil: freeUntil.toISOString(),
      reason: 'within_2_min',
      driverTravelledM: travelledSinceAccept(ride),
    };
  }

  // Deuxième chance : le chauffeur n'a pas encore roulé 300 m.
  const travelled = travelledSinceAccept(ride);
  if (travelled !== null && travelled < FREE_CANCEL_DISTANCE_M) {
    return {
      free: true,
      feeXaf: 0,
      freeUntil: null,
      reason: 'under_300_m',
      driverTravelledM: travelled,
    };
  }

  return {
    free: false,
    feeXaf: fee,
    freeUntil: freeUntil.toISOString(),
    reason: 'late',
    driverTravelledM: travelled,
  };
}

/**
 * Distance réellement parcourue par le chauffeur depuis son acceptation.
 *
 * `null` quand on ne sait pas — position perdue, API redémarrée. Dans ce cas la règle
 * des 300 m ne s'applique pas, et c'est la fenêtre de 2 minutes qui tranche seule : on
 * ne facture pas un passager sur une mesure qu'on n'a pas.
 */
function travelledSinceAccept(ride: Ride): number | null {
  if (!ride.driverId || ride.driverOdometerStartM === null) return null;
  const current = driverPresence.odometer(ride.driverId);
  if (current === null) return null;
  return Math.max(0, Math.round(current - ride.driverOdometerStartM));
}

export async function cancelRide(input: {
  rideId: string;
  actorId: string;
  actorType: Extract<Actor, 'passenger' | 'driver' | 'ops'>;
  reason?: string;
}): Promise<{ status: RideStatus; feeXaf: number }> {
  const ride = await repository.findRideRow(input.rideId);
  if (!ride) throw new AppError('NOT_FOUND', 'Cette course est introuvable.');

  if (input.actorType === 'passenger' && ride.passengerId !== input.actorId) {
    throw new AppError('FORBIDDEN', "Cette course n'est pas la vôtre.");
  }
  if (input.actorType === 'driver' && ride.driverId !== input.actorId) {
    throw new AppError('FORBIDDEN', "Cette course n'est pas la vôtre.");
  }

  // Le chauffeur qui annule : pas de frais pour le passager, mais une trace sur son
  // taux d'annulation — c'est ce taux qui pèse 15 % dans son score (§ 5.4).
  if (input.actorType === 'driver') {
    return cancelByDriver(ride, input.actorId, input.reason);
  }

  // Le dispatch en cours s'arrête AVANT la transition : inutile de laisser un chauffeur
  // devant une demande qui n'a plus d'objet. Et on RELIT la course ensuite : le moteur
  // pouvait être en train de la passer d'un chauffeur au suivant, et annuler sur un
  // statut périmé échouerait sous les doigts du passager pour une raison qui ne le
  // regarde pas.
  const { stopDispatch } = await import('../dispatch/engine.js');
  await stopDispatch(ride.id, 'Le passager a annulé.');

  const current = (await repository.findRideRow(input.rideId)) ?? ride;
  const policy = cancellationPolicy(current);
  const target: RideStatus = policy.free ? 'cancelled_free' : 'cancelled_late';
  assertTransition(current.status, target, input.actorType);

  const cancelled = await repository.applyTransition({
    rideId: ride.id,
    from: current.status,
    to: target,
    actorType: input.actorType,
    actorId: input.actorId,
    eventType: 'ride.cancelled',
    payload: {
      free: policy.free,
      fee: policy.feeXaf,
      rule: policy.reason,
      driver_travelled_m: policy.driverTravelledM,
      reason: input.reason ?? null,
    },
    patch: {
      cancelledBy: input.actorType,
      cancelReason: input.reason ?? null,
      cancelFee: policy.feeXaf,
    },
  });

  // « Reversés INTÉGRALEMENT au chauffeur » (§ 5.3) : ni commission, ni DGI sur un
  // frais d'annulation. Le chauffeur touche les 300 F, pas 255.
  if (!policy.free && cancelled.driverId) {
    await creditFee(cancelled, cancelled.driverId, 'cancel_fee', policy.feeXaf);
    publish(driverRoom(cancelled.driverId), RIDE_CANCELLED, {
      rideId: cancelled.id,
      feeXaf: policy.feeXaf,
      reason: 'Le passager a annulé.',
    });
  } else if (cancelled.driverId) {
    publish(driverRoom(cancelled.driverId), RIDE_CANCELLED, {
      rideId: cancelled.id,
      feeXaf: 0,
      reason: 'Le passager a annulé.',
    });
  }

  finishRide(cancelled);
  announce(cancelled, { feeXaf: policy.feeXaf, free: policy.free });

  return { status: cancelled.status, feeXaf: policy.feeXaf };
}

async function cancelByDriver(
  ride: Ride,
  driverId: string,
  reason?: string,
): Promise<{ status: RideStatus; feeXaf: number }> {
  assertTransition(ride.status, 'cancelled_driver', 'driver');

  const cancelled = await repository.applyTransition({
    rideId: ride.id,
    from: ride.status,
    to: 'cancelled_driver',
    actorType: 'driver',
    actorId: driverId,
    eventType: 'ride.cancelled',
    payload: { by: 'driver', reason: reason ?? null },
    patch: { cancelledBy: 'driver', cancelReason: reason ?? null, cancelFee: 0 },
  });

  await dispatch.noteDriverCancellation(driverId);

  finishRide(cancelled);
  announce(cancelled, { feeXaf: 0, free: true });

  return { status: cancelled.status, feeXaf: 0 };
}

// ─── Paiement (appelé par le module payments) ────────────────────────────────

/**
 * `completed` → `paid`. Écrit par le module `payments`, qui possède les intentions de
 * paiement ; c'est `rides` qui possède le statut de la course, d'où cet appel de service
 * à service plutôt qu'une écriture croisée (CLAUDE.md § 7).
 */
export async function markPaid(input: {
  rideId: string;
  method: PaymentMethod;
  providerRef: string | null;
  actorId: string;
  actorType: Extract<Actor, 'passenger' | 'driver' | 'system'>;
}): Promise<Ride> {
  const ride = await repository.findRideRow(input.rideId);
  if (!ride) throw new AppError('NOT_FOUND', 'Cette course est introuvable.');

  assertTransition(ride.status, 'paid', input.actorType);

  const amount = ride.priceFinal ?? ride.priceQuoted;
  const paid = await repository.applyTransition({
    rideId: ride.id,
    from: 'completed',
    to: 'paid',
    actorType: input.actorType,
    actorId: input.actorId,
    eventType: 'ride.paid',
    payload: { method: input.method, amount, providerRef: input.providerRef },
    patch: { paidAt: new Date(), paymentMethod: input.method, paymentStatus: 'paid' },
  });

  if (paid.driverId) {
    await repository.creditDriver({
      rideId: paid.id,
      driverId: paid.driverId,
      source: 'ride',
      gross: amount,
      commission: paid.commission ?? 0,
      dgi: paid.dgiAmount ?? 0,
      net: paid.driverNet ?? amount,
      paymentMethod: input.method,
    });

    // En espèces, le chauffeur encaisse le brut : il doit à VORA la commission et la
    // retenue DGI. En Mobile Money, VORA encaisse et reverse : aucune dette.
    const cashDue =
      input.method === 'cash' ? (paid.commission ?? 0) + (paid.dgiAmount ?? 0) : 0;
    await dispatch.noteRideCompleted(paid.driverId, cashDue);
  }

  finishRide(paid);
  announce(paid, {
    method: input.method,
    netXaf: paid.driverNet,
  });

  return paid;
}

// ─── « Attendre 2 min » : relancer une course expirée ────────────────────────

/**
 * `expired` → `requested`, puis un nouveau dispatch SUR LA MÊME COURSE.
 *
 * C'est la première des deux sorties promises au passager après trois vagues sans
 * réponse (CLAUDE.md § 5.4). Elle repart au prix déjà figé : le devis a été consommé,
 * la course existe, rien ne justifie de refacturer. La seconde sortie — « Réessayer » —
 * est un nouveau devis, et elle ne passe pas par ici.
 */
export async function retryRide(rideId: string, passengerId: string): Promise<RideDto> {
  const ride = await repository.findRideRow(rideId);
  if (!ride) throw new AppError('NOT_FOUND', 'Cette course est introuvable.');
  if (ride.passengerId !== passengerId) {
    throw new AppError('FORBIDDEN', "Cette course n'est pas la vôtre.");
  }

  assertTransition(ride.status, 'requested', 'passenger');

  const relaunched = await repository.applyTransition({
    rideId,
    from: ride.status,
    to: 'requested',
    actorType: 'passenger',
    actorId: passengerId,
    eventType: 'ride.requested',
    payload: { retry: true, price: ride.priceQuoted },
    patch: { requestedAt: new Date() },
  });

  announce(relaunched, { retry: true });

  const { startDispatch } = await import('../dispatch/engine.js');
  startDispatch(relaunched);

  return getRide(rideId, { id: passengerId, role: 'passenger' });
}

// ─── Notation (CLAUDE.md § 5.7 : `paid` → `rated`) ───────────────────────────

/**
 * Note de fin de course, des deux côtés. La note du passager ferme la course ; celle du
 * chauffeur s'enregistre sans rien fermer — il note souvent après avoir déjà repris la
 * route, et une course ne doit pas rester ouverte en attendant son geste.
 *
 * La moyenne du chauffeur est recalculée depuis la table, dans la même transaction :
 * elle pèse 10 % de son score de dispatch, elle ne peut pas dériver.
 */
export async function rateRide(input: {
  rideId: string;
  raterId: string;
  role: UserRole;
  stars: number;
  tags: string[];
  comment?: string;
}): Promise<{ ok: boolean; alreadyRated: boolean }> {
  const ride = await repository.findRideRow(input.rideId);
  if (!ride) throw new AppError('NOT_FOUND', 'Cette course est introuvable.');

  const isPassenger = ride.passengerId === input.raterId;
  const isDriver = ride.driverId === input.raterId;
  if (!isPassenger && !isDriver) {
    throw new AppError('FORBIDDEN', "Cette course n'est pas la vôtre.");
  }

  // On ne note pas une course qu'on n'a pas faite : avant le paiement, il n'y a rien à
  // juger, et après une annulation il n'y a eu aucun trajet.
  if (ride.status !== 'paid' && ride.status !== 'rated') {
    throw new AppError(
      'INVALID_TRANSITION',
      'Cette course ne peut pas encore être notée. Elle doit être payée.',
      { from: ride.status },
    );
  }

  const rateeId = isPassenger ? ride.driverId : ride.passengerId;
  if (!rateeId) {
    throw new AppError('CONFLICT', "Cette course n'a pas d'autre partie à noter.");
  }

  const saved = await repository.saveRating({
    rideId: input.rideId,
    raterId: input.raterId,
    rateeId,
    stars: input.stars,
    tags: input.tags,
    comment: input.comment ?? null,
  });

  if (!saved) return { ok: true, alreadyRated: true };

  await repository.appendEvent({
    rideId: input.rideId,
    type: 'ride.rated',
    actorType: isPassenger ? 'passenger' : 'driver',
    actorId: input.raterId,
    // Ni le commentaire ni l'identité du noté : le journal d'une course n'est pas
    // l'endroit où stocker un jugement lisible par les deux parties.
    payload: { stars: input.stars, by: isPassenger ? 'passenger' : 'driver' },
  });

  // Seule la note du passager clôt la course.
  if (isPassenger && ride.status === 'paid') {
    const rated = await repository.applyTransition({
      rideId: input.rideId,
      from: 'paid',
      to: 'rated',
      actorType: 'passenger',
      actorId: input.raterId,
      eventType: 'ride.rated',
      payload: { stars: input.stars },
    });
    announce(rated, { stars: input.stars });
  }

  return { ok: true, alreadyRated: false };
}

// ─── SOS (CLAUDE.md § 8.1) ───────────────────────────────────────────────────

/**
 * Alerte SOS. NE CHANGE PAS le statut de la course : la course continue, c'est
 * précisément le problème. Elle écrit au journal et réveille l'ops.
 *
 * Rien ici ne peut échouer pour une raison secondaire — pas de règle de statut, pas de
 * vérification de moment. Un SOS se déclenche à l'arrêt, en roulant, avant la montée ou
 * après la descente : le seul contrôle est que la personne appartienne à la course.
 */
export async function raiseSos(input: {
  rideId: string;
  actorId: string;
  role: UserRole;
  position?: LatLng;
  note?: string;
}): Promise<{ alertId: string; notified: string[] }> {
  const bundle = await repository.findRideById(input.rideId);
  if (!bundle || !canSee(bundle.ride, input.actorId, input.role)) {
    throw new AppError('NOT_FOUND', 'Cette course est introuvable.');
  }

  const { ride } = bundle;
  const alertId = randomUUID();
  const actorType: Actor = ride.driverId === input.actorId ? 'driver' : 'passenger';

  // La position du SOS : celle envoyée par le téléphone, sinon la dernière connue du
  // chauffeur, sinon le point de rendez-vous. Une alerte sans lieu ne sert à rien.
  const position =
    input.position ??
    (ride.driverId ? driverPresence.get(ride.driverId) : null) ??
    ride.pickup;

  await repository.appendEvent({
    rideId: ride.id,
    type: 'ride.sos',
    actorType,
    actorId: input.actorId,
    payload: {
      alertId,
      by: actorType,
      lat: position.lat,
      lng: position.lng,
      note: input.note ?? null,
    },
  });

  publish(OPS_ROOM, OPS_ALERT, {
    kind: 'sos',
    alertId,
    rideId: ride.id,
    by: actorType,
    status: ride.status,
    lat: position.lat,
    lng: position.lng,
    // Les deux parties par leur ID VORA : de quoi les rappeler depuis la fiche ops,
    // sans qu'aucun numéro ne transite par un canal de diffusion.
    passengerVoraId: bundle.passenger.voraId,
    driverVoraId: bundle.driver?.voraId ?? null,
    plate: bundle.vehicle ? formatPlate(bundle.vehicle.plate) : null,
    at: new Date().toISOString(),
  });

  logger.error({ rideId: ride.id, alertId, by: actorType }, 'SOS déclenché');

  // L'autre partie est prévenue que l'alerte est partie : personne ne doit croire que
  // son bouton n'a rien fait.
  publish(rideRoom(ride.id), RIDE_STATUS, {
    rideId: ride.id,
    status: ride.status,
    sos: { alertId, by: actorType, at: new Date().toISOString() },
  });

  const notified = ['ops'];
  if (ride.driverId && actorType === 'passenger') notified.push('driver');
  if (actorType === 'driver') notified.push('passenger');

  return { alertId, notified };
}

// ─── Partage de trajet (CLAUDE.md § 8.1) ─────────────────────────────────────

/** Crée le lien public. Le jeton porte lui-même son échéance — voir `share.ts`. */
export async function shareRide(
  rideId: string,
  passengerId: string,
): Promise<{ url: string; expiresAt: string }> {
  const ride = await repository.findRideRow(rideId);
  if (!ride) throw new AppError('NOT_FOUND', 'Cette course est introuvable.');
  if (ride.passengerId !== passengerId) {
    throw new AppError('FORBIDDEN', "Cette course n'est pas la vôtre.");
  }

  const expiresAt = new Date(Date.now() + config.SHARE_LINK_TTL_S * 1000);
  const token = signShareToken(
    { rideId, expiresAt: Math.floor(expiresAt.getTime() / 1000) },
    config.JWT_SECRET,
  );

  await repository.appendEvent({
    rideId,
    type: 'ride.shared',
    actorType: 'passenger',
    actorId: passengerId,
    // Jamais le jeton lui-même dans le journal : ce serait y écrire la clé de la porte.
    payload: { expiresAt: expiresAt.toISOString() },
  });

  return {
    url: `${config.PUBLIC_BASE_URL}/v1/share/${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Vue publique d'un trajet partagé. Aucune session, aucun compte.
 *
 * Ce que le proche voit : où en est la course, quel véhicule, quelle plaque, et le point
 * qui bouge. Ce qu'il ne voit pas : les noms complets, les identifiants VORA, le prix,
 * et bien sûr aucun moyen de contact. Un jeton invalide ou périmé donne un 404 — pas un
 * message qui distinguerait « expiré » de « inexistant ».
 */
export async function readSharedRide(token: string): Promise<SharedRideDto> {
  const parsed = readShareToken(token, config.JWT_SECRET);
  if (!parsed) {
    throw new AppError('NOT_FOUND', "Ce lien de trajet n'est plus valable.");
  }

  const bundle = await repository.findRideById(parsed.rideId);
  if (!bundle) {
    throw new AppError('NOT_FOUND', "Ce lien de trajet n'est plus valable.");
  }

  return toSharedRideDto(bundle, {
    driverPosition: bundle.ride.driverId
      ? (driverPresence.get(bundle.ride.driverId) ?? null)
      : null,
    expiresAt: new Date(parsed.expiresAt * 1000).toISOString(),
  });
}

// ─── Gains du chauffeur ──────────────────────────────────────────────────────

export type EarningsPeriod = 'day' | 'week' | 'month';

/** Début de la période, à partir de minuit à Yaoundé (voir `lib/time.ts`). */
function startOfPeriod(period: EarningsPeriod, now = new Date()): Date {
  const today = startOfCityDay(now).getTime();

  if (period === 'day') return new Date(today);
  if (period === 'week') return new Date(today - 6 * DAY_MS);
  return new Date(today - 29 * DAY_MS);
}

/**
 * « Combien ai-je gagné ? » — TROISIÈME MOMENT DE VÉRITÉ (CLAUDE.md § 2).
 *
 * Les montants viennent de `driver_earnings`, exacts au franc, frais d'annulation
 * compris. `onlineMinutes` est la seule valeur approchée du lot : elle est mesurée
 * depuis la mise en ligne EN COURS, en mémoire, et repart de zéro si l'API redémarre.
 * L'historique détaillé semaine/mois du temps en ligne demanderait une table de sessions,
 * explicitement hors périmètre (CLAUDE.md § 8.3) — mieux vaut un chiffre honnête et daté
 * qu'un chiffre inventé.
 */
export async function driverEarnings(
  driverId: string,
  period: EarningsPeriod,
): Promise<DriverEarningsDto> {
  const since = startOfPeriod(period);

  const [totals, byHour, recent] = await Promise.all([
    repository.sumEarnings(driverId, since),
    period === 'day'
      ? repository.earningsByHour(driverId, since)
      : Promise.resolve<Array<{ hour: number; netXaf: number }>>([]),
    repository.recentEarnings(driverId, since, 20),
  ]);

  const presence = driverPresence.get(driverId);

  return {
    period,
    since: since.toISOString(),
    netXaf: totals.netXaf,
    netFormatted: formatAmount(totals.netXaf),
    grossXaf: totals.grossXaf,
    commissionXaf: totals.commissionXaf,
    dgiXaf: totals.dgiXaf,
    ridesCount: totals.ridesCount,
    onlineMinutes: presence ? Math.round((Date.now() - presence.onlineSince.getTime()) / 60_000) : 0,
    byHour: byHour.map((row) => ({ hour: row.hour, netXaf: row.netXaf })),
    recent: recent.map((row) => ({
      rideId: row.rideId,
      at: row.at.toISOString(),
      from: row.from,
      to: row.to,
      netXaf: row.netXaf,
      netFormatted: formatAmount(row.netXaf),
      source: row.source,
    })),
  };
}

// ─── Fin de vie ──────────────────────────────────────────────────────────────

/** Crédite un frais reversé INTÉGRALEMENT : pas de commission, pas de retenue. */
async function creditFee(
  ride: Ride,
  driverId: string,
  source: 'cancel_fee' | 'no_show_fee',
  fee: number,
): Promise<void> {
  if (fee <= 0) return;

  await repository.creditDriver({
    rideId: ride.id,
    driverId,
    source,
    gross: fee,
    commission: 0,
    dgi: 0,
    net: fee,
    paymentMethod: ride.paymentMethod,
  });
}

/** La course est close : le chauffeur redevient disponible, le code s'oublie. */
function finishRide(ride: Ride): void {
  if (ride.driverId) driverPresence.setAvailability(ride.driverId, 'available');
  forgetBoardingCode(ride.id);
  // Le tampon de rejeu de cette course ne sert plus à personne : les clients qui se
  // reconnectent liront l'état final par `GET /v1/rides/{id}`.
  setTimeout(() => forget(rideRoom(ride.id)), 60_000).unref?.();
}

// ─── Vue passager du code de montée ──────────────────────────────────────────

/**
 * Le code que le passager lira au chauffeur. Régénéré s'il a été perdu (redémarrage de
 * l'API) : voir l'en-tête de `boarding.ts`. Le chauffeur ne passe JAMAIS par ici — la
 * garde est dans la route et dans le DTO.
 */
export async function boardingCodeForPassenger(ride: Ride): Promise<string | null> {
  // Le code n'a de sens qu'entre l'acceptation et la montée à bord.
  if (!['accepted', 'approaching', 'arrived'].includes(ride.status)) return null;

  const remembered = recallBoardingCode(ride.id);
  if (remembered) return remembered;

  const code = generateBoardingCode();
  await repository.patchRide(ride.id, {
    boardingCodeHash: hashBoardingCode(code, config.JWT_SECRET),
  });
  rememberBoardingCode(ride.id, code);
  logger.info({ rideId: ride.id }, 'Code de montée régénéré (mémoire perdue)');

  return code;
}

/** Distance à vol d'oiseau chauffeur → passager, pour l'ETA affiché pendant l'approche. */
export function approachDistanceM(ride: Ride): number | null {
  if (!ride.driverId) return null;
  const presence = driverPresence.get(ride.driverId);
  if (!presence) return null;
  return Math.round(haversineMeters({ lat: presence.lat, lng: presence.lng }, ride.pickup));
}
