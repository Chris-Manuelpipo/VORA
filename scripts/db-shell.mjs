#!/usr/bin/env node
// VORA — ouvre psql sur la base de développement locale, avec les identifiants de .env.
//   npm run db:psql

import { spawnSync } from 'node:child_process';
import { loadEnv, parseDatabaseUrl } from './lib/env.mjs';
import { isWindows } from './lib/psql.mjs';

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL est absente. Faites : cp .env.example .env');
  process.exit(1);
}

const conn = parseDatabaseUrl(url);
const result = spawnSync(
  'psql',
  ['-h', conn.host, '-p', String(conn.port), '-U', conn.user, '-d', conn.database],
  {
    stdio: 'inherit',
    shell: isWindows,
    env: { ...process.env, PGPASSWORD: conn.password },
  },
);

if (result.error) {
  console.error('✗ `psql` introuvable. Installation de PostgreSQL : CLAUDE.md § 4.');
  process.exit(1);
}
process.exit(result.status ?? 1);
