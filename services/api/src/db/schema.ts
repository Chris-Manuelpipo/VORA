// VORA — schéma Drizzle. Reprend les colonnes du § 5.2 du document de conception, simplifiées
// pour le hackathon (CLAUDE.md § 3) :
//
//   · PII en clair en base plutôt que chiffrée par colonne (pgcrypto). Le chiffrement ne se
//     voit pas dans une démo ; la fuite d'un numéro, si. La règle qui compte est donc tenue
//     ailleurs, et sans exception : DTO de sortie explicites, jamais d'entité brute renvoyée
//     (voir chaque `dto.ts`). Téléphone et e-mail ne sortent JAMAIS vers l'autre partie.
//   · Empreintes en `text` hexadécimal plutôt qu'en `bytea` : même sécurité, lecture directe
//     en psql pendant la démo.
//   · Pas de `cities` : une seule ville en v1, Yaoundé. La colonne `city` reste en texte pour
//     que l'ajout de Douala ne demande pas de migration de données.
//
// Les contraintes CHECK, les index GiST et les index trigrammes vivent dans la migration SQL
// (src/db/migrations/0000_socle.sql) : Drizzle ne les exprime pas tous, et la migration est
// écrite à la main pour cette raison.

import { relations, sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { MessageCode, MessageSender } from '../domain/messages.js';
import type { Offer, VehicleKind } from '../domain/rules.js';
import type { Actor, RideEventType, RideStatus } from '../domain/states.js';
import { geographyLineString, geographyPoint, geographyPolygon } from './geography.js';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ─── Identité ────────────────────────────────────────────────────────────────

export type UserRole = 'passenger' | 'driver' | 'ops';
export type UserStatus = 'active' | 'suspended' | 'deleted';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 8 chiffres, unique, non modifiable, affiché « 4821 0937 ». Jamais un identifiant de connexion. */
    voraId: char('vora_id', { length: 8 }).notNull(),
    role: text('role').$type<UserRole>().notNull(),
    displayName: text('display_name').notNull(),
    photoKey: text('photo_key'),
    locale: text('locale').notNull().default('fr'),

    // PII. Ne sort jamais d'un DTO destiné à quelqu'un d'autre que son propriétaire.
    phone: text('phone'),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    email: text('email'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),

    status: text('status').$type<UserStatus>().notNull().default('active'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    voraIdKey: uniqueIndex('users_vora_id_key').on(table.voraId),
    phoneKey: uniqueIndex('users_phone_key').on(table.phone),
    emailKey: uniqueIndex('users_email_key').on(table.email),
    roleIdx: index('users_role_idx').on(table.role),
  }),
);

export type DevicePlatform = 'android' | 'ios' | 'web';

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<DevicePlatform>().notNull(),
    /** Jeton de notification (FCM). Absent tant que l'appli n'a pas demandé l'autorisation. */
    pushToken: text('push_token'),
    appVersion: text('app_version'),
    model: text('model'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => ({
    userIdx: index('devices_user_idx').on(table.userId),
    pushTokenKey: uniqueIndex('devices_push_token_key').on(table.pushToken),
  }),
);

export type OtpChannel = 'phone' | 'email';

/**
 * Codes de vérification. Le code est HACHÉ : une copie de la table ne permet pas de se
 * connecter. En mode démonstration le code vaut toujours 123456 — c'est un choix assumé
 * et borné (CLAUDE.md § 8.2), jamais actif en production (garde-fou dans lib/config.ts).
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: text('channel').$type<OtpChannel>().notNull(),
    /** Destination normalisée : +237 6XX XXX XXX ou l'e-mail en minuscules. */
    destination: text('destination').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    maxAttempts: smallint('max_attempts').notNull().default(5),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    requestIp: text('request_ip'),
    createdAt: createdAt(),
  },
  (table) => ({
    lookupIdx: index('otp_challenges_destination_idx').on(table.destination, table.createdAt),
    expiryIdx: index('otp_challenges_expires_idx').on(table.expiresAt),
  }),
);

// ─── Chauffeurs et véhicules ─────────────────────────────────────────────────

export type DriverStatus = 'pending' | 'approved' | 'suspended' | 'rejected';

