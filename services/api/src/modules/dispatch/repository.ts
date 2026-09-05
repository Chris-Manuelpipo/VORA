// VORA — accès aux données du module dispatch.
//
// Les POSITIONS ne sont pas ici : elles vivent en mémoire (presence.ts), avec un TTL de
// 60 s. Écrire 12 positions par seconde en base n'apporterait rien et coûterait cher.
// Ce que la base garde, c'est l'état durable : le chauffeur est-il en ligne, son dossier
// est-il validé, quel véhicule conduit-il.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  dispatchOffers,
  driverProfiles,
  users,
  vehicles,
  type DispatchOffer,
  type DriverProfile,
  type OfferResponse,
  type User,
  type Vehicle,
} from '../../db/schema.js';
import type { Offer } from '../../domain/rules.js';

export interface DriverBundle {
  user: User;
  profile: DriverProfile;
  vehicle: Vehicle | null;
}

/** Le chauffeur, son dossier et son véhicule courant — en une requête. */
export async function findDriverBundle(userId: string): Promise<DriverBundle | null> {
  const [row] = await db
    .select({ user: users, profile: driverProfiles, vehicle: vehicles })
    .from(driverProfiles)
    .innerJoin(users, eq(users.id, driverProfiles.userId))
    .leftJoin(vehicles, eq(vehicles.id, driverProfiles.currentVehicleId))
    .where(eq(driverProfiles.userId, userId))
    .limit(1);

  if (!row) return null;
  return { user: row.user, profile: row.profile, vehicle: row.vehicle };
}

/** Premier véhicule actif du chauffeur, quand aucun n'est explicitement choisi. */
export async function findFirstActiveVehicle(driverId: string): Promise<Vehicle | null> {
  const [row] = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.driverId, driverId), eq(vehicles.active, true)))
    .orderBy(vehicles.createdAt)
    .limit(1);
  return row ?? null;
}

export async function findVehicleOfDriver(
  driverId: string,
  vehicleId: string,
): Promise<Vehicle | null> {
  const [row] = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.driverId, driverId)))
    .limit(1);
  return row ?? null;
}

export async function setOnline(
  userId: string,
  online: boolean,
  currentVehicleId?: string | null,
): Promise<void> {
  await db
    .update(driverProfiles)
    .set({
      online,
      ...(currentVehicleId !== undefined ? { currentVehicleId } : {}),
    })
    .where(eq(driverProfiles.userId, userId));
}

/** Chauffeurs déclarés en ligne en base — à croiser avec les positions vivantes. */
export async function listOnlineDrivers(): Promise<
  { userId: string; voraId: string; displayName: string; kind: 'car' | 'moto' }[]
> {
  const rows = await db
    .select({
      userId: driverProfiles.userId,
      voraId: users.voraId,
      displayName: users.displayName,
      kind: driverProfiles.kind,
    })
    .from(driverProfiles)
    .innerJoin(users, eq(users.id, driverProfiles.userId))
    .where(and(eq(driverProfiles.online, true), eq(driverProfiles.status, 'approved')));

  return rows;
}

// ─── Candidats à une course ──────────────────────────────────────────────────

export interface DriverCandidateRow {
  userId: string;
  displayName: string;
  voraId: string;
  rating: number;
  acceptanceRate: number;
  cancellationRate: number;
  vehicleId: string;
  offers: Offer[];
}

/**
 * Parmi les chauffeurs dont la POSITION est vivante (elle vient de la mémoire, pas
 * d'ici), lesquels peuvent réellement prendre cette course ?
 *
 * Trois conditions, toutes en base parce qu'elles sont durables : le dossier est validé,
 * le chauffeur s'est déclaré en ligne, et son véhicule sert l'offre demandée. La position
 * dit où il est ; c'est la base qui dit s'il a le droit d'y être.
 *
 * Une seule requête pour toute la vague : douze chauffeurs, douze allers-retours, ce
 * serait douze fois la latence dans les 15 secondes qu'on doit tenir.
 */
