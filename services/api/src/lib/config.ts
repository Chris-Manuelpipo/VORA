// VORA — configuration de l'API. Une seule lecture de l'environnement, validée par zod.
// Toute variable manquante ou aberrante arrête le processus au démarrage avec un message
// qui dit quoi corriger, plutôt qu'un `undefined` qui explose au milieu d'une démo.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Le `.env` vit à la RACINE DU DÉPÔT, mais l'API démarre depuis `services/api`.
 * On remonte donc jusqu'à lui.
 *
 * Et on remonte jusqu'à la racine, pas jusqu'au premier `.env` rencontré : c'est ce même
 * fichier que lisent `scripts/db-setup.mjs` et `scripts/test-db.mjs`. Un `.env` oublié dans
 * `services/api/` ferait travailler l'API sur une base et l'outillage sur une autre, sans
 * le moindre message. La racine se reconnaît à son `.git` ; à défaut (image Docker, tarball
 * sans historique), on retombe sur le premier `.env` trouvé.
 */
function loadDotEnv(): string | null {
  let directory = dirname(fileURLToPath(import.meta.url));
  let nearest: string | null = null;

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(directory, '.env');
    const isRepositoryRoot = existsSync(resolve(directory, '.git'));

    if (existsSync(candidate)) {
      if (isRepositoryRoot) {
        dotenv.config({ path: candidate });
        return candidate;
      }
      nearest ??= candidate;
    }

    if (isRepositoryRoot) break;
    directory = resolve(directory, '..');
  }

  if (nearest) {
    dotenv.config({ path: nearest });
    return nearest;
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

  /**
   * Jeton des endpoints de pilotage de la démonstration (`/v1/demo/*`). Ces routes ne
   * sont montées que si DEMO_MODE=true, et DEMO_MODE est interdit en production : le
   * jeton protège donc surtout d'un camarade facétieux sur le réseau du hackathon.
   */
  DEMO_CONTROL_TOKEN: z.string().min(4).default('vora-demo'),
  /** Accélération de la course simulée : ×8 par défaut. Une course de 20 min en 2 min 30. */
  DEMO_RIDE_SPEEDUP: z.coerce.number().min(1).max(60).default(8),
  /** Le chauffeur simulé accepte entre 4 et 8 s : assez pour qu'on voie le compte à rebours. */
  DEMO_ACCEPT_MIN_S: z.coerce.number().min(0).default(4),
  DEMO_ACCEPT_MAX_S: z.coerce.number().min(0).default(8),
  /** Pause après « Je suis arrivé », le temps de montrer le code sur le téléphone. */
  DEMO_BOARDING_PAUSE_S: z.coerce.number().min(0).default(6),

  // Durée de vie et tolérance d'un code de vérification.
  OTP_TTL_S: z.coerce.number().int().min(30).max(3600).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),

  QUOTE_TTL_S: z.coerce.number().int().min(30).default(120),

  /**
   * Base des URL publiques — lien de partage ouvert par un proche dans un navigateur, hors
   * de l'application : il lui faut une adresse joignable de l'EXTÉRIEUR, pas l'hôte interne
   * sur lequel l'API écoute. Sert aussi aux photos de profil.
   *
   * La barre oblique finale est retirée ICI, à la lecture de l'environnement, et pas dans
   * chaque appelant. Elle a coûté une panne réelle : `https://vora.cleverapps.io/` collée
   * depuis une barre d'adresse produisait `…io//v1/share/<token>`, qui répond 404. L'API
   * répondait 200 partout, les journaux étaient vides, et seul le proche qui ouvrait le
   * lien voyait l'erreur — depuis un téléphone qui n'a même pas l'application.
   *
   * Deuxième ceinture dans `lib/urls.ts` : `publicUrl()` recolle base et chemin sans
   * jamais doubler la barre. Les deux disent la même chose ; ce fichier ne peut pas
   * importer `urls.ts`, qui dépend de lui.
   */
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .default('http://localhost:3000')
    .transform((url) => url.replace(/\/+$/, '')),
  // Un trajet partagé reste consultable quelques heures : le temps du trajet, plus la
  // marge pour que le proche ouvre le lien après coup. Au-delà, le jeton ne vaut plus rien.
  SHARE_LINK_TTL_S: z.coerce.number().int().min(300).default(4 * 3600),

  OSRM_BASE_URL: z.string().url().default('https://router.project-osrm.org'),
  OSRM_PROFILE: z.string().default('driving'),
  OSRM_TIMEOUT_MS: z.coerce.number().int().min(200).default(2000),
  // Interrupteur de démonstration : `false` force le repli haversine sans toucher au
  // réseau. CLAUDE.md § 3 demande d'avoir essayé le repli AVANT de passer devant le
  // jury ; sans ce drapeau, l'essayer demande de débrancher le wifi de la salle.
  OSRM_ENABLED: boolean('true'),
  FALLBACK_DISTANCE_FACTOR: z.coerce.number().min(1).default(1.35),
  FALLBACK_SPEED_KMH: z.coerce.number().min(1).default(22),

  DISPATCH_OFFER_TIMEOUT_S: z.coerce.number().int().min(5).default(15),
  DISPATCH_MAX_WAVES: z.coerce.number().int().min(1).default(3),
  DISPATCH_RADII_KM: z.string().default('1,3,5'),
  DRIVER_POSITION_TTL_S: z.coerce.number().int().min(10).default(60),

  PAYMENT_PROVIDER: z.enum(['simulated']).default('simulated'),
  PAYMENT_SIMULATED_DELAY_MS: z.coerce.number().int().min(0).default(3000),

  // ─── Assistant de support (module isolé, hors chemin critique) ─────────────
  //
  // Les quatre variables sont VIDES par défaut, et c'est délibéré : sans elles,
  // `POST /v1/support/ask` répond quand même, à partir de la FAQ seule. Un support qui
  // se tait parce qu'une clé manque ne serait pas un support.

  /**
   * `false` (défaut) : l'assistant répond uniquement à partir de la FAQ, sans réseau.
   * `true` : il tente d'abord le modèle distant, et retombe sur la FAQ au moindre
   * problème (clé absente, appel en échec, délai dépassé).
   */
  LLM_ENABLED: boolean('false'),
  /** Racine d'une API compatible OpenAI, sans `/chat/completions`. Vide → FAQ seule. */
  LLM_BASE_URL: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  /** Secret. Absent → FAQ seule, sans erreur et sans appel réseau. */
  LLM_API_KEY: z.string().default(''),

  // ─── Déploiement ───────────────────────────────────────────────────────────

  /**
   * Empreinte du commit déployé, exposée par `GET /health`. Clever Cloud renseigne
   * `COMMIT_ID` tout seul sur un déploiement git : savoir QUELLE version répond est la
   * première question qu'on se pose quand quelque chose ne va pas.
   */
  COMMIT_ID: z.string().default('inconnu'),

  /**
   * Sert `GET /openapi.json` et `GET /docs`. Vrai par défaut : le développeur frontend
   * travaille sur une autre machine, et une API dont on ne peut pas lire le contrat lui
   * coûte un aller-retour par question. `false` referme les deux routes d'un coup.
   */
  DOCS_ENABLED: boolean('true'),

  /**
   * TLS vers PostgreSQL. Les add-ons gérés présentent souvent un certificat que Node ne
   * reconnaît pas : `DATABASE_SSL=true` chiffre la connexion sans exiger cette chaîne de
   * confiance. C'est un compromis, et il est explicite — on ne l'active pas par défaut,
   * et jamais sur une base locale.
   */
  DATABASE_SSL: boolean('false'),

  /**
   * Délai pour ÉTABLIR une connexion à PostgreSQL.
   *
   * 5 s suffisaient pour une base locale, où la connexion prend 5 ms. Contre une base
   * gérée et distante, la seule poignée de main TLS coûte 0,8 à 2 s (mesuré sur
   * Clever Cloud depuis Yaoundé), et l'authentification SCRAM ajoute trois allers-retours
   * par-dessus : le budget était trop juste, et `npm run seed` échouait sur un
   * « Connection terminated due to connection timeout » qui n'accusait rien de précis.
   *
   * 10 s ne coûtent rien en local — ce délai ne se déclenche que si quelque chose ne va
   * pas — et `GET /health` garde sa propre limite de 2 s, donc la supervision reste vive.
   */
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),

  /**
   * Applique les migrations au démarrage. Vrai par défaut, y compris en local où c'est
   * un no-op de quelques millisecondes : une base en retard sur le code est un bug qu'on
   * découvre au pire moment. `false` pour un déploiement où les migrations sont jouées
   * par une étape séparée.
   */
  MIGRATE_ON_BOOT: boolean('true'),
});

