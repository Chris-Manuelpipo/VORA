-- VORA — profil personnel et contacts de confiance, remplis à l'onboarding.
--
-- ÉCART ASSUMÉ AVEC `docs/` : la vision UX (PA-05) ne demandait que le prénom, au nom
-- d'une promesse explicite — « elle ne veut pas remplir un formulaire ». On collecte
-- désormais le nom, le sexe et la date de naissance. Décision produit prise après coup,
-- documentée dans `src/domain/profile.ts` et dans le README.
--
-- CE QUE ÇA N'AUTORISE PAS. Ces trois colonnes sont des PII : elles ne sortent jamais
-- vers l'autre partie. Le chauffeur voit « Aïcha », pas « Aïcha Mballa, 27 ans ». La
-- barrière n'est pas ici — elle est dans les DTO (`toPublicUserDto`, `toSharedRideDto`)
-- et dans le contexte de l'assistant de support, tous vérifiés par des tests.
--
-- `display_name` reste le PRÉNOM, et ne change pas de sens : c'est lui que lit
-- `firstName()` pour la fiche chauffeur. On ajoute `family_name` à côté plutôt que de
-- fusionner les deux, parce qu'un « nom complet » se sépare mal (et se sépare mal
-- différemment selon les pays).

ALTER TABLE "users"
  ADD COLUMN "family_name" text,
  ADD COLUMN "sex" text,
  ADD COLUMN "birth_date" date,
  -- Quand l'onboarding a été passé. NULL = jamais vu : l'application doit le proposer.
  -- Ce n'est pas déductible des autres colonnes : quelqu'un qui a répondu « Plus tard »
  -- à la photo et aux contacts a bien terminé son onboarding, et ne doit pas le revoir
  -- à chaque connexion.
  ADD COLUMN "onboarded_at" timestamptz;
--> statement-breakpoint
-- Trois valeurs, dont une qui dit « je préfère ne pas dire ». Un refus de répondre est
-- une réponse : le distinguer d'un champ vide évite de reposer la question à l'infini.
ALTER TABLE "users"
  ADD CONSTRAINT "users_sex_check"
  CHECK ("sex" IS NULL OR "sex" IN ('female', 'male', 'undisclosed'));
--> statement-breakpoint
-- Garde-fou de SAISIE, pas règle d'âge : aucun document du projet ne fixe d'âge minimum,
-- et l'inventer en base reviendrait à décider seul qu'un lycéen ne peut pas commander.
-- Une date dans le futur ou un âge de 150 ans, en revanche, est une faute de frappe.
ALTER TABLE "users"
  ADD CONSTRAINT "users_birth_date_check"
  CHECK ("birth_date" IS NULL OR ("birth_date" > '1900-01-01' AND "birth_date" < CURRENT_DATE));
--> statement-breakpoint

-- ─── Contacts de confiance (PA-07) ──────────────────────────────────────────
--
-- Jusqu'à trois personnes à prévenir en cas de SOS. Elles n'ont pas de compte VORA et
-- n'en auront pas : ce sont des numéros que leur propriétaire nous confie, et qui ne
-- servent qu'à ça. Le numéro ne ressort jamais entier de l'API — même à son propriétaire,
-- qui n'en a pas besoin pour reconnaître « Maman ».

CREATE TABLE "trusted_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  -- E.164, normalisé comme un numéro de compte (+2376XXXXXXXX).
  "phone" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "trusted_contacts_user_idx" ON "trusted_contacts" ("user_id", "created_at");
--> statement-breakpoint
-- Deux fois le même numéro, c'est une double saisie, pas deux contacts.
CREATE UNIQUE INDEX "trusted_contacts_user_phone_key" ON "trusted_contacts" ("user_id", "phone");
