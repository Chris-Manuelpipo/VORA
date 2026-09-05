// VORA — score d'attribution et estimation d'approche. FONCTIONS PURES.
//
// Le score est celui de CLAUDE.md § 5.4, au coefficient près :
//   score = 0,55 × eta + 0,20 × acceptation + 0,15 × (1 − annulation) + 0,10 × note
//
// Les quatre termes sont ramenés à [0, 1] et le score l'est aussi : 1 est le chauffeur
// idéal (déjà sur place, accepte toujours, n'annule jamais, noté 5). Aucun terme ne peut
// donc en écraser un autre par son unité — une erreur classique quand on mélange des
// secondes et des étoiles dans une somme pondérée.

import {
  DISPATCH_SCORE_WEIGHTS,
  type VehicleKind,
} from '../../domain/rules.js';
import type { LatLng } from '../../db/geography.js';
import { haversineMeters } from '../../lib/geodesy.js';
import { config } from '../../lib/config.js';

/**
 * Au-delà de cette approche, l'ETA ne départage plus rien : un chauffeur à 15 minutes
 * et un chauffeur à 25 minutes sont également inacceptables pour le passager. Le terme
 * sature donc à 0 plutôt que de devenir négatif et de fausser la somme.
 */
export const ETA_SATURATION_S = 15 * 60;

/** Note maximale de l'échelle VORA. Sert à ramener la note dans [0, 1]. */
const MAX_RATING = 5;

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

/**
 * Temps d'approche estimé, en secondes, à partir de la distance à vol d'oiseau.
 *
 * On réutilise volontairement les constantes du repli de routage (× 1,35 à 22 km/h,
 * CLAUDE.md § 3) : ce sont les mêmes hypothèses sur le réseau de Yaoundé, et une
 * seconde table de chiffres finirait par diverger de la première. Interroger OSRM pour
 * chaque candidat de chaque vague coûterait des dizaines d'appels par course — pour
 * classer des chauffeurs entre eux, l'ordre de grandeur suffit.
 *
 * La moto ne va pas plus vite que la voiture à Yaoundé aux heures ouvrées : elle se
 * faufile, mais sur des routes plus mauvaises. On ne différencie donc pas — et le jour
 * où on mesurera le contraire, c'est ici que ça se corrigera.
 */
export function approachEtaS(from: LatLng, to: LatLng, _kind?: VehicleKind): number {
  const straightM = haversineMeters(from, to);
  const roadM = straightM * config.FALLBACK_DISTANCE_FACTOR;
  const speedMs = (config.FALLBACK_SPEED_KMH * 1000) / 3600;
  return Math.max(1, Math.round(roadM / speedMs));
}

export interface ScoreInput {
  /** Temps d'approche estimé, en secondes. */
  etaS: number;
  /** Part des offres acceptées, dans [0, 1]. */
  acceptanceRate: number;
  /** Part des courses annulées par le chauffeur, dans [0, 1]. */
  cancellationRate: number;
  /** Note sur 5. */
  rating: number;
}

export interface ScoreBreakdown {
  score: number;
  eta: number;
  acceptance: number;
  reliability: number;
  rating: number;
}

/**
 * Le score, et sa décomposition. La décomposition n'est pas décorative : quand un
 * chauffeur demande pourquoi il reçoit moins de courses que son voisin, c'est elle
 * qu'on lui montre.
 */
export function scoreDriver(input: ScoreInput): ScoreBreakdown {
  const eta = clamp01(1 - input.etaS / ETA_SATURATION_S);
  const acceptance = clamp01(input.acceptanceRate);
  const reliability = clamp01(1 - input.cancellationRate);
  const rating = clamp01(input.rating / MAX_RATING);

  const score =
    DISPATCH_SCORE_WEIGHTS.eta * eta +
    DISPATCH_SCORE_WEIGHTS.acceptance * acceptance +
    DISPATCH_SCORE_WEIGHTS.reliability * reliability +
    DISPATCH_SCORE_WEIGHTS.rating * rating;

  return { score, eta, acceptance, reliability, rating };
}
