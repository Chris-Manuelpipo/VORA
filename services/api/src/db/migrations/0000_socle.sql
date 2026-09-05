-- VORA — migration initiale (P1 : socle backend et authentification).
--
-- Écrite à la main plutôt que générée par drizzle-kit : les colonnes PostGIS
-- (geography(Point,4326), geography(Polygon,4326)), les index GiST et les index
-- trigrammes ne se laissent pas décrire complètement par le schéma Drizzle.
-- src/db/schema.ts en est le miroir typé ; toute évolution touche les deux.
--
-- Les extensions (postgis, pg_trgm, unaccent, pgcrypto) sont posées AVANT par
-- infra/postgres/init/01-extensions.sql, appliqué par `npm run db:setup`.

CREATE OR REPLACE FUNCTION vora_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ─── Identité ────────────────────────────────────────────────────────────────

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 8 chiffres, généré (clé de Luhn interne, motifs triviaux rejetés), non modifiable.
  "vora_id" char(8) NOT NULL,
  "role" text NOT NULL,
  "display_name" text NOT NULL,
  "photo_key" text,
  "locale" text NOT NULL DEFAULT 'fr',
  -- PII : présentes en base, jamais dans une réponse destinée à un autre utilisateur.
  "phone" text,
  "phone_verified_at" timestamptz,
  "email" text,
  "email_verified_at" timestamptz,
  "status" text NOT NULL DEFAULT 'active',
  "last_seen_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "users_vora_id_digits" CHECK ("vora_id" ~ '^[0-9]{8}$'),
  CONSTRAINT "users_role_check" CHECK ("role" IN ('passenger', 'driver', 'ops')),
  CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'suspended', 'deleted')),
  -- Un compte existe parce qu'un canal a été vérifié. Pas de compte fantôme.
  CONSTRAINT "users_verified_channel_check" CHECK (
    "phone_verified_at" IS NOT NULL OR "email_verified_at" IS NOT NULL OR "status" = 'deleted'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_vora_id_key" ON "users" ("vora_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" ("phone");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");
--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" ("role");
--> statement-breakpoint
CREATE TRIGGER "users_touch" BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION vora_touch_updated_at();
--> statement-breakpoint

CREATE TABLE "devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform" text NOT NULL,
  "push_token" text,
  "app_version" text,
  "model" text,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "devices_platform_check" CHECK ("platform" IN ('android', 'ios', 'web'))
);
--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "devices_push_token_key" ON "devices" ("push_token");
--> statement-breakpoint

-- Codes de vérification. Le code est haché : une copie de la table ne connecte personne.
CREATE TABLE "otp_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel" text NOT NULL,
  "destination" text NOT NULL,
  "code_hash" text NOT NULL,
  "attempts" smallint NOT NULL DEFAULT 0,
  "max_attempts" smallint NOT NULL DEFAULT 5,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "request_ip" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "otp_challenges_channel_check" CHECK ("channel" IN ('phone', 'email'))
);
--> statement-breakpoint
CREATE INDEX "otp_challenges_destination_idx" ON "otp_challenges" ("destination", "created_at");
--> statement-breakpoint
CREATE INDEX "otp_challenges_expires_idx" ON "otp_challenges" ("expires_at");
--> statement-breakpoint

-- ─── Chauffeurs et véhicules ─────────────────────────────────────────────────

CREATE TABLE "driver_profiles" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "verified_at" timestamptz,
  "license_number" text,
  "license_expires_on" date,
  "rating" numeric(2,1) NOT NULL DEFAULT 5.0,
  "rides_count" integer NOT NULL DEFAULT 0,
  "acceptance_rate" real NOT NULL DEFAULT 1,
  "cancellation_rate" real NOT NULL DEFAULT 0,
  "online" boolean NOT NULL DEFAULT false,
  "current_vehicle_id" uuid,
  "cash_debt" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "driver_profiles_kind_check" CHECK ("kind" IN ('car', 'moto')),
  CONSTRAINT "driver_profiles_status_check" CHECK ("status" IN ('pending', 'approved', 'suspended', 'rejected')),
  CONSTRAINT "driver_profiles_rating_check" CHECK ("rating" >= 0 AND "rating" <= 5),
  CONSTRAINT "driver_profiles_debt_check" CHECK ("cash_debt" >= 0)
);
--> statement-breakpoint
CREATE INDEX "driver_profiles_status_idx" ON "driver_profiles" ("status", "online");
--> statement-breakpoint
CREATE TRIGGER "driver_profiles_touch" BEFORE UPDATE ON "driver_profiles"
  FOR EACH ROW EXECUTE FUNCTION vora_touch_updated_at();
