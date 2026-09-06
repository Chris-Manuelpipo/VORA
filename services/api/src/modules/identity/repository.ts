// VORA — accès aux données du module identity.
//
// Frontière stricte (CLAUDE.md § 7) : ce module n'écrit que dans SES tables — users,
// devices, otp_challenges, driver_profiles. Il lit `vehicles` pour composer /v1/me, mais
// ne l'écrit pas : c'est le module d'exploitation du dossier chauffeur qui en a la charge.

import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  devices,
  driverProfiles,
  media,
  otpChallenges,
  trustedContacts,
  users,
  vehicles,
  type DriverProfile,
  type Media,
  type MediaPurpose,
  type OtpChallenge,
  type TrustedContact,
  type User,
  type UserRole,
  type Vehicle,
} from '../../db/schema.js';
import type { Sex } from '../../domain/profile.js';
import type { ImageMimeType } from '../../lib/images.js';
import type { VehicleKind } from '../../domain/rules.js';
import type { Channel } from './channels.js';

// ─── Utilisateurs ────────────────────────────────────────────────────────────

export async function findUserById(id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function findUserByDestination(
  channel: Channel,
  destination: string,
): Promise<User | null> {
  const predicate =
    channel === 'phone' ? eq(users.phone, destination) : eq(users.email, destination);
  const [row] = await db.select().from(users).where(predicate).limit(1);
  return row ?? null;
}

export async function isVoraIdTaken(voraId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.voraId, voraId))
    .limit(1);
  return row !== undefined;
}

export interface CreateUserInput {
  voraId: string;
  role: UserRole;
  displayName: string;
  channel: Channel;
  destination: string;
  /** Renseigné seulement pour un chauffeur : voiture ou moto. */
  driverKind?: VehicleKind;
}

/**
 * Crée le compte et, s'il s'agit d'un chauffeur, son dossier — dans une seule transaction.
 * Un chauffeur sans dossier ne pourrait ni se mettre en ligne ni être validé par l'ops :
 * les deux lignes naissent ensemble ou pas du tout.
 */
export async function createUser(input: CreateUserInput): Promise<{
  user: User;
  driverProfile: DriverProfile | null;
}> {
  return db.transaction(async (tx) => {
    const verifiedAt = new Date();
    const [user] = await tx
      .insert(users)
      .values({
        voraId: input.voraId,
        role: input.role,
        displayName: input.displayName,
        phone: input.channel === 'phone' ? input.destination : null,
        phoneVerifiedAt: input.channel === 'phone' ? verifiedAt : null,
        email: input.channel === 'email' ? input.destination : null,
        emailVerifiedAt: input.channel === 'email' ? verifiedAt : null,
        lastSeenAt: verifiedAt,
      })
      .returning();

    if (!user) throw new Error("Création du compte : aucune ligne renvoyée par l'insertion.");

    if (input.role !== 'driver') return { user, driverProfile: null };

    const [driverProfile] = await tx
      .insert(driverProfiles)
      .values({
        userId: user.id,
        kind: input.driverKind ?? 'car',
        // Le dossier reste `pending` : un chauffeur non validé ne prend pas de course.
        status: 'pending',
      })
      .returning();

    return { user, driverProfile: driverProfile ?? null };
  });
}

export interface UpdateUserPatch {
  displayName?: string;
  familyName?: string;
  sex?: Sex | null;
  /** Date ISO (AAAA-MM-JJ) : la colonne est un `date`, sans heure ni fuseau. */
  birthDate?: string | null;
  locale?: string;
  /** Écrite par l'envoi de photo seulement — jamais depuis un corps de requête. */
  photoKey?: string | null;
  onboardedAt?: Date;
}

export async function updateUser(id: string, patch: UpdateUserPatch): Promise<User | null> {
  const [row] = await db
    .update(users)
    .set({
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.familyName !== undefined ? { familyName: patch.familyName } : {}),
      ...(patch.sex !== undefined ? { sex: patch.sex } : {}),
      ...(patch.birthDate !== undefined ? { birthDate: patch.birthDate } : {}),
      ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
      ...(patch.photoKey !== undefined ? { photoKey: patch.photoKey } : {}),
      ...(patch.onboardedAt !== undefined ? { onboardedAt: patch.onboardedAt } : {}),
    })
    .where(eq(users.id, id))
    .returning();
  return row ?? null;
}

