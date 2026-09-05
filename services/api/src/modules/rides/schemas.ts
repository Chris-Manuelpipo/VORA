// VORA — schémas zod du module rides.

import { z } from 'zod';
import { RIDE_STATUSES } from '../../domain/states.js';
import { publicUserSchema } from '../identity/schemas.js';

export const rideStatusSchema = z.enum(RIDE_STATUSES);

export const rideParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const listRidesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    /** Curseur : date de création de la dernière course reçue. */
    before: z.string().datetime().optional(),
    status: rideStatusSchema.optional(),
  })
  .strict();

const placeSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  label: z.string().nullable(),
});

const rideVehicleSchema = z.object({
  make: z.string(),
  model: z.string(),
  color: z.string(),
  /** La plaque, telle qu'elle se lit sur le véhicule : « CE 4821 AB ». */
  plate: z.string(),
});

export const rideSchema = z.object({
  id: z.string().uuid(),
  status: rideStatusSchema,
  offer: z.enum(['eco', 'confort', 'moto']),
  pickup: placeSchema,
  dropoff: placeSchema,
  /** Itinéraire figé du devis, polyligne encodée (précision 5). */
  route_polyline: z.string().nullable(),
  /**
   * Code de montée à 4 chiffres. Renseigné POUR LE PASSAGER SEULEMENT, et seulement
   * entre l'acceptation et la montée à bord. `null` partout ailleurs — c'est ce qui
   * oblige le chauffeur à le demander de vive voix (CLAUDE.md § 5.5).
   */
  boarding_code: z.string().nullable(),
  /** De quoi écrire un bouton d'annulation qui dit la vérité du moment (§ 5.3). */
  cancellation: z
    .object({
      free: z.boolean(),
      fee_xaf: z.number().int(),
      fee_formatted: z.string(),
      free_until: z.string().nullable(),
      rule: z.enum(['no_driver_yet', 'within_2_min', 'under_300_m', 'late']),
    })
    .nullable(),
  /** Distance chauffeur → passager pendant l'approche, en mètres. */
  approach_distance_m: z.number().int().nullable(),
  /** Prix ferme figé à la commande. Il ne change plus jusqu'à la fin. */
  price_quoted: z.number().int(),
  price_quoted_formatted: z.string(),
  price_final: z.number().int().nullable(),
  distance_m: z.number().int().nullable(),
  duration_s: z.number().int().nullable(),
  payment_method: z.enum(['cash', 'mobile_money']),
  payment_status: z.enum(['pending', 'authorized', 'paid', 'failed']),
  /** L'autre partie, sans aucun moyen de contact. */
  driver: publicUserSchema.nullable(),
  vehicle: rideVehicleSchema.nullable(),
  passenger: publicUserSchema.nullable(),
  /** Décomposition du net, visible du chauffeur uniquement. */
  earnings: z
    .object({
      gross: z.number().int(),
      commission: z.number().int(),
      dgi: z.number().int(),
      net: z.number().int(),
      net_formatted: z.string(),
    })
    .nullable(),
  requested_at: z.string().nullable(),
  accepted_at: z.string().nullable(),
  arrived_at: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
});

export const ridesListSchema = z.object({
  rides: z.array(rideSchema),
  /** À repasser en `before` pour la page suivante ; `null` quand il n'y a plus rien. */
  next_cursor: z.string().nullable(),
});

export const rideEventSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  from_status: rideStatusSchema.nullable(),
  to_status: rideStatusSchema.nullable(),
  actor_type: z.enum(['passenger', 'driver', 'system', 'ops']),
  occurred_at: z.string(),
});

export const rideEventsSchema = z.object({ events: z.array(rideEventSchema) });

// ─── Entrées des actions ─────────────────────────────────────────────────────

export const createRideBodySchema = z
  .object({
    /** Devis DE L'OFFRE CHOISIE — voir `quoteOfferSchema` du module pricing. */
    quoteId: z.string().uuid(),
    offer: z.enum(['eco', 'confort', 'moto']),
    paymentMethod: z.enum(['cash', 'mobile_money']).default('cash'),
    /** « Portail bleu, après la pharmacie ». Ce que la carte ne dit pas. */
    pickupNote: z.string().max(160).optional(),
  })
  .strict();

export const cancelRideBodySchema = z
  .object({ reason: z.string().max(160).optional() })
  .strict();

export const cancelRideResponseSchema = z.object({
  status: rideStatusSchema,
  /** Frais réellement retenus, en francs. 0 quand l'annulation est gratuite. */
  feeXaf: z.number().int(),
  feeFormatted: z.string(),
});

