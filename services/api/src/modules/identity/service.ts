// VORA — logique du module identity : demander un code, le vérifier, ouvrir la session.
//
// Le service ne connaît ni Fastify ni HTTP : il reçoit ce dont il a besoin (de quoi signer
// un jeton, de quoi journaliser) et renvoie des DTO. C'est ce qui permet de le tester sans
// serveur, et de le déplacer vers NestJS après le hackathon sans le réécrire.

import { AppError } from '../../lib/errors.js';
import { sha256Hex } from '../../lib/crypto.js';
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  sniffImageType,
  type ImageMimeType,
} from '../../lib/images.js';
import { config } from '../../lib/config.js';
import type { UserRole } from '../../db/schema.js';
import type { VehicleKind } from '../../domain/rules.js';
import {
  maskDestination,
  normalizeDestination,
  normalizePhone,
  type Channel,
} from './channels.js';
import { isPlausibleBirthDate } from '../../domain/profile.js';
import { photoUrl, toMeDto } from './dto.js';
import { generateOtpCode, hashOtpCode, verifyOtpCode } from './otp.js';
import * as repository from './repository.js';
import type { DeviceInput } from './repository.js';
import type {
  MeDto,
  OnboardingBody,
  OtpRequestResponse,
  OtpVerifyResponse,
  UpdateMeBody,
} from './schemas.js';
import { allocateVoraId } from './vora-id.js';

/** Juste ce qu'il faut d'un logger pino : le service n'en demande pas plus. */
export interface ServiceLogger {
  info: (details: Record<string, unknown>, message: string) => void;
  warn: (details: Record<string, unknown>, message: string) => void;
}

/** Combien de codes on accepte d'émettre pour une même destination, et sur quelle fenêtre. */
const MAX_CHALLENGES_PER_WINDOW = 5;
const CHALLENGE_WINDOW_S = 600;

/** « 24h » → 86400. Le client a besoin d'une durée en secondes, pas d'une chaîne. */
export function durationToSeconds(duration: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(duration.trim());
  if (!match) return 86_400;
  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86_400;
  return value * multiplier;
}

/** Un e-mail contient une arobase, un numéro non : inutile de faire redire le canal au client. */
export function channelOf(value: string): Channel {
  return value.includes('@') ? 'email' : 'phone';
}

// ─── Demande de code ─────────────────────────────────────────────────────────

export interface RequestOtpInput {
  channel: Channel;
  value: string;
  ip?: string;
  logger: ServiceLogger;
}

export async function requestOtp(input: RequestOtpInput): Promise<OtpRequestResponse> {
  const destination = normalizeDestination(input.channel, input.value);
  const masked = maskDestination(input.channel, destination);

  const since = new Date(Date.now() - CHALLENGE_WINDOW_S * 1000);
  const recent = await repository.countChallengesSince(destination, since);
  if (recent >= MAX_CHALLENGES_PER_WINDOW) {
    throw new AppError(
      'TOO_MANY_REQUESTS',
      'Trop de demandes de code pour ce contact. Patientez quelques minutes avant de réessayer.',
      { retry_after_s: CHALLENGE_WINDOW_S },
    );
  }

  // Un nouveau code annule le précédent : deux codes valides en circulation, c'est un code
  // qui traîne dans un SMS et qui ouvre encore la porte.
  await repository.consumePendingChallenges(destination);

  const code = generateOtpCode({ enabled: config.DEMO_MODE, code: config.DEMO_OTP_CODE });
  const expiresAt = new Date(Date.now() + config.OTP_TTL_S * 1000);

  const challenge = await repository.createOtpChallenge({
    channel: input.channel,
    destination,
    codeHash: hashOtpCode(code, config.JWT_SECRET),
    maxAttempts: config.OTP_MAX_ATTEMPTS,
    expiresAt,
    requestIp: input.ip,
  });

  if (config.DEMO_MODE) {
    // Écart assumé et borné du hackathon : aucun agrégateur SMS n'est contractualisable
    // en 48 h (CLAUDE.md § 8.2). Le code est affiché en clair pour que le jury le lise.
    input.logger.info(
      { destination: masked, otp_code: code, challenge_id: challenge.id },
      `[DÉMO] Code de vérification pour ${masked} : ${code}`,
    );
  } else {
    // En production, le code part par SMS ou e-mail et n'apparaît jamais dans un journal.
    input.logger.info({ destination: masked, challenge_id: challenge.id }, 'Code de vérification émis');
  }

  return {
    challenge_id: challenge.id,
    channel: input.channel,
    destination_masked: masked,
    expires_at: expiresAt.toISOString(),
    expires_in_s: config.OTP_TTL_S,
    demo_mode: config.DEMO_MODE,
    demo_code: config.DEMO_MODE ? code : null,
  };
}

