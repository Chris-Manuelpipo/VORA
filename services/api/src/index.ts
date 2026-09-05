// VORA — processus API. Fastify + Socket.IO + PostgreSQL/PostGIS.
//
// SÉQUENCE DE DÉMARRAGE, et pourquoi elle est dans cet ordre :
//
//   1. extensions PostGIS/pg_trgm/unaccent/pgcrypto  — sans elles, les migrations
//      échouent avec un message obscur ; ici le message dit quoi taper ;
//   2. migrations                                    — idempotentes, et BLOQUANTES :
//      une base en retard sur le code sert des erreurs, pas des courses ;
//   3. serveur HTTP, puis passerelle Socket.IO       — dans cet ordre, la passerelle se
//      greffe sur un serveur qui existe déjà.
//
// Ce qui n'est PAS ici : le seed. Il reste une commande manuelle (`npm run seed`), parce
// qu'il écrit des données de démonstration et qu'aucun redémarrage ne doit les réécrire.

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDatabase, db, migrationsFolder, missingExtensions } from './db/client.js';
import { driverPresence } from './modules/dispatch/presence.js';
import { closeRealtime, registerRealtime } from './realtime/gateway.js';
import { buildApp } from './app.js';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';

/** Arrête le processus avec le message qui dit quoi corriger. */
function abort(problem: string, ...steps: string[]): never {
  logger.fatal({ problem }, 'Démarrage impossible');
  console.error(`\n\x1b[31m✗ ${problem}\x1b[0m`);
  for (const step of steps) console.error(`   ${step}`);
  console.error('');
  process.exit(1);
}

async function prepareDatabase(): Promise<void> {
  let missing: string[];
  try {
    missing = await missingExtensions();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    abort(
      `PostgreSQL ne répond pas : ${message}`,
      'Vérifiez DATABASE_URL (ou POSTGRESQL_ADDON_URI).',
      'Add-on géré : DATABASE_SSL=true est souvent nécessaire.',
    );
  }

  if (missing.length > 0) {
    abort(
      `Extensions PostgreSQL manquantes : ${missing.join(', ')}.`,
      'En local  : npm run db:setup',
      'Sur un add-on géré : activez-les depuis la console, ou jouez',
      `  ${missing.map((name) => `CREATE EXTENSION IF NOT EXISTS ${name};`).join(' ')}`,
      'Détail : infra/deploy/CLEVER_CLOUD.md',
    );
  }

  if (!config.MIGRATE_ON_BOOT) {
    logger.warn('MIGRATE_ON_BOOT=false : migrations non appliquées au démarrage.');
    return;
  }

  try {
    // Le migrateur Drizzle tient la liste de ce qui est déjà appliqué : relancer le
    // processus ne rejoue rien. Un redéploiement sans nouvelle migration coûte une
    // requête et quelques millisecondes.
    await migrate(db, { migrationsFolder });
    logger.info({ folder: migrationsFolder }, 'Migrations à jour');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    abort(
      `Migration échouée : ${message}`,
      "L'API ne démarre pas sur une base en retard : elle servirait des erreurs.",
      'Journaux de la migration ci-dessus. Corrigez, puis redéployez.',
    );
  }
}

await prepareDatabase();

/**
 * LE SEUL ENDROIT DU DÉPÔT QUI CHARGE LE SIMULATEUR.
 *
 * `index.ts` n'est pas un module métier : c'est le montage du processus. Il décide, en
 * lisant DEMO_MODE, si l'application sert en plus les routes de démonstration.
 *
 * L'import est DYNAMIQUE et sous condition : quand DEMO_MODE=false, le fichier
 * `demo/routes.js` n'est jamais lu, ses dépendances ne sont jamais chargées, la flotte
 * n'existe pas et `/v1/demo/*` répond 404 — un 404 de routeur, pas un 403 de garde.
 * Le produit tourne sans le simulateur parce qu'il ne le connaît pas.
 */
const demoPlugins = [];
let startDemoFleet: (() => Promise<void>) | null = null;

if (config.DEMO_MODE) {
  const { demoRoutes } = await import('./demo/routes.js');
  const { startSimulator } = await import('./demo/simulator.js');
  demoPlugins.push(demoRoutes);
  startDemoFleet = async () => {
    await startSimulator(app);
  };
  logger.warn('DEMO_MODE=true : routes /v1/demo/* montées et flotte simulée active.');
}

const app = await buildApp({ plugins: demoPlugins });

// La passerelle se greffe sur le serveur HTTP de Fastify : il faut donc qu'il existe et
// que `app.jwt` soit décoré, d'où le `ready()` avant le `listen()`. Les tests, eux,
// montent `buildApp` sans passer par ici : aucune WebSocket ne s'ouvre en test.
await app.ready();
registerRealtime(app);

let stopping = false;

/**
 * Arrêt propre. La plateforme envoie SIGTERM avant de remplacer une instance : on ferme
 * les connexions en cours plutôt que de les couper au milieu d'une course.
 */
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;

  app.log.info({ signal }, 'Arrêt demandé');
  if (config.DEMO_MODE) {
    const { stopSimulator } = await import('./demo/simulator.js');
    await stopSimulator().catch(() => undefined);
  }
  driverPresence.stop();
  await closeRealtime();
  await app.close();
  await closeDatabase();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  // HOST vaut 0.0.0.0 par défaut et `lib/config.ts` refuse la boucle locale en
  // production : derrière un routeur de plateforme, écouter sur 127.0.0.1 rend
  // l'application injoignable sans la moindre erreur applicative.
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(
    {
      port: config.PORT,
      host: config.HOST,
      commit: config.COMMIT_ID,
      demo: config.DEMO_MODE,
    },
    `VORA API à l'écoute sur ${config.HOST}:${config.PORT}`,
  );

  // La flotte simulée démarre UNE FOIS LE PORT OUVERT : elle appelle l'API comme un
  // client, et son démarrage ne doit pas retarder le contrôle de santé de la plateforme.
  if (startDemoFleet) await startDemoFleet();
} catch (error) {
  app.log.error(error);
  driverPresence.stop();
  await closeRealtime();
  await closeDatabase();
  process.exit(1);
}
