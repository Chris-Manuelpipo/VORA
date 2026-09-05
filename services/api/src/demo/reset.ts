#!/usr/bin/env tsx
// VORA — `npm run demo` : remise à zéro + identifiants de démonstration (CLAUDE.md § 10).
//
// À quoi ça sert, concrètement : entre deux passages devant le jury, on veut retrouver
// une base propre en cinq secondes — sans courses en cours, sans dettes d'espèces, sans
// chauffeur resté « en ligne » d'une démonstration précédente — mais SANS refaire
// `db:reset`, qui rejouerait les migrations et reséèmerait 120 repères pour rien.
//
// CE QUI EST EFFACÉ : tout ce qui est transactionnel — courses, journal, devis, offres,
// gains, paiements, notes, clés d'idempotence.
// CE QUI RESTE : les comptes, les véhicules, les repères, les zones, les tarifs. Ce sont
// les données de référence ; les effacer coûterait une minute de reséquençage à chaque
// répétition.
//
// Ce fichier vit dans `demo/` et n'est importé par AUCUN module métier (CLAUDE.md § 7).

import { sql } from 'drizzle-orm';
import { closeDatabase, db } from '../db/client.js';
import { DEMO_ACCOUNTS, seedAll } from '../db/seed/index.js';
import { config } from '../lib/config.js';
import { formatVoraId } from '../modules/identity/vora-id.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Tables vidées, dans cet ordre. `CASCADE` suffirait depuis `rides`, mais les nommer
 * toutes rend la liste relisible : quand une table apparaîtra dans le schéma, on verra
 * tout de suite si elle a sa place ici ou dans les données de référence.
 */
const TRANSACTIONAL_TABLES = [
  'ride_events',
  'dispatch_offers',
  'driver_earnings',
  'payment_intents',
  'ratings',
  'idempotency_keys',
  'rides',
  'quotes',
] as const;

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

  await db.execute(
    sql.raw(`TRUNCATE TABLE ${TRANSACTIONAL_TABLES.join(', ')} RESTART IDENTITY CASCADE`),
  );
  console.log(`✓  ${TRANSACTIONAL_TABLES.length} tables transactionnelles vidées`);

  // Les chauffeurs repartent hors ligne et sans dette : un chauffeur laissé « en ligne »
  // par la démonstration précédente recevrait des courses que personne ne conduit.
  await db.execute(sql`
    UPDATE driver_profiles
       SET online = false,
           cash_debt = 0,
           current_vehicle_id = coalesce(
             current_vehicle_id,
             (select v.id from vehicles v where v.driver_id = driver_profiles.user_id and v.active limit 1)
           )
  `);
  console.log('✓  Chauffeurs remis hors ligne, dettes d’espèces à zéro');

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