export const driverProfiles = pgTable(
  'driver_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Un chauffeur conduit une voiture OU une moto : les offres et les règles diffèrent. */
    kind: text('kind').$type<VehicleKind>().notNull(),
    /** Tant que ce n'est pas `approved`, le chauffeur ne peut pas se mettre en ligne. */
    status: text('status').$type<DriverStatus>().notNull().default('pending'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    licenseNumber: text('license_number'),
    licenseExpiresOn: date('license_expires_on'),

    /** Statistiques du score de dispatch (CLAUDE.md § 5.4). */
    rating: numeric('rating', { precision: 2, scale: 1 }).notNull().default('5.0'),
    ridesCount: integer('rides_count').notNull().default(0),
    acceptanceRate: real('acceptance_rate').notNull().default(1),
    cancellationRate: real('cancellation_rate').notNull().default(0),

    online: boolean('online').notNull().default(false),
    currentVehicleId: uuid('current_vehicle_id'),
    /** Commission et retenue dues sur les courses encaissées en espèces, en francs. */
    cashDebt: integer('cash_debt').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    statusIdx: index('driver_profiles_status_idx').on(table.status, table.online),
  }),
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<VehicleKind>().notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    color: text('color').notNull(),
    /** Plaque camerounaise, stockée en majuscules sans espaces : « CE4821AB ». */
    plate: text('plate').notNull(),
    year: smallint('year'),
    seats: smallint('seats').notNull().default(4),
    /** Offres servies par ce véhicule : ['eco'] · ['eco','confort'] · ['moto']. */
    offers: text('offers').array().$type<Offer[]>().notNull(),
    insuranceExpiresOn: date('insurance_expires_on'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => ({
    plateKey: uniqueIndex('vehicles_plate_key').on(table.plate),
    driverIdx: index('vehicles_driver_idx').on(table.driverId),
  }),
);

// ─── Géographie ──────────────────────────────────────────────────────────────

/**
 * Repères de Yaoundé : on ne cherche pas une adresse (il n'y en a pas), on cherche
 * « Carrefour Warda », « Total Mvan », « Chapelle Nsimeyong ».
 */
export const landmarks = pgTable(
  'landmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Orthographes et surnoms usuels, pour la recherche tolérante aux fautes. */
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    category: text('category').notNull().default('poi'),
    district: text('district'),
    city: text('city').notNull().default('Yaoundé'),
    geom: geographyPoint('geom').notNull(),
    /** `seed` · `driver` · `osm`. Les chauffeurs alimentent la base en v1. */
    source: text('source').notNull().default('seed'),
    /** 0 à 100. Les coordonnées du seed sont approximatives et assumées comme telles. */
    confidence: smallint('confidence').notNull().default(50),
    /**
     * 0 à 100. Dernier départage du tri de recherche, après la similarité et la distance :
     * entre le marché Mokolo, le carrefour Mokolo et le quartier Mokolo, celui qu'on
     * demande est presque toujours le plus fréquenté.
     */
    popularity: smallint('popularity').notNull().default(50),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => ({
    cityNameKey: uniqueIndex('landmarks_city_name_key').on(table.city, table.name),
    nameIdx: index('landmarks_name_idx').on(table.name),
    cityIdx: index('landmarks_city_idx').on(table.city),
  }),
);

export type ZoneKind = 'moto_forbidden' | 'moto_allowed' | 'car_corridor' | 'bonus';

/**
 * Zones réglementaires. `moto_forbidden` porte l'arrêté préfectoral : aucune course moto
 * dont le départ, l'arrivée ou l'itinéraire touche une de ces zones actives (CLAUDE.md § 5.5).
 */
export const zones = pgTable(
  'zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<ZoneKind>().notNull(),
    name: text('name').notNull(),
    /** Texte affiché au passager quand la course est refusée. */
    reason: text('reason'),
    city: text('city').notNull().default('Yaoundé'),
    geom: geographyPolygon('geom').notNull(),
    publishedVersion: integer('published_version'),
    /** Le géorepérage n'utilise QUE les zones actives. */
    active: boolean('active').notNull().default(false),
    bonusAmount: integer('bonus_amount'),
    schedule: jsonb('schedule'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    cityNameKey: uniqueIndex('zones_city_name_key').on(table.city, table.name),
    kindIdx: index('zones_kind_idx').on(table.kind, table.active),
  }),
);

// ─── Tarification ────────────────────────────────────────────────────────────

/**
 * Grille tarifaire versionnée. Le devis mémorise la version utilisée : un changement de
 * tarif ne réécrit jamais le prix d'une course déjà commandée.
 * Les valeurs de référence sont dans domain/rules.ts ; cette table les publie.
 */
