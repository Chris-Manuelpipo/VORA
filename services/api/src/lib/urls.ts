// VORA — construction des URL publiques (lien de partage, photo de profil).
//
// POURQUOI CE FICHIER EXISTE, pour trois lignes de code.
//
// `PUBLIC_BASE_URL` est saisie à la main dans une console de déploiement. Sur Clever
// Cloud, quelqu'un a collé `https://vora.cleverapps.io/` — avec la barre oblique finale,
// comme la barre d'adresse d'un navigateur la montre. Le serveur a alors produit
// `https://vora.cleverapps.io//v1/media/<id>`, et cette URL répond **404** : pour un
// serveur HTTP, `//v1` n'est pas `/v1`.
//
// Ce qui rend cette panne coûteuse, ce n'est pas sa difficulté — c'est son SILENCE.
// L'API répond 200 partout, les journaux sont vides, les tests passent : seul l'avatar
// ne s'affiche pas, et seul le proche qui ouvre un lien de partage tombe sur une page
// d'erreur. Or ce lien est l'un des trois filets de sécurité du produit (CLAUDE.md § 8.1),
// et il est justement utilisé par quelqu'un qui n'a PAS l'application pour se plaindre.
//
// La correction tient en un `replace`. Elle est ici, et pas recopiée à chaque appel,
// parce qu'une règle recopiée est une règle qu'on oubliera au troisième endroit.

import { config } from './config.js';

/** Retire les barres obliques finales. `https://x.io/` → `https://x.io`, `https://x.io` inchangé. */
export function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * URL publique absolue pour un chemin de l'API.
 *
 * @param path chemin commençant par `/` (`/v1/media/<id>`)
 */
export function publicUrl(path: string): string {
  const base = stripTrailingSlashes(config.PUBLIC_BASE_URL);
  return `${base}/${path.replace(/^\/+/, '')}`;
}
