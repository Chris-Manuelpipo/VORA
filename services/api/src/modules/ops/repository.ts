// VORA — accès aux données du module ops.
//
// FRONTIÈRE DE MODULE, à dire clairement : ops écrit dans `driver_profiles.status`
// (validation du dossier), dispatch écrit dans `driver_profiles.online` (mise en ligne).
// Même table, colonnes disjointes, et aucune des deux ne touche à celles de l'autre.
// C'est le seul endroit du backend où deux modules partagent une table, et c'est
// délibéré : le dossier d'un chauffeur et sa disponibilité du moment sont deux sujets
// différents qui vivent sur la même ligne.
//
// Le reste n'est que LECTURE : les compteurs traversent les tables des autres modules,
// parce qu'un tableau de bord est par nature transversal.

import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  driverEarnings,
  driverProfiles,
  rides,
  users,
  vehicles,
  type DriverStatus,
} from '../../db/schema.js';
import type { RideStatus } from '../../domain/states.js';

/** Une course « en cours » du point de vue de l'ops : elle demande une attention. */
const LIVE_STATUSES: RideStatus[] = [
  'requested',
  'offered',
  'accepted',
  'approaching',
  'arrived',
  'in_progress',
];

export interface DashboardCounters {
  ridesLive: number;
  ridesToday: number;
  ridesUnservedToday: number;
  grossTodayXaf: number;
  driverNetTodayXaf: number;
  driversPendingReview: number;
}

/**
 * Les compteurs du tableau de bord, en UNE requête.
 *
 * Six sous-requêtes dans un seul aller-retour plutôt que six appels : la page ops se
 * rafraîchit toutes les quelques secondes pendant la démonstration, et six allers-retours
 * par rafraîchissement se verraient à l'écran.
 */
export async function dashboardCounters(since: Date): Promise<DashboardCounters> {
  const result = await db.execute(sql`
    select
      (select count(*) from rides where status = any(${sql.raw(`ARRAY[${LIVE_STATUSES.map((s) => `'${s}'`).join(',')}]`)}::text[]))::int as rides_live,
      (select count(*) from rides where created_at >= ${since})::int as rides_today,
      -- Courses qu'aucun chauffeur n'a prises : c'est le compteur qui dit s'il faut
      -- recruter, pas celui des courses réussies.
      (select count(*) from rides where status = 'expired' and created_at >= ${since})::int as rides_unserved_today,
      (select coalesce(sum(coalesce(price_final, price_quoted)), 0) from rides
        where paid_at >= ${since})::int as gross_today,
      (select coalesce(sum(net), 0) from driver_earnings where created_at >= ${since})::int as driver_net_today,
      (select count(*) from driver_profiles where status = 'pending')::int as drivers_pending
  `);

  const row = result.rows[0] as Record<string, number> | undefined;

  return {
    ridesLive: Number(row?.rides_live ?? 0),
    ridesToday: Number(row?.rides_today ?? 0),
    ridesUnservedToday: Number(row?.rides_unserved_today ?? 0),
    grossTodayXaf: Number(row?.gross_today ?? 0),
    driverNetTodayXaf: Number(row?.driver_net_today ?? 0),
    driversPendingReview: Number(row?.drivers_pending ?? 0),
  };
}

export interface PendingDriverRow {
  userId: string;
  voraId: string;
  displayName: string;
  kind: 'car' | 'moto';
  status: DriverStatus;
  licenseNumber: string | null;
  createdAt: Date;
  vehicle: { make: string; model: string; color: string; plate: string } | null;
}

/** File de revue des dossiers chauffeurs. Sans PII : ni téléphone, ni e-mail. */
export async function listDriversByStatus(
  status: DriverStatus,
  limit = 50,
): Promise<PendingDriverRow[]> {
  const rows = await db
    .select({
      userId: driverProfiles.userId,
      voraId: users.voraId,
      displayName: users.displayName,
      kind: driverProfiles.kind,
      status: driverProfiles.status,
      licenseNumber: driverProfiles.licenseNumber,
      createdAt: driverProfiles.createdAt,
      make: vehicles.make,
      model: vehicles.model,
      color: vehicles.color,
      plate: vehicles.plate,
    })
    .from(driverProfiles)
    .innerJoin(users, eq(users.id, driverProfiles.userId))
    .leftJoin(vehicles, eq(vehicles.driverId, driverProfiles.userId))
    .where(eq(driverProfiles.status, status))
    .orderBy(driverProfiles.createdAt)
    .limit(limit);

  return rows.map((row) => ({
    userId: row.userId,
    voraId: row.voraId,
    displayName: row.displayName,
    kind: row.kind,
    status: row.status,
    licenseNumber: row.licenseNumber,
    createdAt: row.createdAt,
    vehicle: row.plate
      ? { make: row.make!, model: row.model!, color: row.color!, plate: row.plate }
      : null,
  }));
}

/**
 * Change le statut d'un dossier. Un dossier suspendu ou rejeté force la mise HORS LIGNE
 * dans la même écriture : sans cela, un chauffeur sanctionné continuerait de recevoir
 * des courses jusqu'à sa prochaine reconnexion.
 */
export async function setDriverStatus(
  userId: string,
  status: DriverStatus,
): Promise<{ userId: string; voraId: string; status: DriverStatus } | null> {
  const [row] = await db
    .update(driverProfiles)
    .set({
      status,
      verifiedAt: status === 'approved' ? new Date() : null,
      ...(status === 'approved' ? {} : { online: false }),
    })
    .where(eq(driverProfiles.userId, userId))
    .returning({ userId: driverProfiles.userId, status: driverProfiles.status });

  if (!row) return null;

  // L'ops travaille sur l'ID VORA, pas sur un UUID : on le rend avec la décision.
  const [owner] = await db
    .select({ voraId: users.voraId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return { ...row, voraId: owner?.voraId ?? '' };
}

/** Dernières courses, pour la liste vivante à côté de la carte. */
export async function recentRides(limit = 20) {
  return db
    .select({
      id: rides.id,
      status: rides.status,
      offer: rides.offer,
      price: rides.priceQuoted,
      pickupLabel: rides.pickupLabel,
      dropoffLabel: rides.dropoffLabel,
      createdAt: rides.createdAt,
    })
    .from(rides)
    .orderBy(desc(rides.createdAt))
    .limit(limit);
}

/** Nombre de courses vivantes par statut : de quoi voir où ça coince. */
export async function liveRidesByStatus(): Promise<Array<{ status: RideStatus; count: number }>> {
  const rows = await db
    .select({ status: rides.status, count: count() })
    .from(rides)
    .where(inArray(rides.status, LIVE_STATUSES))
    .groupBy(rides.status);

  return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
}

/** Total net reversé aux chauffeurs depuis une date — sert aux tests et aux exports. */
export async function netPaidSince(since: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${driverEarnings.net}), 0)::int` })
    .from(driverEarnings)
    .where(and(gte(driverEarnings.createdAt, since)));

  return Number(row?.total ?? 0);
}
