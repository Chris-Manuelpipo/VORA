// VORA — primitives de hachage et d'aléa. Aucune donnée sensible n'est stockée en clair
// quand elle n'a pas besoin de l'être : code OTP et code de montée sont hachés (CLAUDE.md § 5.5).

import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Hachage d'un secret court (code OTP, code de montée à 4 chiffres).
 * Un code à 4 ou 6 chiffres tient dans un espace minuscule : un simple SHA-256 se force
 * hors ligne en une seconde. On sale donc avec un secret serveur (poivre) : sans le
 * `JWT_SECRET`/`QUOTE_HMAC_SECRET`, une copie de la table ne suffit pas à retrouver le code.
 * En production, ces codes vivent quelques minutes — c'est la vraie protection.
 */
export function hashShortSecret(value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(value).digest('hex');
}

/** Comparaison à temps constant de deux empreintes hexadécimales. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Empreinte stable d'une valeur non secrète (recherche par index sans stocker la valeur). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Signature HMAC hexadécimale — devis figé, jetons de partage. */
export function hmacHex(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Suite de `length` chiffres, tirée d'un générateur cryptographique.
 * `Math.random()` est interdit ici : ces chiffres protègent un compte et une montée à bord.
 */
export function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String(randomInt(0, 10));
  return out;
}
