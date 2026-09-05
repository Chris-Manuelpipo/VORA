// VORA — comptes et données de départ pour les tests d'intégration.
//
// On ne réutilise pas `db/seed/index.ts` : c'est un script, il s'exécute à l'import et
// ferme la connexion en partant. Et un test doit dire ce qu'il suppose — un chauffeur
// moto validé à 500 m du départ, une grille tarifaire publiée — plutôt que d'hériter
// silencieusement d'un jeu de démonstration qui bougera.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { driverProfiles, tariffs, users, vehicles } from '../../db/schema.js';
import {
  CANCEL_FEE,
  COMMISSION_FLAT_MOTO,
  COMMISSION_PERCENT_CAR,
  DEMAND_SURGE_MAX_PERCENT,
  DGI_PERCENT,
  NIGHT_SURGE_PERCENT,
  TARIFFS,
  TOTAL_SURGE_CAP_PERCENT,
  type Offer,
  type VehicleKind,
} from '../../domain/rules.js';
import { allocateVoraId } from '../../modules/identity/vora-id.js';
import { isVoraIdTaken } from '../../modules/identity/repository.js';

const CITY = 'Yaoundé';

/** Publie les trois grilles. Sans elles, aucun devis ne peut être signé. */
export async function seedTariffs(): Promise<void> {
  const rows = [
    { offer: 'eco' as const, commissionPercent: COMMISSION_PERCENT_CAR, commissionFlat: 0, cancelFee: CANCEL_FEE.car },
    { offer: 'confort' as const, commissionPercent: COMMISSION_PERCENT_CAR, commissionFlat: 0, cancelFee: CANCEL_FEE.car },
    { offer: 'moto' as const, commissionPercent: 0, commissionFlat: COMMISSION_FLAT_MOTO, cancelFee: CANCEL_FEE.moto },
  ];

  for (const row of rows) {
    const existing = await db.select().from(tariffs).where(eq(tariffs.offer, row.offer)).limit(1);
    if (existing[0]) continue;

    const grid = TARIFFS[row.offer];
    await db.insert(tariffs).values({
      offer: row.offer,
      version: 1,
      city: CITY,
      baseFare: grid.baseFare,
      perKm: grid.perKm,
      perMin: grid.perMin,
      minimumFare: grid.minimumFare,
      nightSurgePercent: NIGHT_SURGE_PERCENT,
      demandSurgeMaxPercent: DEMAND_SURGE_MAX_PERCENT,
      totalCapPercent: TOTAL_SURGE_CAP_PERCENT,
      commissionPercent: row.commissionPercent,
      commissionFlat: row.commissionFlat,
      dgiPercent: DGI_PERCENT,
      cancelFee: row.cancelFee,
      active: true,
    });
  }
}

export interface TestAccount {
  id: string;
  voraId: string;
  token: string;
  displayName: string;
}

export interface TestDriver extends TestAccount {
  vehicleId: string;
  kind: VehicleKind;
}

/** Numéro camerounais unique par appel : la colonne `phone` est unique. */
function uniquePhone(): string {
  return `+2376${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;
}

/**
 * Plaque camerounaise unique : « CE 4821 AB » stockée « CE4821AB ». La colonne est
 * unique, et le format compte — le passager compare ces caractères à la voiture qui se
 * gare devant lui, donc `formatPlate` doit savoir les regrouper.
 */
function uniquePlate(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letter = (): string => letters[Math.floor(Math.random() * letters.length)]!;
  const digits = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
  return `CE${digits}${letter()}${letter()}`;
}

async function createUser(
  app: FastifyInstance,
  role: 'passenger' | 'driver' | 'ops',
  displayName: string,
): Promise<TestAccount> {
  const now = new Date();
  const [user] = await db
    .insert(users)
    .values({
      voraId: await allocateVoraId(isVoraIdTaken),
      role,
      displayName,
      phone: uniquePhone(),
      phoneVerifiedAt: now,
      lastSeenAt: now,
    })
    .returning();

  if (!user) throw new Error(`Création de ${displayName} impossible.`);

  return {
    id: user.id,
    voraId: user.voraId,
    displayName: user.displayName,
    // Le jeton est signé par Fastify, comme en production : les tests passent par les
    // vraies routes, avec la vraie authentification.
    token: app.jwt.sign({ sub: user.id, vora_id: user.voraId, role }),
  };
}

export async function createPassenger(
  app: FastifyInstance,
  displayName = 'Aïcha Mballa',
): Promise<TestAccount> {
  return createUser(app, 'passenger', displayName);
}

export async function createOps(app: FastifyInstance, displayName = 'Ops VORA'): Promise<TestAccount> {
  return createUser(app, 'ops', displayName);
}

/**
 * Un chauffeur VALIDÉ, avec un véhicule actif. `status: 'approved'` est délibéré : un
 * dossier en attente ne peut pas se mettre en ligne, et c'est justement ce que teste
 * `dispatch/service.requireApprovedDriver`.
 */
export async function createDriver(
  app: FastifyInstance,
  options: {
    displayName?: string;
    kind?: VehicleKind;
    offers?: Offer[];
    rating?: string;
    acceptanceRate?: number;
    cancellationRate?: number;
  } = {},
): Promise<TestDriver> {
  const kind = options.kind ?? 'car';
  const account = await createUser(app, 'driver', options.displayName ?? 'Boris Nguema');

  const [vehicle] = await db
    .insert(vehicles)
    .values({
      driverId: account.id,
      kind,
      make: kind === 'moto' ? 'Honda' : 'Toyota',
      model: kind === 'moto' ? 'Ace 125' : 'Corolla',
      color: kind === 'moto' ? 'Noir' : 'Blanc',
      plate: uniquePlate(),
      year: 2019,
      seats: kind === 'moto' ? 1 : 4,
      offers: options.offers ?? (kind === 'moto' ? ['moto'] : ['eco', 'confort']),
      active: true,
    })
    .returning();

  if (!vehicle) throw new Error('Création du véhicule impossible.');

  await db.insert(driverProfiles).values({
    userId: account.id,
    kind,
    status: 'approved',
    verifiedAt: new Date(),
    rating: options.rating ?? '4.8',
    ridesCount: 40,
    acceptanceRate: options.acceptanceRate ?? 0.92,
    cancellationRate: options.cancellationRate ?? 0.04,
    currentVehicleId: vehicle.id,
    online: false,
  });

  return { ...account, vehicleId: vehicle.id, kind };
}

/** En-tête d'authentification prêt à poser sur `app.inject`. */
export function auth(account: TestAccount): Record<string, string> {
  return { authorization: `Bearer ${account.token}` };
}

/**
 * Attend qu'une condition devienne vraie, ou abandonne.
 *
 * Le dispatch est ASYNCHRONE par construction : `POST /v1/rides` répond dès que la
 * course est créée, et la première offre part ensuite. Un test qui lirait la base
 * immédiatement après testerait la vitesse du disque, pas le produit.
 */
export async function waitFor<T>(
  probe: () => Promise<T | null | undefined>,
  { timeoutMs = 5_000, intervalMs = 25, label = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé en attendant : ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