/**
 * Clever Cloud publie l'URI de l'add-on PostgreSQL sous `POSTGRESQL_ADDON_URI`, et non
 * sous `DATABASE_URL`. On accepte les deux plutôt que d'obliger à recopier une chaîne de
 * connexion à la main dans la console : une chaîne recopiée est une chaîne qui finit par
 * pointer sur l'ancienne base après une restauration.
 */
const environment = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || process.env.POSTGRESQL_ADDON_URI,
};

const parsed = schema.safeParse(environment);

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

/** Refuse de démarrer, avec la correction exacte à appliquer. */
function refuse(problem: string, fix: string): never {
  console.error(`\n\x1b[31m✗ ${problem}\x1b[0m\n   ${fix}\n`);
  process.exit(1);
}

// Le mode démonstration n'a rien à faire en production : le code OTP y serait constant.
if (config.isProduction && config.DEMO_MODE) {
  refuse(
    'DEMO_MODE=true avec NODE_ENV=production : le code de vérification serait constant.',
    'Mettez DEMO_MODE=false.',
  );
}

// ─── Garde-fous de déploiement ───────────────────────────────────────────────
//
// Ils ne servent qu'en production, et ils servent tous à la même chose : transformer une
// erreur silencieuse — une API injoignable, un jeton signé avec la clé d'exemple — en un
// refus de démarrer, lisible dans les journaux au premier essai.

