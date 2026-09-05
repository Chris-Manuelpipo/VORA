-- VORA — extensions requises, jouées à la création du volume Postgres.
-- postgis   : geography(Point/Polygon/LineString, 4326), ST_Intersects pour le géorepérage moto
-- pg_trgm   : recherche de repères tolérante aux fautes (trigrammes sur nom + alias)
-- unaccent  : « Ngoa-Ekellé » trouvé en tapant « ngoa ekelle »
-- pgcrypto  : gen_random_uuid(), hachage du code de montée

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
