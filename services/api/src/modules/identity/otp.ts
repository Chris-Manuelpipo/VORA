// VORA — code de vérification à 6 chiffres.
//
// Logique PURE : pas de base, pas d'horloge implicite, pas de Fastify. Le service décide
// ensuite quoi écrire (incrémenter les tentatives, consommer le code) ; ici on ne fait que
// juger. C'est ce qui rend la vérification testable seule
// (src/tests/unit/otp.unit.test.ts).
//
// MODE DÉMONSTRATION (CLAUDE.md § 8.2) : `DEMO_MODE=true` → le code vaut toujours 123456,
// il est renvoyé dans la réponse et écrit en clair dans les logs. Aucun agrégateur SMS
// n'est contractualisable en 48 h. Le garde-fou est dans lib/config.ts : cette combinaison
// est refusée au démarrage si NODE_ENV=production.

import { hashShortSecret, randomDigits, safeEquals } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { OTP_CODE_LENGTH } from '../../domain/rules.js';

/** Ce que la vérification a besoin de connaître d'un défi — rien de plus. */
export interface OtpChallengeState {
  id: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export type OtpVerdict =
  | { ok: true }
  /**
   * `countsAsAttempt` : seul un code FAUX consomme un essai. Un code expiré ou déjà
   * utilisé n'en consomme pas — sinon une horloge de retard suffirait à bloquer un compte.
   */
  | { ok: false; error: AppError; countsAsAttempt: boolean };

/**
 * Tire le code à envoyer.
 * @param demo mode démonstration : code fixe, connu du jury, affiché à l'écran.
 */
export function generateOtpCode(demo: { enabled: boolean; code: string }): string {
  return demo.enabled ? demo.code : randomDigits(OTP_CODE_LENGTH);
}

export function hashOtpCode(code: string, pepper: string): string {
  return hashShortSecret(code, pepper);
}

/**
 * Juge un code soumis. L'ordre des vérifications est volontaire : on répond « expiré »
 * plutôt que « faux » quand les deux sont vrais, parce que l'action à faire n'est pas la
 * même — redemander un code, ou le retaper.
 */
export function verifyOtpCode(
  challenge: OtpChallengeState,
  submittedCode: string,
  pepper: string,
  now: Date = new Date(),
): OtpVerdict {
  if (challenge.consumedAt !== null) {
    return {
      ok: false,
      countsAsAttempt: false,
      error: new AppError(
        'OTP_ALREADY_USED',
        'Ce code a déjà servi. Demandez-en un nouveau pour vous connecter.',
      ),
    };
  }

  if (now.getTime() >= challenge.expiresAt.getTime()) {
    return {
      ok: false,
      countsAsAttempt: false,
      error: new AppError(
        'OTP_EXPIRED',
        'Ce code a expiré. Demandez-en un nouveau, il arrive en quelques secondes.',
      ),
    };
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    return {
      ok: false,
      countsAsAttempt: false,
      error: new AppError(
        'OTP_TOO_MANY_ATTEMPTS',
        'Trop d’essais sur ce code. Demandez-en un nouveau pour continuer.',
        { max_attempts: challenge.maxAttempts },
      ),
    };
  }

  const submittedHash = hashOtpCode(submittedCode, pepper);
  if (!safeEquals(submittedHash, challenge.codeHash)) {
    const remaining = challenge.maxAttempts - (challenge.attempts + 1);
    return {
      ok: false,
      countsAsAttempt: true,
      error: new AppError(
        remaining > 0 ? 'OTP_INVALID' : 'OTP_TOO_MANY_ATTEMPTS',
        remaining > 0
          ? `Code incorrect. Il vous reste ${remaining} essai${remaining > 1 ? 's' : ''}.`
          : 'Trop d’essais sur ce code. Demandez-en un nouveau pour continuer.',
        { remaining_attempts: Math.max(remaining, 0) },
      ),
    };
  }

  return { ok: true };
}
