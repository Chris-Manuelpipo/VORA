// VORA — code de montée à 4 chiffres (CLAUDE.md § 5.5).
//
// Obligatoire pour passer `arrived` → `in_progress`. Généré aléatoirement, STOCKÉ HACHÉ,
// visible du passager seulement, JAMAIS renvoyé au chauffeur — c'est tout l'intérêt :
// le chauffeur doit le demander à la personne qui monte. 3 échecs → alerte ops.
//
// LE PROBLÈME QUE CE FICHIER RÉSOUT, ET COMMENT.
//
// Un code haché ne se relit pas. Or le passager doit pouvoir le retrouver : il ferme
// l'application, la rouvre à l'arrivée du chauffeur, et le code doit être là. Trois
// solutions existaient :
//
//   · le stocker en clair → on annule la seule protection contre une copie de la base ;
//   · le chiffrer par colonne → pgcrypto et une clé hors base, hors budget (§ 3) ;
//   · le garder en clair EN MÉMOIRE le temps de la course, la base ne gardant que
//     l'empreinte qui sert à vérifier. C'est ce qu'on fait.
//
// Ce que ça coûte, et qu'on dit : un redémarrage de l'API pendant une course perd le
// code en clair. Le passager qui le redemande en reçoit alors un NOUVEAU, et l'empreinte
// est réécrite — la course n'est pas bloquée, et le chauffeur n'a de toute façon jamais
// vu ni l'ancien ni le nouveau. C'est la propriété qui compte.

import { hashShortSecret, randomDigits, safeEquals } from '../../lib/crypto.js';
import { BOARDING_CODE_LENGTH } from '../../domain/rules.js';

export function generateBoardingCode(): string {
  return randomDigits(BOARDING_CODE_LENGTH);
}

export function hashBoardingCode(code: string, pepper: string): string {
  return hashShortSecret(code, pepper);
}

export function boardingCodeMatches(code: string, hash: string, pepper: string): boolean {
  return safeEquals(hashBoardingCode(code, pepper), hash);
}

// ─── Le code en clair, le temps de la course ─────────────────────────────────

const clearCodes = new Map<string, string>();

export function rememberBoardingCode(rideId: string, code: string): void {
  clearCodes.set(rideId, code);
}

/** Le code que le passager doit lire au chauffeur, ou `null` s'il a été oublié. */
export function recallBoardingCode(rideId: string): string | null {
  return clearCodes.get(rideId) ?? null;
}

/** La course est montée ou close : le code n'a plus aucune raison d'exister. */
export function forgetBoardingCode(rideId: string): void {
  clearCodes.delete(rideId);
}

/** Remise à zéro — tests et `npm run demo`. */
export function clearBoardingCodes(): void {
  clearCodes.clear();
}
