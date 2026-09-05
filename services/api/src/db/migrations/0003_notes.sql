-- VORA — notation des deux côtés.
--
-- Une seule table ici, et une raison simple : la note du chauffeur pèse 10 % dans le
-- score de dispatch (CLAUDE.md § 5.4). Elle ne peut donc pas être un champ qu'on
-- écrase — il faut savoir QUI a noté QUOI, sinon une note contestée n'est pas
-- arbitrable et un chauffeur ne peut pas comprendre pourquoi son score baisse.
--
-- `driver_profiles.rating` reste la moyenne, recalculée à chaque note à partir d'ici :
-- c'est une projection, comme `rides.status` l'est de `ride_events`.
--
-- Le SOS et le partage de trajet, eux, n'ont PAS de table : ce sont des événements de
-- course, ils vivent dans `ride_events` avec leur charge utile. Un lien de partage est
-- un jeton signé, pas une ligne — rien à stocker, rien à révoquer, rien à purger.

CREATE TABLE "ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ride_id" uuid NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
  "rater_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "ratee_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "stars" smallint NOT NULL,
  -- Motifs prédéfinis (« conduite prudente », « véhicule propre »…). Pas de texte
  -- libre échangé entre les parties : la messagerie est coupée (CLAUDE.md § 8.3).
  "tags" text[] NOT NULL DEFAULT '{}'::text[],
  -- Commentaire destiné à VORA, jamais affiché à l'autre partie.
  "comment" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5),
  CONSTRAINT "ratings_self_check" CHECK ("rater_id" <> "ratee_id")
);
--> statement-breakpoint
-- On note une course une fois. Le second appui sur « Envoyer » ne double pas la note.
CREATE UNIQUE INDEX "ratings_ride_rater_key" ON "ratings" ("ride_id", "rater_id");
--> statement-breakpoint
CREATE INDEX "ratings_ratee_idx" ON "ratings" ("ratee_id", "created_at");
