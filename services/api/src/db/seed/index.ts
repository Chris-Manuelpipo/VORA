#!/usr/bin/env tsx
// VORA — données de départ. Idempotent : relancer `npm run seed` ne duplique rien.
//
// Compte de démo (CLAUDE.md § 8.2) :
//   1 passagère  — Aïcha
//   3 voitures   — Boris, Nadine, Jean-Pierre
//   2 motos      — Samuel, Fatou
// Plaques camerounaises (CE = Centre / Yaoundé), stockées sans espaces.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from '../client.js';
import { driverProfiles, tariffs, users, vehicles } from '../schema.js';
import { seedLandmarks, seedZones } from './geography.js';
import { ZONE_SEED } from './zones.js';
import {
  CANCEL_FEE,
  COMMISSION_FLAT_MOTO,
  COMMISSION_PERCENT_CAR,
  DEMAND_SURGE_MAX_PERCENT,
  DGI_PERCENT,
  NIGHT_SURGE_PERCENT,
  TARIFFS,
  TOTAL_SURGE_CAP_PERCENT,
} from '../../domain/rules.js';
import { allocateVoraId } from '../../modules/identity/vora-id.js';
import { isVoraIdTaken } from '../../modules/identity/repository.js';

const CITY = 'Yaoundé';

interface SeedAccount {
  phone: string;
  displayName: string;
  role: 'passenger' | 'driver';
  driver?: {
    kind: 'car' | 'moto';
    rating: string;
    vehicle: {
      make: string;
      model: string;
      color: string;
      plate: string;
      year: number;
      seats: number;
      offers: Array<'eco' | 'confort' | 'moto'>;
    };
  };
}

const ACCOUNTS: SeedAccount[] = [
  { phone: '+237691234567', displayName: 'Aïcha Mballa', role: 'passenger' },
  {
    phone: '+237677001122',
    displayName: 'Boris Nguema',
    role: 'driver',
    driver: {
      kind: 'car',
      rating: '4.9',
      vehicle: {
        make: 'Toyota',
        model: 'Corolla',
        color: 'Blanc',
        plate: 'CE4821AB',
        year: 2018,
        seats: 4,
        offers: ['eco', 'confort'],
      },
    },
  },
  {
    phone: '+237655334455',
    displayName: 'Nadine Fouda',
    role: 'driver',
    driver: {
      kind: 'car',
      rating: '4.8',
      vehicle: {
        make: 'Hyundai',
        model: 'Accent',
        color: 'Gris',
        plate: 'CE1903CD',
        year: 2019,
        seats: 4,
        offers: ['eco'],
      },
    },
  },
  {
    phone: '+237699778899',
    displayName: 'Jean-Pierre Mbarga',
    role: 'driver',
    driver: {
      kind: 'car',
      rating: '4.7',
      vehicle: {
        make: 'Kia',
        model: 'Picanto',
        color: 'Rouge',
        plate: 'CE7742EF',
        year: 2021,
        seats: 4,
        offers: ['eco', 'confort'],
      },
    },
  },
  {
    phone: '+237650112233',
    displayName: 'Samuel Tchinda',
    role: 'driver',
    driver: {
      kind: 'moto',
      rating: '4.6',
      vehicle: {
        make: 'Honda',
        model: 'Ace 125',
        color: 'Noir',
        plate: 'CE2210GH',
        year: 2020,
        seats: 1,
        offers: ['moto'],
      },
    },
  },
  {
    phone: '+237670445566',
    displayName: 'Fatou Ngo',
    role: 'driver',
    driver: {
      kind: 'moto',
      rating: '4.8',
      vehicle: {
        make: 'TVS',
        model: 'Star HLX',
        color: 'Bleu',
        plate: 'CE8831JK',
        year: 2022,
        seats: 1,
        offers: ['moto'],
      },
    },
  },
];