// ─── Vérification et ouverture de session ────────────────────────────────────

export interface VerifyOtpInput {
  value: string;
  code: string;
  role: 'passenger' | 'driver';
  displayName?: string;
  driverKind?: VehicleKind;
  device?: DeviceInput;
  logger: ServiceLogger;
  /** Signature du jeton, fournie par la route (c'est Fastify qui détient la clé). */
  signToken: (payload: { sub: string; vora_id: string; role: UserRole }) => string;
}

const DEFAULT_DISPLAY_NAME: Record<'passenger' | 'driver', string> = {
  passenger: 'Passager',
  driver: 'Chauffeur',
};

export async function verifyOtp(input: VerifyOtpInput): Promise<OtpVerifyResponse> {
  const channel = channelOf(input.value);
  const destination = normalizeDestination(channel, input.value);

  const challenge = await repository.findLatestChallenge(destination);
  if (!challenge) {
    throw new AppError(
      'OTP_NOT_FOUND',
      "Aucun code n'a été demandé pour ce contact. Demandez-en un, puis saisissez-le.",
    );
  }

  const verdict = verifyOtpCode(
    {
      id: challenge.id,
      codeHash: challenge.codeHash,
      attempts: challenge.attempts,
      maxAttempts: challenge.maxAttempts,
      expiresAt: challenge.expiresAt,
      consumedAt: challenge.consumedAt,
    },
    input.code,
    config.JWT_SECRET,
  );

  if (!verdict.ok) {
    // Seul un code faux consomme un essai : l'écriture n'a lieu que dans ce cas.
    if (verdict.countsAsAttempt) {
      await repository.incrementChallengeAttempts(challenge.id);
      input.logger.warn(
        { destination: maskDestination(channel, destination), challenge_id: challenge.id },
        'Code de vérification refusé',
      );
    }
    throw verdict.error;
  }

  // Le code est bon : il ne servira plus, quoi qu'il arrive ensuite.
  await repository.markChallengeConsumed(challenge.id);

  const existing = await repository.findUserByDestination(channel, destination);
  const isNewAccount = existing === null;

  const user = existing
    ? assertUsable(existing, input.role)
    : (
        await repository.createUser({
          voraId: await allocateVoraId(repository.isVoraIdTaken),
          role: input.role,
          displayName: input.displayName ?? DEFAULT_DISPLAY_NAME[input.role],
          channel,
          destination,
          driverKind: input.driverKind,
        })
      ).user;

  // Un nom fourni à la connexion d'un compte déjà créé met simplement le profil à jour.
  const named =
    !isNewAccount && input.displayName && input.displayName !== user.displayName
      ? ((await repository.updateUser(user.id, { displayName: input.displayName })) ?? user)
      : user;

  if (input.device) await repository.registerDevice(named.id, input.device);
  await repository.touchLastSeen(named.id);

  input.logger.info(
    { vora_id: named.voraId, role: named.role, new_account: isNewAccount },
    isNewAccount ? 'Compte créé' : 'Connexion',
  );

  return {
    access_token: input.signToken({ sub: named.id, vora_id: named.voraId, role: named.role }),
    token_type: 'Bearer',
    expires_in: durationToSeconds(config.JWT_EXPIRES_IN),
    is_new_account: isNewAccount,
    user: await composeMe(named.id, named.role),
  };
}