export const tariffs = pgTable(
  'tariffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offer: text('offer').$type<Offer>().notNull(),
    version: integer('version').notNull().default(1),
    city: text('city').notNull().default('Yaoundé'),

    baseFare: integer('base_fare').notNull(),
    perKm: integer('per_km').notNull(),
    perMin: integer('per_min').notNull(),
    minimumFare: integer('minimum_fare').notNull(),

    nightSurgePercent: smallint('night_surge_percent').notNull().default(25),
    demandSurgeMaxPercent: smallint('demand_surge_max_percent').notNull().default(50),
    /** Plafond global, en pourcentage du prix de base : 150 = × 1,5, jamais dépassé. */
    totalCapPercent: smallint('total_cap_percent').notNull().default(150),

    commissionPercent: smallint('commission_percent').notNull().default(0),
    commissionFlat: integer('commission_flat').notNull().default(0),
    dgiPercent: smallint('dgi_percent').notNull().default(1),
    cancelFee: integer('cancel_fee').notNull(),

    active: boolean('active').notNull().default(true),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    offerVersionKey: uniqueIndex('tariffs_offer_version_key').on(
      table.offer,
      table.city,
      table.version,
    ),
  }),
);

export type Routing = 'osrm' | 'fallback';

/**
 * Devis. C'est le premier moment de vérité : le prix est calculé ici, signé, et ne bouge
 * plus (CLAUDE.md § 5.1). `signature` est un HMAC des entrées : un client qui modifierait
 * le prix avant de commander est détecté.
 */
export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    passengerId: uuid('passenger_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    offer: text('offer').$type<Offer>().notNull(),
    tariffId: uuid('tariff_id')
      .notNull()
      .references(() => tariffs.id),

    pickup: geographyPoint('pickup').notNull(),
    pickupLabel: text('pickup_label'),
    dropoff: geographyPoint('dropoff').notNull(),
    dropoffLabel: text('dropoff_label'),
    route: geographyLineString('route'),

    distanceM: integer('distance_m').notNull(),
    durationS: integer('duration_s').notNull(),
    /** `osrm` ou `fallback` : la dégradation gracieuse doit être visible, pas cachée. */
    routing: text('routing').$type<Routing>().notNull(),

    /** Décomposition affichée ligne à ligne : base, distance, temps, nuit, pluie, plafond. */
    breakdown: jsonb('breakdown').notNull(),
    price: integer('price').notNull(),
    currency: text('currency').notNull().default('XAF'),
    night: boolean('night').notNull().default(false),
    surgePercent: smallint('surge_percent').notNull().default(0),

    signature: text('signature').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => ({
    passengerIdx: index('quotes_passenger_idx').on(table.passengerId, table.createdAt),
  }),
);

// ─── Courses ─────────────────────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'mobile_money';
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'failed';

/**
 * Course. `status` est une PROJECTION : la vérité est la suite d'événements de
 * `ride_events`. Les trois surfaces (passager, chauffeur, ops) lisent ce même statut,
 * c'est la condition pour qu'un litige soit arbitrable (CLAUDE.md § 5.7).
 */
export const rides = pgTable(
  'rides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    passengerId: uuid('passenger_id')
      .notNull()
      .references(() => users.id),
    driverId: uuid('driver_id').references(() => users.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),

    offer: text('offer').$type<Offer>().notNull(),
    status: text('status').$type<RideStatus>().notNull().default('draft'),

    pickup: geographyPoint('pickup').notNull(),
    pickupLabel: text('pickup_label'),
    pickupNote: text('pickup_note'),
    dropoff: geographyPoint('dropoff').notNull(),
    dropoffLabel: text('dropoff_label'),
    route: geographyLineString('route'),

    /** Prix ferme, figé à la commande. Ne change plus jusqu'à la fin. */
    priceQuoted: integer('price_quoted').notNull(),
    priceFinal: integer('price_final'),
    distanceM: integer('distance_m'),
    durationS: integer('duration_s'),

    /** Décomposition de l'argent du chauffeur, calculée à la commande et affichée avant acceptation. */
    commission: integer('commission'),
    dgiAmount: integer('dgi_amount'),
    driverNet: integer('driver_net'),

    paymentMethod: text('payment_method').$type<PaymentMethod>().notNull().default('cash'),
    paymentStatus: text('payment_status').$type<PaymentStatus>().notNull().default('pending'),

    /** Code de montée à 4 chiffres : haché, visible du passager seulement. */
    boardingCodeHash: text('boarding_code_hash'),
    boardingAttempts: smallint('boarding_attempts').notNull().default(0),

    /**
     * Compteur du chauffeur à l'instant où il a accepté. L'annulation est gratuite tant
     * qu'il a parcouru moins de 300 m (CLAUDE.md § 5.3) : c'est de ce point zéro que la
     * distance se mesure, pas du point de rendez-vous.
     */
    driverOdometerStartM: integer('driver_odometer_start_m'),

    cancelledBy: text('cancelled_by').$type<Actor>(),
    cancelReason: text('cancel_reason'),
    cancelFee: integer('cancel_fee'),

    requestedAt: timestamp('requested_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),

    /** Verrou optimiste : deux acceptations concurrentes ne peuvent pas gagner ensemble. */
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    passengerIdx: index('rides_passenger_idx').on(table.passengerId, table.requestedAt),
    driverIdx: index('rides_driver_idx').on(table.driverId, table.requestedAt),
    statusIdx: index('rides_status_idx').on(table.status),
  }),
);

