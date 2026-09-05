// VORA — construction du contexte envoyé au modèle. C'est LE fichier sensible du module.
//
// Ce qui sort d'ici part chez un tiers, sur un réseau qui n'est pas le nôtre. Trois
// règles, dans cet ordre :
//
//   1. Le contexte est construit CÔTÉ SERVEUR, jamais transmis par le client. Une
//      application compromise ne peut pas faire dire « la course coûte 200 F » au modèle :
//      elle n'envoie qu'une question.
//   2. Il ne contient QUE la FAQ et les faits de la course en cours. Pas de numéro, pas
//      d'e-mail, pas de position brute, aucun identifiant d'un autre utilisateur —
//      `supportContextSchema` est `.strict()` et le test `support.test.ts` le vérifie sur
//      une vraie course.
//   3. Les faits viennent du SERVICE `rides`, pas de son repository (CLAUDE.md § 7) : on
//      lit ce que le module `rides` accepte de montrer à cette personne, donc le filtrage
//      par destinataire de `toRideDto` s'applique déjà. Le net du chauffeur ne peut pas
//      atterrir dans le contexte d'un passager, même par erreur.
//
// Le code de montée, lui, n'entre JAMAIS ici : il est visible du passager, mais il ne
// sort pas de nos machines pour autant.

import type { UserRole } from '../../db/schema.js';
import { isActive } from '../../domain/states.js';
import * as rides from '../rides/service.js';
import { rankKnowledge, type Audience } from './knowledge.js';
import {
  supportContextSchema,
  type RideFacts,
  type SupportContext,
} from './schemas.js';

export interface Viewer {
  id: string;
  role: UserRole;
}

/** L'ops n'a pas de course à lui : il lit la FAQ chauffeur, la plus complète. */
export function audienceOf(role: UserRole): Audience {
  return role === 'passenger' ? 'passenger' : 'driver';
}

/**
 * La course EN COURS de cette personne, s'il y en a une.
 *
 * « En cours » au sens de la machine à états : entre `requested` et le dernier état non
 * terminal. Une course terminée hier n'entre pas dans le contexte — la question porterait
 * alors sur l'historique, et l'historique se lit dans l'application, pas dans un prompt.
 */
async function currentRideFacts(viewer: Viewer): Promise<RideFacts | null> {
  if (viewer.role === 'ops') return null;

  const { rides: recent } = await rides.listRides(
    { id: viewer.id, role: viewer.role },
    { limit: 3 },
  );

  const ride = recent.find((candidate) => isActive(candidate.status));
  if (!ride) return null;

  return {
    status: ride.status,
    offer: ride.offer,
    price_xaf: ride.price_quoted,
    price_formatted: ride.price_quoted_formatted,
    // `earnings` n'est renseigné par `toRideDto` que pour le chauffeur et l'ops : le
    // filtrage par destinataire est déjà fait, on n'a rien à re-décider ici.
    breakdown: ride.earnings
      ? {
          gross: ride.earnings.gross,
          commission: ride.earnings.commission,
          dgi: ride.earnings.dgi,
          net: ride.earnings.net,
        }
      : null,
    // En kilomètres à une décimale, comme la charte les écrit (« 1,2 km ») : le modèle
    // n'a pas à convertir des mètres, et une conversion ratée est une invention.
    distance_km: ride.distance_m === null ? null : Math.round(ride.distance_m / 100) / 10,
    driver_plate: ride.vehicle?.plate ?? null,
  };
}

/**
 * Le contexte complet : la FAQ pertinente, plus la course en cours s'il y en a une.
 *
 * Passe par `supportContextSchema.parse` — donc par un filtre `.strict()` — avant d'être
 * rendu. Ce n'est pas une ceinture de sécurité de plus : c'est LA garantie que ce qui
 * part est exactement ce qui est écrit dans le schéma.
 */
export async function buildContext(
  viewer: Viewer,
  question: string,
): Promise<SupportContext> {
  const audience = audienceOf(viewer.role);
  const ranked = rankKnowledge(question, audience);

  return supportContextSchema.parse({
    audience,
    ride: await currentRideFacts(viewer),
    faq: ranked.map(({ entry }) => ({
      id: entry.id,
      title: entry.title,
      answer: entry.answer,
    })),
  });
}

/**
 * Empreinte des FAITS du contexte, pour la clé de cache.
 *
 * ELLE EST INDISPENSABLE. Sans elle, « combien je paie ? » mis en cache pour un passager
 * dont la course vaut 1 625 F serait resservi au suivant, dont la course en vaut 3 000 —
 * une fuite d'un utilisateur vers un autre, sur un chemin qu'on croyait anodin. Deux
 * personnes ne partagent une entrée de cache que si leurs faits sont identiques, ce qui
 * est le cas général : personne n'a de course en cours quand il pose une question.
 */
export function contextFingerprint(context: SupportContext): string {
  if (!context.ride) return `${context.audience}:sans-course`;
  const { status, offer, price_xaf, breakdown, distance_km, driver_plate } = context.ride;
  return [
    context.audience,
    status,
    offer,
    price_xaf,
    breakdown ? `${breakdown.commission}/${breakdown.dgi}/${breakdown.net}` : '-',
    distance_km ?? '-',
    driver_plate ?? '-',
  ].join(':');
}
