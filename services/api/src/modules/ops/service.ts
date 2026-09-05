// VORA — logique du module ops : tableau de bord, validation de dossier, majoration.
//
// Le manuel du hackathon classe l'administration en « recommandé », pas obligatoire.
// On tient donc UNE page crédible plutôt que huit vides (CLAUDE.md § 3) — mais celle-là
// doit être vraie : ses compteurs sortent des mêmes tables que les applications, sa
// validation de dossier autorise réellement un chauffeur à se mettre en ligne, et son
// interrupteur de pluie change réellement le prix affiché au passager suivant.

import { AppError } from '../../lib/errors.js';
import { startOfCityDay } from '../../lib/time.js';
import { formatPlate } from '../../domain/plates.js';
import type { DriverStatus } from '../../db/schema.js';
import { formatAmount } from '../pricing/fare.js';
import { currentSurge, setSurge } from '../pricing/surge.js';
import { routingCircuitState } from '../geo/routing.js';
import { driverPresence } from '../dispatch/presence.js';
import { publish } from '../../realtime/bus.js';
import { OPS_ALERT, OPS_ROOM, driverRoom } from '../../realtime/events.js';
import * as repository from './repository.js';
import type { DashboardDto, DriverDecisionBody, SetSurgeBody } from './schemas.js';
import type {
  driverDecisionResponseSchema,
  driverQueueSchema,
  opsRidesSchema,
  surgeStateSchema,
} from './schemas.js';
import type { z } from 'zod';

// ─── Tableau de bord ─────────────────────────────────────────────────────────

export async function dashboard(): Promise<DashboardDto> {
  const since = startOfCityDay();

  const [counters, liveByStatus] = await Promise.all([
    repository.dashboardCounters(since),
    repository.liveRidesByStatus(),
  ]);

  const surge = currentSurge();
  const routing = routingCircuitState();

  return {
    counters: {
      // Le seul compteur qui ne vient pas de la base : les positions vivent en mémoire
      // (CLAUDE.md § 3), et c'est elle qui sait qui est réellement joignable maintenant.
      driversOnline: driverPresence.size(),
      ridesLive: counters.ridesLive,
      ridesToday: counters.ridesToday,
      ridesUnservedToday: counters.ridesUnservedToday,
      grossTodayXaf: counters.grossTodayXaf,
      driverNetTodayXaf: counters.driverNetTodayXaf,
    },
    formatted: {
      grossToday: formatAmount(counters.grossTodayXaf),
      driverNetToday: formatAmount(counters.driverNetTodayXaf),
    },
    liveByStatus,
    surge: { percent: surge.percent, reason: surge.reason, setAt: surge.setAt },
    routing: { circuitOpen: routing.open, reopensInS: routing.reopensInS },
    driversPendingReview: counters.driversPendingReview,
    at: new Date().toISOString(),
  };
}

export async function listRecentRides(): Promise<z.infer<typeof opsRidesSchema>> {
  const rows = await repository.recentRides();

  return {
    rides: rows.map((row) => ({
      id: row.id,
      status: row.status,
      offer: row.offer,
      price: row.price,
      price_formatted: formatAmount(row.price),
      from: row.pickupLabel,
      to: row.dropoffLabel,
      created_at: row.createdAt.toISOString(),
    })),
  };
}

// ─── Validation des dossiers chauffeurs ──────────────────────────────────────

export async function driverQueue(
  status: DriverStatus,
): Promise<z.infer<typeof driverQueueSchema>> {
  const rows = await repository.listDriversByStatus(status);

  return {
    count: rows.length,
    drivers: rows.map((row) => ({
      vora_id: row.voraId,
      user_id: row.userId,
      display_name: row.displayName,
      kind: row.kind,
      status: row.status,
      license_number: row.licenseNumber,
      vehicle: row.vehicle
        ? { ...row.vehicle, plate: formatPlate(row.vehicle.plate) }
        : null,
      submitted_at: row.createdAt.toISOString(),
    })),
  };
}

const DECISIONS: Record<DriverDecisionBody['decision'], { status: DriverStatus; message: string }> = {
  approve: {
    status: 'approved',
    message: 'Dossier validé. Le chauffeur peut se mettre en ligne.',
  },
  reject: {
    status: 'rejected',
    message: 'Dossier refusé. Le chauffeur ne peut pas se mettre en ligne.',
  },
  suspend: {
    status: 'suspended',
    message: 'Compte suspendu. Le chauffeur a été mis hors ligne.',
  },
  reinstate: {
    status: 'approved',
    message: 'Compte rétabli. Le chauffeur peut se remettre en ligne.',
  },
};

/**
 * LA PROMESSE « véhicules et chauffeurs vérifiés » SE TIENT ICI.
 *
 * Tant qu'un dossier n'est pas `approved`, `dispatch.goOnline` le refuse — ce n'est donc
 * pas un statut décoratif dans un tableau, c'est l'autorisation de travailler.
 *
 * Un retrait d'autorisation coupe le chauffeur SUR-LE-CHAMP : la ligne en base passe
 * hors ligne, et sa position est retirée de la mémoire du dispatch. Sans ce second
 * geste, il resterait candidat aux courses jusqu'à l'expiration de sa position.
 */
export async function decideOnDriver(
  userId: string,
  body: DriverDecisionBody,
  decidedBy: string,
): Promise<z.infer<typeof driverDecisionResponseSchema>> {
  const decision = DECISIONS[body.decision];
  const updated = await repository.setDriverStatus(userId, decision.status);

  if (!updated) {
    throw new AppError('NOT_FOUND', "Aucun dossier chauffeur ne correspond à cet identifiant.");
  }

  if (decision.status !== 'approved') {
    driverPresence.remove(userId);
    // Le chauffeur doit l'apprendre tout de suite, pas au prochain démarrage de son
    // application : il pourrait rouler vers un point de rendez-vous.
    publish(driverRoom(userId), OPS_ALERT, {
      kind: 'account_status',
      status: decision.status,
      message: decision.message,
      reason: body.reason ?? null,
    });
  }

  publish(OPS_ROOM, OPS_ALERT, {
    kind: 'driver_review',
    userId,
    status: decision.status,
    decidedBy,
    reason: body.reason ?? null,
    at: new Date().toISOString(),
  });

  return {
    // On rend l'ID VORA, pas l'UUID : c'est l'identifiant avec lequel l'ops travaille.
    vora_id: updated.voraId,
    status: decision.status,
    message: decision.message,
  };
}

// ─── Majoration pluie / forte demande ────────────────────────────────────────

/**
 * L'interrupteur du § 5.1. L'ÉTAT appartient au module `pricing` — c'est lui qui calcule
 * le prix, il ne peut pas y avoir deux sources. `ops` ne fait qu'actionner, et journalise
 * qui l'a fait : une majoration doit être imputable.
 */
export function readSurge(): z.infer<typeof surgeStateSchema> {
  const state = currentSurge();
  return { percent: state.percent, reason: state.reason, set_at: state.setAt };
}

export function applySurge(
  body: SetSurgeBody,
  setBy: string,
): z.infer<typeof surgeStateSchema> {
  const state = setSurge({ percent: body.percent, reason: body.reason ?? null, setBy });

  publish(OPS_ROOM, OPS_ALERT, {
    kind: 'surge',
    percent: state.percent,
    reason: state.reason,
    setBy,
    at: state.setAt,
  });

  return { percent: state.percent, reason: state.reason, set_at: state.setAt };
}