--> statement-breakpoint

CREATE TABLE "vehicles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "make" text NOT NULL,
  "model" text NOT NULL,
  "color" text NOT NULL,
  -- Plaque camerounaise normalisée : lettres et chiffres, sans espaces (« CE4821AB »).
  "plate" text NOT NULL,
  "year" smallint,
  "seats" smallint NOT NULL DEFAULT 4,
  "offers" text[] NOT NULL,
  "insurance_expires_on" date,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "vehicles_kind_check" CHECK ("kind" IN ('car', 'moto')),
  CONSTRAINT "vehicles_plate_format_check" CHECK ("plate" ~ '^[A-Z0-9]{5,12}$'),
  CONSTRAINT "vehicles_offers_check" CHECK ("offers" <@ ARRAY['eco', 'confort', 'moto']::text[])
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles" ("plate");
--> statement-breakpoint
CREATE INDEX "vehicles_driver_idx" ON "vehicles" ("driver_id");
--> statement-breakpoint
ALTER TABLE "driver_profiles"
  ADD CONSTRAINT "driver_profiles_current_vehicle_fk"
  FOREIGN KEY ("current_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- ─── Géographie ──────────────────────────────────────────────────────────────

CREATE TABLE "landmarks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "aliases" text[] NOT NULL DEFAULT '{}'::text[],
  "category" text NOT NULL DEFAULT 'poi',
  "district" text,
  "city" text NOT NULL DEFAULT 'Yaoundé',
  "geom" geography(Point,4326) NOT NULL,
  "source" text NOT NULL DEFAULT 'seed',
  "confidence" smallint NOT NULL DEFAULT 50,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "landmarks_confidence_check" CHECK ("confidence" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE INDEX "landmarks_geom_idx" ON "landmarks" USING gist ("geom");
--> statement-breakpoint
-- Recherche tolérante aux fautes : « ngoa ekelle » doit trouver « Ngoa-Ekellé ».
-- unaccent() n'est pas immuable par défaut, on indexe donc les trigrammes du nom brut
-- et on désaccentue les deux côtés au moment de la comparaison.
CREATE INDEX "landmarks_name_trgm_idx" ON "landmarks" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "landmarks_name_idx" ON "landmarks" ("name");
--> statement-breakpoint
CREATE INDEX "landmarks_city_idx" ON "landmarks" ("city");
--> statement-breakpoint

CREATE TABLE "zones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "reason" text,
  "city" text NOT NULL DEFAULT 'Yaoundé',
  "geom" geography(Polygon,4326) NOT NULL,
  "published_version" integer,
  "active" boolean NOT NULL DEFAULT false,
  "bonus_amount" integer,
  "schedule" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "zones_kind_check" CHECK ("kind" IN ('moto_forbidden', 'moto_allowed', 'car_corridor', 'bonus'))
);
--> statement-breakpoint
-- Index GiST : le géorepérage moto interroge cette table à chaque devis moto.
CREATE INDEX "zones_geom_idx" ON "zones" USING gist ("geom");
--> statement-breakpoint
CREATE INDEX "zones_kind_idx" ON "zones" ("kind", "active");
--> statement-breakpoint
CREATE TRIGGER "zones_touch" BEFORE UPDATE ON "zones"
  FOR EACH ROW EXECUTE FUNCTION vora_touch_updated_at();
--> statement-breakpoint

-- ─── Tarification ────────────────────────────────────────────────────────────

CREATE TABLE "tariffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "offer" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "city" text NOT NULL DEFAULT 'Yaoundé',
  "base_fare" integer NOT NULL,
  "per_km" integer NOT NULL,
  "per_min" integer NOT NULL,
  "minimum_fare" integer NOT NULL,
  "night_surge_percent" smallint NOT NULL DEFAULT 25,
  "demand_surge_max_percent" smallint NOT NULL DEFAULT 50,
  "total_cap_percent" smallint NOT NULL DEFAULT 150,
  "commission_percent" smallint NOT NULL DEFAULT 0,
  "commission_flat" integer NOT NULL DEFAULT 0,
  "dgi_percent" smallint NOT NULL DEFAULT 1,
  "cancel_fee" integer NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "published_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tariffs_offer_check" CHECK ("offer" IN ('eco', 'confort', 'moto')),
  -- Aucun montant négatif : l'argent est en entiers de francs, jamais en flottants.
  CONSTRAINT "tariffs_amounts_check" CHECK (
    "base_fare" >= 0 AND "per_km" >= 0 AND "per_min" >= 0 AND "minimum_fare" >= 0
    AND "commission_flat" >= 0 AND "cancel_fee" >= 0
  ),
  CONSTRAINT "tariffs_percents_check" CHECK (
    "commission_percent" BETWEEN 0 AND 100 AND "dgi_percent" BETWEEN 0 AND 100
    AND "total_cap_percent" >= 100
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tariffs_offer_version_key" ON "tariffs" ("offer", "city", "version");
--> statement-breakpoint

CREATE TABLE "quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "passenger_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "offer" text NOT NULL,
  "tariff_id" uuid NOT NULL REFERENCES "tariffs"("id"),
  "pickup" geography(Point,4326) NOT NULL,
  "pickup_label" text,
  "dropoff" geography(Point,4326) NOT NULL,
  "dropoff_label" text,
  "route" geography(LineString,4326),
  "distance_m" integer NOT NULL,
  "duration_s" integer NOT NULL,
  -- « osrm » ou « fallback » : la dégradation gracieuse se montre, elle ne se cache pas.
  "routing" text NOT NULL,
  "breakdown" jsonb NOT NULL,
  "price" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'XAF',
  "night" boolean NOT NULL DEFAULT false,
  "surge_percent" smallint NOT NULL DEFAULT 0,
  -- HMAC des entrées : un prix modifié côté client est détecté à la commande.
  "signature" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "quotes_offer_check" CHECK ("offer" IN ('eco', 'confort', 'moto')),
  CONSTRAINT "quotes_routing_check" CHECK ("routing" IN ('osrm', 'fallback')),
  CONSTRAINT "quotes_price_check" CHECK ("price" > 0)
);
--> statement-breakpoint
CREATE INDEX "quotes_passenger_idx" ON "quotes" ("passenger_id", "created_at");
--> statement-breakpoint

-- ─── Courses ─────────────────────────────────────────────────────────────────

CREATE TABLE "rides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "passenger_id" uuid NOT NULL REFERENCES "users"("id"),
  "driver_id" uuid REFERENCES "users"("id"),
  "vehicle_id" uuid REFERENCES "vehicles"("id"),
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id"),
  "offer" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "pickup" geography(Point,4326) NOT NULL,
  "pickup_label" text,
  "pickup_note" text,
  "dropoff" geography(Point,4326) NOT NULL,
  "dropoff_label" text,
  "route" geography(LineString,4326),
  "price_quoted" integer NOT NULL,
  "price_final" integer,
  "distance_m" integer,
  "duration_s" integer,
  "commission" integer,
  "dgi_amount" integer,
  "driver_net" integer,
  "payment_method" text NOT NULL DEFAULT 'cash',
  "payment_status" text NOT NULL DEFAULT 'pending',
  "boarding_code_hash" text,
  "boarding_attempts" smallint NOT NULL DEFAULT 0,
  "cancelled_by" text,
  "cancel_reason" text,
  "cancel_fee" integer,
  "requested_at" timestamptz,
  "accepted_at" timestamptz,
  "arrived_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "paid_at" timestamptz,
  "version" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "rides_offer_check" CHECK ("offer" IN ('eco', 'confort', 'moto')),
  CONSTRAINT "rides_status_check" CHECK ("status" IN (
    'draft', 'requested', 'offered', 'accepted', 'approaching', 'arrived', 'in_progress',
    'completed', 'paid', 'rated', 'expired', 'cancelled_free', 'cancelled_late',
    'cancelled_driver', 'no_show'
  )),
  CONSTRAINT "rides_payment_method_check" CHECK ("payment_method" IN ('cash', 'mobile_money')),
  CONSTRAINT "rides_payment_status_check" CHECK ("payment_status" IN ('pending', 'authorized', 'paid', 'failed')),
  CONSTRAINT "rides_cancelled_by_check" CHECK ("cancelled_by" IS NULL OR "cancelled_by" IN ('passenger', 'driver', 'system', 'ops')),
  -- Le prix ferme est positif et le net du chauffeur ne peut pas être négatif.
  CONSTRAINT "rides_price_check" CHECK ("price_quoted" > 0 AND ("driver_net" IS NULL OR "driver_net" >= 0))
);
--> statement-breakpoint
CREATE INDEX "rides_passenger_idx" ON "rides" ("passenger_id", "requested_at");
--> statement-breakpoint
CREATE INDEX "rides_driver_idx" ON "rides" ("driver_id", "requested_at");
--> statement-breakpoint
-- Index partiel : les courses closes n'intéressent ni le dispatch ni la page ops.
CREATE INDEX "rides_status_idx" ON "rides" ("status")
  WHERE "status" NOT IN ('paid', 'rated', 'expired', 'cancelled_free', 'cancelled_late', 'cancelled_driver', 'no_show');
