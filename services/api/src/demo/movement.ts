// VORA — déplacement le long d'un itinéraire. FONCTIONS PURES, testables sans base.
//
// Un chauffeur simulé ne se téléporte pas et ne suit pas une ligne droite : il avance le
// long de la géométrie renvoyée par OSRM, mètre après mètre. C'est ce qui fait qu'un
// point qui bouge sur la carte du jury ressemble à une voiture dans une rue, et pas à un
// curseur qui traverse les immeubles.
//
// Tout est ici pour que ce soit vérifiable au mètre près par un test, sans OSRM, sans
// base, sans horloge : `advanceAlong` est une fonction de (chemin, distance) vers une
// position. Le reste du simulateur n'est que de l'ordonnancement autour d'elle.

import type { LatLng } from '../db/geography.js';
import { haversineMeters } from '../lib/geodesy.js';

export interface Progress {
  position: LatLng;
  /** Cap en degrés (0 = nord), pour orienter la flèche du véhicule sur la carte. */
  heading: number;
  /** Distance parcourue depuis le début du chemin, en mètres. */
  travelledM: number;
  /** Vrai quand le bout du chemin est atteint : il faut en retracer un autre. */
  finished: boolean;
}

/**
 * Position après avoir parcouru `distanceM` le long de `path`.
 *
 * L'interpolation est linéaire entre deux points consécutifs. À l'échelle d'une rue de
 * Yaoundé — quelques dizaines de mètres entre deux sommets d'une polyligne OSRM — la
 * courbure de la Terre est sans effet : deux décimales de plus ne rendraient pas le
 * point plus juste, elles coûteraient seulement du calcul à chaque battement.
 */
export function advanceAlong(path: LatLng[], distanceM: number): Progress {
  if (path.length === 0) {
    throw new Error('Un chemin vide ne mène nulle part.');
  }

  const first = path[0]!;
  if (path.length === 1) {
    return { position: first, heading: 0, travelledM: 0, finished: true };
  }

  if (distanceM <= 0) {
    return {
      position: first,
      heading: bearing(first, path[1]!),
      travelledM: 0,
      finished: false,
    };
  }

  let remaining = distanceM;

  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i]!;
    const to = path[i + 1]!;
    const segment = haversineMeters(from, to);

    // Deux points identiques d'affilée (OSRM en produit) : rien à parcourir.
    if (segment <= 0) continue;

    if (remaining <= segment) {
      const ratio = remaining / segment;
      return {
        position: {
          lat: from.lat + (to.lat - from.lat) * ratio,
          lng: from.lng + (to.lng - from.lng) * ratio,
        },
        heading: bearing(from, to),
        travelledM: distanceM,
        finished: false,
      };
    }

    remaining -= segment;
  }

  // Le chemin est plus court que la distance demandée : on est au bout.
  const last = path[path.length - 1]!;
  const beforeLast = path[path.length - 2]!;

  return {
    position: last,
    heading: bearing(beforeLast, last),
    travelledM: pathLength(path),
    finished: true,
  };
}

/** Longueur totale d'un chemin, en mètres. */
export function pathLength(path: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    total += haversineMeters(path[i]!, path[i + 1]!);
  }
  return total;
}

/**
 * Cap de `from` vers `to`, en degrés dans [0, 360).
 *
 * Formule du cap initial orthodromique. Elle compte pour l'affichage : une flèche qui
 * pointe à l'envers dans une rue à sens unique se remarque tout de suite.
 */
export function bearing(from: LatLng, to: LatLng): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Tirage uniforme dans un intervalle. Le simulateur n'a pas besoin de cryptographie. */
export function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Un élément au hasard, ou `null` si la liste est vide. */
export function pickOne<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}
