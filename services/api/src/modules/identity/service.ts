// VORA — logique du module identity : demander un code, le vérifier, ouvrir la session.
//
// Le service ne connaît ni Fastify ni HTTP : il reçoit ce dont il a besoin (de quoi signer
// un jeton, de quoi journaliser) et renvoie des DTO. C'est ce qui permet de le tester sans
// serveur, et de le déplacer vers NestJS après le hackathon sans le réécrire.

import { AppError } from '../../lib/errors.js';
import { config } from '../../lib/config.js';
import type { UserRole } from '../../db/schema.js';
import type { VehicleKind } from '../../domain/rules.js';
import {
  maskDestination,
  normalizeDestination,
  type Channel,
} from './channels.js';
import { toMeDto } from './dto.js';
import { generateOtpCode, hashOtpCode, verifyOtpCode } from './otp.js';
import * as repository from './repository.js';
import type { DeviceInput } from './repository.js';
import type { MeDto, OtpRequestResponse, OtpVerifyResponse, UpdateMeBody } from './schemas.js';
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

  if (role !== 'driver') return toMeDto({ user });

  const driverProfile = await repository.findDriverProfile(userId);
  const vehicle = driverProfile
    ? await repository.findDriverVehicle(userId, driverProfile.currentVehicleId)
    : null;

  return toMeDto({ user, driverProfile, vehicle });
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
