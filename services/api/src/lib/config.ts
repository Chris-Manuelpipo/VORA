// VORA — configuration de l'API. Une seule lecture de l'environnement, validée par zod.
// Toute variable manquante ou aberrante arrête le processus au démarrage avec un message
// qui dit quoi corriger, plutôt qu'un `undefined` qui explose au milieu d'une démo.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Le `.env` vit à la racine du dépôt, mais l'API démarre depuis `services/api`.
 * On remonte donc jusqu'à le trouver, au lieu de dépendre du répertoire courant.
 */
function loadDotEnv(): string | null {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(directory, '.env');
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return candidate;
    }
    directory = resolve(directory, '..');
  }
  return null;
}

export const envFile = loadDotEnv();

/** `DEMO_MODE=true` → booléen. Les .env sont du texte, jamais des booléens. */
const boolean = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback)
    .transform((value) => value === 'true' || value === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TZ: z.string().default('Africa/Douala'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL est absente : faites `cp .env.example .env` à la racine du dépôt.')
    .refine((url) => /^postgres(ql)?:\/\//.test(url), {
      message: 'DATABASE_URL doit ressembler à postgresql://vora:vora@localhost:5432/vora',
    }),

  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),

  JWT_SECRET: z.string().min(8, 'JWT_SECRET est trop court : openssl rand -hex 32'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  QUOTE_HMAC_SECRET: z.string().min(8, 'QUOTE_HMAC_SECRET est trop court : openssl rand -hex 32'),

  // Mode démonstration : code OTP fixe, renvoyé dans la réponse et écrit en clair dans les logs.
  DEMO_MODE: boolean('false'),
  DEMO_OTP_CODE: z.string().regex(/^\d{6}$/).default('123456'),

  // Durée de vie et tolérance d'un code de vérification.
  OTP_TTL_S: z.coerce.number().int().min(30).max(3600).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),

  QUOTE_TTL_S: z.coerce.number().int().min(30).default(120),

  OSRM_BASE_URL: z.string().url().default('https://router.project-osrm.org'),
  OSRM_PROFILE: z.string().default('driving'),
  OSRM_TIMEOUT_MS: z.coerce.number().int().min(200).default(2000),
  FALLBACK_DISTANCE_FACTOR: z.coerce.number().min(1).default(1.35),
  FALLBACK_SPEED_KMH: z.coerce.number().min(1).default(22),

  DISPATCH_OFFER_TIMEOUT_S: z.coerce.number().int().min(5).default(15),
  DISPATCH_MAX_WAVES: z.coerce.number().int().min(1).default(3),
  DISPATCH_RADII_KM: z.string().default('1,3,5'),
  DRIVER_POSITION_TTL_S: z.coerce.number().int().min(10).default(60),

  PAYMENT_PROVIDER: z.enum(['simulated']).default('simulated'),
  PAYMENT_SIMULATED_DELAY_MS: z.coerce.number().int().min(0).default(3000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `   · ${issue.path.join('.')} : ${issue.message}`)
    .join('\n');
  console.error(
    `\n\x1b[31m✗ Configuration invalide${envFile ? ` (${envFile})` : ' (aucun .env trouvé)'}\x1b[0m\n${details}\n`,
  );
  process.exit(1);
}

const raw = parsed.data;

export const config = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  dispatchRadiiKm: raw.DISPATCH_RADII_KM.split(',')
    .map((radius) => Number(radius.trim()))
    .filter((radius) => Number.isFinite(radius)),
} as const;

// Le mode démonstration n'a rien à faire en production : le code OTP y serait constant.
if (config.isProduction && config.DEMO_MODE) {
  console.error(
    '\n\x1b[31m✗ DEMO_MODE=true avec NODE_ENV=production : le code de vérification serait constant.\x1b[0m\n   Mettez DEMO_MODE=false.\n',
  );
  process.exit(1);
}

export type Config = typeof config;
