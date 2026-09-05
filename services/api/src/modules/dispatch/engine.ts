// VORA — attribution des courses. UN SEUL CHAUFFEUR À LA FOIS (CLAUDE.md § 5.4).
//
// C'est le deuxième moment de vérité qui se joue ici : « le chauffeur arrive comme
// promis ». Un dispatch qui arrose dix chauffeurs à la fois obtient une acceptation plus
// vite — et neuf chauffeurs qui apprennent une seconde plus tard qu'ils ont perdu. Au
// bout de quelques jours, ils n'ouvrent plus les demandes. L'offre séquentielle est plus
// lente sur le papier, et c'est la seule qui tienne dans la durée.
//
// La boucle, littéralement :
//
//   vague 1 (rayon 1 km) → candidats classés par score
//        chauffeur A : 15 s pour répondre → refus ou silence → chauffeur B, TOUT DE SUITE
//        …
//   vague 2 (3 km) → les nouveaux candidats seulement
//   vague 3 (5 km)
//   plus personne → la course passe `expired`, et le passager reçoit DEUX SORTIES
//                   (« Attendre 2 min » / « Réessayer »), jamais un spinner muet.
//
// « En moins d'une seconde » (§ 5.4) : le passage au suivant ne dépend d'aucun
// battement d'horloge. Un refus résout immédiatement la promesse d'attente, la boucle
// reprend au tour suivant. Le seul délai jamais attendu est celui du chauffeur qui
// laisse filer ses 15 s.
//
// ÉTAT EN MÉMOIRE : les minuteries et les promesses d'attente vivent dans ce processus.
// C'est le corollaire des positions en mémoire (CLAUDE.md § 3) — voir `presence.ts`.
// Un redémarrage de l'API pendant un dispatch laisse la course en `offered` : le
// balayage `sweepStaleDispatch` la rattrape et la fait expirer proprement.

import {
  DISPATCH_MAX_WAVES,
  DISPATCH_OFFER_TIMEOUT_S,
  DISPATCH_WAVE_RADII_KM,
  vehicleKindForOffer,
} from '../../domain/rules.js';
import type { Ride } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { publish } from '../../realtime/bus.js';
import {
  driverRoom,
  rideRoom,
  OPS_ALERT,
  OPS_ROOM,
  RIDE_OFFER,
  RIDE_OFFER_CLOSED,
} from '../../realtime/events.js';
import { driverPresence } from './presence.js';
import * as repository from './repository.js';
import { approachEtaS, scoreDriver } from './scoring.js';

/** Réponse d'un chauffeur à une offre, ou l'absence de réponse. */
type OfferOutcome = 'accepted' | 'declined' | 'expired' | 'cancelled';

interface PendingOffer {
  rideId: string;
  driverId: string;
  /** Ce qu'il faudra écrire sur la course si ce chauffeur accepte. */
  vehicleId: string;
  etaS: number;
  settle(outcome: OfferOutcome): void;
}

/** Une course en cours d'attribution. Sert à l'arrêter net quand le passager annule. */
interface DispatchRun {
  rideId: string;
  cancelled: boolean;
  pending: PendingOffer | null;
  startedAt: number;
}

const runs = new Map<string, DispatchRun>();
/** Index par offre : le chauffeur répond avec un identifiant d'offre, pas de course. */
const pendingByOffer = new Map<string, PendingOffer>();

/** Dispatchs en cours — page ops et tests. */
export function activeDispatchCount(): number {
  return runs.size;
}

/**
 * Lance l'attribution. Ne rejette JAMAIS : une panne de dispatch fait expirer la course
 * proprement, avec ses deux sorties, elle ne remonte pas en erreur 500 sur le
 * `POST /v1/rides` qui a déjà réussi.
 */
export function startDispatch(ride: Ride): void {
  if (runs.has(ride.id)) return;

  const run: DispatchRun = { rideId: ride.id, cancelled: false, pending: null, startedAt: Date.now() };
  runs.set(ride.id, run);

  void dispatchLoop(ride, run)
    .catch((error: unknown) => {
      logger.error({ err: error, rideId: ride.id }, 'Dispatch interrompu par une erreur');
      return expire(ride, "Le dispatch s'est interrompu.");
    })
    .finally(() => {
      runs.delete(ride.id);
    });
}