/** Un compte suspendu ne se reconnecte pas, et un rôle ne change pas en route. */
function assertUsable(
  user: Awaited<ReturnType<typeof repository.findUserById>>,
  requestedRole: 'passenger' | 'driver',
) {
  if (!user) throw new AppError('NOT_FOUND', 'Ce compte est introuvable.');

  if (user.status === 'suspended') {
    throw new AppError(
      'ACCOUNT_SUSPENDED',
      'Ce compte est suspendu. Contactez le support VORA pour le réactiver.',
    );
  }
  if (user.status === 'deleted') {
    throw new AppError(
      'ACCOUNT_SUSPENDED',
      'Ce compte a été supprimé. Créez-en un nouveau avec un autre contact.',
    );
  }

  // Un compte ops se connecte par le même point d'entrée, avec son rôle réel.
  if (user.role !== 'ops' && user.role !== requestedRole) {
    throw new AppError(
      'ROLE_MISMATCH',
      user.role === 'driver'
        ? "Ce contact est déjà celui d'un compte chauffeur. Ouvrez l'application VORA Chauffeur."
        : "Ce contact est déjà celui d'un compte passager. Ouvrez l'application VORA.",
      { account_role: user.role, requested_role: requestedRole },
    );
  }

  return user;
}

// ─── Profil ──────────────────────────────────────────────────────────────────

/** Assemble /v1/me : compte, dossier chauffeur, véhicule courant. */
export async function composeMe(userId: string, role: UserRole): Promise<MeDto> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AppError('NOT_FOUND', 'Ce compte est introuvable. Reconnectez-vous.');
  }

  const trustedContacts = await repository.listTrustedContacts(userId);

  if (role !== 'driver') return toMeDto({ user, trustedContacts });

  const driverProfile = await repository.findDriverProfile(userId);
  const vehicle = driverProfile
    ? await repository.findDriverVehicle(userId, driverProfile.currentVehicleId)
    : null;

  return toMeDto({ user, driverProfile, vehicle, trustedContacts });
}

// ─── Onboarding (PA-05 → PA-07) ──────────────────────────────────────────────

/**
 * Enregistre le profil personnel, en UN SEUL appel.
 *
 * Pourquoi un appel unique plutôt qu'un PATCH par écran : sur une 3G de Yaoundé, quatre
 * requêtes sont quatre occasions d'échouer au milieu, et un compte à moitié rempli est
 * pire qu'un compte vide — on ne sait plus quoi redemander. Ici, ou tout est écrit, ou
 * rien ne l'est, et l'appel se rejoue à l'identique après une coupure.
 *
 * Rejouable aussi depuis l'écran Profil : le dernier envoi fait foi, y compris pour les
 * contacts de confiance, qui sont REMPLACÉS et non ajoutés.
 */
export async function completeOnboarding(
  userId: string,
  body: OnboardingBody,
): Promise<MeDto> {
  const user = await repository.findUserById(userId);
  if (!user) throw new AppError('NOT_FOUND', 'Ce compte est introuvable. Reconnectez-vous.');

  // Garde-fou de SAISIE, pas règle d'âge : une date dans le futur ou un âge de 150 ans
  // est une faute de frappe (voir `domain/profile.ts`).
  if (body.birth_date && !isPlausibleBirthDate(new Date(`${body.birth_date}T00:00:00Z`))) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Cette date de naissance ne semble pas correcte. Vérifiez le jour, le mois et l\u2019année.',
      { field: 'birth_date' },
    );
  }

  // Les numéros des contacts passent par la MÊME normalisation que ceux des comptes :
  // « 6 91 23 45 67 » et « +237691234567 » sont un seul contact. Sans cela, l'index
  // unique refuserait le doublon avec un message que personne ne peut comprendre.
  const contacts = body.trusted_contacts?.map((contact) => ({
    name: contact.name,
    phone: normalizePhone(contact.phone),
  }));

  if (contacts) {
    const uniques = new Set(contacts.map((contact) => contact.phone));
    if (uniques.size !== contacts.length) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Deux de vos contacts ont le même numéro. Retirez-en un, puis réessayez.',
        { field: 'trusted_contacts' },
      );
    }
  }

  const updated = await repository.updateUser(userId, {
    displayName: body.first_name,
    familyName: body.family_name,
    sex: body.sex ?? null,
    birthDate: body.birth_date ?? null,
    ...(body.locale !== undefined ? { locale: body.locale } : {}),
    ...(body.photo_key !== undefined ? { photoKey: body.photo_key } : {}),
    onboardedAt: new Date(),
  });

  if (!updated) throw new AppError('NOT_FOUND', 'Ce compte est introuvable. Reconnectez-vous.');

  // `undefined` = l'écran des contacts n'a pas été envoyé (« Plus tard ») : on ne touche
  // à rien. Une liste VIDE, elle, est une décision : elle efface.
  if (contacts) await repository.replaceTrustedContacts(userId, contacts);

  return composeMe(updated.id, updated.role);
}