/**
 * Rattache un canal vérifié à un compte existant (le passager inscrit par téléphone
 * ajoute son e-mail, ou l'inverse).
 */
export async function attachVerifiedChannel(
  id: string,
  channel: Channel,
  destination: string,
): Promise<User | null> {
  const verifiedAt = new Date();
  const [row] = await db
    .update(users)
    .set(
      channel === 'phone'
        ? { phone: destination, phoneVerifiedAt: verifiedAt }
        : { email: destination, emailVerifiedAt: verifiedAt },
    )
    .where(eq(users.id, id))
    .returning();
  return row ?? null;
}

export async function touchLastSeen(id: string): Promise<void> {
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, id));
}

// ─── Codes de vérification ───────────────────────────────────────────────────

export interface CreateChallengeInput {
  channel: Channel;
  destination: string;
  codeHash: string;
  maxAttempts: number;
  expiresAt: Date;
  requestIp?: string;
}

export async function createOtpChallenge(input: CreateChallengeInput): Promise<OtpChallenge> {
  const [row] = await db
    .insert(otpChallenges)
    .values({
      channel: input.channel,
      destination: input.destination,
      codeHash: input.codeHash,
      maxAttempts: input.maxAttempts,
      expiresAt: input.expiresAt,
      requestIp: input.requestIp ?? null,
    })
    .returning();
  if (!row) throw new Error('Création du défi OTP : aucune ligne renvoyée.');
  return row;
}

/**
 * Invalide les codes encore ouverts pour cette destination : demander un nouveau code
 * annule le précédent, sinon deux codes valides circuleraient en même temps.
 */
export async function consumePendingChallenges(destination: string): Promise<void> {
  await db
    .update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpChallenges.destination, destination), isNull(otpChallenges.consumedAt)));
}

/** Le dernier code émis pour cette destination, consommé ou non. */
export async function findLatestChallenge(destination: string): Promise<OtpChallenge | null> {
  const [row] = await db
    .select()
    .from(otpChallenges)
    .where(eq(otpChallenges.destination, destination))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);
  return row ?? null;
}

/** Combien de codes ont été demandés pour cette destination depuis `since` (anti-abus). */
export async function countChallengesSince(destination: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(otpChallenges)
    .where(and(eq(otpChallenges.destination, destination), gte(otpChallenges.createdAt, since)));
  return row?.total ?? 0;
}

export async function incrementChallengeAttempts(id: string): Promise<void> {
  await db
    .update(otpChallenges)
    .set({ attempts: sql`${otpChallenges.attempts} + 1` })
    .where(eq(otpChallenges.id, id));
}

export async function markChallengeConsumed(id: string): Promise<void> {
  await db
    .update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(otpChallenges.id, id));
}

// ─── Appareils ───────────────────────────────────────────────────────────────

export interface DeviceInput {
  platform: 'android' | 'ios' | 'web';
  push_token?: string;
  app_version?: string;
  model?: string;
}

/**
 * Enregistre l'appareil. Un jeton de notification n'appartient qu'à un compte à la fois :
 * s'il change de main (téléphone prêté, réinstallation), il suit le dernier connecté.
 */
export async function registerDevice(userId: string, device: DeviceInput): Promise<void> {
  const values = {
    userId,
    platform: device.platform,
    pushToken: device.push_token ?? null,
    appVersion: device.app_version ?? null,
    model: device.model ?? null,
    lastSeenAt: new Date(),
  };

  if (!device.push_token) {
    await db.insert(devices).values(values);
    return;
  }

  await db
    .insert(devices)
    .values(values)
    .onConflictDoUpdate({
      target: devices.pushToken,
      set: {
        userId,
        platform: values.platform,
        appVersion: values.appVersion,
        model: values.model,
        lastSeenAt: values.lastSeenAt,
      },
    });
}

