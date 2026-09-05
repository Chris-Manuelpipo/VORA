// VORA — DTO de sortie du module rides.
//
// L'autre partie n'y apparaît que par toPublicUserDto : prénom, photo, ID VORA.
// Jamais de téléphone, jamais d'e-mail (CLAUDE.md § 5.6).
//
// Deux champs sont FILTRÉS PAR DESTINATAIRE, et ce filtrage est la règle métier
// elle-même, pas une précaution d'affichage :
//
//   · `boarding_code` — le passager le voit, le chauffeur JAMAIS. C'est tout le
//     mécanisme du § 5.5 : le chauffeur doit demander les 4 chiffres à la personne qui
//     monte. S'il pouvait les lire dans sa propre réponse d'API, le code ne vérifierait
//     plus rien.
//   · `earnings` — le net du chauffeur ne regarde que lui.

import { formatPlate } from '../../domain/plates.js';
import { encodePolyline } from '../../lib/polyline.js';
import { formatAmount } from '../pricing/fare.js';
import { toPublicUserDto } from '../identity/dto.js';
import { firstName } from '../identity/dto.js';
import type { DriverPresence } from '../dispatch/presence.js';
import type { CancellationPolicy } from './service.js';
import type { RideWithParties } from './repository.js';
import type { RideDto, SharedRideDto } from './schemas.js';

export interface RideViewer {
  id: string;
  role: 'passenger' | 'driver' | 'ops';
}

export interface RideExtras {
  /** Code de montée en clair. Fourni UNIQUEMENT quand le lecteur est le passager. */
  boardingCode?: string | null;
  cancellation?: CancellationPolicy;
  /** Distance chauffeur → passager pendant l'approche, en mètres. */
  approachDistanceM?: number | null;
}

export function toRideDto(
  bundle: RideWithParties,
  viewer: RideViewer,
  extras: RideExtras = {},
): RideDto {
  const { ride, passenger, driver, driverProfile, vehicle } = bundle;
  const isDriver = viewer.role === 'driver' && viewer.id === ride.driverId;
  const isPassenger = viewer.role === 'passenger' && viewer.id === ride.passengerId;
  const isOps = viewer.role === 'ops';

  return {
    id: ride.id,
    status: ride.status,
    offer: ride.offer,
    pickup: {
      lat: ride.pickup.lat,
      lng: ride.pickup.lng,
      label: ride.pickupLabel,
    },
    dropoff: {
      lat: ride.dropoff.lat,
      lng: ride.dropoff.lng,
      label: ride.dropoffLabel,
    },
    /** L'itinéraire figé du devis, prêt à tracer sur la carte. */
    route_polyline: ride.route && ride.route.length >= 2 ? encodePolyline(ride.route) : null,
    price_quoted: ride.priceQuoted,
    price_quoted_formatted: formatAmount(ride.priceQuoted),
    price_final: ride.priceFinal,
    distance_m: ride.distanceM,
    duration_s: ride.durationS,
    payment_method: ride.paymentMethod,
    payment_status: ride.paymentStatus,
    // Le code de montée : au passager, et à personne d'autre. Le champ existe pour tous
    // (le contrat de sortie serait sinon différent selon le lecteur), il vaut `null`
    // pour le chauffeur et pour l'ops.
    boarding_code: isPassenger ? (extras.boardingCode ?? null) : null,
    cancellation: extras.cancellation
      ? {
          free: extras.cancellation.free,
          fee_xaf: extras.cancellation.feeXaf,
          fee_formatted: formatAmount(extras.cancellation.feeXaf),
          free_until: extras.cancellation.freeUntil,
          rule: extras.cancellation.reason,
        }
      : null,
    approach_distance_m: extras.approachDistanceM ?? null,
    driver: driver && (isPassenger || isOps) ? toPublicUserDto(driver, driverProfile) : null,
    vehicle:
      vehicle && (isPassenger || isOps)
        ? {
            make: vehicle.make,
            model: vehicle.model,
            color: vehicle.color,
            plate: formatPlate(vehicle.plate),
          }
        : null,
    passenger: passenger && (isDriver || isOps) ? toPublicUserDto(passenger) : null,
    earnings:
      (isDriver || isOps) &&
      ride.driverNet !== null &&
      ride.commission !== null &&
      ride.dgiAmount !== null
        ? {
            gross: ride.priceQuoted,
            commission: ride.commission,
            dgi: ride.dgiAmount,
            net: ride.driverNet,
            net_formatted: formatAmount(ride.driverNet),
          }
        : null,
    requested_at: ride.requestedAt?.toISOString() ?? null,
    accepted_at: ride.acceptedAt?.toISOString() ?? null,
    arrived_at: ride.arrivedAt?.toISOString() ?? null,
    started_at: ride.startedAt?.toISOString() ?? null,
    completed_at: ride.completedAt?.toISOString() ?? null,
    paid_at: ride.paidAt?.toISOString() ?? null,
    created_at: ride.createdAt.toISOString(),
  };
}

/**
 * Vue PUBLIQUE d'un trajet partagé, pour un proche sans compte.
 *
 * On construit ce DTO à la main, champ par champ, plutôt que de retirer des clés d'un
 * `RideDto` : la liste de ce qu'on montre doit être une liste POSITIVE. Une colonne
 * ajoutée demain en base ne doit pas se retrouver publiée parce que personne n'a pensé
 * à l'exclure.
 *
 * Ce qu'on montre : où en est la course, quel véhicule, quelle plaque, le point qui
 * bouge. Ce qu'on ne montre pas : les noms complets, les ID VORA, le prix, et aucun
 * moyen de contact.
 */
export function toSharedRideDto(
  bundle: RideWithParties,
  context: { driverPosition: DriverPresence | null; expiresAt: string },
): SharedRideDto {
  const { ride, driver, driverProfile, vehicle } = bundle;

  return {
    status: ride.status,
    offer: ride.offer,
    pickup: { lat: ride.pickup.lat, lng: ride.pickup.lng, label: ride.pickupLabel },
    dropoff: { lat: ride.dropoff.lat, lng: ride.dropoff.lng, label: ride.dropoffLabel },
    route_polyline: ride.route && ride.route.length >= 2 ? encodePolyline(ride.route) : null,
    driver: driver
      ? {
          // Le prénom seul : c'est déjà ce que voit le passager (CLAUDE.md § 5.6), et
          // un lien public n'en mérite pas davantage.
          first_name: firstName(driver.displayName),
          rating: driverProfile ? Number(driverProfile.rating) : null,
          verified: driverProfile?.status === 'approved',
        }
      : null,
    vehicle: vehicle
      ? {
          make: vehicle.make,
          model: vehicle.model,
          color: vehicle.color,
          // LA plaque : c'est très exactement ce qu'on partage à un proche inquiet.
          plate: formatPlate(vehicle.plate),
        }
      : null,
    driver_position: context.driverPosition
      ? {
          lat: context.driverPosition.lat,
          lng: context.driverPosition.lng,
          heading: context.driverPosition.heading,
        }
      : null,
    started_at: ride.startedAt?.toISOString() ?? null,
    completed_at: ride.completedAt?.toISOString() ?? null,
    link_expires_at: context.expiresAt,
  };
}