if (config.isProduction) {
  // Une plateforme comme Clever Cloud route le trafic vers le conteneur : écouter sur la
  // boucle locale rend l'application injoignable, et le symptôme est un contrôle de
  // santé qui échoue sans la moindre erreur applicative. C'est long à diagnostiquer.
  if (['127.0.0.1', 'localhost', '::1'].includes(config.HOST)) {
    refuse(
      `HOST=${config.HOST} en production : l'API ne serait joignable que depuis son propre conteneur.`,
      'Laissez HOST vide (0.0.0.0 par défaut) ou mettez HOST=0.0.0.0.',
    );
  }

  // Les valeurs d'exemple de `.env.example` signent de vrais jetons et de vrais devis.
  for (const [name, value] of [
    ['JWT_SECRET', config.JWT_SECRET],
    ['QUOTE_HMAC_SECRET', config.QUOTE_HMAC_SECRET],
  ] as const) {
    if (value.includes('changeme')) {
      refuse(
        `${name} porte encore la valeur d'exemple : n'importe qui pourrait forger un jeton.`,
        `Générez-en une : openssl rand -hex 32, puis mettez-la dans ${name}.`,
      );
    }
  }

  // Un avertissement, pas un refus : une application mobile n'envoie pas d'en-tête
  // Origin, donc une API qui ne sert que Flutter fonctionne très bien ainsi.
  if (config.corsOrigins.some((origin) => origin.includes('localhost'))) {
    console.warn(
      `⚠  CORS_ORIGINS contient localhost en production (${config.CORS_ORIGINS}).\n` +
        "   Sans effet pour les applications mobiles, mais le back-office déployé sera refusé.\n",
    );
  }
}

export type Config = typeof config;
