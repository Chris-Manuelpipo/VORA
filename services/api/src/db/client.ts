// VORA — connexion à PostgreSQL. Un seul pool pour tout le processus.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../lib/config.js';
import * as schema from './schema.js';

// node-postgres rend les entiers 8 octets (bigserial) sous forme de chaîne, par prudence
// vis-à-vis de la précision. Nos identifiants d'événements restent très en deçà de
// Number.MAX_SAFE_INTEGER : on les lit en nombres, comme le déclare le schéma.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.isTest ? 4 : 10,
  // Le réseau du hackathon est capricieux : mieux vaut échouer vite et reconnecter.
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30_000,
  application_name: 'vora-api',
  // `rejectUnauthorized: false` chiffre le transport sans vérifier la chaîne de
  // certification : c'est ce qu'exigent la plupart des add-ons PostgreSQL gérés, dont
  // celui de Clever Cloud. Le compromis est réel et il est explicite — DATABASE_SSL vaut
  // false par défaut, et on ne l'active jamais sur une base locale.
  ...(config.DATABASE_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
});

// Une erreur sur une connexion inactive ne doit pas tuer le processus en pleine démo.
pool.on('error', (error) => {
  console.error('[db] connexion inactive perdue :', error.message);
});

// Les noms de colonnes sont déclarés explicitement dans schema.ts : rien n'est déduit.
export const db = drizzle(pool, { schema });

export type Database = typeof db;

/** Chemin du dossier de migrations, partagé par le migrateur et les tests. */
export const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Ferme le pool : appelé à l'arrêt du serveur et à la fin des tests. */
export async function closeDatabase(): Promise<void> {
  await pool.end();
}

/** Vérifie que la base répond et que PostGIS est bien là (utilisé par /health). */
export async function databaseHealth(): Promise<{ ok: boolean; postgis: string | null }> {
  const result = await pool.query<{ postgis: string | null }>(
    "select (select extversion from pg_extension where extname = 'postgis') as postgis",
  );
  return { ok: true, postgis: result.rows[0]?.postgis ?? null };
}

/**
 * Extensions sans lesquelles les migrations ET le produit sont faux.
 *
 * `postgis` porte le géorepérage moto, `pg_trgm` et `unaccent` la recherche par repères,
 * `pgcrypto` les identifiants. Les migrations les SUPPOSENT posées : en local c'est
 * `db:setup` qui applique `infra/postgres/init/01-extensions.sql`, en production c'est
 * l'add-on qui doit les activer. La différence entre les deux mondes est exactement
 * celle-là, et c'est le premier motif d'échec d'un premier déploiement.
 */
export const REQUIRED_EXTENSIONS = ['postgis', 'pg_trgm', 'unaccent', 'pgcrypto'] as const;

/** Celles qui manquent, dans l'ordre où il faut les créer. */
export async function missingExtensions(): Promise<string[]> {
  const result = await pool.query<{ extname: string }>(
    'select extname from pg_extension where extname = any($1::text[])',
    [[...REQUIRED_EXTENSIONS]],
  );

  const present = new Set(result.rows.map((row) => row.extname));
  return REQUIRED_EXTENSIONS.filter((name) => !present.has(name));
}
