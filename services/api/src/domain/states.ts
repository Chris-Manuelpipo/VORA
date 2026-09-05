// VORA — machine à états de la course. Référence : docs/VORA_cycle_de_vie_course.mermaid
// et CLAUDE.md § 5.7.
//
// La machine est STRICTE et vit côté serveur. Le client ne décide jamais d'un statut :
// il demande une action, le serveur décide. Une transition invalide renvoie
// INVALID_TRANSITION **sans rien écrire** — ni sur la course, ni dans ride_events.

import { AppError } from '../lib/errors.js';

export const RIDE_STATUSES = [
  'draft',
  'requested',
  'offered',
  'accepted',
  'approaching',
  'arrived',
  'in_progress',
  'completed',
  'paid',
  'rated',
  'expired',
  'cancelled_free',
  'cancelled_late',
  'cancelled_driver',
  'no_show',
] as const;

export type RideStatus = (typeof RIDE_STATUSES)[number];

/** Qui a le droit de provoquer une transition. */
export const ACTORS = ['passenger', 'driver', 'system', 'ops'] as const;
export type Actor = (typeof ACTORS)[number];

/**
 * Transitions autorisées, et pour chacune, les acteurs qui peuvent la déclencher.
 *
 * `cancelled_free` / `cancelled_late` sont deux états distincts et non deux libellés :
 * le serveur choisit lequel s'applique (2 min après acceptation OU moins de 300 m
 * parcourus → gratuit), et cette décision est ensuite inattaquable dans un litige.
 */
const TRANSITIONS: Record<RideStatus, Partial<Record<RideStatus, readonly Actor[]>>> = {
  draft: {
    requested: ['passenger'],
    cancelled_free: ['passenger'],
  },
  requested: {
    offered: ['system'],
    expired: ['system'],
    cancelled_free: ['passenger', 'ops'],
  },
  offered: {
    // La course reste `offered` d'une vague à l'autre : le chauffeur suivant est sollicité
    // sans repasser par `requested`.
    offered: ['system'],
    accepted: ['driver'],
    expired: ['system'],
    cancelled_free: ['passenger', 'ops'],
  },
  accepted: {
    approaching: ['driver', 'system'],
    arrived: ['driver'],
    cancelled_driver: ['driver'],
    cancelled_free: ['passenger', 'ops'],
    cancelled_late: ['passenger'],
  },
  approaching: {
    arrived: ['driver'],
    cancelled_driver: ['driver'],
    cancelled_free: ['passenger', 'ops'],
    cancelled_late: ['passenger'],
  },
  arrived: {
    in_progress: ['driver'],
    no_show: ['driver'],
    cancelled_driver: ['driver'],
    cancelled_free: ['passenger', 'ops'],
    cancelled_late: ['passenger'],
  },
  in_progress: {
    completed: ['driver'],
  },
  completed: {
    paid: ['driver', 'passenger', 'system'],
  },
  paid: {
    rated: ['passenger', 'system'],
  },
  /**
   * `expired` n'est PAS un cul-de-sac : c'est la seule sortie non terminale du
   * diagramme (« Expirée → Demandée : le passager choisit d'attendre 2 min »).
   *
   * CLAUDE.md § 5.4 promet deux sorties au passager après trois vagues sans réponse :
   * « Attendre 2 min » et « Réessayer ». « Réessayer » repart d'un nouveau devis ;
   * « Attendre 2 min » relance le dispatch SUR LA MÊME COURSE — donc au même prix, déjà
   * figé, et sans deuxième ligne dans l'historique du passager. Sans cette flèche, la
   * moitié de la promesse serait un bouton qui ne mène nulle part.
   */
  expired: {
    requested: ['passenger', 'ops'],
  },
  // États terminaux : plus aucune sortie.
  rated: {},
  cancelled_free: {},
  cancelled_late: {},
  cancelled_driver: {},
  no_show: {},
};

/** Un état terminal ne mène plus nulle part : la course est close, seule la lecture reste. */
export function isTerminal(status: RideStatus): boolean {
  return Object.keys(TRANSITIONS[status]).length === 0;
}

/** La course est-elle en cours (donc suivie en temps réel, et annulable) ? */
export function isActive(status: RideStatus): boolean {
  return !isTerminal(status) && status !== 'draft';
}

export function canTransition(from: RideStatus, to: RideStatus, actor?: Actor): boolean {
  const allowedActors = TRANSITIONS[from][to];
  if (!allowedActors) return false;
  return actor === undefined || allowedActors.includes(actor);
}

/** Transitions possibles depuis un état — utile aux tests et à la page ops. */
export function nextStatuses(from: RideStatus): RideStatus[] {
  return Object.keys(TRANSITIONS[from]) as RideStatus[];
}

/**
 * Vérifie une transition, ou refuse. À appeler AVANT toute écriture : le contrat est
 * qu'une transition refusée ne laisse aucune trace.
 */
export function assertTransition(from: RideStatus, to: RideStatus, actor: Actor): void {
  const allowedActors = TRANSITIONS[from][to];

  if (!allowedActors) {
    throw new AppError(
      'INVALID_TRANSITION',
      `Cette action n'est plus possible : la course est déjà « ${from} ». Rafraîchissez pour voir son état réel.`,
      { from, to, actor, allowed: nextStatuses(from) },
    );
  }

  if (!allowedActors.includes(actor)) {
    throw new AppError(
      'INVALID_TRANSITION',
      "Cette action ne vous appartient pas. C'est l'autre partie ou VORA qui la déclenche.",
      { from, to, actor, allowedActors },
    );
  }
}

/**
 * Types d'événements écrits dans `ride_events`. Le journal est la vérité de la course :
 * `rides.status` n'en est qu'une projection, pratique pour les listes et les index.
 */
export const RIDE_EVENT_TYPES = [
  'ride.created',
  'ride.requested',
  'ride.offer_sent',
  'ride.offer_declined',
  'ride.offer_expired',
  'ride.accepted',
  'ride.approaching',
  'ride.arrived',
  'ride.boarding_code_failed',
  'ride.started',
  'ride.completed',
  'ride.paid',
  'ride.rated',
  'ride.cancelled',
  'ride.no_show',
  'ride.expired',
  'ride.sos',
  'ride.shared',
] as const;

export type RideEventType = (typeof RIDE_EVENT_TYPES)[number];
