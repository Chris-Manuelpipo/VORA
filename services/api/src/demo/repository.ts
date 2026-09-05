// VORA — les seules lectures en base que le simulateur s'autorise.
//
// TOUT LE RESTE PASSE PAR L'API PUBLIQUE. Un chauffeur simulé se met en ligne, remonte
// sa position, accepte, arrive, démarre et encaisse par les mêmes routes HTTP que
// l'application Flutter — pas par les services internes. C'est ce qui rend la
// démonstration probante : si le simulateur y arrive, un vrai téléphone y arrive.
//
// Ce fichier existe pour les trois choses qu'un vrai téléphone apprend AUTREMENT, et que
// le simulateur doit bien obtenir d'une façon ou d'une autre :
//
//   1. la carte de Yaoundé (repères, zones moto) — un téléphone l'a en mémoire ;
//   2. les offres en attente — un téléphone les reçoit par Socket.IO ; le simulateur les
//      lit en base, faute de connexion WebSocket à lui-même ;
//   3. le voyage dans le temps du scénario « annulation tardive » — personne ne l'a, et
//      c'est assumé (voir `timeTravelAcceptedAt`).
//
// Ces requêtes sont en LECTURE seule, à une exception près, clairement signalée.

import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { LatLng } from '../db/geography.js';
import type { RideStatus } from '../domain/states.js';

// ─── La carte ────────────────────────────────────────────────────────────────

export interface DemoPlace extends LatLng {
  name: string;
}

/** Repères actifs de Yaoundé : les destinations plausibles des voitures. */
export async function listLandmarks(limit = 200): Promise<DemoPlace[]> {
  const result = await db.execute(sql`
    select name, ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lng
    from landmarks
    where active and city = 'Yaoundé'
    limit ${limit}
  `);

  return (result.rows as Array<{ name: string; lat: number; lng: number }>).map((row) => ({
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
  }));
}

/**
 * Points tirés au hasard À L'INTÉRIEUR des zones où la moto est autorisée.
 *
 * C'est la contrainte du § 5.5 appliquée à la flotte simulée : une moto ne doit pas
 * apparaître au milieu du centre urbain interdit, ni y rouler. On ne filtre donc pas
 * après coup — on ne tire que dans les zones permises, ce qui rend la faute impossible.
 *
 * `ST_GeneratePoints` fait le tirage dans PostGIS : c'est la même géométrie que celle
 * qui sert au géorepérage, donc aucune approximation ne peut s'y glisser.
 */
export async function randomPointsInMotoZones(count: number): Promise<DemoPlace[]> {
  const result = await db.execute(sql`
    with points as (
      select z.name, (ST_Dump(ST_GeneratePoints(z.geom::geometry, ${count}))).geom as p
      from zones z
      where z.active and z.kind = 'moto_allowed' and z.city = 'Yaoundé'
    )
    select name, ST_Y(p) as lat, ST_X(p) as lng
    from points
    order by random()
    limit ${count}
  `);

  return (result.rows as Array<{ name: string; lat: number; lng: number }>).map((row) => ({
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
  }));
}

// ─── Les offres en attente ───────────────────────────────────────────────────

export interface PendingOffer {
  offerId: string;
  rideId: string;
  driverId: string;
  status: RideStatus;
  offer: 'eco' | 'confort' | 'moto';
  paymentMethod: 'cash' | 'mobile_money';
  driverNet: number;
  pickup: LatLng;
  dropoff: LatLng;
}

/**
 * Offres encore ouvertes pour les chauffeurs de la flotte.
 *
 * SIMULATION ASSUMÉE : un vrai chauffeur reçoit `ride.offer` par Socket.IO. Le
 * simulateur, lui, tourne DANS le serveur et n'a pas de WebSocket vers lui-même : il
 * interroge la table. Ce qu'il fait ensuite — accepter — repasse par la route publique
 * `POST /v1/driver/offers/{id}/accept`, avec les 15 secondes et la concurrence réelles.
 */
export async function pendingOffersFor(driverIds: string[]): Promise<PendingOffer[]> {
  if (driverIds.length === 0) return [];

  const result = await db.execute(sql`
    select
      o.id as offer_id,
      o.ride_id,
      o.driver_id,
      o.driver_net,
      r.status,
      r.offer,
      r.payment_method,
      ST_Y(r.pickup::geometry) as pickup_lat,
      ST_X(r.pickup::geometry) as pickup_lng,
      ST_Y(r.dropoff::geometry) as dropoff_lat,
      ST_X(r.dropoff::geometry) as dropoff_lng
    from dispatch_offers o
    join rides r on r.id = o.ride_id
    where o.response = 'pending'
      and o.expires_at > now()
      and o.driver_id = any(${sql.raw(`ARRAY[${driverIds.map((id) => `'${id}'::uuid`).join(',')}]`)})
  `);

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    offerId: String(row.offer_id),
    rideId: String(row.ride_id),
    driverId: String(row.driver_id),
    status: String(row.status) as RideStatus,
    offer: String(row.offer) as 'eco' | 'confort' | 'moto',
    paymentMethod: String(row.payment_method) as 'cash' | 'mobile_money',
    driverNet: Number(row.driver_net),
    pickup: { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
    dropoff: { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) },
  }));
}

// ─── L'état d'une course suivie ──────────────────────────────────────────────

export interface RideSnapshot {
  id: string;
  status: RideStatus;
  paymentMethod: 'cash' | 'mobile_money';
  pickup: LatLng;
  dropoff: LatLng;
}

export async function rideSnapshot(rideId: string): Promise<RideSnapshot | null> {
  const result = await db.execute(sql`
    select
      id, status, payment_method,
      ST_Y(pickup::geometry) as pickup_lat, ST_X(pickup::geometry) as pickup_lng,
      ST_Y(dropoff::geometry) as dropoff_lat, ST_X(dropoff::geometry) as dropoff_lng
    from rides where id = ${rideId}::uuid
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: String(row.id),
    status: String(row.status) as RideStatus,
    paymentMethod: String(row.payment_method) as 'cash' | 'mobile_money',
    pickup: { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
    dropoff: { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) },
  };
}

// ─── La seule écriture, et pourquoi ──────────────────────────────────────────

/**
 * VOYAGE DANS LE TEMPS. Recule l'heure d'acceptation d'une course.
 *
 * Scénario « annulation tardive » : l'annulation est gratuite dans les 2 minutes qui
 * suivent l'acceptation **ou** tant que le chauffeur a parcouru moins de 300 m
 * (CLAUDE.md § 5.3). Les deux conditions sont alternatives, donc pour montrer une
 * annulation PAYANTE il faut que les deux soient tombées — soit deux minutes d'attente
 * devant le jury, sur une démonstration qui en dure cinq.
 *
 * On recule donc l'horloge, et rien d'autre. C'est la SEULE écriture du simulateur dans
 * une table métier, elle ne touche qu'un horodatage, et surtout : le calcul des frais,
 * la transition d'état et le crédit du chauffeur restent intégralement faits par
 * `rides/service.cancelRide`. Le simulateur n'écrit ni un statut, ni un montant.
 */
export async function timeTravelAcceptedAt(rideId: string, secondsAgo: number): Promise<void> {
  await db.execute(sql`
    update rides
       set accepted_at = now() - make_interval(secs => ${secondsAgo}),
           driver_odometer_start_m = 0
     where id = ${rideId}::uuid
       and accepted_at is not null
  `);
}
