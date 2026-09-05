// VORA — DTO de sortie du module identity.
//
// RÈGLE (CLAUDE.md § 5.6) : une entité de base ne sort JAMAIS telle quelle. Ces fonctions
// sont le seul chemin entre une ligne `users` et une réponse HTTP. Le téléphone et l'e-mail
// n'y apparaissent que masqués, et jamais dans le DTO destiné à l'autre partie.

import { formatPlate } from '../../domain/plates.js';
import type { Offer } from '../../domain/rules.js';
import type { DriverProfile, User, Vehicle } from '../../db/schema.js';
import { maskUserChannels } from './channels.js';
import type { MeDto, PublicUserDto } from './schemas.js';
import { formatVoraId } from './vora-id.js';

/** Le passager voit le PRÉNOM du chauffeur, pas son état civil complet. */
export function firstName(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : displayName.trim();
}

export interface MeSources {
  user: User;
  driverProfile?: DriverProfile | null;
  vehicle?: Vehicle | null;
}

/** `GET /v1/me` — la vue de l'utilisateur sur son propre compte. */
export function toMeDto({ user, driverProfile, vehicle }: MeSources): MeDto {
  const { phone_masked, email_masked } = maskUserChannels(user);

  return {
    vora_id: user.voraId,
    vora_id_formatted: formatVoraId(user.voraId),
    role: user.role,
    display_name: user.displayName,
    photo_key: user.photoKey,
    locale: user.locale,
    status: user.status,
    phone_masked,
    email_masked,
    created_at: user.createdAt.toISOString(),
    driver: driverProfile
      ? {
          kind: driverProfile.kind,
          status: driverProfile.status,
          // `numeric` revient en chaîne depuis PostgreSQL : la note est un nombre côté API.
          rating: Number(driverProfile.rating),
          rides_count: driverProfile.ridesCount,
          online: driverProfile.online,
          cash_debt: driverProfile.cashDebt,
          vehicle: vehicle
            ? {
                id: vehicle.id,
                kind: vehicle.kind,
                make: vehicle.make,
                model: vehicle.model,
                color: vehicle.color,
                plate: formatPlate(vehicle.plate),
                offers: vehicle.offers as Offer[],
              }
            : null,
        }
      : null,
  };
}

/**
 * Ce que l'AUTRE partie voit : le passager du chauffeur, le chauffeur du passager.
 * Prénom, photo, ID VORA, note, badge Vérifié. Aucun moyen de contact.
 */
export function toPublicUserDto(
  user: Pick<User, 'voraId' | 'displayName' | 'photoKey'>,
  driverProfile?: Pick<DriverProfile, 'rating' | 'status'> | null,
): PublicUserDto {
  return {
    vora_id: user.voraId,
    first_name: firstName(user.displayName),
    photo_key: user.photoKey,
    rating: driverProfile ? Number(driverProfile.rating) : null,
    verified: driverProfile ? driverProfile.status === 'approved' : false,
  };
}
