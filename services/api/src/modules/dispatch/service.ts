// VORA — logique du module dispatch : mise en ligne, position, carte live.
//
// L'attribution séquentielle (un chauffeur à la fois, 15 s, 3 vagues, score) arrive en P3.
// Ce qu'elle exigera existe déjà : un dossier validé, une position vivante, un véhicule.

import { AppError } from '../../lib/errors.js';
import {
  DISPATCH_WAVE_RADII_KM,
  DRIVER_POSITION_TTL_S,
  type VehicleKind,
} from '../../domain/rules.js';
import type { LatLng } from '../../db/geography.js';
import { firstName } from '../identity/dto.js';
import { driverPresence, type DriverAvailability, type DriverPresence } from './presence.js';
import { approachEtaS } from './scoring.js';
import * as repository from './repository.js';
import type { GoOnlineBody, PositionBody } from './schemas.js';
import { z } from 'zod';
import { driverStatusSchema, liveDriversResponseSchema } from './schemas.js';

/** Cadence de remontée des positions : 5 s, comme le § 8.3 du dossier de conception. */
const POSITION_INTERVAL_S = 5;

type DriverStatus = z.infer<typeof driverStatusSchema>;

/**
 * Un chauffeur dont le dossier n'est pas validé ne se met pas en ligne. C'est la promesse
 * « véhicules et chauffeurs vérifiés » : elle se tient ici, pas dans un écran.
 */
async function requireApprovedDriver(userId: string) {
  const bundle = await repository.findDriverBundle(userId);

  if (!bundle) {
    throw new AppError(
      'NOT_FOUND',
      "Aucun dossier chauffeur n'est rattaché à ce compte. Contactez le support VORA.",
    );
  }

  if (bundle.profile.status !== 'approved') {
    throw new AppError(
      'DRIVER_NOT_APPROVED',
      bundle.profile.status === 'pending'
        ? 'Votre dossier est en cours de vérification. Vous pourrez vous mettre en ligne dès sa validation.'
        : "Votre compte chauffeur n'est pas actif. Contactez le support VORA.",
      { status: bundle.profile.status },
    );
  }

  return bundle;
}

export async function goOnline(userId: string, body: GoOnlineBody): Promise<DriverStatus> {
  const bundle = await requireApprovedDriver(userId);

  const vehicle = body.vehicle_id
    ? await repository.findVehicleOfDriver(userId, body.vehicle_id)
    : (bundle.vehicle ?? (await repository.findFirstActiveVehicle(userId)));

  if (!vehicle) {
    throw new AppError(
      'DRIVER_NOT_APPROVED',
      "Aucun véhicule n'est rattaché à votre compte. Ajoutez-le avant de vous mettre en ligne.",
    );
  }

  await repository.setOnline(userId, true, vehicle.id);

  driverPresence.upsert({
    driverId: userId,
    kind: bundle.profile.kind,
    lat: body.position.lat,
    lng: body.position.lng,
    heading: body.position.heading ?? null,
    speed: body.position.speed ?? null,
    availability: 'available',
  });

  return {
    online: true,
    availability: 'available',
    position_ttl_s: DRIVER_POSITION_TTL_S,
    position_interval_s: POSITION_INTERVAL_S,
    vehicle_id: vehicle.id,
  };
}

export async function goOffline(userId: string): Promise<DriverStatus> {
  await repository.setOnline(userId, false);
  driverPresence.remove(userId);

  return {
    online: false,
    availability: 'offline',
    position_ttl_s: DRIVER_POSITION_TTL_S,
    position_interval_s: POSITION_INTERVAL_S,
    vehicle_id: null,
  };
}

/**
 * Remontée de position par REST. La voie normale est l'événement Socket.IO
 * `driver.position` (P3) ; celle-ci reste le filet quand la WebSocket est coupée —
 * exigence de dégradation gracieuse du brief.
 */
export async function updatePosition(userId: string, body: PositionBody): Promise<DriverStatus> {
  const bundle = await requireApprovedDriver(userId);

  if (!bundle.profile.online) {
    throw new AppError(
      'FORBIDDEN',
      'Vous êtes hors ligne. Mettez-vous en ligne pour recevoir des courses.',
    );
  }

  const current = driverPresence.get(userId);
  const availability: DriverAvailability = current?.availability ?? 'available';

  driverPresence.upsert({
    driverId: userId,
    kind: bundle.profile.kind,
    lat: body.lat,
    lng: body.lng,
    heading: body.heading ?? null,
    speed: body.speed ?? null,
    availability,
  });

  return {
    online: true,
    availability,
    position_ttl_s: DRIVER_POSITION_TTL_S,
    position_interval_s: POSITION_INTERVAL_S,
    vehicle_id: bundle.profile.currentVehicleId,
  };
}