/** Journal append-only. Jamais de UPDATE, jamais de DELETE : c'est la mémoire des litiges. */
export const rideEvents = pgTable(
  'ride_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    type: text('type').$type<RideEventType>().notNull(),
    fromStatus: text('from_status').$type<RideStatus>(),
    toStatus: text('to_status').$type<RideStatus>(),
    actorType: text('actor_type').$type<Actor>().notNull(),
    actorId: uuid('actor_id'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rideIdx: index('ride_events_ride_idx').on(table.rideId, table.id),
  }),
);

export type OfferResponse = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';

/**
 * Offres de dispatch. Séquentielles : un seul chauffeur à la fois, 15 s pour répondre,
 * 3 vagues au maximum (CLAUDE.md § 5.4). Le net du chauffeur est mémorisé dans l'offre :
 * c'est ce montant qu'il a vu avant d'accepter, et il devra rester vrai après la course.
 */
export const dispatchOffers = pgTable(
  'dispatch_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    wave: smallint('wave').notNull(),
    rank: smallint('rank').notNull().default(0),
    score: real('score'),
    etaS: integer('eta_s'),
    /** Net affiché au chauffeur dans la demande : brut − commission − DGI. */
    driverNet: integer('driver_net').notNull(),
    response: text('response').$type<OfferResponse>().notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (table) => ({
    rideWaveKey: uniqueIndex('dispatch_offers_ride_driver_wave_key').on(
      table.rideId,
      table.driverId,
      table.wave,
    ),
    driverPendingIdx: index('dispatch_offers_driver_idx').on(table.driverId, table.response),
  }),
);

// ─── Notation ────────────────────────────────────────────────────────────────

/**
 * Notes des deux côtés. `driver_profiles.rating` en est la moyenne — une projection,
 * comme `rides.status` l'est de `ride_events`. La note pèse 10 % dans le score de
 * dispatch : elle doit rester imputable, pas être un champ qu'on écrase.
 */
export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    raterId: uuid('rater_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rateeId: uuid('ratee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stars: smallint('stars').notNull(),
    /** Motifs prédéfinis. Pas de texte libre entre les parties (messagerie coupée). */
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    /** Destiné à VORA, jamais affiché à l'autre partie. */
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (table) => ({
    rideRaterKey: uniqueIndex('ratings_ride_rater_key').on(table.rideId, table.raterId),
    rateeIdx: index('ratings_ratee_idx').on(table.rateeId, table.createdAt),
  }),
);

// ─── Messages prédéfinis ─────────────────────────────────────────────────────

/**
 * Messages liés à une course. SIX CODES, aucun texte libre (`domain/messages.ts`).
 *
 * Il n'y a pas de colonne `body`, et c'est le fond du sujet : sans champ de texte, il
 * n'y a rien à modérer, rien à chiffrer, et aucun moyen d'échanger un numéro de
 * téléphone en contournant la règle du § 5.6. La contrainte CHECK de la migration
 * interdit même à un `INSERT` en psql d'écrire autre chose que ces six valeurs.
 */
export const rideMessages = pgTable(
  'ride_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    /** Qui parle, déduit du jeton — jamais du corps de la requête. */
    sender: text('sender').$type<MessageSender>().notNull(),
    code: text('code').$type<MessageCode>().notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    rideIdx: index('ride_messages_ride_idx').on(table.rideId, table.createdAt),
  }),
);

// ─── Idempotence ─────────────────────────────────────────────────────────────

