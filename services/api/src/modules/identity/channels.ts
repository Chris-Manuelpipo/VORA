// VORA — canaux d'authentification : téléphone camerounais ou e-mail.
//
// Deux responsabilités, et une seule règle qui les gouverne : la NORMALISATION (pour que
// « 691 23 45 67 », « +237 691234567 » et « 00237691234567 » soient le même compte) et le
// MASQUAGE (pour qu'un numéro ne se retrouve jamais entier dans une réponse ou un log,
// CLAUDE.md § 5.6).

import { AppError } from '../../lib/errors.js';

export type Channel = 'phone' | 'email';

/** Indicatif du Cameroun. Une seule ville en v1, un seul pays. */
const COUNTRY_CODE = '237';

/**
 * Numéro camerounais en E.164 : +2376XXXXXXXX.
 * Les mobiles font 9 chiffres et commencent par 6 (MTN 67/650-654, Orange 69/655-659,
 * Camtel 62). On accepte les espaces, points, tirets, le 00237 et le +237.
 */
export function normalizePhone(raw: string): string {
  let digits = raw.trim().replace(/[\s.\-()]/g, '');

  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.startsWith(COUNTRY_CODE)) digits = digits.slice(COUNTRY_CODE.length);

  if (!/^\d+$/.test(digits)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Ce numéro contient des caractères inattendus. Saisissez-le au format 6 91 23 45 67.',
    );
  }

  if (!/^6\d{8}$/.test(digits)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Un numéro camerounais commence par 6 et compte 9 chiffres. Exemple : 6 91 23 45 67.',
      { received_length: digits.length },
    );
  }

  return `+${COUNTRY_CODE}${digits}`;
}

/** E-mail en minuscules, sans espaces. Validation de forme volontairement souple. */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new AppError(
      'VALIDATION_ERROR',
      "Cette adresse e-mail semble incomplète. Vérifiez-la, puis réessayez.",
    );
  }
  return email;
}

export function normalizeDestination(channel: Channel, value: string): string {
  return channel === 'phone' ? normalizePhone(value) : normalizeEmail(value);
}

/**
 * Version affichable d'une destination : assez pour que son propriétaire se reconnaisse,
 * jamais assez pour qu'un tiers la compose. C'est la SEULE forme qui sort de l'API.
 *   +237691234567  →  +237 6·· ··· ·67
 *   aicha@mail.cm  →  a····@mail.cm
 */
export function maskDestination(channel: Channel, value: string): string {
  if (channel === 'phone') {
    const national = value.replace(/^\+237/, '');
    if (national.length !== 9) return '+237 ·········';
    return `+237 ${national[0]}·· ··· ·${national.slice(7)}`;
  }

  const [local = '', domain = ''] = value.split('@');
  const head = local.slice(0, 1) || '·';
  return `${head}${'·'.repeat(Math.max(local.length - 1, 3))}@${domain}`;
}

/** Masque un utilisateur enregistré, quel que soit le canal dont il dispose. */
export function maskUserChannels(user: { phone: string | null; email: string | null }): {
  phone_masked: string | null;
  email_masked: string | null;
} {
  return {
    phone_masked: user.phone ? maskDestination('phone', user.phone) : null,
    email_masked: user.email ? maskDestination('email', user.email) : null,
  };
}