/**
 * Position remontée par la WebSocket (`driver.position`, toutes les 5 s).
 *
 * Contrairement à la voie REST, on NE REQUÊTE PAS la base à chaque relevé : la présence
 * existe déjà, donc le chauffeur a été validé au moment de sa mise en ligne. Douze
 * chauffeurs qui remontent leur position toutes les 5 secondes feraient sinon deux
 * requêtes par seconde pour ne jamais rien apprendre de neuf.
 *
 * Renvoie `null` si le chauffeur n'est pas en ligne : sa position n'intéresse personne,
 * et l'accepter reviendrait à le faire réapparaître sur la carte de l'ops.
 */
export function applyLivePosition(driverId: string, body: PositionBody): DriverPresence | null {
  const current = driverPresence.get(driverId);
  if (!current) return null;

  driverPresence.upsert({
    driverId,
    kind: current.kind,
    lat: body.lat,
    lng: body.lng,
    heading: body.heading ?? null,
    speed: body.speed ?? null,
    availability: current.availability,
  });

  return driverPresence.get(driverId);
}

/**
 * Temps d'approche du chauffeur disponible le plus proche, en secondes, ou `null` s'il
 * n'y en a aucun dans le plus grand rayon de dispatch.
 *
 * C'est l'ETA affiché sur le devis, AVANT la commande. Il est indicatif et il le reste :
 * le chauffeur qui prendra la course n'est pas encore choisi. Ce qu'il promet, c'est un
 * ordre de grandeur honnête — « une moto à 3 minutes » —, pas un engagement.
 */
export function nearestApproachEtaS(pickup: LatLng, kind: VehicleKind): number | null {
  const maxRadiusKm = DISPATCH_WAVE_RADII_KM.at(-1) ?? 5;
  const [nearest] = driverPresence.nearby(pickup, maxRadiusKm, { kind });
  if (!nearest) return null;

  return approachEtaS({ lat: nearest.lat, lng: nearest.lng }, pickup, kind);
}

// ─── Statistiques du chauffeur, appelées par le module `rides` ───────────────
//
// `driver_profiles` appartient au dispatch : c'est lui qui s'en sert pour classer les
// chauffeurs (§ 5.4). Le module `rides` sait qu'une course s'est terminée ou qu'un
// chauffeur a annulé, mais il n'a pas à écrire dans une table qui n'est pas la sienne —
// il le dit au dispatch, qui en tire les conséquences sur le score.

/** Le chauffeur a annulé : sa fiabilité baisse, donc son score. */
export async function noteDriverCancellation(driverId: string): Promise<void> {
  await repository.recordDriverCancellation(driverId);
}

/**
 * Course terminée et payée. `cashDue` est ce que le chauffeur doit à VORA quand il a
 * encaissé des espèces — commission et retenue DGI qu'il a gardées en main.
 */
export async function noteRideCompleted(driverId: string, cashDue: number): Promise<void> {
  await repository.completeRideStats(driverId, cashDue);
}

/**
 * Carte live de la page ops. Prénom et ID VORA suffisent à identifier un chauffeur au
 * téléphone ; ni numéro ni e-mail ne franchissent cette frontière (CLAUDE.md § 5.6).
 */
export async function listLiveDrivers(): Promise<z.infer<typeof liveDriversResponseSchema>> {
  const known = await repository.listOnlineDrivers();
  const byId = new Map(known.map((driver) => [driver.userId, driver]));

  const drivers = driverPresence
    .all()
    .map((presence) => {
      const driver = byId.get(presence.driverId);
      if (!driver) return null; // position sans dossier en ligne : on ne l'affiche pas
      return {
        vora_id: driver.voraId,
        first_name: firstName(driver.displayName),
        kind: presence.kind,
        lat: presence.lat,
        lng: presence.lng,
        heading: presence.heading,
        availability: presence.availability,
        updated_at: presence.updatedAt.toISOString(),
      };
    })
    .filter((driver): driver is NonNullable<typeof driver> => driver !== null);

  return { count: drivers.length, drivers };
}