/**
 * Arrête l'attribution en cours : le passager a annulé, ou l'ops a repris la main.
 * L'offre ouverte est close et le chauffeur prévenu — il ne doit pas rester quinze
 * secondes devant une demande qui n'existe plus.
 */
export async function stopDispatch(rideId: string, reason: string): Promise<void> {
  const run = runs.get(rideId);
  if (!run) return;

  run.cancelled = true;
  const pending = run.pending;
  if (pending) {
    publish(driverRoom(pending.driverId), RIDE_OFFER_CLOSED, { rideId, reason });
    pending.settle('cancelled');
  }
}

/**
 * Réponse d'un chauffeur. Renvoie `true` si elle a été prise en compte, `false` si
 * l'offre n'était plus ouverte (15 s dépassées, course annulée entre-temps).
 *
 * La vérité est en BASE, pas en mémoire : `closeOffer` n'écrit que si l'offre est
 * encore `pending`. Le doigt du chauffeur et le chronomètre peuvent tomber dans la même
 * milliseconde ; celui qui écrit le premier gagne.
 *
 * L'ACCEPTATION EST ÉCRITE ICI, avant de rendre la main. Si on se contentait de réveiller
 * la boucle et de répondre au chauffeur, son application afficherait « course acceptée »
 * pendant que `GET /v1/rides/{id}` répondrait encore `offered` : deux surfaces, deux
 * vérités, exactement ce que CLAUDE.md § 5.7 interdit.
 */
export async function respondToOffer(
  offerId: string,
  driverId: string,
  response: 'accepted' | 'declined',
): Promise<boolean> {
  const pending = pendingByOffer.get(offerId);
  if (!pending || pending.driverId !== driverId) return false;

  const closed = await repository.closeOffer(offerId, response);
  if (!closed) return false;

  await repository.recordOfferOutcome(driverId, response === 'accepted');

  if (response === 'declined') {
    pending.settle('declined');
    return true;
  }

  try {
    const rides = await import('../rides/service.js');
    await rides.acceptRide({
      rideId: pending.rideId,
      driverId,
      vehicleId: pending.vehicleId,
      etaS: pending.etaS,
    });
  } catch (error) {
    // La course a pu être annulée entre la fermeture de l'offre et la transition. Le
    // chauffeur doit l'apprendre, pas croire qu'il a une course.
    pending.settle('cancelled');
    throw error;
  }

  pending.settle('accepted');
  return true;
}

// ─── La boucle ───────────────────────────────────────────────────────────────

async function dispatchLoop(ride: Ride, run: DispatchRun): Promise<void> {
  const kind = vehicleKindForOffer(ride.offer);
  const timeoutMs = DISPATCH_OFFER_TIMEOUT_S * 1000;
  let anyoneAsked = false;

  for (let wave = 1; wave <= DISPATCH_MAX_WAVES; wave += 1) {
    if (run.cancelled) return;

    const radiusKm = DISPATCH_WAVE_RADII_KM[wave - 1] ?? DISPATCH_WAVE_RADII_KM.at(-1) ?? 5;

    // Les chauffeurs déjà sollicités sont relus À CHAQUE VAGUE : celui qui a refusé au
    // premier rayon ne doit pas être redemandé au troisième.
    const alreadyAsked = new Set(await repository.listOfferedDriverIds(ride.id));
    const candidates = await selectCandidates(ride, radiusKm, kind, alreadyAsked);

    for (const [index, candidate] of candidates.entries()) {
      if (run.cancelled) return;

      anyoneAsked = true;
      const outcome = await offerTo(ride, run, candidate, wave, index, timeoutMs);

      if (outcome === 'accepted') return; // la transition a été écrite par `accept`
      if (outcome === 'cancelled') return;
      // refus ou silence : on enchaîne immédiatement, sans attendre quoi que ce soit.
    }
  }

  if (run.cancelled) return;

  await expire(
    ride,
    anyoneAsked
      ? 'Aucun chauffeur disponible n’a accepté.'
      : 'Aucun chauffeur en ligne dans le secteur.',
  );
}

