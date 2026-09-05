// VORA — accès aux données du module rides.
//
// Une transition d'état écrit DEUX choses, dans la même transaction : la projection
// (`rides.status`) et la ligne de journal (`ride_events`). Jamais l'une sans l'autre —
// c'est ce qui rend une course arbitrable.

import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  driverEarnings,
  idempotencyKeys,
  ratings,
  rideEvents,
  rides,
  users,
  vehicles,
  driverProfiles,
  type EarningSource,
  type PaymentMethod,
  type Ride,
  type RideEvent,
  type User,
  type Vehicle,
  type DriverProfile,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { CITY_TIMEZONE } from '../../domain/rules.js';
import type { Actor, RideEventType, RideStatus } from '../../domain/states.js';

export interface RideWithParties {
  ride: Ride;
  passenger: User;
  driver: User | null;
  driverProfile: DriverProfile | null;
  vehicle: Vehicle | null;
}

/**
 * Rattache passager, chauffeur et véhicule à une PAGE de courses.
 *
 * Trois requêtes groupées, quelle que soit la taille de la page — et non trois par course :
 * l'historique du passager est l'écran le plus ouvert de l'application, il ne doit pas
 * coûter soixante allers-retours pour vingt lignes.
 */
export async function attachParties(list: Ride[]): Promise<RideWithParties[]> {
  if (list.length === 0) return [];

  const userIds = [
    ...new Set(
      list.flatMap((ride) => [ride.passengerId, ride.driverId]).filter((id): id is string => id !== null),
    ),
  ];
  const vehicleIds = [
    ...new Set(list.map((ride) => ride.vehicleId).filter((id): id is string => id !== null)),
  ];

  // Le dossier chauffeur vient en jointure externe : un passager n'en a pas.
  const userRows = await db
    .select({ user: users, profile: driverProfiles })
    .from(users)
    .leftJoin(driverProfiles, eq(driverProfiles.userId, users.id))
    .where(inArray(users.id, userIds));

  const vehicleRows = vehicleIds.length
    ? await db.select().from(vehicles).where(inArray(vehicles.id, vehicleIds))
    : [];

  const usersById = new Map(userRows.map((row) => [row.user.id, row]));
  const vehiclesById = new Map(vehicleRows.map((vehicle) => [vehicle.id, vehicle]));

  return list.flatMap((ride) => {
    const passenger = usersById.get(ride.passengerId)?.user;
    // Une course sans passager n'existe pas (clé étrangère NOT NULL) : si ça arrive,
    // c'est une incohérence, et on préfère l'omettre que renvoyer une course amputée.
    if (!passenger) return [];

    const driverRow = ride.driverId ? usersById.get(ride.driverId) : undefined;

    return [
      {
        ride,
        passenger,
        driver: driverRow?.user ?? null,
        driverProfile: driverRow?.profile ?? null,
        vehicle: ride.vehicleId ? (vehiclesById.get(ride.vehicleId) ?? null) : null,
      },
    ];
  });
}

export async function findRideById(rideId: string): Promise<RideWithParties | null> {
  const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
  if (!ride) return null;

  const [bundle] = await attachParties([ride]);
  return bundle ?? null;
}

/** Historique d'une personne, du plus récent au plus ancien, paginé par curseur. */
export async function listRidesForUser(
  userId: string,
  options: { limit: number; before?: Date; statuses?: RideStatus[] },
): Promise<Ride[]> {
  const belongsToUser = or(eq(rides.passengerId, userId), eq(rides.driverId, userId));

  return db
    .select()
    .from(rides)
    .where(
      and(
        belongsToUser,
        options.before ? lt(rides.createdAt, options.before) : undefined,
        options.statuses?.length ? inArray(rides.status, options.statuses) : undefined,
      ),
    )
    .orderBy(desc(rides.createdAt))
    .limit(options.limit);
}

export async function listRideEvents(rideId: string): Promise<RideEvent[]> {
  return db.select().from(rideEvents).where(eq(rideEvents.rideId, rideId)).orderBy(rideEvents.id);
}

export interface TransitionInput {
  rideId: string;
  from: RideStatus;
  to: RideStatus;
  actorType: Actor;
  actorId?: string | null;
  eventType: RideEventType;
  payload?: Record<string, unknown>;
  /** Colonnes mises à jour en même temps que le statut (horodatages, montants…). */
  patch?: Partial<typeof rides.$inferInsert>;
}

