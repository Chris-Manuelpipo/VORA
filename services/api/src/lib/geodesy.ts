// VORA — distances à vol d'oiseau. Sert au dispatch (rayon des vagues) et au repli de
// routage quand OSRM ne répond pas (CLAUDE.md § 3 : haversine × 1,35 à 22 km/h).
//
// Pour tout ce qui touche à une ZONE ou à un ITINÉRAIRE, c'est PostGIS qui tranche, pas ce
// fichier : une approximation ne décide jamais si une moto traverse une zone interdite.

import type { LatLng } from '../db/geography.js';

const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Distance orthodromique entre deux points, en mètres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