/**
 * `Idempotency-Key` des créations (CLAUDE.md § 9). Le deuxième appel avec la même clé
 * ne crée rien : il relit la course déjà créée. C'est la différence entre un passager
 * impatient et un passager avec deux chauffeurs en route.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    key: text('key').notNull(),
    rideId: uuid('ride_id').references(() => rides.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => ({
    pk: uniqueIndex('idempotency_keys_pkey').on(table.userId, table.endpoint, table.key),
    rideIdx: index('idempotency_keys_ride_idx').on(table.rideId),
  }),
);

// ─── Argent du chauffeur ─────────────────────────────────────────────────────

export type EarningSource = 'ride' | 'cancel_fee' | 'no_show_fee';

/**
 * Ce que le chauffeur a gagné, ligne par ligne. Le ledger en double entrée (ADR-008)
 * est hors périmètre du hackathon ; ces lignes-là, elles, sont exactes au franc et
 * suffisent à répondre « combien ai-je gagné aujourd'hui ».
 */
export const driverEarnings = pgTable(
  'driver_earnings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').$type<EarningSource>().notNull(),
    gross: integer('gross').notNull(),
    commission: integer('commission').notNull(),
    dgi: integer('dgi').notNull(),
    net: integer('net').notNull(),
    paymentMethod: text('payment_method').$type<PaymentMethod>().notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    rideSourceKey: uniqueIndex('driver_earnings_ride_source_key').on(table.rideId, table.source),
    driverIdx: index('driver_earnings_driver_idx').on(table.driverId, table.createdAt),
  }),
);

// ─── Paiements ───────────────────────────────────────────────────────────────

export type PaymentIntentStatus = 'pending' | 'succeeded' | 'failed';

/**
 * Intention de paiement. Le fournisseur est simulé (CLAUDE.md § 8.2), la trace ne l'est
 * pas : brancher MTN MoMo ou Orange Money remplira exactement ces colonnes.
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    method: text('method').$type<PaymentMethod>().notNull(),
    amount: integer('amount').notNull(),
    status: text('status').$type<PaymentIntentStatus>().notNull().default('pending'),
    provider: text('provider').notNull().default('simulated'),
    providerRef: text('provider_ref'),
    createdAt: createdAt(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => ({
    rideIdx: index('payment_intents_ride_idx').on(table.rideId, table.createdAt),
  }),
);

// ─── Relations (pratiques pour les jointures Drizzle) ────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  driverProfile: one(driverProfiles, {
    fields: [users.id],
    references: [driverProfiles.userId],
  }),
  vehicles: many(vehicles),
  devices: many(devices),
}));

export const driverProfilesRelations = relations(driverProfiles, ({ one }) => ({
  user: one(users, { fields: [driverProfiles.userId], references: [users.id] }),
  currentVehicle: one(vehicles, {
    fields: [driverProfiles.currentVehicleId],
    references: [vehicles.id],
  }),
}));

export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  driver: one(users, { fields: [vehicles.driverId], references: [users.id] }),
}));

export const ridesRelations = relations(rides, ({ one, many }) => ({
  passenger: one(users, { fields: [rides.passengerId], references: [users.id] }),
  driver: one(users, { fields: [rides.driverId], references: [users.id] }),
  vehicle: one(vehicles, { fields: [rides.vehicleId], references: [vehicles.id] }),
  quote: one(quotes, { fields: [rides.quoteId], references: [quotes.id] }),
  events: many(rideEvents),
  offers: many(dispatchOffers),
}));

export const rideEventsRelations = relations(rideEvents, ({ one }) => ({
  ride: one(rides, { fields: [rideEvents.rideId], references: [rides.id] }),
}));

export const dispatchOffersRelations = relations(dispatchOffers, ({ one }) => ({
  ride: one(rides, { fields: [dispatchOffers.rideId], references: [rides.id] }),
  driver: one(users, { fields: [dispatchOffers.driverId], references: [users.id] }),
}));

// ─── Types déduits ───────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Device = typeof devices.$inferSelect;
export type OtpChallenge = typeof otpChallenges.$inferSelect;
export type DriverProfile = typeof driverProfiles.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Landmark = typeof landmarks.$inferSelect;
export type Zone = typeof zones.$inferSelect;
export type Tariff = typeof tariffs.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type Ride = typeof rides.$inferSelect;
export type RideEvent = typeof rideEvents.$inferSelect;
export type DispatchOffer = typeof dispatchOffers.$inferSelect;
export type DriverEarning = typeof driverEarnings.$inferSelect;
export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type Rating = typeof ratings.$inferSelect;
export type RideMessage = typeof rideMessages.$inferSelect;