/**
 * Applique une transition. Le `where` porte AUSSI sur le statut de départ : si un autre
 * acteur a fait avancer la course entre-temps, aucune ligne n'est touchée et l'appel
 * échoue proprement plutôt que d'écraser l'état.
 */
export async function applyTransition(input: TransitionInput): Promise<Ride> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(rides)
      .set({
        ...input.patch,
        status: input.to,
        version: sql`${rides.version} + 1`,
      })
      .where(and(eq(rides.id, input.rideId), eq(rides.status, input.from)))
      .returning();

    if (!updated) {
      // Rien n'a été écrit : ni la course, ni le journal. C'est le contrat.
      throw new AppError(
        'INVALID_TRANSITION',
        "La course a changé d'état entre-temps. Rafraîchissez pour voir où elle en est.",
        { expected_from: input.from, to: input.to },
      );
    }

    await tx.insert(rideEvents).values({
      rideId: input.rideId,
      type: input.eventType,
      fromStatus: input.from,
      toStatus: input.to,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
    });

    return updated;
  });
}

/**
 * Écrit des colonnes SANS changer de statut : compteur d'essais du code de montée,
 * position du chauffeur mémorisée à l'acceptation. Rien qui touche à `status` ne passe
 * par ici — la machine à états est le seul chemin vers un changement d'état.
 */
export async function patchRide(
  rideId: string,
  patch: Partial<typeof rides.$inferInsert>,
): Promise<Ride | null> {
  const [row] = await db.update(rides).set(patch).where(eq(rides.id, rideId)).returning();
  return row ?? null;
}

/** Course brute, sans les parties. Utile quand on n'a besoin que du statut et des montants. */
export async function findRideRow(rideId: string): Promise<Ride | null> {
  const [row] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
  return row ?? null;
}

/** Les statuts pendant lesquels un chauffeur est engagé sur une course. */
const ENGAGED_STATUSES: RideStatus[] = ['accepted', 'approaching', 'arrived', 'in_progress'];

/**
 * La course en cours d'un chauffeur, s'il en a une. Interrogée à chaque remontée de
 * position pour savoir où renvoyer le point qui bouge sur la carte du passager.
 *
 * Un chauffeur n'a qu'UNE course engagée à la fois : le dispatch le passe en `on_ride`
 * dès l'acceptation, et un chauffeur `on_ride` n'est plus candidat.
 */
export async function findEngagedRideForDriver(driverId: string): Promise<Ride | null> {
  const [row] = await db
    .select()
    .from(rides)
    .where(and(eq(rides.driverId, driverId), inArray(rides.status, ENGAGED_STATUSES)))
    .orderBy(desc(rides.acceptedAt))
    .limit(1);
  return row ?? null;
}

/** Crée la course en `draft`. Le passage à `requested` est une TRANSITION, faite ensuite. */
export async function insertRide(values: typeof rides.$inferInsert): Promise<Ride> {
  const [row] = await db.insert(rides).values(values).returning();
  if (!row) throw new Error("La course n'a pas été créée.");
  return row;
}

// ─── Idempotence (CLAUDE.md § 9) ─────────────────────────────────────────────

/** La course déjà créée sous cette clé, s'il y en a une. */
export async function findIdempotentRide(
  userId: string,
  endpoint: string,
  key: string,
): Promise<Ride | null> {
  const [row] = await db
    .select({ ride: rides })
    .from(idempotencyKeys)
    .innerJoin(rides, eq(rides.id, idempotencyKeys.rideId))
    .where(
      and(
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.endpoint, endpoint),
        eq(idempotencyKeys.key, key),
      ),
    )
    .limit(1);
  return row?.ride ?? null;
}

export async function rememberIdempotency(input: {
  userId: string;
  endpoint: string;
  key: string;
  rideId: string;
}): Promise<void> {
  await db.insert(idempotencyKeys).values(input).onConflictDoNothing();
}

// ─── Argent du chauffeur ─────────────────────────────────────────────────────

/**
 * Crédite le chauffeur. `onConflictDoNothing` sur (ride_id, source) : le double clic sur
 * « Encaissé » ne double pas la recette, et un rejeu de webhook non plus.
 */
export async function creditDriver(input: {
  rideId: string;
  driverId: string;
  source: EarningSource;
  gross: number;
  commission: number;
  dgi: number;
  net: number;
  paymentMethod: PaymentMethod;
}): Promise<void> {
  await db.insert(driverEarnings).values(input).onConflictDoNothing();
}

// ─── Notation ────────────────────────────────────────────────────────────────

