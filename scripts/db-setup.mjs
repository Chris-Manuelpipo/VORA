#!/usr/bin/env node
// VORA — prépare la base de développement sur le PostgreSQL *local* de la machine.
//   npm run db:setup            vérifie, crée ce qui manque, migre, sème
//   npm run db:reset            supprime la base puis refait tout
//
// Aucune dépendance npm, aucun Docker : ce script doit tourner sur un poste neuf,
// avant même `npm install`. Il ne fait qu'appeler le client `psql` déjà installé
// avec PostgreSQL. Voir CLAUDE.md § 4 pour l'installation de PostgreSQL lui-même.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, parseDatabaseUrl, repoRoot } from './lib/env.mjs';
import { hasPsql, isWindows, psql, query, serverIsUp, startServerHint } from './lib/psql.mjs';

const reset = process.argv.includes('--reset');

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`\x1b[34m·\x1b[0m ${m}`);
const skip = (m) => console.log(`\x1b[90m⏭  ${m}\x1b[0m`);

/** Erreur d'installation : on dit ce qui manque, puis exactement quoi taper. */
function fail(title, ...steps) {
  console.error(`\n\x1b[31m✗ ${title}\x1b[0m\n`);
  for (const step of steps) {
    console.error(step.startsWith(' ') ? step : `   ${step}`);
  }
  console.error('\nDétail de l\'installation par système : CLAUDE.md § 4 « Base de données ».\n');
  process.exit(1);
}

// ─── 1. Configuration ────────────────────────────────────────────────────────
loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  fail('DATABASE_URL est absente.', 'cp .env.example .env');
}

let conn;
try {
  conn = parseDatabaseUrl(url);
} catch (error) {
  fail(error.message, 'Attendu : postgresql://vora:vora@localhost:5432/vora');
}
const adminConn = { ...conn, database: 'postgres' };
info(`Base visée : ${conn.user}@${conn.host}:${conn.port}/${conn.database}`);

// ─── 2. Le client psql est-il installé ? ─────────────────────────────────────
if (!hasPsql()) {
  fail(
    "La commande `psql` est introuvable. PostgreSQL n'est pas installé, ou n'est pas dans le PATH.",
    'Ubuntu / Debian : sudo apt install -y postgresql-16 postgresql-16-postgis-3 postgresql-contrib',
    'macOS          : brew install postgresql@16 postgis',
    'Windows        : winget install PostgreSQL.PostgreSQL.16 puis ajoutez',
    '                 C:\\Program Files\\PostgreSQL\\16\\bin au PATH',
  );
}

// ─── 3. Le serveur tourne-t-il ? ─────────────────────────────────────────────
if (!serverIsUp(conn)) {
  fail(
    `Aucun PostgreSQL ne répond sur ${conn.host}:${conn.port}. Le serveur n'est probablement pas démarré.`,
    ...startServerHint(),
    '',
    `Puis vérifiez : pg_isready -h ${conn.host} -p ${conn.port}`,
  );
}
ok(`PostgreSQL répond sur ${conn.host}:${conn.port}`);

// ─── 4. Le rôle existe-t-il ? ────────────────────────────────────────────────
const roleReachable = query(adminConn, 'select 1') !== null;

if (!roleReachable) {
  // Le rôle n'existe pas, ou son mot de passe ne correspond pas. On tente la création
  // par le superutilisateur local (sudo -u postgres), sans jamais demander de mot de passe.
  info(`Le rôle « ${conn.user} » ne se connecte pas, tentative de création…`);
  const created = psql(
    { ...adminConn, user: 'postgres', password: '' },
    ['-c', `CREATE ROLE ${conn.user} LOGIN PASSWORD '${conn.password}' SUPERUSER;`],
    { admin: true, silent: true },
  );

  if (created.status !== 0 || query(adminConn, 'select 1') === null) {
    fail(
      `Impossible de se connecter en tant que « ${conn.user} », et la création automatique du rôle a échoué.`,
      'Créez-le à la main (le droit SUPERUSER est un confort de poste de développement,',
      'il permet à db:setup de créer les extensions ; en production, un rôle restreint suffit) :',
      '',
      `Ubuntu / Debian : sudo -u postgres psql -c "CREATE ROLE ${conn.user} LOGIN PASSWORD '${conn.password}' SUPERUSER;"`,
      `macOS          : createuser -s ${conn.user} && psql -d postgres -c "ALTER ROLE ${conn.user} PASSWORD '${conn.password}';"`,
      `Windows        : psql -U postgres -c "CREATE ROLE ${conn.user} LOGIN PASSWORD '${conn.password}' SUPERUSER;"`,
      '',
      'Puis relancez : npm run db:setup',
    );
  }
  ok(`Rôle « ${conn.user} » créé`);
} else {
  ok(`Rôle « ${conn.user} » opérationnel`);
}

// ─── 5. La base existe-t-elle ? ──────────────────────────────────────────────
const exists = () =>
  query(adminConn, `select 1 from pg_database where datname = '${conn.database}'`) === '1';

