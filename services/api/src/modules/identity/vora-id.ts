// VORA — génération de l'ID VORA.
//
// 8 chiffres, unique, non modifiable, affiché en deux groupes de 4 : « 4821 0937 »
// (CLAUDE.md § 5.6). C'est l'identifiant qu'on lit à voix haute au téléphone, qu'on
// compare sur un reçu, qu'on donne à l'ops en cas de litige. Il ne remplace jamais
// l'authentification : connaître un ID VORA ne donne aucun droit.
//
// Deux propriétés le rendent utilisable par des humains :
//   · une CLÉ DE LUHN en dernière position — une faute de frappe isolée est détectée
//     avant même de toucher la base ;
//   · le REJET DES MOTIFS TRIVIAUX — pas de 11111111, 12345678, 42104210 : ils se
//     confondent avec des saisies de test et sèment le doute au support.
//
// Fonctions pures, sans base ni horloge : elles sont testées seules
// (src/tests/unit/vora-id.unit.test.ts).

import { randomDigits } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { VORA_ID_LENGTH } from '../../domain/rules.js';

/** Longueur de la partie tirée au sort : 7 chiffres + 1 chiffre de contrôle. */
const PAYLOAD_LENGTH = VORA_ID_LENGTH - 1;

/**
 * Chiffre de contrôle de Luhn pour une charge utile de 7 chiffres.
 * On double un chiffre sur deux en partant de la droite de la charge utile.
 */
export function luhnCheckDigit(payload: string): number {
  let sum = 0;
  for (let i = payload.length - 1, position = 0; i >= 0; i -= 1, position += 1) {
    let digit = payload.charCodeAt(i) - 48;
    // Le chiffre de contrôle occupera la position 0 : les positions paires d'ici sont doublées.
    if (position % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Motifs que l'on refuse de distribuer, même s'ils passent Luhn.
 * Chaque règle a une raison, aucune n'est décorative.
 */
export function isTrivialVoraId(value: string): boolean {
  // Un zéro en tête disparaît dès que quelqu'un colle l'ID dans un tableur.
  if (value.startsWith('0')) return true;
  // 11111111, 12121212 : moins de trois chiffres distincts, ça ressemble à un jeu d'essai.
  if (new Set(value).size <= 2) return true;
  // 48214821 : la moitié répétée se retient mal et se confond avec une erreur de copie.
  if (value.slice(0, 4) === value.slice(4)) return true;

  // 12345678 et 98765432 : suites parfaites.
  let ascending = true;
  let descending = true;
  for (let i = 1; i < value.length; i += 1) {
    const step = (value.charCodeAt(i) - 48) - (value.charCodeAt(i - 1) - 48);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

/** Un ID VORA est-il bien formé (8 chiffres, clé de Luhn juste, motif non trivial) ? */
export function isValidVoraId(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const payload = value.slice(0, PAYLOAD_LENGTH);
  const check = value.charCodeAt(VORA_ID_LENGTH - 1) - 48;
  if (luhnCheckDigit(payload) !== check) return false;
  return !isTrivialVoraId(value);
}

/**
 * Tire un ID VORA valide. Ne garantit PAS l'unicité : c'est le rôle d'`allocateVoraId`,
 * qui confronte le tirage à la base. Ici, on garantit seulement la forme.
 *
 * @param draw injectable pour les tests (par défaut : aléa cryptographique)
 */
export function generateVoraId(draw: (length: number) => string = randomDigits): string {
  // La boucle se termine : la très grande majorité des tirages passe du premier coup,
  // les motifs triviaux étant une poignée sur neuf millions.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const payload = draw(PAYLOAD_LENGTH);
    if (!/^\d{7}$/.test(payload)) {
      throw new Error(`Tirage invalide : ${PAYLOAD_LENGTH} chiffres attendus, reçu « ${payload} ».`);
    }
    const candidate = `${payload}${luhnCheckDigit(payload)}`;
    if (!isTrivialVoraId(candidate)) return candidate;
  }
  // Seulement atteignable avec un générateur d'aléa dégénéré (tirage constant).
  throw new AppError(
    'VORA_ID_UNAVAILABLE',
    "Impossible de générer un identifiant VORA. Réessayez dans un instant.",
    { reason: 'draw_always_trivial' },
  );
}

/**
 * Réserve un ID VORA libre. L'unicité réelle est celle de la base : `isTaken` interroge
 * l'index unique `users_vora_id_key`, et l'insertion elle-même reste protégée par cet
 * index — deux inscriptions simultanées ne peuvent pas obtenir le même identifiant.
 */
export async function allocateVoraId(
  isTaken: (candidate: string) => Promise<boolean>,
  options: { maxAttempts?: number; draw?: (length: number) => string } = {},
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 12;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = generateVoraId(options.draw);
    if (!(await isTaken(candidate))) return candidate;
  }

  throw new AppError(
    'VORA_ID_UNAVAILABLE',
    "Impossible d'attribuer un identifiant VORA pour l'instant. Réessayez dans un instant.",
    { attempts: maxAttempts },
  );
}

/** Présentation humaine : « 48210937 » → « 4821 0937 ». */
export function formatVoraId(value: string): string {
  return `${value.slice(0, 4)} ${value.slice(4)}`;
}
