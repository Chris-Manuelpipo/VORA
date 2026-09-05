// VORA — logique du module geo : repères, zones, routage, géorepérage moto.

import type { LatLng } from '../../db/geography.js';
import type { ZoneKind } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { decodePolyline } from '../../lib/polyline.js';
import { toLandmarkDto, toZoneFeature } from './dto.js';
import { prepareQuery } from './query.js';
import * as repository from './repository.js';
import { route } from './routing.js';
import type { RouteResult, Routing } from './routing.js';
import type { LandmarkSearchQuery, MotoCheckBody, MotoCheckResponse } from './schemas.js';

// ─── Repères ─────────────────────────────────────────────────────────────────

export async function searchLandmarks(query: LandmarkSearchQuery) {
  const near =
    query.lat !== undefined && query.lng !== undefined
      ? { lat: query.lat, lng: query.lng }
      : undefined;

  const rows = await repository.searchLandmarks(prepareQuery(query.q), {
    limit: query.limit,
    near,
  });

  return rows.map(toLandmarkDto);
}

// ─── Zones ───────────────────────────────────────────────────────────────────

export async function listZones(kind?: ZoneKind) {
  const rows = await repository.listActiveZones(kind);
  return { type: 'FeatureCollection' as const, features: rows.map(toZoneFeature) };
}

// ─── Routage ─────────────────────────────────────────────────────────────────

export async function computeRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
  return route(from, to);
}

// ─── Géorepérage moto (CLAUDE.md § 5.5) ──────────────────────────────────────

/** Phrase affichée au passager. Elle dit la règle ET pourquoi elle existe. */
export const MOTO_FORBIDDEN_MESSAGE =
  "L'itinéraire traverse une zone interdite aux motos (arrêté préfectoral). VORA ne propose pas de course illégale.";

export interface MotoVerdict {
  allowed: boolean;
  /** Les zones touchées, avec leur géométrie : de quoi les dessiner sur la carte. */
  zones: repository.ForbiddenZoneHit[];
}

/**
 * Un itinéraire peut arriver sous trois formes selon l'appelant : la liste de points
 * qu'on vient de calculer, la polyligne encodée stockée sur la course, ou rien du tout.
 */
export type RouteGeometry = LatLng[] | string | null | undefined;

function toPoints(geometry: RouteGeometry): LatLng[] {
  if (!geometry) return [];
  return typeof geometry === 'string' ? decodePolyline(geometry) : geometry;
}

/**
 * LA FONCTION QUI PORTE LA RÈGLE.
 *
 * Cette course est-elle possible en moto ? On vérifie le départ, l'arrivée ET tout
 * l'itinéraire — dans cet ordre littéral : les extrémités sont TOUJOURS ajoutées à la
 * ligne soumise à PostGIS, même quand un itinéraire est fourni. Un itinéraire OSRM
 * commence sur la voie la plus proche, qui peut être à quelques dizaines de mètres du
 * point de rendez-vous réel ; sans cette précaution, un départ posé juste à l'intérieur
 * d'une zone interdite passerait entre les mailles.
 *
 * Sans itinéraire, la vérification porte sur le segment droit départ → arrivée. C'est
 * moins fidèle, jamais plus laxiste sur les extrémités, et ça se dit : voir le repli de
 * `routing.ts`.
 */
export async function isMotoAllowed(
  pickup: LatLng,
  dropoff: LatLng,
  routeGeometry?: RouteGeometry,
): Promise<MotoVerdict> {
  const path = [pickup, ...toPoints(routeGeometry), dropoff];
  const zones = await repository.findMotoForbiddenZones(path);
  return { allowed: zones.length === 0, zones };
}

/**
 * Vérification BLOQUANTE, appelée avant de créer un devis moto et avant de chercher un
 * chauffeur (modules `pricing` et `dispatch`). Elle lève `MOTO_ZONE_FORBIDDEN` avec la
 * zone, pour que l'appli la dessine sur la carte au lieu de dire « impossible » sans
 * expliquer.
 *
 * C'est ici que la règle se tient : CÔTÉ SERVEUR, AVANT le dispatch. Aucune commande
 * moto ne peut exister sans être passée par cette fonction.
 */
export async function assertMotoAllowed(
  pickup: LatLng,
  dropoff: LatLng,
  routeGeometry?: RouteGeometry,
): Promise<void> {
  const verdict = await isMotoAllowed(pickup, dropoff, routeGeometry);
  if (verdict.allowed) return;

  throw new AppError('MOTO_ZONE_FORBIDDEN', MOTO_FORBIDDEN_MESSAGE, {
    zones: verdict.zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      reason: zone.reason,
      geometry: zone.geometry,
    })),
  });
}

/**
 * Vérification INFORMATIVE, pour la carte : « cette course est-elle possible en moto ? ».
 * Répond 200 avec le verdict et la zone à dessiner, sans lever d'erreur — c'est une
 * question, pas une commande.
 *
 * Si l'appelant ne fournit pas d'itinéraire, le serveur en calcule un : la vérification
 * ne dépend jamais de ce que le client veut bien envoyer.
 */
export async function checkMotoRoute(body: MotoCheckBody): Promise<MotoCheckResponse> {
  let geometry: RouteGeometry = body.route;
  let routing: Routing = 'osrm';

  if (geometry === undefined) {
    const computed = await route(body.pickup, body.dropoff);
    geometry = computed.points;
    routing = computed.routing;
  } else {
    // Itinéraire fourni : on ne sait pas d'où il vient, donc on ne prétend pas qu'il
    // vient d'OSRM. `fallback` est la réponse honnête — « vérifié sur une géométrie
    // dont nous ne garantissons pas la provenance ».
    routing = 'fallback';
  }

  const verdict = await isMotoAllowed(body.pickup, body.dropoff, geometry);

  return {
    allowed: verdict.allowed,
    message: verdict.allowed ? null : MOTO_FORBIDDEN_MESSAGE,
    routing,
    zones: verdict.zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      reason: zone.reason,
      geometry: zone.geometry,
    })),
  };
}