if (reset && exists()) {
  const dropped = psql(adminConn, ['-c', `DROP DATABASE "${conn.database}" WITH (FORCE);`], {
    silent: true,
  });
  if (dropped.status !== 0) {
    fail(
      `Suppression de « ${conn.database} » impossible : ${(dropped.stderr || '').trim()}`,
      'Fermez les connexions ouvertes (API en cours, psql, client graphique) et réessayez.',
    );
  }
  ok(`Base « ${conn.database} » supprimée (--reset)`);
}

if (!exists()) {
  const created = psql(adminConn, ['-c', `CREATE DATABASE "${conn.database}" OWNER "${conn.user}";`], {
    silent: true,
  });
  if (created.status !== 0) {
    fail(
      `Création de la base « ${conn.database} » impossible : ${(created.stderr || '').trim()}`,
      `À la main : createdb -h ${conn.host} -p ${conn.port} -U ${conn.user} ${conn.database}`,
    );
  }
  ok(`Base « ${conn.database} » créée`);
} else {
  ok(`Base « ${conn.database} » présente`);
}

// ─── 6. Extensions ───────────────────────────────────────────────────────────
// Même fichier que celui monté dans le conteneur de production : les deux
// environnements ne peuvent pas diverger.
const extensionsFile = resolve(repoRoot, 'infra/postgres/init/01-extensions.sql');
if (!existsSync(extensionsFile)) {
  fail(`Fichier d'extensions introuvable : ${extensionsFile}`);
}

let applied = psql(conn, ['-f', extensionsFile], { silent: true });
// L'erreur de cette première tentative est la plus informative : c'est PostgreSQL qui parle,
// pas sudo. On la garde, sinon le vrai motif (« extension postgis non disponible ») est masqué
// par un « mot de passe requis » du repli administrateur.
const directError = (applied.stderr || '').trim();
const needsSuperuser = /superuser|permission denied|droit|privilège/i.test(directError);

if (applied.status !== 0 && needsSuperuser) {
  // Le rôle n'est pas superutilisateur : seconde tentative par le superutilisateur local.
  applied = psql({ ...conn, user: 'postgres', password: '' }, ['-f', extensionsFile], {
    admin: true,
    silent: true,
  });
}

if (applied.status !== 0) {
  // Cas de loin le plus fréquent : PostgreSQL est là, PostGIS n'a jamais été installé.
  const missing = directError.match(/extension "(\w+)" is not available|extension « (\w+) » n/i);
  const missingName = missing ? missing[1] || missing[2] : null;

  if (missingName === 'postgis') {
    fail(
      "L'extension PostGIS n'est pas installée sur cette machine. Elle est indispensable : le géorepérage moto s'appuie dessus.",
      'Ubuntu / Debian : sudo apt install -y postgresql-16-postgis-3',
      'macOS          : brew install postgis',
      'Windows        : Application Stack Builder → PostgreSQL 16 → Spatial Extensions → PostGIS 3 Bundle',
      '',
      'Puis relancez : npm run db:setup',
    );
  }
  if (missingName) {
    fail(
      `L'extension « ${missingName} » n'est pas disponible sur ce serveur.`,
      'Ubuntu / Debian : sudo apt install -y postgresql-contrib postgresql-16-postgis-3',
      'macOS          : brew install postgresql@16 postgis',
      'Windows        : réexécutez l\'installeur PostgreSQL et Stack Builder',
    );
  }
  fail(
    `Création des extensions impossible : ${directError || (applied.stderr || '').trim()}`,
    'CREATE EXTENSION demande le droit superutilisateur. À la main :',
    '',
    `Ubuntu / Debian : sudo -u postgres psql -d ${conn.database} -f infra/postgres/init/01-extensions.sql`,
    `macOS          : psql -d ${conn.database} -f infra/postgres/init/01-extensions.sql`,
    `Windows        : psql -U postgres -d ${conn.database} -f infra/postgres/init/01-extensions.sql`,
  );
}

const versions = query(
  conn,
  "select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension where extname in ('postgis','pg_trgm','unaccent','pgcrypto')",
);
ok(`Extensions : ${versions || 'aucune'}`);

// ─── 7. Migrations et données de départ ──────────────────────────────────────
function runNpm(script, label) {
  const result = spawnSync('npm', ['run', script, '--workspace', 'services/api'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: isWindows,
  });
  if (result.status !== 0) {
    fail(`${label} : échec.`, `Relancez seul pour voir le détail : npm run ${script}`);
  }
  ok(label);
}

if (existsSync(resolve(repoRoot, 'services/api/src/db/migrate.ts'))) {
  runNpm('db:migrate', 'Migrations appliquées');
} else {
  skip('Migrations : rien à appliquer pour l\'instant (créées à l\'étape P1).');
}

if (existsSync(resolve(repoRoot, 'services/api/src/db/seed/index.ts'))) {
  runNpm('seed', 'Données de départ chargées');
} else {
  skip('Données de départ : pas encore de seed (repères et zones à l\'étape P2).');
}

console.log(`\n\x1b[32mBase prête.\x1b[0m  Lancez l'API : npm run dev\n`);