export async function getMe(userId: string): Promise<MeDto> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AppError('NOT_FOUND', 'Ce compte est introuvable. Reconnectez-vous.');
  }
  return composeMe(user.id, user.role);
}

export async function updateMe(userId: string, patch: UpdateMeBody): Promise<MeDto> {
  const updated = await repository.updateUser(userId, {
    displayName: patch.display_name,
    locale: patch.locale,
    photoKey: patch.photo_key,
  });

  if (!updated) {
    throw new AppError('NOT_FOUND', 'Ce compte est introuvable. Reconnectez-vous.');
  }

  return composeMe(updated.id, updated.role);
}

/**
 * Les contacts de confiance d'une personne, AVEC leur numéro entier.
 *
 * Un seul appelant légitime : l'alerte SOS, qui les transmet à l'ops pour qu'une équipe
 * humaine les appelle. C'est la seule sortie de l'API où ces numéros apparaissent en
 * clair, et elle ne va que dans la salle `ops` (CLAUDE.md § 5.6 protège l'autre PARTIE
 * d'une course ; l'ops, lui, doit pouvoir décrocher son téléphone).
 *
 * Partout ailleurs — `GET /v1/me` compris — c'est `toTrustedContactDto` qui répond, et
 * il masque.
 */
export async function trustedContactsForAlert(
  userId: string,
): Promise<Array<{ name: string; phone: string }>> {
  const contacts = await repository.listTrustedContacts(userId);
  return contacts.map((contact) => ({ name: contact.name, phone: contact.phone }));
}

// ─── Photo de profil ─────────────────────────────────────────────────────────

export interface UploadedPhoto {
  photo_key: string;
  photo_url: string;
  mime: ImageMimeType;
  size_bytes: number;
}

/**
 * Enregistre la photo de profil.
 *
 * Le TYPE VIENT DES OCTETS, pas de l'en-tête `Content-Type` : celui-ci est envoyé par le
 * client, donc par n'importe qui, et un fichier HTML annoncé « image/jpeg » serait
 * resservi plus tard à un navigateur (voir `lib/images.ts`). On lit le nombre magique, et
 * c'est lui qui décide de ce qu'on stocke et de ce qu'on renverra.
 */
export async function uploadPhoto(userId: string, bytes: Buffer): Promise<UploadedPhoto> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Cette photo est trop lourde. Réduisez-la à 512 pixels de côté, puis réessayez.',
      { max_bytes: MAX_IMAGE_BYTES, received_bytes: bytes.byteLength },
    );
  }

  const mime = sniffImageType(bytes);
  if (!mime) {
    throw new AppError(
      'VALIDATION_ERROR',
      "Ce fichier n'est pas une image. Choisissez une photo au format JPEG, PNG ou WebP.",
      { accepted: IMAGE_MIME_TYPES },
    );
  }

  const row = await repository.replaceMedia({
    ownerId: userId,
    purpose: 'avatar',
    mime,
    bytes,
    sha256: sha256Hex(bytes.toString('base64')),
  });

  return {
    photo_key: row.id,
    photo_url: photoUrl(row.id)!,
    mime: row.mime,
    size_bytes: row.sizeBytes,
  };
}

export async function removePhoto(userId: string): Promise<MeDto> {
  await repository.deleteMedia(userId, 'avatar');
  const user = await repository.findUserById(userId);
  if (!user) throw new AppError('NOT_FOUND', 'Ce compte est introuvable. Reconnectez-vous.');
  return composeMe(user.id, user.role);
}

/**
 * Les octets d'une image, pour `GET /v1/media/:id`.
 *
 * Aucun contrôle de propriétaire, et c'est VOULU : une photo de profil est faite pour
 * être vue par l'autre partie de la course — c'est même une règle de la charte (le
 * passager voit le visage de son chauffeur avant de monter). Les deux barrières sont
 * ailleurs : la route exige un jeton valide, et l'identifiant est un UUID, qui ne se
 * devine pas. Vérifier en plus « êtes-vous sur une course avec cette personne ? »
 * coûterait une requête à chaque affichage d'avatar, pour une donnée que l'application
 * montre de toute façon.
 */
export async function readMedia(id: string) {
  const row = await repository.findMedia(id);
  if (!row) throw new AppError('NOT_FOUND', "Cette image n'existe pas.");
  return row;
}
