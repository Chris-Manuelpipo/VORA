// VORA — routage : OSRM public, repli haversine.
//
// ÉCART ASSUMÉ (CLAUDE.md § 3) : la cible est un OSRM auto-hébergé sur un extrait
// Cameroun (ADR-005). Importer et compiler cet extrait coûte plusieurs gigaoctets et une
// heure ; l'instance publique répond en ~300 ms depuis Yaoundé. On l'utilise, avec un
// délai de garde de 2 s.
//
// LE REPLI N'EST PAS UN CACHE-MISÈRE. C'est l'exigence de dégradation gracieuse du
// brief, et il est visible : la réponse porte toujours `routing: 'osrm' | 'fallback'`.
// Une distance de repli est une distance à vol d'oiseau × 1,35 à 22 km/h — une
// approximation honnête du réseau de Yaoundé, pas une vérité.
//
// Ce que le repli change pour le reste du produit, et qu'il faut savoir :
//   · le PRIX calculé dessus est ferme quand même (le passager ne paie pas notre panne) ;
//   · la GÉOMÉTRIE est un segment droit. Le géorepérage moto vérifié sur ce segment est
//     donc approximatif : il peut refuser une course dont le vrai itinéraire contourne la
//     zone. On refuse dans le doute — c'est le sens de la règle (CLAUDE.md § 5.5), et
//     c'est dit dans `service.ts`.

import { config } from '../../lib/config.js';
import type { LatLng } from '../../db/geography.js';
import { haversineMeters } from '../../lib/geodesy.js';
import { decodePolyline, encodePolyline } from '../../lib/polyline.js';

export type Routing = 'osrm' | 'fallback';

export interface RouteResult {
  distanceM: number;
  durationS: number;
  /** Polyligne encodée (précision 5), telle que la comprend `flutter_map`. */
  geometry: string;
  /** Les mêmes points, décodés : c'est cette liste qui part chez PostGIS. */
  points: LatLng[];
  routing: Routing;
  /**
   * Renseigné uniquement en repli : ce qui a empêché OSRM de répondre. Destiné au log
   * et à la page ops, jamais affiché au passager — il n'a pas à lire nos pannes.
   */
  fallbackReason: string | null;
}

// ─── Disjoncteur ─────────────────────────────────────────────────────────────
//
// Sans lui, une coupure réseau ferait attendre 2 s À CHAQUE devis : quinze secondes
// de blanc pendant une démo de cinq minutes. Après trois échecs consécutifs on cesse
// d'appeler OSRM pendant une minute, puis on retente une fois. Le repli est immédiat.

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60_000;

let consecutiveFailures = 0;
let openedUntil = 0;

function circuitIsOpen(now = Date.now()): boolean {
  return now < openedUntil;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    openedUntil = Date.now() + COOLDOWN_MS;
    consecutiveFailures = 0;
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  openedUntil = 0;
}

/** Remet le disjoncteur à zéro. Utilisé par les tests et par `POST /v1/demo/reset`. */
export function resetRoutingCircuit(): void {
  consecutiveFailures = 0;
  openedUntil = 0;
}

/** État du disjoncteur, pour la page ops et le contrôle avant démo. */
export function routingCircuitState(): { open: boolean; reopensInS: number } {
  const remaining = Math.max(0, openedUntil - Date.now());
  return { open: remaining > 0, reopensInS: Math.ceil(remaining / 1000) };
}

// ─── Repli ───────────────────────────────────────────────────────────────────

/**
 * Distance à vol d'oiseau × 1,35, à 22 km/h. Le facteur 1,35 est le détour moyen
 * constaté d'un réseau urbain dense ; 22 km/h la vitesse moyenne réaliste dans Yaoundé
 * aux heures ouvrées. Les deux sont dans `.env` : ils se corrigent sans redéploiement.
 */
export function fallbackRoute(from: LatLng, to: LatLng, reason: string): RouteResult {
  const straightM = haversineMeters(from, to);
  const distanceM = Math.round(straightM * config.FALLBACK_DISTANCE_FACTOR);
  const speedMs = (config.FALLBACK_SPEED_KMH * 1000) / 3600;
  const points = [from, to];

  return {
    distanceM,
    durationS: Math.max(1, Math.round(distanceM / speedMs)),
    geometry: encodePolyline(points),
    points,
    routing: 'fallback',
    fallbackReason: reason,
  };
}

