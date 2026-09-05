-- VORA — P3 : commande, dispatch, encaissement.
--
-- Le socle (0000) portait déjà `rides`, `ride_events`, `quotes` et `dispatch_offers`.
-- Cette migration ajoute les quatre choses que la boucle complète a réclamées, et rien
-- d'autre :
--
--   1. `idempotency_keys` — CLAUDE.md § 9 : « Idempotency-Key obligatoire sur les
--      créations ». Un passager qui appuie deux fois sur « Commander », ou dont le
--      téléphone renvoie la requête après une coupure, ne doit pas se retrouver avec
--      deux courses et deux chauffeurs. La clé porte la réponse déjà donnée.
--
--   2. `driver_earnings` — CLAUDE.md § 3 : le net est calculé directement et stocké sur
--      la course ET dans cette table. Le ledger en double entrée (ADR-008) reste hors
--      périmètre ; ce qu'il faut ici, c'est pouvoir répondre « combien Boris a-t-il
--      gagné aujourd'hui » sans rejouer les courses, frais d'annulation compris.
--
--   3. `payment_intents` — l'adaptateur Mobile Money est simulé (CLAUDE.md § 8.2), mais
--      sa TRACE ne l'est pas : une intention de paiement, un statut, une référence
--      fournisseur. Brancher MTN ou Orange remplira les mêmes colonnes.
--
--   4. `rides.driver_odometer_start_m` — l'annulation est gratuite « tant que le
--      chauffeur a parcouru moins de 300 m » (§ 5.3). Il faut donc un point zéro : le
--      compteur du chauffeur au moment où il a accepté. Sans lui, la règle se
--      transformerait en « à moins de 300 m du point de départ », qui n'est pas la même
--      chose et qui punit le chauffeur qui a fait le tour du pâté de maisons.

-- ─── Idempotence des créations ───────────────────────────────────────────────

CREATE TABLE "idempotency_keys" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "key" text NOT NULL,
  "ride_id" uuid REFERENCES "rides"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  -- La clé n'est unique que pour SON auteur et SON endpoint : deux passagers qui
  -- tirent la même clé (c'est arrivé, les UUID v4 mal semés existent) ne se volent
  -- pas leur course.
  PRIMARY KEY ("user_id", "endpoint", "key")
);
--> statement-breakpoint
CREATE INDEX "idempotency_keys_ride_idx" ON "idempotency_keys" ("ride_id");
--> statement-breakpoint

-- ─── Argent du chauffeur ─────────────────────────────────────────────────────

CREATE TABLE "driver_earnings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ride_id" uuid NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
  "driver_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- D'où vient cette ligne : la course elle-même, un frais d'annulation tardive, ou un
  -- frais de passager absent. Les trois se paient, les trois s'affichent.
  "source" text NOT NULL,
  "gross" integer NOT NULL,
  "commission" integer NOT NULL,
  "dgi" integer NOT NULL,
  "net" integer NOT NULL,
  "payment_method" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "driver_earnings_source_check" CHECK ("source" IN ('ride', 'cancel_fee', 'no_show_fee')),
  CONSTRAINT "driver_earnings_method_check" CHECK ("payment_method" IN ('cash', 'mobile_money')),
  -- La base refuse un net incohérent. C'est le troisième moment de vérité : il vaut
  -- mieux une insertion qui échoue qu'un chauffeur qui découvre un montant faux.
  CONSTRAINT "driver_earnings_net_check" CHECK ("net" = "gross" - "commission" - "dgi"),
  CONSTRAINT "driver_earnings_positive_check" CHECK ("gross" >= 0 AND "commission" >= 0 AND "dgi" >= 0 AND "net" >= 0)
);
--> statement-breakpoint
-- Une course ne crédite qu'UNE fois chaque nature de gain : le double clic du chauffeur
-- sur « Encaissé » ne double pas sa recette.
CREATE UNIQUE INDEX "driver_earnings_ride_source_key" ON "driver_earnings" ("ride_id", "source");
--> statement-breakpoint
CREATE INDEX "driver_earnings_driver_idx" ON "driver_earnings" ("driver_id", "created_at");
--> statement-breakpoint

-- ─── Paiements ───────────────────────────────────────────────────────────────

CREATE TABLE "payment_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ride_id" uuid NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
  "method" text NOT NULL,
  "amount" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  -- `simulated` aujourd'hui, `mtn_momo` / `orange_money` demain. La colonne existe pour
  -- que la bascule ne soit pas une migration.
  "provider" text NOT NULL DEFAULT 'simulated',
  "provider_ref" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "settled_at" timestamptz,
  CONSTRAINT "payment_intents_method_check" CHECK ("method" IN ('cash', 'mobile_money')),
  CONSTRAINT "payment_intents_status_check" CHECK ("status" IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT "payment_intents_amount_check" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE INDEX "payment_intents_ride_idx" ON "payment_intents" ("ride_id", "created_at");
--> statement-breakpoint

-- ─── Point zéro du compteur chauffeur ────────────────────────────────────────

ALTER TABLE "rides"
  ADD COLUMN "driver_odometer_start_m" integer;
