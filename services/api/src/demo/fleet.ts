// VORA — les douze chauffeurs virtuels de la démonstration.
//
// Huit voitures et quatre motos (CLAUDE.md § 8.2). Ce sont de VRAIS comptes : de vrais
// utilisateurs, de vrais dossiers validés, de vrais véhicules avec de vraies plaques
// camerounaises. Rien dans la base ne les distingue d'un chauffeur ordinaire, et c'est
// voulu : le dispatch ne doit pas pouvoir les traiter autrement.
//
// Ce qui les distingue est ailleurs : leur numéro de téléphone est dans une plage
// réservée (+237 6 99 00 00 xx) qui permet au simulateur de les retrouver, et personne
// ne se connecte jamais avec — ils n'ont pas d'application, ils ont ce fichier.

import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { driverProfiles, users, vehicles } from '../db/schema.js';
import type { VehicleKind } from '../domain/rules.js';
import { allocateVoraId } from '../modules/identity/vora-id.js';
import { isVoraIdTaken } from '../modules/identity/repository.js';

export interface FleetMember {
  /** Numéro réservé : sert de clé de reconnaissance, jamais d'identifiant de connexion. */
  phone: string;
  displayName: string;
  kind: VehicleKind;
  rating: string;
  acceptanceRate: number;
  cancellationRate: number;
  vehicle: {
    make: string;
    model: string;
    color: string;
    /** Plaque camerounaise, stockée sans espaces : « CE 4821 AB » → « CE4821AB ». */
    plate: string;
    year: number;
    seats: number;
    offers: Array<'eco' | 'confort' | 'moto'>;
  };
}

/**
 * Huit voitures et quatre motos. Les modèles sont ceux qu'on croise réellement à
 * Yaoundé : des berlines japonaises et coréennes d'occasion pour les VTC, des 125 cm³
 * chinoises et indiennes pour les motos-taxis. Un jury camerounais le voit tout de suite.
 *
 * Les statistiques ne sont pas uniformes : elles font varier le score de dispatch
 * (§ 5.4) d'un chauffeur à l'autre, sinon c'est toujours le plus proche qui gagne et la
 * pondération ne se démontre pas.
 */
export const FLEET: FleetMember[] = [
  // ─── Voitures ──────────────────────────────────────────────────────────────
  {
    phone: '+237699000001',
    displayName: 'Étienne Ateba',
    kind: 'car',
    rating: '4.9',
    acceptanceRate: 0.95,
    cancellationRate: 0.02,
    vehicle: { make: 'Toyota', model: 'Corolla', color: 'Blanc', plate: 'CE3041AB', year: 2017, seats: 4, offers: ['eco', 'confort'] },
  },
  {
    phone: '+237699000002',
    displayName: 'Clarisse Owona',
    kind: 'car',
    rating: '4.8',
    acceptanceRate: 0.9,
    cancellationRate: 0.04,
    vehicle: { make: 'Hyundai', model: 'Accent', color: 'Gris', plate: 'CE5127CD', year: 2019, seats: 4, offers: ['eco'] },
  },
  {
    phone: '+237699000003',
    displayName: 'Serge Bilong',
    kind: 'car',
    rating: '4.6',
    acceptanceRate: 0.82,
    cancellationRate: 0.09,
    vehicle: { make: 'Kia', model: 'Rio', color: 'Bleu', plate: 'CE7714EF', year: 2018, seats: 4, offers: ['eco'] },
  },
  {
    phone: '+237699000004',
    displayName: 'Mireille Essomba',
    kind: 'car',
    rating: '5.0',
    acceptanceRate: 0.97,
    cancellationRate: 0.01,
    vehicle: { make: 'Toyota', model: 'Camry', color: 'Noir', plate: 'CE2288GH', year: 2020, seats: 4, offers: ['eco', 'confort'] },
  },
  {
    phone: '+237699000005',
    displayName: 'Alain Ndzana',
    kind: 'car',
    rating: '4.5',
    acceptanceRate: 0.78,
    cancellationRate: 0.12,
    vehicle: { make: 'Nissan', model: 'Sunny', color: 'Argent', plate: 'CE6603JK', year: 2015, seats: 4, offers: ['eco'] },
  },
  {
    phone: '+237699000006',
    displayName: 'Pauline Tchouta',
    kind: 'car',
    rating: '4.7',
    acceptanceRate: 0.88,
    cancellationRate: 0.05,
    vehicle: { make: 'Suzuki', model: 'Swift', color: 'Rouge', plate: 'CE9450LM', year: 2019, seats: 4, offers: ['eco', 'confort'] },
  },
  {
    phone: '+237699000007',
    displayName: 'Rodrigue Mvondo',
    kind: 'car',
    rating: '4.4',
    acceptanceRate: 0.74,
    cancellationRate: 0.15,
    vehicle: { make: 'Toyota', model: 'Yaris', color: 'Blanc', plate: 'CE1876NP', year: 2016, seats: 4, offers: ['eco'] },
  },
  {
    phone: '+237699000008',
    displayName: 'Estelle Ngo Bell',
    kind: 'car',
    rating: '4.9',
    acceptanceRate: 0.93,
    cancellationRate: 0.03,
    vehicle: { make: 'Hyundai', model: 'Elantra', color: 'Gris', plate: 'CE4392QR', year: 2021, seats: 4, offers: ['eco', 'confort'] },
  },

  // ─── Motos ─────────────────────────────────────────────────────────────────
  {
    phone: '+237699000009',
    displayName: 'Yannick Abega',
    kind: 'moto',
    rating: '4.8',
    acceptanceRate: 0.94,
    cancellationRate: 0.03,
    vehicle: { make: 'Sanili', model: 'SL 125', color: 'Rouge', plate: 'CE5560ST', year: 2021, seats: 1, offers: ['moto'] },
  },
  {
    phone: '+237699000010',
    displayName: 'Blaise Kamdem',
    kind: 'moto',
    rating: '4.6',
    acceptanceRate: 0.86,
    cancellationRate: 0.07,
    vehicle: { make: 'Haojue', model: 'HJ 125', color: 'Noir', plate: 'CE8021UV', year: 2020, seats: 1, offers: ['moto'] },
  },
  {
    phone: '+237699000011',
    displayName: 'Armand Nkoulou',
    kind: 'moto',
    rating: '4.7',
    acceptanceRate: 0.9,
    cancellationRate: 0.05,
    vehicle: { make: 'TVS', model: 'HLX 125', color: 'Bleu', plate: 'CE3345WX', year: 2022, seats: 1, offers: ['moto'] },
  },
  {
    phone: '+237699000012',
    displayName: 'Ghislain Onana',
    kind: 'moto',
    rating: '4.5',
    acceptanceRate: 0.81,
    cancellationRate: 0.1,
    vehicle: { make: 'Bajaj', model: 'Boxer 100', color: 'Jaune', plate: 'CE7108YZ', year: 2019, seats: 1, offers: ['moto'] },
  },
];

