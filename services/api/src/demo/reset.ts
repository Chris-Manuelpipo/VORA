#!/usr/bin/env tsx
// VORA — `npm run demo` : remise à zéro + identifiants de démonstration (CLAUDE.md § 10).
//
// À quoi ça sert, concrètement : entre deux passages devant le jury, on veut retrouver
// une base propre en cinq secondes — sans courses en cours, sans dettes d'espèces, sans
// chauffeur resté « en ligne » d'une démonstration précédente — mais SANS refaire
// `db:reset`, qui rejouerait les migrations et reséèmerait 120 repères pour rien.
//
// Ce qui est effacé et ce qui reste : voir `dataset.ts`, partagé avec l'endpoint
// `POST /v1/demo/reset` pour qu'il n'existe qu'UNE définition de « repartir de zéro ».
//
// Ce fichier vit dans `demo/` et n'est importé par AUCUN module métier (CLAUDE.md § 7).

import { eq } from 'drizzle-orm';
import { closeDatabase, db } from '../db/client.js';
import { DEMO_ACCOUNTS, seedAll } from '../db/seed/index.js';
import { config } from '../lib/config.js';
import { formatVoraId } from '../modules/identity/vora-id.js';
import { users } from '../db/schema.js';
import { FLEET } from './fleet.js';
import { resetDemoData } from './dataset.js';

function refuse(reason: string, fix: string): never {
  console.error(`\n\x1b[31m✗ ${reason}\x1b[0m\n   ${fix}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Deux garde-fous, parce que cette commande DÉTRUIT des courses. Elle est faite pour
  // un poste de démonstration, jamais pour une base qui porte de vraies courses.
  if (config.isProduction) {
    refuse(
      'npm run demo efface toutes les courses : refusé avec NODE_ENV=production.',
      'Si vous vouliez vraiment repartir de zéro, faites-le explicitement en base.',
    );
  }
  if (!config.DEMO_MODE) {
    refuse(
      'DEMO_MODE=false : cette base n’est pas une base de démonstration.',
      'Mettez DEMO_MODE=true dans .env, ou utilisez npm run db:reset.',
    );
  }

  const target = new URL(config.DATABASE_URL);
  console.log(`· Remise à zéro de la démonstration sur ${target.pathname.slice(1)}`);

  const report = await resetDemoData();
  console.log(`✓  ${report.tables} tables transactionnelles vidées`);
  console.log(`✓  ${report.drivers} chauffeurs remis hors ligne, dettes d'espèces à zéro`);

  // Le seed est idempotent : il recrée ce qui manquerait sans dupliquer le reste.
  await seedAll();

  await printCredentials();
}

async function printCredentials(): Promise<void> {
  console.log('\n\x1b[1mIdentifiants de démonstration\x1b[0m');
  console.log(`  Code de vérification : \x1b[1m${config.DEMO_OTP_CODE}\x1b[0m (toujours le même en mode démo)\n`);

  for (const account of DEMO_ACCOUNTS) {
    const [row] = await db
      .select({ voraId: users.voraId })
      .from(users)
      .where(eq(users.phone, account.phone))
      .limit(1);

    const role = account.role === 'passenger' ? 'passagère' : `chauffeur ${account.driver?.kind ?? ''}`;
    const voraId = row ? formatVoraId(row.voraId) : '—';
    console.log(`  ${account.phone.padEnd(15)} ${voraId.padEnd(11)} ${account.displayName.padEnd(22)} ${role}`);
  }

  console.log(
    '\n  Un compte ops n’est pas semé : créez-le avec POST /v1/auth/otp/verify puis\n' +
      "  passez son rôle à « ops » en base (npm run db:psql).\n",
  );

  const cars = FLEET.filter((member) => member.kind === 'car').length;
  const motos = FLEET.length - cars;
  console.log(
    `  Flotte simulée : ${FLEET.length} chauffeurs (${cars} voitures, ${motos} motos),\n` +
      `  démarrée automatiquement au lancement de l'API tant que DEMO_MODE=true.\n` +
      `  Pilotage : POST /v1/demo/scenario  ·  en-tête X-Demo-Token: ${config.DEMO_CONTROL_TOKEN}\n`,
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n\x1b[31m✗ Remise à zéro impossible : ${message}\x1b[0m`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