// ─── Dossier chauffeur (lecture pour /v1/me) ─────────────────────────────────

export async function findDriverProfile(userId: string): Promise<DriverProfile | null> {
  const [row] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}

/** Véhicule courant du chauffeur, ou à défaut son premier véhicule actif. */
export async function findDriverVehicle(
  driverId: string,
  currentVehicleId: string | null,
): Promise<Vehicle | null> {
  if (currentVehicleId) {
    const [row] = await db.select().from(vehicles).where(eq(vehicles.id, currentVehicleId)).limit(1);
    if (row) return row;
  }

  const [fallback] = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.driverId, driverId), eq(vehicles.active, true)))
    .orderBy(vehicles.createdAt)
    .limit(1);
  return fallback ?? null;
}

// ─── Contacts de confiance ───────────────────────────────────────────────────

export async function listTrustedContacts(userId: string): Promise<TrustedContact[]> {
  return db
    .select()
    .from(trustedContacts)
    .where(eq(trustedContacts.userId, userId))
    .orderBy(trustedContacts.createdAt);
}

/**
 * REMPLACE la liste des contacts de confiance, en une transaction.
 *
 * Remplacer plutôt qu'ajouter : l'écran PA-07 montre trois lignes qu'on édite ensemble,
 * et un envoi partiel après une coupure réseau doit pouvoir être rejoué sans créer de
 * doublon. Une liste vide efface — c'est le sens de « je retire mes contacts ».
 */
export async function replaceTrustedContacts(
  userId: string,
  contacts: Array<{ name: string; phone: string }>,
): Promise<TrustedContact[]> {
  return db.transaction(async (tx) => {
    await tx.delete(trustedContacts).where(eq(trustedContacts.userId, userId));
    if (contacts.length === 0) return [];

    return tx
      .insert(trustedContacts)
      .values(contacts.map((contact) => ({ userId, ...contact })))
      .returning();
  });
}

// ─── Images ──────────────────────────────────────────────────────────────────

/** Les octets et leurs métadonnées. Lu par `GET /v1/media/:id`. */
export async function findMedia(id: string): Promise<Media | null> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row ?? null;
}

/**
 * Enregistre une image et REMPLACE la précédente du même usage, en une transaction.
 *
 * Remplacer plutôt qu'empiler : sans cela, chaque changement d'avatar laisserait une
 * ligne de 60 Ko derrière lui, et la table grossirait d'images que plus personne ne
 * référence. Le tout est transactionnel avec la mise à jour de `users.photo_key` — on ne
 * peut pas se retrouver avec une clé qui pointe sur une ligne supprimée.
 */
export async function replaceMedia(input: {
  ownerId: string;
  purpose: MediaPurpose;
  mime: ImageMimeType;
  bytes: Buffer;
  sha256: string;
}): Promise<Media> {
  return db.transaction(async (tx) => {
    await tx
      .delete(media)
      .where(and(eq(media.ownerId, input.ownerId), eq(media.purpose, input.purpose)));

    const [row] = await tx
      .insert(media)
      .values({
        ownerId: input.ownerId,
        purpose: input.purpose,
        mime: input.mime,
        sizeBytes: input.bytes.byteLength,
        sha256: input.sha256,
        bytes: input.bytes,
      })
      .returning();

    if (!row) throw new Error("Enregistrement de l'image : aucune ligne renvoyée.");

    if (input.purpose === 'avatar') {
      await tx.update(users).set({ photoKey: row.id }).where(eq(users.id, input.ownerId));
    }

    return row;
  });
}

/** Retire l'image de ce type et la clé qui la référence. */
export async function deleteMedia(ownerId: string, purpose: MediaPurpose): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(media).where(and(eq(media.ownerId, ownerId), eq(media.purpose, purpose)));
    if (purpose === 'avatar') {
      await tx.update(users).set({ photoKey: null }).where(eq(users.id, ownerId));
    }
  });
}
