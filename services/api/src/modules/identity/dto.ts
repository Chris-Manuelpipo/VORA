// VORA — DTO de sortie du module identity.
//
// RÈGLE (CLAUDE.md § 5.6) : une entité de base ne sort JAMAIS telle quelle. Ces fonctions
// sont le seul chemin entre une ligne `users` et une réponse HTTP. Le téléphone et l'e-mail
// n'y apparaissent que masqués, et jamais dans le DTO destiné à l'autre partie.

import { config } from '../../lib/config.js';
import { formatPlate } from '../../domain/plates.js';
import type { Offer } from '../../domain/rules.js';
import type { DriverProfile, TrustedContact, User, Vehicle } from '../../db/schema.js';
import { maskDestination, maskUserChannels } from './channels.js';
import type { MeDto, PublicUserDto, TrustedContactDto } from './schemas.js';
import { formatVoraId } from './vora-id.js';

/**
 * URL publique d'une image stockée. Construite ici, une seule fois : le client n'a pas à
 * savoir comment on range nos octets, et le jour où ils partent dans un stockage objet,
 * seule cette fonction change.
 */
export function photoUrl(photoKey: string | null): string | null {
  return photoKey ? `${config.PUBLIC_BASE_URL}/v1/media/${photoKey}` : null;
}

/** Le passager voit le PRÉNOM du chauffeur, pas son état civil complet. */
export function firstName(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : displayName.trim();
}

export interface MeSources {
  user: User;
  driverProfile?: DriverProfile | null;
  vehicle?: Vehicle | null;
  trustedContacts?: TrustedContact[];
}

/**
 * Un contact de confiance, vu par son propriétaire. Le numéro reste MASQUÉ, même pour
 * lui : il reconnaît « Maman » sans les neuf chiffres, et une capture d'écran du profil
 * ne doit pas suffire à composer le numéro d'un proche. Pour le corriger, on le
 * renvoie — c'est un formulaire de trois lignes, pas une base à éditer.
 */
export function toTrustedContactDto(contact: TrustedContact): TrustedContactDto {
  return {
    id: contact.id,
    name: contact.name,
    phone_masked: maskDestination('phone', contact.phone),
  };
}

/**
 * Ce qui reste à remplir. Ni bloquant, ni impératif : l'application s'en sert pour
 * proposer, plus tard, ce que la personne a sauté — la photo, ses contacts de confiance.
 */
function missingProfileFields(user: User, contacts: TrustedContact[]): string[] {
  const missing: string[] = [];
  if (!user.familyName) missing.push('family_name');
  if (!user.sex) missing.push('sex');
  if (!user.birthDate) missing.push('birth_date');
  if (!user.photoKey) missing.push('photo');
  if (contacts.length === 0) missing.push('trusted_contacts');
  return missing;
}

/** `GET /v1/me` — la vue de l'utilisateur sur son propre compte. */
export function toMeDto({ user, driverProfile, vehicle, trustedContacts = [] }: MeSources): MeDto {
  const { phone_masked, email_masked } = maskUserChannels(user);

  return {
    vora_id: user.voraId,
    vora_id_formatted: formatVoraId(user.voraId),
    role: user.role,
    display_name: user.displayName,
    // Nom, sexe et date de naissance : à leur propriétaire SEUL. `toPublicUserDto`,
    // plus bas, ne les connaît même pas — c'est ce qui rend la fuite impossible plutôt
    // qu'improbable.
    family_name: user.familyName,
    sex: user.sex,
    birth_date: user.birthDate,
    photo_key: user.photoKey,
    photo_url: photoUrl(user.photoKey),
    locale: user.locale,
    status: user.status,
    phone_masked,
    email_masked,
    created_at: user.createdAt.toISOString(),
    trusted_contacts: trustedContacts.map(toTrustedContactDto),
    onboarding: {
      completed: user.onboardedAt !== null,
      completed_at: user.onboardedAt?.toISOString() ?? null,
      missing: missingProfileFields(user, trustedContacts),
      // Le chauffeur a en plus son dossier de pièces (CH-03 → CH-06). Tant qu'il n'est
      // pas validé, il peut se connecter mais pas se mettre en ligne.
      driver_kyc_required: user.role === 'driver' && driverProfile?.status !== 'approved',
    },
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
    photo_url: photoUrl(user.photoKey),
    rating: driverProfile ? Number(driverProfile.rating) : null,
    verified: driverProfile ? driverProfile.status === 'approved' : false,
  };
}