/**
 * Enregistre une note, et met à jour la moyenne du chauffeur DANS LA MÊME TRANSACTION.
 *
 * La moyenne est recalculée depuis la table, jamais incrémentée : une moyenne
 * incrémentale dérive au fil des arrondis, et celle-ci pèse 10 % du score de dispatch.
 * `onConflictDoNothing` sur (ride_id, rater_id) : on note une course une fois.
 *
 * Renvoie `false` si la personne avait déjà noté cette course — ce n'est pas une erreur,
 * juste un second appui sur « Envoyer ».
 */
export async function saveRating(input: {
  rideId: string;
  raterId: string;
  rateeId: string;
  stars: number;
  tags: string[];
  comment?: string | null;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(ratings)
      .values({ ...input, comment: input.comment ?? null })
      .onConflictDoNothing()
      .returning({ id: ratings.id });

    if (inserted.length === 0) return false;

    // Le noté n'est pas forcément un chauffeur : un passager aussi se note. La mise à
    // jour ne touche alors aucune ligne, et c'est très bien.
    await tx
      .update(driverProfiles)
      .set({
        rating: sql`(
          select round(avg(${ratings.stars})::numeric, 1)
          from ${ratings}
          where ${ratings.rateeId} = ${input.rateeId}
        )`,
      })
      .where(eq(driverProfiles.userId, input.rateeId));

    return true;
  });
}

// ─── Gains du chauffeur ──────────────────────────────────────────────────────

export interface EarningsTotals {
  netXaf: number;
  grossXaf: number;
  commissionXaf: number;
  dgiXaf: number;
  ridesCount: number;
}

/** Totaux d'une période. Les frais d'annulation comptent : ils ont été gagnés aussi. */
export async function sumEarnings(driverId: string, since: Date): Promise<EarningsTotals> {
  const [row] = await db
    .select({
      netXaf: sql<number>`coalesce(sum(${driverEarnings.net}), 0)::int`,
      grossXaf: sql<number>`coalesce(sum(${driverEarnings.gross}), 0)::int`,
      commissionXaf: sql<number>`coalesce(sum(${driverEarnings.commission}), 0)::int`,
      dgiXaf: sql<number>`coalesce(sum(${driverEarnings.dgi}), 0)::int`,
      // Seules les courses comptent comme courses : un frais d'annulation n'en est pas une.
      ridesCount: sql<number>`count(*) filter (where ${driverEarnings.source} = 'ride')::int`,
    })
    .from(driverEarnings)
    .where(and(eq(driverEarnings.driverId, driverId), gte(driverEarnings.createdAt, since)));

  return (
    row ?? { netXaf: 0, grossXaf: 0, commissionXaf: 0, dgiXaf: 0, ridesCount: 0 }
  );
}

/** Net par heure de la journée, pour l'histogramme de l'écran « Mes gains ». */
export async function earningsByHour(
  driverId: string,
  since: Date,
): Promise<Array<{ hour: number; netXaf: number }>> {
  const rows = await db
    .select({
      hour: sql<number>`extract(hour from ${driverEarnings.createdAt} at time zone ${CITY_TIMEZONE})::int`,
      netXaf: sql<number>`sum(${driverEarnings.net})::int`,
    })
    .from(driverEarnings)
    .where(and(eq(driverEarnings.driverId, driverId), gte(driverEarnings.createdAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return rows;
}

export interface RecentEarning {
  rideId: string;
  at: Date;
  from: string | null;
  to: string | null;
  netXaf: number;
  source: EarningSource;
}

/** Les dernières lignes de gain, avec le trajet qu'elles récompensent. */
export async function recentEarnings(
  driverId: string,
  since: Date,
  limit: number,
): Promise<RecentEarning[]> {
  return db
    .select({
      rideId: driverEarnings.rideId,
      at: driverEarnings.createdAt,
      from: rides.pickupLabel,
      to: rides.dropoffLabel,
      netXaf: driverEarnings.net,
      source: driverEarnings.source,
    })
    .from(driverEarnings)
    .innerJoin(rides, eq(rides.id, driverEarnings.rideId))
    .where(and(eq(driverEarnings.driverId, driverId), gte(driverEarnings.createdAt, since)))
    .orderBy(desc(driverEarnings.createdAt))
    .limit(limit);
}

/** Journalise sans changer d'état (échec de code de montée, SOS, partage de trajet…). */
export async function appendEvent(input: {
  rideId: string;
  type: RideEventType;
  actorType: Actor;
  actorId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(rideEvents).values({
    rideId: input.rideId,
    type: input.type,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    payload: input.payload ?? {},
  });
}
