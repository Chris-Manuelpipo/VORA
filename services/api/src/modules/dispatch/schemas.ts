// VORA — schémas zod du module dispatch.

import { z } from 'zod';

export const positionSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    heading: z.number().min(0).max(360).optional(),
    speed: z.number().min(0).max(200).optional(),
  })
  .strict();

export const goOnlineBodySchema = z
  .object({
    position: positionSchema,
    /** Véhicule utilisé pour cette session, si le chauffeur en a plusieurs. */
    vehicle_id: z.string().uuid().optional(),
  })
  .strict();

export const driverStatusSchema = z.object({
  online: z.boolean(),
  availability: z.enum(['available', 'on_ride', 'offline']),
  /** Combien de temps une position reste valable sans nouvelle remontée. */
  position_ttl_s: z.number().int(),
  /** Cadence attendue des remontées de position, en secondes. */
  position_interval_s: z.number().int(),
  vehicle_id: z.string().uuid().nullable(),
});

/** Carte de la page ops : des points et des identifiants VORA, aucun contact. */
export const liveDriverSchema = z.object({
  vora_id: z.string(),
  first_name: z.string(),
  kind: z.enum(['car', 'moto']),
  lat: z.number(),
  lng: z.number(),
  heading: z.number().nullable(),
  availability: z.enum(['available', 'on_ride']),
  updated_at: z.string(),
});

export const liveDriversResponseSchema = z.object({
  count: z.number().int(),
  drivers: z.array(liveDriverSchema),
});

// ─── Réponse à une offre ─────────────────────────────────────────────────────

export const offerParamsSchema = z.object({ offerId: z.string().uuid() }).strict();

export const offerResponseSchema = z.object({
  /** `true` si la réponse est arrivée à temps ; `false` si l'offre était déjà close. */
  accepted: z.boolean(),
  /** Phrase à afficher au chauffeur : « Course acceptée » ou « Trop tard ». */
  message: z.string(),
});

export type GoOnlineBody = z.infer<typeof goOnlineBodySchema>;
export type PositionBody = z.infer<typeof positionSchema>;
