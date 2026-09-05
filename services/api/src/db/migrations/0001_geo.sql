-- VORA — P2 : module geo. Recherche par repères et géorepérage moto.
--
-- Deux choses seulement dans cette migration, mais ce sont les deux qui font
-- l'argument produit :
--
--   1. « popularity » sur les repères. À Yaoundé on ne donne pas une adresse, on donne
--      un repère — et entre trois repères qui portent le même nom (le marché Mokolo, le
--      carrefour Mokolo, le quartier Mokolo), celui qu'on veut est presque toujours le
--      plus fréquenté. C'est le dernier départage du tri, après la similarité et la
--      distance.
--
--   2. De quoi rendre la recherche trigramme INDEXABLE. Le § 4 de 0000_socle.sql posait
--      un index sur « name » brut, que la requête ne pouvait pas utiliser : elle compare
--      du texte désaccentué et mis en minuscules, et elle regarde aussi les alias et le
--      quartier. On indexe donc l'expression exacte que la requête interroge.

-- ─── Popularité ──────────────────────────────────────────────────────────────

ALTER TABLE "landmarks"
  ADD COLUMN "popularity" smallint NOT NULL DEFAULT 50;
--> statement-breakpoint
ALTER TABLE "landmarks"
  ADD CONSTRAINT "landmarks_popularity_check" CHECK ("popularity" BETWEEN 0 AND 100);
--> statement-breakpoint

-- ─── Normalisation indexable ─────────────────────────────────────────────────

-- unaccent() est déclarée STABLE, pas IMMUTABLE : elle dépend d'un dictionnaire que
-- l'administrateur pourrait recharger. PostgreSQL refuse donc de l'utiliser dans un
-- index. L'enveloppe ci-dessous est la recette standard : on fige le dictionnaire
-- (première forme à deux arguments), ce qui rend la fonction réellement déterministe.
-- Corollaire à connaître : si quelqu'un modifie le dictionnaire unaccent, il faut
-- REINDEX. Personne ne le fera ici, et la migration le dit pour que ça ne surprenne pas.
CREATE OR REPLACE FUNCTION vora_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
--> statement-breakpoint

-- Le texte réellement interrogé par la recherche : nom + alias + quartier, désaccentué,
-- en minuscules. Un seul champ, donc un seul index, et surtout une seule définition de
-- « ce sur quoi on cherche » — partagée par l'index et par la requête.
--
-- array_to_string() est catalogué STABLE parce que la sortie d'un élément peut dépendre
-- de la session (un timestamptz dépend du fuseau). Pour un text[], la conversion est
-- l'identité : marquer cette fonction IMMUTABLE n'est pas un mensonge de confort, c'est
-- exact pour le type qu'on lui passe — et la colonne "aliases" est déclarée text[].
CREATE OR REPLACE FUNCTION vora_landmark_haystack(name text, aliases text[], district text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE
AS $$
  SELECT vora_unaccent(lower(
    coalesce(name, '')
    || ' ' || coalesce(array_to_string(aliases, ' '), '')
    || ' ' || coalesce(district, '')
  ))
$$;
--> statement-breakpoint

-- gin_trgm_ops sert les trois opérateurs dont la recherche a besoin :
--   %   similarité globale        « carrefour bastos » → « Carrefour Bastos »
--   <%  similarité de mot         « melen »            → « Pharmacie de Melen »
--   LIKE '%…%'                    « acacia »           → « Carrefour Acacias »
CREATE INDEX "landmarks_haystack_trgm_idx" ON "landmarks"
  USING gin (vora_landmark_haystack("name", "aliases", "district") gin_trgm_ops);
--> statement-breakpoint

-- Remplacé par l'index ci-dessus : celui-ci portait sur le nom accentué, que la requête
-- ne compare jamais tel quel. Un index que personne ne lit coûte à chaque écriture.
DROP INDEX IF EXISTS "landmarks_name_trgm_idx";
--> statement-breakpoint

-- ─── Identité d'un repère et d'une zone ──────────────────────────────────────

-- (ville, nom) identifie un repère. Sans cette clé, `npm run seed` ne pouvait
-- qu'insérer ou passer son tour : corriger une coordonnée sur le terrain demandait un
-- db:reset. Avec elle, le seed est un vrai upsert — on relève un point au GPS, on
-- change la constante, on relance le seed, la base suit.
CREATE UNIQUE INDEX "landmarks_city_name_key" ON "landmarks" ("city", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX "zones_city_name_key" ON "zones" ("city", "name");
