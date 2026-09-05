// VORA — signature du devis. FONCTION PURE, testable sans base.
//
// PREMIER MOMENT DE VÉRITÉ (CLAUDE.md § 2) : « le prix s'affiche avant la commande, et
// ne bouge plus ». Le devis est donc figé — et la signature est ce qui rend ce gel
// VÉRIFIABLE plutôt que promis.
//
// Ce que la signature protège vraiment, puisque le devis est aussi stocké en base :
//   · elle interdit à un client de commander un prix qu'on n'a jamais calculé (le prix
//     revalidé à la commande n'est pas celui que le téléphone renvoie, mais celui qu'on
//     a signé) ;
//   · elle rend une altération en base ou en transit DÉTECTABLE, au lieu de silencieuse ;
//   · elle documente, en une ligne de code, les entrées dont le prix dépend : si demain
//     quelqu'un ajoute une variable au calcul sans l'ajouter ici, le devis signé cesse
//     de décrire le prix qu'il porte, et c'est visible à la relecture.
//
// La chaîne canonique est délibérément lisible : en cas de litige on doit pouvoir la
// recomposer à la main devant un jury, pas déboguer une sérialisation.

import { hmacHex, safeEquals } from '../../lib/crypto.js';
import type { LatLng } from '../../db/geography.js';
import type { Offer } from '../../domain/rules.js';

export interface QuoteSignatureInput {
  quoteId: string;
  passengerId: string;
  offer: Offer;
  tariffId: string;
  pickup: LatLng;
  dropoff: LatLng;
  distanceM: number;
  durationS: number;
  price: number;
  night: boolean;
  surgePercent: number;
  /** Instant d'expiration, ISO 8601 : signer le prix sans sa péremption ne servirait à rien. */
  expiresAt: string;
}

/**
 * Cinq décimales, soit ~1 m à l'équateur. Au-delà, le bruit du GPS ferait échouer la
 * vérification d'un devis parfaitement légitime : on signe une position, pas un capteur.
 */
function coordinate(value: number): string {
  return value.toFixed(5);
}

/** La chaîne exactement signée. Exposée pour que les tests et un litige la relisent. */
export function canonicalQuotePayload(input: QuoteSignatureInput): string {
  return [
    'vora.quote.v1',
    input.quoteId,
    input.passengerId,
    input.offer,
    input.tariffId,
    coordinate(input.pickup.lat),
    coordinate(input.pickup.lng),
    coordinate(input.dropoff.lat),
    coordinate(input.dropoff.lng),
    String(input.distanceM),
    String(input.durationS),
    String(input.price),
    input.night ? 'night' : 'day',
    String(input.surgePercent),
    input.expiresAt,
  ].join('|');
}

export function signQuote(input: QuoteSignatureInput, secret: string): string {
  return hmacHex(canonicalQuotePayload(input), secret);
}

/** Comparaison à temps constant : une signature ne se vérifie pas avec `===`. */
export function verifyQuoteSignature(
  input: QuoteSignatureInput,
  signature: string,
  secret: string,
): boolean {
  return safeEquals(signQuote(input, secret), signature);
}
