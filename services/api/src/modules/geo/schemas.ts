// VORA — schémas zod du module geo.
//
// La forme des réponses suit `docs/API_CONTRACT.md`, qui est le contrat déjà distribué à
// l'équipe mobile : `quartier` et `distanceM` s'écrivent comme là-bas, et `/geo/zones`
// renvoie bien une FeatureCollection GeoJSON. Un backend qui a raison tout seul contre le
// contrat coûte une soirée de débogage à deux personnes.

import { z } from 'zod';

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const pointSchema = z.object({ lat: latitudeSchema, lng: longitudeSchema }).strict();

export const ZONE_KINDS = ['moto_forbidden', 'moto_allowed', 'car_corridor', 'bonus'] as const;
export const zoneKindSchema = z.enum(ZONE_KINDS);

// ─── GET /v1/geo/search ──────────────────────────────────────────────────────

export const landmarkSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2, 'Tapez au moins deux lettres.').max(120),
    /** Position de l'utilisateur : à pertinence égale, le repère le plus proche gagne. */
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  })
  .strict()
  // lat sans lng ne veut rien dire : autant le dire à l'appelant plutôt que d'ignorer
  // silencieusement sa position et de lui rendre un tri qu'il ne comprendra pas.
  .refine((query) => (query.lat === undefined) === (query.lng === undefined), {
    message: 'Donnez lat ET lng, ou aucun des deux.',
    path: ['lat'],
  });

export const landmarkSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Nom du quartier — c'est ainsi que le contrat mobile le nomme. */
  quartier: z.string().nullable(),
  category: z.string(),
  lat: z.number(),
  lng: z.number(),
  /** Distance à la position fournie, en mètres. `null` si aucune position n'a été donnée. */
  distanceM: z.number().int().nullable(),
  /**
   * Fiabilité des coordonnées, de 0 à 100. Les repères semés sont APPROXIMATIFS et le
   * disent (CLAUDE.md § 8.2) : au-delà de 65, c'est qu'un chauffeur les a corrigés.
   * Affiché nulle part, mais l'appli peut s'en servir pour proposer « corriger ce point ».
   */
  confidence: z.number().int(),
});

/** Le contrat mobile attend un tableau nu. On le lui rend tel quel. */
export const landmarkSearchResponseSchema = z.array(landmarkSchema);

// ─── GET /v1/geo/zones ───────────────────────────────────────────────────────

export const zonesQuerySchema = z.object({ kind: zoneKindSchema.optional() }).strict();

/**
 * Une zone en Feature GeoJSON. `geometry` vient de `ST_AsGeoJSON` : c'est PostGIS qui
 * produit le GeoJSON, pas nous — la géométrie affichée sur la carte est exactement celle
 * qui a servi à décider.
 */
export const zoneFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.string().uuid(),
  geometry: z.unknown(),
  properties: z.object({
    id: z.string().uuid(),
    kind: zoneKindSchema,
    name: z.string(),
    reason: z.string().nullable(),
    bonusAmount: z.number().int().nullable(),
  }),
});

export const zonesResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(zoneFeatureSchema),
});

// ─── GET /v1/geo/route ───────────────────────────────────────────────────────

export const routeQuerySchema = z
  .object({
    from_lat: z.coerce.number().min(-90).max(90),
    from_lng: z.coerce.number().min(-180).max(180),
    to_lat: z.coerce.number().min(-90).max(90),
    to_lng: z.coerce.number().min(-180).max(180),
  })
  .strict();

export const routeResponseSchema = z.object({
  distanceM: z.number().int(),
  durationS: z.number().int(),
  /** Polyligne encodée (précision 5), lisible par `flutter_map`. */
  geometry: z.string(),
  /**
   * D'où vient cet itinéraire. JAMAIS caché : c'est la dégradation gracieuse du brief,
   * et elle doit se voir à l'écran (CLAUDE.md § 3).
   */
  routing: z.enum(['osrm', 'fallback']),
});

// ─── POST /v1/geo/moto/check ─────────────────────────────────────────────────

export const motoCheckBodySchema = z
  .object({
    pickup: pointSchema,
    dropoff: pointSchema,
    /**
     * Itinéraire déjà calculé, si l'appelant en a un — sous forme de points ou de
     * polyligne encodée. Absent, le serveur le calcule lui-même : la vérification ne
     * doit jamais dépendre de ce que le client veut bien fournir.
     */
    route: z.union([z.array(pointSchema).max(5000), z.string().max(20_000)]).optional(),
  })
  .strict();

export const forbiddenZoneSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  reason: z.string().nullable(),
  /** GeoJSON de la zone, pour la dessiner sur la carte au lieu de dire « impossible ». */
  geometry: z.unknown(),
});

export const motoCheckResponseSchema = z.object({
  allowed: z.boolean(),
  /** Phrase à afficher telle quelle au passager quand la course est refusée. */
  message: z.string().nullable(),
  /** D'où vient l'itinéraire vérifié : un repli a été contrôlé sur un segment droit. */
  routing: z.enum(['osrm', 'fallback']),
  zones: z.array(forbiddenZoneSchema),
});

export type LandmarkSearchQuery = z.infer<typeof landmarkSearchQuerySchema>;
export type RouteQuery = z.infer<typeof routeQuerySchema>;
export type MotoCheckBody = z.infer<typeof motoCheckBodySchema>;
export type MotoCheckResponse = z.infer<typeof motoCheckResponseSchema>;
export type ZoneFeature = z.infer<typeof zoneFeatureSchema>;