--> statement-breakpoint
CREATE TRIGGER "rides_touch" BEFORE UPDATE ON "rides"
  FOR EACH ROW EXECUTE FUNCTION vora_touch_updated_at();
--> statement-breakpoint

-- Journal append-only : la vérité de la course. rides.status n'en est qu'une projection.
CREATE TABLE "ride_events" (
  "id" bigserial PRIMARY KEY,
  "ride_id" uuid NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "from_status" text,
  "to_status" text,
  "actor_type" text NOT NULL,
  "actor_id" uuid,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ride_events_actor_check" CHECK ("actor_type" IN ('passenger', 'driver', 'system', 'ops'))
);
--> statement-breakpoint
CREATE INDEX "ride_events_ride_idx" ON "ride_events" ("ride_id", "id");
--> statement-breakpoint
-- Le journal ne se réécrit pas : c'est ce qui le rend opposable dans un litige.
-- Une exception, pas un silence : un UPDATE oublié doit se voir, pas disparaître.
-- Le DELETE reste possible, mais uniquement en cascade depuis la course (purge RGPD).
CREATE OR REPLACE FUNCTION vora_ride_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ride_events est un journal append-only : ajoutez un événement, ne modifiez pas celui-ci (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ride_events_immutable" BEFORE UPDATE ON "ride_events"
  FOR EACH ROW EXECUTE FUNCTION vora_ride_events_immutable();
--> statement-breakpoint

CREATE TABLE "dispatch_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ride_id" uuid NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
  "driver_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "wave" smallint NOT NULL,
  "rank" smallint NOT NULL DEFAULT 0,
  "score" real,
  "eta_s" integer,
  -- Net affiché au chauffeur AVANT qu'il accepte. Il doit rester vrai après la course.
  "driver_net" integer NOT NULL,
  "response" text NOT NULL DEFAULT 'pending',
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "responded_at" timestamptz,
  CONSTRAINT "dispatch_offers_response_check" CHECK ("response" IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  CONSTRAINT "dispatch_offers_wave_check" CHECK ("wave" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_offers_ride_driver_wave_key" ON "dispatch_offers" ("ride_id", "driver_id", "wave");
--> statement-breakpoint
CREATE INDEX "dispatch_offers_driver_idx" ON "dispatch_offers" ("driver_id", "response");
