// VORA — DTO de sortie du module geo.
//
// Repères et zones sont des données publiques : aucune PII ici. La règle « jamais
// d'entité brute » (CLAUDE.md § 5.6) vaut quand même, et c'est elle qui garantit qu'une
// colonne ajoutée en base n'apparaît pas d'elle-même dans une réponse.
//
// Ce qu'on retient volontairement à l'intérieur : `score` (notre calcul de pertinence,
// qui n'a aucun sens pour un client et changera) et `popularity` (une estimation interne
// qu'on n'a pas à afficher comme une donnée).

import type { z } from 'zod';
import type { LandmarkRow, ZoneRow } from './repository.js';
import type { landmarkSchema, zoneFeatureSchema } from './schemas.js';

export function toLandmarkDto(row: LandmarkRow): z.infer<typeof landmarkSchema> {
  return {
    id: row.id,
    name: row.name,
    quartier: row.district,
    category: row.category,
    // PostgreSQL rend numeric et double precision en chaîne selon le type : on force.
    lat: Number(row.lat),
    lng: Number(row.lng),
    distanceM: row.distance_m === null ? null : Number(row.distance_m),
    confidence: Number(row.confidence),
  };
}

/** Une zone en Feature GeoJSON. La géométrie est celle que PostGIS a sérialisée. */
export function toZoneFeature(row: ZoneRow): z.infer<typeof zoneFeatureSchema> {
  return {
    type: 'Feature',
    id: row.id,
    geometry: row.geometry,
    properties: {
      id: row.id,
      kind: row.kind,
      name: row.name,
      reason: row.reason,
      bonusAmount: row.bonus_amount === null ? null : Number(row.bonus_amount),
    },
  };
}