// ─── OSRM ────────────────────────────────────────────────────────────────────

/** L'ordre OSRM est lng,lat — l'inverse de celui des applis. La confusion s'arrête ici. */
function toOsrmCoordinates(from: LatLng, to: LatLng): string {
  return `${from.lng},${from.lat};${to.lng},${to.lat}`;
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: string;
}

/**
 * Lecture DÉFENSIVE de la réponse OSRM. C'est un service public : il peut renvoyer une
 * page d'erreur HTML, un JSON d'une autre forme, ou un itinéraire vide. Tout ce qui
 * n'est pas exactement la forme attendue bascule en repli plutôt que de propager un
 * `undefined` jusqu'au prix.
 */
function readOsrmRoute(payload: unknown): OsrmRoute | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as { code?: unknown; routes?: unknown };
  if (body.code !== 'Ok' || !Array.isArray(body.routes) || body.routes.length === 0) return null;

  const first = body.routes[0] as { distance?: unknown; duration?: unknown; geometry?: unknown };
  if (
    typeof first.distance !== 'number' ||
    typeof first.duration !== 'number' ||
    typeof first.geometry !== 'string' ||
    !Number.isFinite(first.distance) ||
    !Number.isFinite(first.duration)
  ) {
    return null;
  }

  return { distance: first.distance, duration: first.duration, geometry: first.geometry };
}

/**
 * Itinéraire entre deux points.
 *
 * Ne rejette JAMAIS : un routage indisponible n'est pas une erreur du passager, et une
 * commande ne doit pas échouer parce qu'un serveur tiers est lent. En cas de problème,
 * le repli répond et le dit dans `routing`.
 */
export async function route(from: LatLng, to: LatLng): Promise<RouteResult> {
  if (!config.OSRM_ENABLED) {
    return fallbackRoute(from, to, 'OSRM désactivé (OSRM_ENABLED=false)');
  }
  if (circuitIsOpen()) {
    const { reopensInS } = routingCircuitState();
    return fallbackRoute(from, to, `OSRM en repos après échecs répétés (nouvelle tentative dans ${reopensInS} s)`);
  }

  const url =
    `${config.OSRM_BASE_URL}/route/v1/${config.OSRM_PROFILE}/${toOsrmCoordinates(from, to)}` +
    '?overview=full&geometries=polyline&alternatives=false&steps=false';

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.OSRM_TIMEOUT_MS),
      headers: {
        // Politique d'usage des services publics OSM : se présenter.
        // Sans accent, volontairement : un champ d'en-tête HTTP est de l'US-ASCII
        // (RFC 9110 § 5.5), et un octet au-delà se comporte différemment selon le client
        // et le mandataire. Ce n'est pas le lieu d'écrire « Yaoundé » correctement.
        'User-Agent': 'VORA/0.1 (hackathon NuxCine, Yaounde, Cameroun)',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      recordFailure();
      return fallbackRoute(from, to, `OSRM a répondu ${response.status}`);
    }

    const osrm = readOsrmRoute(await response.json());
    if (!osrm) {
      recordFailure();
      return fallbackRoute(from, to, 'Réponse OSRM inexploitable');
    }

    const points = decodePolyline(osrm.geometry);
    if (points.length < 2) {
      recordFailure();
      return fallbackRoute(from, to, 'Géométrie OSRM vide');
    }

    recordSuccess();
    return {
      distanceM: Math.round(osrm.distance),
      durationS: Math.max(1, Math.round(osrm.duration)),
      geometry: osrm.geometry,
      points,
      routing: 'osrm',
      fallbackReason: null,
    };
  } catch (error) {
    recordFailure();
    // `AbortSignal.timeout` lève une TimeoutError : c'est le cas courant sur un réseau
    // de salle, et il mérite un message qui le nomme.
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    const reason = timedOut
      ? `OSRM n'a pas répondu en ${config.OSRM_TIMEOUT_MS} ms`
      : `OSRM injoignable : ${error instanceof Error ? error.message : String(error)}`;
    return fallbackRoute(from, to, reason);
  }
}
