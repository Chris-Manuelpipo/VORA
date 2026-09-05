#!/usr/bin/env node
// VORA — copie les migrations dans dist/, après tsc.
//
// POURQUOI CE SCRIPT EXISTE : `tsc` n'émet que du JavaScript. Les migrations sont des
// fichiers `.sql` (écrits à la main, parce que Drizzle n'exprime ni les index GiST, ni
// les contraintes CHECK, ni les déclencheurs — voir l'en-tête de `db/schema.ts`), et
// `db/client.ts` les cherche À CÔTÉ du code compilé.
//
// Sans cette copie, `npm start` démarre, applique zéro migration, et l'API sert des
// « relation "users" does not exist » sur une base pourtant saine. Le symptôme ne
// désigne pas sa cause : d'où ce fichier, et son message d'erreur explicite.

import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(apiRoot, 'src/db/migrations');
const target = resolve(apiRoot, 'dist/db/migrations');

if (!existsSync(source)) {
  console.error(`\n\x1b[31m✗ Migrations introuvables : ${source}\x1b[0m\n`);
  process.exit(1);
}

if (!existsSync(resolve(apiRoot, 'dist'))) {
  console.error(
    '\n\x1b[31m✗ dist/ n’existe pas : lancez `tsc` avant cette copie.\x1b[0m\n' +
      '   Le script `build` enchaîne les deux ; ne l’appelez pas seul.\n',
  );
  process.exit(1);
}

// `recursive` embarque aussi `meta/_journal.json`, qui est la LISTE des migrations
// appliquées : sans lui, le migrateur ne sait pas dans quel ordre les jouer.
cpSync(source, target, { recursive: true });

const sqlFiles = readdirSync(target).filter((name) => name.endsWith('.sql'));
console.log(`✓  ${sqlFiles.length} migrations copiées dans dist/db/migrations`);