export async function findCandidates(
  driverIds: string[],
  offer: Offer,
): Promise<DriverCandidateRow[]> {
  if (driverIds.length === 0) return [];

  const rows = await db
    .select({
      userId: driverProfiles.userId,
      displayName: users.displayName,
      voraId: users.voraId,
      rating: driverProfiles.rating,
      acceptanceRate: driverProfiles.acceptanceRate,
      cancellationRate: driverProfiles.cancellationRate,
      vehicleId: vehicles.id,
      offers: vehicles.offers,
    })
    .from(driverProfiles)
    .innerJoin(users, eq(users.id, driverProfiles.userId))
    .innerJoin(vehicles, eq(vehicles.id, driverProfiles.currentVehicleId))
    .where(
      and(
        inArray(driverProfiles.userId, driverIds),
        eq(driverProfiles.status, 'approved'),
        eq(driverProfiles.online, true),
        eq(users.status, 'active'),
        eq(vehicles.active, true),
        // `offers` est un text[] : l'offre demandée doit y figurer. C'est ce qui interdit
        // de proposer une course Confort à une Picanto déclarée Éco seulement.
        sql`${vehicles.offers} @> ARRAY[${offer}]::text[]`,
      ),
    );

  return rows.map((row) => ({
    ...row,
    // `numeric` et `real` reviennent en chaîne selon la colonne : on normalise ici, une
    // fois, plutôt que dans chaque calcul de score.
    rating: Number(row.rating),
    acceptanceRate: Number(row.acceptanceRate),
    cancellationRate: Number(row.cancellationRate),
    offers: row.offers as Offer[],
  }));
}

// ─── Offres séquentielles ────────────────────────────────────────────────────

export async function createOffer(input: {
  rideId: string;
  driverId: string;
  wave: number;
  rank: number;
  score: number;
  etaS: number;
  driverNet: number;
  expiresAt: Date;
}): Promise<DispatchOffer> {
  const [row] = await db.insert(dispatchOffers).values(input).returning();
  if (!row) throw new Error("L'offre de dispatch n'a pas été créée.");
  return row;
}

export async function findOfferById(offerId: string): Promise<DispatchOffer | null> {
  const [row] = await db.select().from(dispatchOffers).where(eq(dispatchOffers.id, offerId)).limit(1);
  return row ?? null;
}

/**
 * Clôt une offre, mais SEULEMENT si elle est encore en attente.
 *
 * Le `where` sur `response = 'pending'` est la course critique du dispatch : le
 * chronomètre de 15 s et le doigt du chauffeur peuvent tomber dans la même
 * milliseconde. Celui qui écrit le premier gagne, l'autre reçoit `null` et sait qu'il
 * a perdu — plutôt que d'écraser une acceptation par une expiration.
 */
export async function closeOffer(
  offerId: string,
  response: Exclude<OfferResponse, 'pending'>,
): Promise<DispatchOffer | null> {
  const [row] = await db
    .update(dispatchOffers)
    .set({ response, respondedAt: new Date() })
    .where(and(eq(dispatchOffers.id, offerId), eq(dispatchOffers.response, 'pending')))
    .returning();
  return row ?? null;
}

/** Chauffeurs déjà sollicités pour cette course : on ne redemande pas deux fois. */
export async function listOfferedDriverIds(rideId: string): Promise<string[]> {
  const rows = await db
    .select({ driverId: dispatchOffers.driverId })
    .from(dispatchOffers)
    .where(eq(dispatchOffers.rideId, rideId));
  return rows.map((row) => row.driverId);
}

/** Toutes les offres d'une course, pour la page ops et les tests. */
export async function listOffers(rideId: string): Promise<DispatchOffer[]> {
  return db
    .select()
    .from(dispatchOffers)
    .where(eq(dispatchOffers.rideId, rideId))
    .orderBy(dispatchOffers.sentAt);
}

/** Statistiques du score : une offre acceptée ou refusée fait bouger le taux d'acceptation. */
export async function recordOfferOutcome(driverId: string, accepted: boolean): Promise<void> {
  // Moyenne glissante à 20 offres : un refus ne condamne pas, une série de refus se voit.
  // Le calcul est fait en base pour rester atomique face à deux offres simultanées.
  const target = accepted ? 1 : 0;
  await db
    .update(driverProfiles)
    .set({
      acceptanceRate: sql`greatest(0, least(1, ${driverProfiles.acceptanceRate} + (${target} - ${driverProfiles.acceptanceRate}) / 20.0))`,
    })
    .where(eq(driverProfiles.userId, driverId));
}

/** Une annulation par le chauffeur pèse sur sa fiabilité, donc sur son score. */
export async function recordDriverCancellation(driverId: string): Promise<void> {
  await db
    .update(driverProfiles)
    .set({
      cancellationRate: sql`greatest(0, least(1, ${driverProfiles.cancellationRate} + (1 - ${driverProfiles.cancellationRate}) / 20.0))`,
    })
    .where(eq(driverProfiles.userId, driverId));
}

/** Une course terminée compte, et remet la dette d'espèces à jour côté chauffeur. */
export async function completeRideStats(driverId: string, cashDue: number): Promise<void> {
  await db
    .update(driverProfiles)
    .set({
      ridesCount: sql`${driverProfiles.ridesCount} + 1`,
      cashDebt: sql`${driverProfiles.cashDebt} + ${cashDue}`,
    })
    .where(eq(driverProfiles.userId, driverId));
}
