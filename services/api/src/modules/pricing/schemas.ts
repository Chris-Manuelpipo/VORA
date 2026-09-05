// VORA — schémas zod du module pricing.

import { z } from 'zod';

export const offerSchema = z.enum(['eco', 'confort', 'moto']);

export const estimateBodySchema = z
  .object({
    offer: offerSchema,
    /** Distance de l'itinéraire, en mètres. Fournie par le module geo en P2. */
    distance_m: z.number().int().min(0).max(200_000),
    duration_s: z.number().int().min(0).max(4 * 3600),
    /** Heure de la commande. Par défaut maintenant — la majoration de nuit en dépend. */
    at: z.string().datetime().optional(),
    /** Majoration pluie / forte demande, activée par l'ops. Bornée à 50 % côté serveur. */
    demand_surge_percent: z.number().int().min(0).max(50).optional(),
  })
  .strict();

const fareLineSchema = z.object({
  key: z.enum(['base', 'distance', 'time', 'minimum', 'night', 'demand', 'cap']),
  label: z.string(),
  amount: z.number().int(),
});

export const fareSchema = z.object({
  offer: offerSchema,
  /** Le prix ferme. C'est ce nombre que le passager voit, et il ne bougera plus. */
  total: z.number().int(),
  total_formatted: z.string(),
  currency: z.literal('XAF'),
  base_amount: z.number().int(),
  lines: z.array(fareLineSchema),
  night: z.boolean(),
  demand_surge_percent: z.number().int(),
  capped: z.boolean(),
});

export const tariffSchema = z.object({
  offer: offerSchema,
  version: z.number().int(),
  base_fare: z.number().int(),
  per_km: z.number().int(),
  per_min: z.number().int(),
  minimum_fare: z.number().int(),
  night_surge_percent: z.number().int(),
  demand_surge_max_percent: z.number().int(),
  total_cap_percent: z.number().int(),
  cancel_fee: z.number().int(),
});

export const tariffsResponseSchema = z.object({
  city: z.string(),
  tariffs: z.array(tariffSchema),
});

// ─── POST /v1/quotes ─────────────────────────────────────────────────────────
//
// La forme suit `docs/API_CONTRACT.md` : c'est le contrat déjà distribué à l'équipe
// mobile, qui écrit son client pendant qu'on écrit le serveur. On y ajoute trois choses
// que le contrat ne nommait pas mais que les règles imposent : la décomposition LIGNE
// PAR LIGNE (§ 5.1 : « majorations en lignes séparées et visibles »), la SIGNATURE du
// devis, et le `quoteId` par offre — voir le commentaire de `quoteOfferSchema`.

const placeInputSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: z.string().max(160).optional(),
  })
  .strict();

export const createQuoteBodySchema = z
  .object({
    pickup: placeInputSchema,
    dropoff: placeInputSchema,
  })
  .strict();

export const quoteOfferSchema = z.object({
  offer: offerSchema,
  /**
   * Identifiant du devis DE CETTE OFFRE. Le contrat mobile plaçait `quoteId` au niveau
   * du devis entier ; il est ici au niveau de l'offre, parce qu'un devis porte un prix
   * signé et qu'il y a trois prix. `POST /v1/rides` reçoit celui de l'offre choisie.
   * `null` quand l'offre est indisponible : on ne signe pas un prix qu'on refuse.
   */
  quoteId: z.string().uuid().nullable(),
  /** Le prix ferme. Ce nombre-là ne bougera plus jusqu'à la fin de la course. */
  price: z.number().int(),
  priceFormatted: z.string(),
  currency: z.literal('XAF'),
  /** Minutes avant qu'un chauffeur soit là. `null` si aucun n'est en vue. */
  etaMin: z.number().int().nullable(),
  /** Décomposition du contrat mobile : quatre nombres pour un affichage compact. */
  breakdown: z.object({
    base: z.number().int(),
    distance: z.number().int(),
    time: z.number().int(),
    surge: z.number().int(),
  }),
  /** La même chose en toutes lettres, une ligne par poste — c'est ce qui s'affiche. */
  lines: z.array(fareLineSchema),
  night: z.boolean(),
  surgePercent: z.number().int(),
  capped: z.boolean(),
  available: z.boolean(),
  /** Phrase à afficher telle quelle quand l'offre est refusée. */
  unavailableReason: z.string().nullable(),
  /** Zone interdite à dessiner sur la carte, quand c'est le géorepérage qui refuse. */
  unavailableZoneId: z.string().uuid().nullable(),
  /** HMAC des entrées du devis. Revérifié à la commande. */
  signature: z.string().nullable(),
});

export const createQuoteResponseSchema = z.object({
  expiresAt: z.string(),
  /** Secondes restantes : l'appli affiche « prix garanti 1:58 » sans recalculer d'écart. */
  expiresInS: z.number().int(),
  /** D'où vient l'itinéraire. Jamais caché (CLAUDE.md § 3). */
  routing: z.enum(['osrm', 'fallback']),
  distanceKm: z.number(),
  durationMin: z.number().int(),
  /** Polyligne encodée de l'itinéraire, pour la tracer avant même de commander. */
  routePolyline: z.string(),
  offers: z.array(quoteOfferSchema),
});

export type EstimateBody = z.infer<typeof estimateBodySchema>;
export type FareDto = z.infer<typeof fareSchema>;
export type TariffDto = z.infer<typeof tariffSchema>;
export type CreateQuoteBody = z.infer<typeof createQuoteBodySchema>;
export type CreateQuoteResponse = z.infer<typeof createQuoteResponseSchema>;
export type QuoteOfferDto = z.infer<typeof quoteOfferSchema>;
