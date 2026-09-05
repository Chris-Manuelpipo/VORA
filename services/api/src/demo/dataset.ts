// VORA — remise à zéro des données de démonstration.
//
// Partagé par `npm run demo` (script) et `POST /v1/demo/reset` (endpoint) : une seule
// définition de « repartir de zéro », sinon les deux finissent par diverger et on ne
// sait plus lequel a été lancé avant de passer devant le jury.
//
// CE QUI EST EFFACÉ : tout ce qui est transactionnel — courses, journal, devis, offres,
// gains, paiements, notes, clés d'idempotence.
// CE QUI RESTE : comptes, véhicules, repères, zones, tarifs. Ce sont les données de
// référence ; les refaire coûterait une minute de reséquençage à chaque répétition.

import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clearBoardingCodes } from '../modules/rides/boarding.js';
import { resetSurge } from '../modules/pricing/surge.js';
import { resetRoutingCircuit } from '../modules/geo/routing.js';
import { resetSupportMemory } from '../modules/support/limits.js';
import { clearBuffers } from '../realtime/bus.js';
import { driverPresence } from '../modules/dispatch/presence.js';

/**
 * Tables vidées, dans cet ordre. `CASCADE` suffirait depuis `rides`, mais les nommer
 * toutes rend la liste relisible : quand une table apparaîtra dans le schéma, on verra
 * tout de suite si elle a sa place ici ou dans les données de référence.
 */
export const TRANSACTIONAL_TABLES = [
  'ride_events',
  'dispatch_offers',
  'driver_earnings',
  'payment_intents',
  'ratings',
  'idempotency_keys',
  'rides',
  'quotes',
] as const;

export interface ResetReport {
  tables: number;
  drivers: number;
}

/**
 * Vide les tables transactionnelles et remet l'état de processus à zéro.
 *
 * L'état EN MÉMOIRE compte autant que la base : un code de montée oublié, une majoration
 * de pluie restée active ou un disjoncteur de routage encore ouvert d'une répétition
 * précédente fausseraient la démonstration suivante sans laisser de trace en base.
 */
export async function resetDemoData(): Promise<ResetReport> {
  await db.execute(
    sql.raw(`TRUNCATE TABLE ${TRANSACTIONAL_TABLES.join(', ')} RESTART IDENTITY CASCADE`),
  );

  // Les chauffeurs repartent hors ligne et sans dette : un chauffeur laissé « en ligne »
  // par la démonstration précédente recevrait des courses que personne ne conduit.
  const drivers = await db.execute(sql`
    UPDATE driver_profiles
       SET online = false,
           cash_debt = 0,
           current_vehicle_id = coalesce(
             current_vehicle_id,
             (select v.id from vehicles v where v.driver_id = driver_profiles.user_id and v.active limit 1)
           )
  `);

  driverPresence.clear();
  clearBoardingCodes();
  clearBuffers();
  resetSurge();
  resetRoutingCircuit();
  // Quota horaire et cache de l'assistant : une démonstration repart avec ses 10 questions.
  resetSupportMemory();

  return { tables: TRANSACTIONAL_TABLES.length, drivers: drivers.rowCount ?? 0 };
}