/** Préfixe des numéros réservés à la flotte simulée. */
export const FLEET_PHONE_PREFIX = '+23769900';

export interface FleetAccount {
  userId: string;
  voraId: string;
  vehicleId: string;
  member: FleetMember;
}

/**
 * Crée les douze comptes s'ils n'existent pas, et rend leurs identifiants.
 *
 * IDEMPOTENT : relancer le simulateur ne duplique rien. Un compte déjà présent est
 * seulement remis dans l'état de départ — dossier validé, hors ligne, sans dette.
 */
export async function ensureFleet(): Promise<FleetAccount[]> {
  const phones = FLEET.map((member) => member.phone);

  const existing = await db
    .select({ id: users.id, voraId: users.voraId, phone: users.phone })
    .from(users)
    .where(inArray(users.phone, phones));

  const byPhone = new Map(existing.map((row) => [row.phone, row]));
  const accounts: FleetAccount[] = [];

  for (const member of FLEET) {
    const found = byPhone.get(member.phone);
    accounts.push(found ? await refresh(found.id, found.voraId, member) : await create(member));
  }

  return accounts;
}

async function create(member: FleetMember): Promise<FleetAccount> {
  const now = new Date();

  const [user] = await db
    .insert(users)
    .values({
      // Même allocateur que l'inscription : les chauffeurs simulés ont de vrais ID VORA,
      // avec leur clé de Luhn. Rien ne les distingue à l'écran.
      voraId: await allocateVoraId(isVoraIdTaken),
      role: 'driver',
      displayName: member.displayName,
      phone: member.phone,
      phoneVerifiedAt: now,
      lastSeenAt: now,
    })
    .returning();

  if (!user) throw new Error(`Création du chauffeur simulé ${member.displayName} impossible.`);

  const [vehicle] = await db
    .insert(vehicles)
    .values({
      driverId: user.id,
      kind: member.kind,
      make: member.vehicle.make,
      model: member.vehicle.model,
      color: member.vehicle.color,
      plate: member.vehicle.plate,
      year: member.vehicle.year,
      seats: member.vehicle.seats,
      offers: member.vehicle.offers,
      active: true,
    })
    .returning();

  if (!vehicle) throw new Error(`Création du véhicule de ${member.displayName} impossible.`);

  await db.insert(driverProfiles).values({
    userId: user.id,
    kind: member.kind,
    status: 'approved',
    verifiedAt: now,
    rating: member.rating,
    ridesCount: 60,
    acceptanceRate: member.acceptanceRate,
    cancellationRate: member.cancellationRate,
    currentVehicleId: vehicle.id,
    online: false,
  });

  return { userId: user.id, voraId: user.voraId, vehicleId: vehicle.id, member };
}

/** Remet un compte existant dans son état de départ, sans le recréer. */
async function refresh(userId: string, voraId: string, member: FleetMember): Promise<FleetAccount> {
  const [vehicle] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.driverId, userId))
    .limit(1);

  if (!vehicle) throw new Error(`Le chauffeur simulé ${member.displayName} n'a plus de véhicule.`);

  await db
    .update(driverProfiles)
    .set({
      status: 'approved',
      kind: member.kind,
      rating: member.rating,
      acceptanceRate: member.acceptanceRate,
      cancellationRate: member.cancellationRate,
      currentVehicleId: vehicle.id,
      cashDebt: 0,
      online: false,
    })
    .where(eq(driverProfiles.userId, userId));

  return { userId, voraId, vehicleId: vehicle.id, member };
}
