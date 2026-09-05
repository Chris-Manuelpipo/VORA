// VORA — lien public de partage de trajet. FONCTIONS PURES.
//
// « Partager mon trajet » (CLAUDE.md § 8.1) : le passager envoie un lien à un proche,
// qui suit la course dans son navigateur, sans compte et sans application.
//
// AUCUNE TABLE. Le jeton porte lui-même ce qu'il autorise — une course, jusqu'à une
// date — et une signature HMAC le rend infalsifiable. Trois conséquences qu'on a
// choisies plutôt que subies :
//   · rien à stocker, rien à purger, rien qui traîne en base après le trajet ;
//   · le lien EXPIRE tout seul : un proche qui le rouvre demain ne voit plus rien ;
//   · on ne peut pas révoquer un lien avant son échéance. C'est le compromis, et il est
//     acceptable pour un lien que le passager a lui-même envoyé, qui ne donne accès à
//     aucune donnée personnelle et qui vit quelques heures.
//
// Ce que le lien montre est décidé ailleurs (`dto.ts`, `toSharedRideDto`) : une plaque,
// un point sur une carte, un statut. Jamais un numéro, jamais un e-mail, jamais un prix.

import { hmacHex, safeEquals } from '../../lib/crypto.js';

/** Version du format : un changement de contenu invalidera proprement les anciens liens. */
const PREFIX = 'v1';

export interface ShareToken {
  rideId: string;
  /** Échéance en secondes Unix — compacte, et lisible dans le jeton. */
  expiresAt: number;
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function payloadOf(token: ShareToken): string {
  return `${PREFIX}.${token.rideId}.${token.expiresAt}`;
}

/** « v1.<uuid>.<epoch>.<signature> », encodé pour tenir dans une URL. */
export function signShareToken(token: ShareToken, secret: string): string {
  const payload = payloadOf(token);
  return base64url(`${payload}.${hmacHex(payload, secret)}`);
}

/**
 * Relit un jeton, ou refuse. Renvoie `null` pour TOUTE anomalie — forme invalide,
 * signature fausse, échéance passée : celui qui ouvre le lien n'a pas à savoir laquelle,
 * et un message d'erreur précis aiderait surtout celui qui essaie d'en fabriquer un.
 */
export function readShareToken(
  raw: string,
  secret: string,
  now: Date = new Date(),
): ShareToken | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const parts = decoded.split('.');
  if (parts.length !== 4) return null;

  const [prefix, rideId, expiresRaw, signature] = parts as [string, string, string, string];
  if (prefix !== PREFIX) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(expiresAt)) return null;

  const expected = hmacHex(`${prefix}.${rideId}.${expiresRaw}`, secret);
  if (!safeEquals(expected, signature)) return null;

  // La signature d'abord, l'échéance ensuite : on ne renseigne jamais sur la validité
  // d'un jeton qu'on n'a pas émis.
  if (expiresAt * 1000 <= now.getTime()) return null;

  return { rideId, expiresAt };
}