/** Position du chauffeur au moment de l'action, quand son téléphone la connaît. */
const positionBodySchema = z
  .object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict();

export const arrivedBodySchema = positionBodySchema;
export const completeBodySchema = positionBodySchema;

export const startRideBodySchema = z
  .object({
    boardingCode: z.string().trim().regex(/^\d{4}$/, 'Le code de montée compte 4 chiffres.'),
  })
  .strict();

// ─── Notation ────────────────────────────────────────────────────────────────

export const rateRideBodySchema = z
  .object({
    stars: z.number().int().min(1).max(5),
    /** Motifs prédéfinis. Pas de texte libre entre les parties : messagerie coupée. */
    tags: z.array(z.string().max(40)).max(6).default([]),
    /** Destiné à VORA, jamais affiché à l'autre partie. */
    comment: z.string().max(500).optional(),
  })
  .strict();

export const rateRideResponseSchema = z.object({
  ok: z.boolean(),
  /** Vrai si la note existait déjà : le second appui sur « Envoyer » n'est pas une erreur. */
  alreadyRated: z.boolean(),
});

// ─── SOS ─────────────────────────────────────────────────────────────────────

export const sosBodySchema = z
  .object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    note: z.string().max(280).optional(),
  })
  .strict();

export const sosResponseSchema = z.object({
  alertId: z.string().uuid(),
  /** Qui a été prévenu : `ops`, et l'autre partie de la course. */
  notified: z.array(z.string()),
});

// ─── Partage de trajet ───────────────────────────────────────────────────────

export const shareResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});

export const shareParamsSchema = z.object({ token: z.string().min(16).max(512) }).strict();

/**
 * Vue PUBLIQUE d'un trajet. Ce schéma est le garde-fou : Fastify sérialise à travers
 * lui, donc rien qui n'y figure pas ne peut sortir. Pas de nom complet, pas d'ID VORA,
 * pas de prix, et évidemment aucun moyen de contact.
 */
export const sharedRideSchema = z.object({
  status: rideStatusSchema,
  offer: z.enum(['eco', 'confort', 'moto']),
  pickup: placeSchema,
  dropoff: placeSchema,
  route_polyline: z.string().nullable(),
  driver: z
    .object({
      first_name: z.string(),
      rating: z.number().nullable(),
      verified: z.boolean(),
    })
    .nullable(),
  vehicle: rideVehicleSchema.nullable(),
  /** Le point qui bouge sur la carte. `null` si la position n'est plus fraîche. */
  driver_position: z
    .object({ lat: z.number(), lng: z.number(), heading: z.number().nullable() })
    .nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  /** Après quoi le lien cesse de répondre. */
  link_expires_at: z.string(),
});

// ─── Gains du chauffeur ──────────────────────────────────────────────────────

export const earningsQuerySchema = z
  .object({ period: z.enum(['day', 'week', 'month']).default('day') })
  .strict();

export const driverEarningsSchema = z.object({
  period: z.enum(['day', 'week', 'month']),
  since: z.string(),
  /** Ce que le chauffeur garde. Exact au franc, frais d'annulation compris. */
  netXaf: z.number().int(),
  netFormatted: z.string(),
  grossXaf: z.number().int(),
  commissionXaf: z.number().int(),
  dgiXaf: z.number().int(),
  ridesCount: z.number().int(),
  /**
   * Temps en ligne de la SESSION EN COURS, en minutes. Mesuré en mémoire : repart de
   * zéro si l'API redémarre (voir `driverEarnings` dans le service).
   */
  onlineMinutes: z.number().int(),
  byHour: z.array(z.object({ hour: z.number().int(), netXaf: z.number().int() })),
  recent: z.array(
    z.object({
      rideId: z.string().uuid(),
      at: z.string(),
      from: z.string().nullable(),
      to: z.string().nullable(),
      netXaf: z.number().int(),
      netFormatted: z.string(),
      source: z.enum(['ride', 'cancel_fee', 'no_show_fee']),
    }),
  ),
});

export type RideDto = z.infer<typeof rideSchema>;
export type ListRidesQuery = z.infer<typeof listRidesQuerySchema>;
export type CreateRideBody = z.infer<typeof createRideBodySchema>;
export type CancelRideBody = z.infer<typeof cancelRideBodySchema>;
export type StartRideBody = z.infer<typeof startRideBodySchema>;
export type RateRideBody = z.infer<typeof rateRideBodySchema>;
export type SosBody = z.infer<typeof sosBodySchema>;
export type SharedRideDto = z.infer<typeof sharedRideSchema>;
export type DriverEarningsDto = z.infer<typeof driverEarningsSchema>;
