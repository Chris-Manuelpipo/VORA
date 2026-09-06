-- VORA — stockage des images (photo de profil).
--
-- OÙ VIVENT LES OCTETS, ET POURQUOI ICI. Trois options se présentaient :
--
--   1. le disque local — écarté. La plateforme de déploiement (Clever Cloud,
--      `infra/deploy/CLEVER_CLOUD.md`) remonte un système de fichiers ÉPHÉMÈRE : les
--      photos disparaîtraient au redéploiement suivant, et la panne serait silencieuse.
--      Elle interdirait aussi de répliquer l'API.
--   2. un stockage objet (S3, Cloudinary) — écarté pour le hackathon. C'est un compte à
--      ouvrir, des secrets à distribuer et un SDK de plus, pour une fonctionnalité qui
--      tient en une colonne. C'est la CIBLE, pas l'étape.
--   3. PostgreSQL — retenu. Zéro infrastructure de plus, sauvegardé avec le reste,
--      transactionnel avec la ligne `users` qui le référence.
--
-- CE QUE ÇA COÛTE, ET QU'IL FAUT DIRE AU JURY : une base de données n'est pas un CDN.
-- Chaque photo transite par le processus Node au lieu d'être servie par un cache en
-- bordure. À l'échelle de la démonstration (quelques dizaines d'avatars de 60 Ko), c'est
-- invisible ; à l'échelle de Yaoundé, cette table devient un compartiment S3 et
-- `photo_key` devient une URL. Le reste du code ne bouge pas : il ne connaît qu'une clé.

CREATE TABLE "media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Le propriétaire. `ON DELETE CASCADE` : supprimer un compte emporte ses images, sans
  -- ménage à faire ailleurs.
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- À quoi sert cette image. Une seule valeur aujourd'hui ; la photo du point de
  -- rendez-vous (PA-10) et les pièces du dossier chauffeur (CH-03 → CH-06) viendront ici,
  -- et ce sera une ligne de migration, pas une table de plus.
  "purpose" text NOT NULL,
  -- Type RÉEL, déduit des octets par `lib/images.ts` — jamais l'en-tête annoncé par le
  -- client. C'est ce qui empêche de stocker un fichier HTML sous une extension d'image,
  -- puis de le resservir à un navigateur.
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  -- Empreinte du contenu : sert d'ETag pour le cache du téléphone, et repère un même
  -- fichier réenvoyé.
  "sha256" text NOT NULL,
  "bytes" bytea NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "media_purpose_check" CHECK ("purpose" IN ('avatar')),
  CONSTRAINT "media_mime_check" CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  -- 2 Mo. La borne est aussi dans `lib/images.ts` et dans la route ; ici, elle protège la
  -- base d'une écriture qui aurait contourné les deux autres.
  CONSTRAINT "media_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 2097152)
);
--> statement-breakpoint
CREATE INDEX "media_owner_idx" ON "media" ("owner_id", "purpose");
--> statement-breakpoint
-- Une image ne se modifie pas : on en envoie une nouvelle, et l'ancienne est supprimée.
-- Sans cela, un identifiant déjà distribué et mis en cache par les téléphones pourrait
-- soudain rendre une autre photo.
CREATE OR REPLACE FUNCTION vora_media_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'media est immuable : envoyez une nouvelle image, ne modifiez pas celle-ci (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "media_immutable" BEFORE UPDATE ON "media"
  FOR EACH ROW EXECUTE FUNCTION vora_media_immutable();
