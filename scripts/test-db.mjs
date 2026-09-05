#!/usr/bin/env node
// VORA — tests d'intégration sur une vraie base PostGIS, sans Testcontainers ni Docker.
//
// Le script crée `vora_test` sur le PostgreSQL local, y applique les extensions et les
// migrations, lance vitest, puis SUPPRIME la base — y compris si les tests échouent ou
// si on interrompt avec Ctrl-C. La base de développement n'est jamais touchée.
//
//   npm test                       tous les tests
//   npm test -- rides              filtre vitest
//   VORA_KEEP_TEST_DB=1 npm test   garde la base pour l'inspecter après un échec

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, parseDatabaseUrl, repoRoot, withDatabase } from './lib/env.mjs';
import { hasPsql, isWindows, psql, query, serverIsUp, startServerHint } from './lib/psql.mjs';

const passthrough = process.argv.slice(2);
const keepDatabase = process.env.VORA_KEEP_TEST_DB === '1';

function fail(title, ...steps) {
  console.error(`\n\x1b[31m✗ ${title}\x1b[0m\n`);
  for (const step of steps) console.error(`   ${step}`);
  console.error('');
  process.exit(1);
}

// ─── Configuration ───────────────────────────────────────────────────────────
loadEnv();
const devUrl = process.env.DATABASE_URL;
if (!devUrl) fail('DATABASE_URL est absente.', 'cp .env.example .env');

const devConn = parseDatabaseUrl(devUrl);
const testUrl = process.env.TEST_DATABASE_URL || withDatabase(devUrl, `${devConn.database}_test`);
const testConn = parseDatabaseUrl(testUrl);

// Garde-fou : on supprime cette base à la fin, elle ne doit jamais être celle de développement.
if (testConn.database === devConn.database) {
  fail(
    `TEST_DATABASE_URL pointe sur la base de développement (« ${devConn.database} »).`,
    'Les tests détruisent leur base : donnez-lui un autre nom, par exemple vora_test.',
  );
}

// Deux serveurs différents pour le développement et les tests : c'est presque toujours un
// TEST_DATABASE_URL oublié dans .env après un changement de port ou de mot de passe.
if (testConn.host !== devConn.host || testConn.port !== devConn.port || testConn.user !== devConn.user) {
  console.warn(
    `⚠  TEST_DATABASE_URL vise ${testConn.user}@${testConn.host}:${testConn.port}, ` +
      `alors que DATABASE_URL vise ${devConn.user}@${devConn.host}:${devConn.port}.\n` +
      '   Commentez TEST_DATABASE_URL dans .env pour qu\'elle suive la base de développement.\n',
  );
}

if (!hasPsql()) {
  fail('La commande `psql` est introuvable.', 'Installation de PostgreSQL : CLAUDE.md § 4.');
}
if (!serverIsUp(testConn)) {
  fail(
    `Aucun PostgreSQL ne répond sur ${testConn.host}:${testConn.port}.`,
    ...startServerHint(),
  );
}

const adminConn = { ...testConn, database: 'postgres' };

// ─── Cycle de vie de la base de test ─────────────────────────────────────────
function dropTestDatabase({ quiet = false } = {}) {
  const result = psql(adminConn, ['-c', `DROP DATABASE IF EXISTS "${testConn.database}" WITH (FORCE);`], {
    silent: true,
  });
  if (result.status !== 0 && !quiet) {
    console.error(`⚠  Suppression de ${testConn.database} impossible : ${(result.stderr || '').trim()}`);
  }
}

function createTestDatabase() {
  dropTestDatabase({ quiet: true }); // une base laissée par un run interrompu
  const created = psql(adminConn, ['-c', `CREATE DATABASE "${testConn.database}" OWNER "${testConn.user}";`], {
    silent: true,
  });
  if (created.status !== 0) {
    fail(
      `Création de ${testConn.database} impossible : ${(created.stderr || '').trim()}`,
      'Lancez d\'abord : npm run db:setup',
    );
  }

  const extensions = resolve(repoRoot, 'infra/postgres/init/01-extensions.sql');
  let applied = psql(testConn, ['-f', extensions], { silent: true });
  if (applied.status !== 0) {
    applied = psql({ ...testConn, user: 'postgres', password: '' }, ['-f', extensions], {
      admin: true,
      silent: true,
    });
  }
  if (applied.status !== 0) {
    dropTestDatabase({ quiet: true });
    fail(
      `Extensions impossibles à créer sur ${testConn.database} : ${(applied.stderr || '').trim()}`,
      'Lancez d\'abord : npm run db:setup',
    );
  }

  if (existsSync(resolve(repoRoot, 'services/api/src/db/migrate.ts'))) {
    const migrated = spawnSync('npm', ['run', 'db:migrate', '--workspace', 'services/api'], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: isWindows,
      env: { ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test' },
    });
    if (migrated.status !== 0) {
      dropTestDatabase({ quiet: true });
      fail('Les migrations ont échoué sur la base de test.');
    }
  }

  const postgis = query(testConn, "select extversion from pg_extension where extname = 'postgis'");
  console.log(`\x1b[34m·\x1b[0m Base de test ${testConn.database} prête (PostGIS ${postgis || '?'})\n`);
}

// ─── Exécution de vitest ─────────────────────────────────────────────────────
const vitestBin = resolve(repoRoot, 'node_modules/.bin', isWindows ? 'vitest.cmd' : 'vitest');
if (!existsSync(vitestBin)) {
  fail('vitest n\'est pas installé.', 'Lancez : npm install');
}

createTestDatabase();

let cleanedUp = false;
function cleanUp() {
  if (cleanedUp) return;
  cleanedUp = true;
  if (keepDatabase) {
    console.log(`\n\x1b[33m·\x1b[0m Base ${testConn.database} conservée (VORA_KEEP_TEST_DB=1).`);
    console.log(`   Inspection : psql "${testUrl}"`);
    console.log(`   Suppression : psql -d postgres -c 'DROP DATABASE "${testConn.database}" WITH (FORCE);'`);
    return;
  }
  dropTestDatabase();
}

const child = spawn(vitestBin, ['run', ...passthrough], {
  cwd: resolve(repoRoot, 'services/api'),
  stdio: 'inherit',
  shell: isWindows,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: testUrl,
    // Le simulateur de chauffeurs et les codes OTP fixes n'ont rien à faire dans les tests.
    DEMO_MODE: 'false',
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
    cleanUp();
    process.exit(130);
  });
}

child.on('exit', (code) => {
  cleanUp();
  process.exit(code ?? 1);
});