interface Candidate {
  driverId: string;
  vehicleId: string;
  etaS: number;
  score: number;
  distanceM: number;
}

/**
 * Qui peut prendre cette course, et dans quel ordre.
 *
 * Deux filtres se complètent : la MÉMOIRE dit qui est physiquement là et disponible
 * (position vivante depuis moins de 60 s), la BASE dit qui a le droit d'y être (dossier
 * validé, en ligne, véhicule servant l'offre). Aucun des deux ne suffit seul.
 *
 * Le géorepérage moto, lui, a déjà tranché : la course n'existerait pas si son
 * itinéraire touchait une zone interdite (module `pricing`, avant même le devis). Il
 * n'y a donc rien à revérifier ici — et rien à laisser passer non plus.
 */
async function selectCandidates(
  ride: Ride,
  radiusKm: number,
  kind: 'car' | 'moto',
  alreadyAsked: Set<string>,
): Promise<Candidate[]> {
  const nearby = driverPresence
    .nearby(ride.pickup, radiusKm, { kind })
    .filter((driver) => !alreadyAsked.has(driver.driverId));

  if (nearby.length === 0) return [];

  const eligible = await repository.findCandidates(
    nearby.map((driver) => driver.driverId),
    ride.offer,
  );
  const byId = new Map(eligible.map((row) => [row.userId, row]));

  return nearby
    .flatMap((presence) => {
      const profile = byId.get(presence.driverId);
      if (!profile) return [];

      const etaS = approachEtaS(
        { lat: presence.lat, lng: presence.lng },
        ride.pickup,
        presence.kind,
      );

      const { score } = scoreDriver({
        etaS,
        acceptanceRate: profile.acceptanceRate,
        cancellationRate: profile.cancellationRate,
        rating: profile.rating,
      });

      return [
        {
          driverId: presence.driverId,
          vehicleId: profile.vehicleId,
          etaS,
          score,
          distanceM: presence.distanceM,
        },
      ];
    })
    .sort((a, b) => b.score - a.score);
}

