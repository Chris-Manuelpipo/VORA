// VORA — lecture de .env et résolution de l'URL de base, sans dépendance npm.
// Utilisé par les scripts d'outillage : ils doivent fonctionner avant `npm install`.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Analyse un fichier .env : `CLE=valeur`, commentaires `#`, guillemets optionnels. */
function parseEnvFile(path) {
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Charge .env s'il existe, sinon .env.example (avec un avertissement).
 * Les variables déjà présentes dans process.env gagnent : la CI et les scripts peuvent surcharger.
 */
export function loadEnv() {
  const dotenv = resolve(repoRoot, '.env');
  const example = resolve(repoRoot, '.env.example');
  let source = null;
  let values = {};

  if (existsSync(dotenv)) {
    source = '.env';
    values = parseEnvFile(dotenv);
  } else if (existsSync(example)) {
    source = '.env.example';
    values = parseEnvFile(example);
    console.warn("⚠  Aucun fichier .env : valeurs de .env.example utilisées. Faites `cp .env.example .env`.");
  }

  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return { source, values };
}

/** Décompose une URL PostgreSQL en éléments utilisables par psql. */
export function parseDatabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`DATABASE_URL illisible : ${url}`);
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error(`DATABASE_URL doit commencer par postgresql:// (reçu : ${parsed.protocol}//)`);
  }
  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres',
  };
}

/** URL de la base avec un autre nom de base (pour vora_test, ou pour joindre `postgres`). */
export function withDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