async function seedAccounts(): Promise<void> {
  for (const account of ACCOUNTS) {
    const existing = await db.select().from(users).where(eq(users.phone, account.phone)).limit(1);
    if (existing[0]) {
      console.log(`⏭  ${account.displayName} déjà présent (${existing[0].voraId})`);
      continue;
    }

    const now = new Date();
    const [user] = await db
      .insert(users)
      .values({
        // Même allocateur que l'inscription : les comptes de démo ont de vrais ID VORA,
        // avec leur clé de Luhn, pas des numéros fabriqués pour la circonstance.
        voraId: await allocateVoraId(isVoraIdTaken),
        role: account.role,
        displayName: account.displayName,
        phone: account.phone,
        phoneVerifiedAt: now,
        lastSeenAt: now,
      })
      .returning();

    if (!user) throw new Error(`Création de ${account.displayName} : aucune ligne.`);

    if (account.role === 'driver' && account.driver) {
      const [vehicle] = await db
        .insert(vehicles)
        .values({
          driverId: user.id,
          kind: account.driver.kind,
          make: account.driver.vehicle.make,
          model: account.driver.vehicle.model,
          color: account.driver.vehicle.color,
          plate: account.driver.vehicle.plate,
          year: account.driver.vehicle.year,
          seats: account.driver.vehicle.seats,
          offers: account.driver.vehicle.offers,
          active: true,
        })
        .returning();

      await db.insert(driverProfiles).values({
        userId: user.id,
        kind: account.driver.kind,
        status: 'approved',
        verifiedAt: now,
        rating: account.driver.rating,
        ridesCount: 40,
        acceptanceRate: 0.92,
        cancellationRate: 0.04,
        currentVehicleId: vehicle?.id ?? null,
        online: false,
      });
    }

    console.log(`✓  ${account.displayName} · ${user.voraId} · ${account.phone}`);
  }
}

async function seedTariffs(): Promise<void> {
  const rows = [
    {
      offer: 'eco' as const,
      grid: TARIFFS.eco,
      commissionPercent: COMMISSION_PERCENT_CAR,
      commissionFlat: 0,
      cancelFee: CANCEL_FEE.car,
    },
    {
      offer: 'confort' as const,
      grid: TARIFFS.confort,
      commissionPercent: COMMISSION_PERCENT_CAR,
      commissionFlat: 0,
      cancelFee: CANCEL_FEE.car,
    },
    {
      offer: 'moto' as const,
      grid: TARIFFS.moto,
      commissionPercent: 0,
      commissionFlat: COMMISSION_FLAT_MOTO,
      cancelFee: CANCEL_FEE.moto,
    },
  ];

  for (const row of rows) {
    const existing = await db.select().from(tariffs).where(eq(tariffs.offer, row.offer)).limit(1);
    if (existing[0]) {
      console.log(`⏭  Tarif ${row.offer} déjà publié`);
      continue;
    }

    await db.insert(tariffs).values({
      offer: row.offer,
      version: 1,
      city: CITY,
      baseFare: row.grid.baseFare,
      perKm: row.grid.perKm,
      perMin: row.grid.perMin,
      minimumFare: row.grid.minimumFare,
      nightSurgePercent: NIGHT_SURGE_PERCENT,
      demandSurgeMaxPercent: DEMAND_SURGE_MAX_PERCENT,
      totalCapPercent: TOTAL_SURGE_CAP_PERCENT,
      commissionPercent: row.commissionPercent,
      commissionFlat: row.commissionFlat,
      dgiPercent: DGI_PERCENT,
      cancelFee: row.cancelFee,
      active: true,
    });
    console.log(`✓  Tarif ${row.offer}`);
  }
}

async function reportLandmarks(): Promise<void> {
  const report = await seedLandmarks();
  console.log(
    `✓  ${report.written} repères de Yaoundé (coordonnées approximatives, cf. seed/landmarks.ts)`,
  );
  for (const name of report.retired) console.log(`↩  Repère « ${name} » retiré du fichier de données`);
}

async function reportZones(): Promise<void> {
  const report = await seedZones();
  for (const zone of ZONE_SEED) {
    console.log(`${zone.kind === 'moto_forbidden' ? '⛔' : '✓ '} Zone ${zone.kind} « ${zone.name} »`);
  }
  for (const name of report.retired) console.log(`↩  Zone « ${name} » désactivée (tracé obsolète)`);
}

/**
 * Le seed complet. Exporté pour que `npm run demo` le rejoue après la remise à zéro
 * SANS dupliquer les comptes de démonstration : deux listes de comptes finiraient par
 * diverger, et c'est celle qui n'a pas servi qui passerait devant le jury.
 */
export async function seedAll(): Promise<void> {
  console.log('· Seed VORA (Yaoundé)');
  await seedAccounts();
  await seedTariffs();
  await reportLandmarks();
  await reportZones();
  console.log('\x1b[32m✓\x1b[0m Seed à jour');
}

/** Les comptes de démonstration, pour que `npm run demo` les affiche sans les réécrire. */
export const DEMO_ACCOUNTS = ACCOUNTS;

/**
 * Exécution directe (`npm run seed`) seulement. Importé par un autre module, ce fichier
 * ne doit rien lancer et surtout pas fermer la connexion sous les pieds de l'appelant.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  seedAll()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n\x1b[31m✗ Seed impossible : ${message}\x1b[0m`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDatabase();
    });
}