/** Propose la course à UN chauffeur, et attend sa réponse au plus 15 secondes. */
async function offerTo(
  ride: Ride,
  run: DispatchRun,
  candidate: Candidate,
  wave: number,
  rank: number,
  timeoutMs: number,
): Promise<OfferOutcome> {
  const expiresAt = new Date(Date.now() + timeoutMs);

  const offer = await repository.createOffer({
    rideId: ride.id,
    driverId: candidate.driverId,
    wave,
    rank,
    score: candidate.score,
    etaS: candidate.etaS,
    // Le NET, pas le brut. C'est ce que le chauffeur doit voir avant d'accepter
    // (CLAUDE.md § 2, troisième moment de vérité) — il a été calculé à la commande et
    // il ne bougera plus.
    driverNet: ride.driverNet ?? 0,
    expiresAt,
  });

  // L'ORDRE DE CES QUATRE ÉTAPES EST LA PARTIE DÉLICATE DU DISPATCH.
  //
  //   1. la ligne d'offre existe (ci-dessus) ;
  //   2. la course passe en `offered` ;
  //   3. l'attente de 15 s est armée ;
  //   4. et SEULEMENT ALORS le chauffeur apprend l'existence de l'offre.
  //
  // L'identifiant de l'offre ne quitte le serveur qu'à l'étape 4 : personne ne peut donc
  // répondre avant que tout soit prêt. Inverser 2 et 4 rendrait possible une acceptation
  // sur une course encore `requested` — une transition invalide, refusée, sur un geste
  // parfaitement légitime du chauffeur.
  //
  // `requested` → `offered` la première fois, puis `offered` → `offered` d'un chauffeur
  // à l'autre : la course ne repasse jamais par `requested` entre deux candidats.
  const rides = await import('../rides/service.js');
  try {
    await rides.markOffered(ride.id, offer.id, candidate.driverId);
  } catch (error) {
    // La course n'est plus proposable (annulée entre-temps) : on referme proprement.
    await repository.closeOffer(offer.id, 'cancelled');
    throw error;
  }

  const waiting = waitForResponse(offer.id, run, candidate, timeoutMs);

  publish(driverRoom(candidate.driverId), RIDE_OFFER, {
    offerId: offer.id,
    rideId: ride.id,
    expiresAt: expiresAt.toISOString(),
    pickup: { lat: ride.pickup.lat, lng: ride.pickup.lng, label: ride.pickupLabel },
    dropoff: { lat: ride.dropoff.lat, lng: ride.dropoff.lng, label: ride.dropoffLabel },
    approachKm: Math.round(candidate.distanceM / 100) / 10,
    etaMin: Math.max(1, Math.round(candidate.etaS / 60)),
    offer: ride.offer,
    netXaf: ride.driverNet ?? 0,
    breakdown: {
      gross: ride.priceQuoted,
      commission: ride.commission ?? 0,
      dgi: ride.dgiAmount ?? 0,
      net: ride.driverNet ?? 0,
    },
    paymentMethod: ride.paymentMethod,
  });

  const outcome = await waiting;

  // L'acceptation a déjà été écrite par `respondToOffer` : la boucle n'a plus qu'à
  // s'arrêter. C'est ce qui garantit que le chauffeur et le passager voient le même
  // statut au même instant.
  if (outcome === 'accepted') return 'accepted';

  if (outcome === 'expired') {
    // Le silence est une réponse : il compte dans le taux d'acceptation, et il ferme
    // l'offre en base pour que le chauffeur qui répond en retard reçoive un refus net.
    await repository.closeOffer(offer.id, 'expired');
    await repository.recordOfferOutcome(candidate.driverId, false);
    publish(driverRoom(candidate.driverId), RIDE_OFFER_CLOSED, {
      rideId: ride.id,
      offerId: offer.id,
      reason: 'Délai écoulé.',
    });
  }

  if (outcome === 'cancelled') {
    await repository.closeOffer(offer.id, 'cancelled');
  }

  return outcome;
}

/**
 * Attend la réponse du chauffeur, ou la fin des 15 s, ou l'annulation de la course.
 * La promesse se résout UNE fois : les trois chemins passent par `settle`.
 */
function waitForResponse(
  offerId: string,
  run: DispatchRun,
  candidate: Candidate,
  timeoutMs: number,
): Promise<OfferOutcome> {
  return new Promise<OfferOutcome>((resolve) => {
    let settled = false;

    const timer = setTimeout(() => settle('expired'), timeoutMs);
    // Une minuterie de dispatch ne doit pas retenir le processus : `npm test` et Ctrl-C
    // doivent rendre la main immédiatement.
    timer.unref?.();

    function settle(outcome: OfferOutcome): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingByOffer.delete(offerId);
      run.pending = null;
      resolve(outcome);
    }

    const pending: PendingOffer = {
      rideId: run.rideId,
      driverId: candidate.driverId,
      vehicleId: candidate.vehicleId,
      etaS: candidate.etaS,
      settle,
    };
    pendingByOffer.set(offerId, pending);
    run.pending = pending;

    // La course a pu être annulée entre la création de l'offre et cette ligne.
    if (run.cancelled) settle('cancelled');
  });
}

/** Plus aucun candidat : la course expire, et le passager reçoit ses deux sorties. */
async function expire(ride: Ride, reason: string): Promise<void> {
  const rides = await import('../rides/service.js');
  await rides.expireRide(ride.id, reason);

  publish(OPS_ROOM, OPS_ALERT, {
    kind: 'no_driver',
    rideId: ride.id,
    offer: ride.offer,
    reason,
    at: new Date().toISOString(),
  });
  publish(rideRoom(ride.id), RIDE_OFFER_CLOSED, { rideId: ride.id, reason });
}
