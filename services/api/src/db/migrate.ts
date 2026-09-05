#!/usr/bin/env tsx
// VORA — application des migrations. Appelé par `npm run db:migrate`, par `npm run db:setup`
// et par `npm test` (sur vora_test). Idempotent : Drizzle tient la liste de ce qui est appliqué.

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDatabase, db, migrationsFolder } from './client.js';
import { config } from '../lib/config.js';

async function main(): Promise<void> {
  const target = new URL(config.DATABASE_URL);
  console.log(`· Migrations sur ${target.pathname.slice(1)} (${target.host})`);

  await migrate(db, { migrationsFolder });
  console.log('\x1b[32m✓\x1b[0m Migrations à jour');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n\x1b[31m✗ Migration impossible : ${message}\x1b[0m`);
    if (/postgis|geography/i.test(message)) {
      console.error(
        "\n   PostGIS manque sur cette base. Lancez : npm run db:setup\n   (il applique infra/postgres/init/01-extensions.sql)\n",
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
