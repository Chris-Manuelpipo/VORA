// VORA — accès aux données du module geo.
//
// Deux choses se jouent ici, et elles justifient à elles seules PostGIS :
//   · la RECHERCHE PAR REPÈRES — à Yaoundé on ne cherche pas une adresse, on cherche
//     « Carrefour Warda » ou « la pharmacie de Melen », souvent mal orthographié ;
//   · le GÉOREPÉRAGE MOTO — `ST_Intersects` en base, jamais une approximation côté appli
//     (CLAUDE.md § 5.5).
//
// Les requêtes spatiales sont en SQL brut : c'est le choix assumé de CLAUDE.md § 3 (ORM
// Drizzle, SQL brut pour PostGIS), et ce SQL-là se relit mieux qu'une abstraction.

import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { LatLng } from '../../db/geography.js';
import { lineToEwkt, pointToEwkt } from '../../db/geography.js';
import type { ZoneKind } from '../../db/schema.js';
import type { PreparedQuery } from './query.js';

const CITY = 'Yaoundé';

export interface LandmarkRow {
  id: string;
  name: string;
  category: string;
  district: string | null;
  lat: number;
  lng: number;
  distance_m: number | null;
  popularity: number;
  confidence: number;
  score: number;
}

/**
 * Recherche de repères, tolérante aux fautes, aux accents et aux phrases entières.
 *
 * Le texte interrogé est `vora_landmark_haystack(name, aliases, district)` — la fonction
 * IMMUTABLE de la migration 0001, celle-là même qui porte l'index GIN trigramme. Index et
 * requête partagent donc UNE seule définition de « ce sur quoi on cherche » : elles ne
 * peuvent pas diverger.
 *
 * Ce que fait l'index AUJOURD'HUI, pour ne pas le raconter de travers : à ~120 repères, le
 * planificateur ne le prend pas — il filtre les 120 lignes, ce qui coûte 20 à 40 ms, et
 * c'est le bon choix. L'index est bien utilisable (`EXPLAIN` avec `enable_seqscan=off`
 * donne un Bitmap Index Scan) et il prendra le relais quand les chauffeurs auront rempli
 * la base. Il est là pour ce jour-là, pas pour aujourd'hui.
 *
 * Le filet de rappel est volontairement large, quatre mailles :
 *   LIKE '%phrase%'  la saisie est contenue telle quelle  « mokolo » → « Marché Mokolo »
 *   haystack % phrase        similarité globale           « carefour warda » (faute)
 *   haystack %> phrase       similarité de mot            « melen » → « Pharmacie de Melen »
 *   un terme utile contenu   phrase bavarde               « en face de la pharmacie de melen »
 *
 * Le tri, lui, est celui demandé : similarité, puis distance, puis popularité.
 * L'arrondi de la similarité à deux décimales n'est pas cosmétique — sans lui, deux
 * repères également pertinents diffèrent au dix-millième et la distance ne départage
 * jamais rien. Arrondie, elle forme des paliers, et c'est la proximité qui tranche à
 * l'intérieur d'un palier. C'est exactement ce qu'on veut : entre deux « Mokolo », prendre
 * celui d'à côté.
 *
 * Sécurité du LIKE : `prepareQuery` a déjà réduit la saisie à [a-z0-9 ]. Ni `%` ni `_`
 * ne peuvent survivre, donc aucun joker ne peut être injecté par le passager.
 */
export async function searchLandmarks(
  prepared: PreparedQuery,
  options: { limit?: number; near?: LatLng } = {},
): Promise<LandmarkRow[]> {
  const limit = options.limit ?? 10;
  const near = options.near ? pointToEwkt(options.near) : null;

  // Drizzle ne sait pas lier un tableau JavaScript comme paramètre `text[]` : il en
  // dépose le premier élément et PostgreSQL refuse le littéral. On envoie donc les
  // termes en une chaîne et on laisse PostgreSQL reconstruire le tableau. L'espace est
  // un séparateur sûr : `prepareQuery` a réduit chaque terme à [a-z0-9].
  const terms = prepared.terms.join(' ');

  const result = await db.execute(sql`
    with input as (
      select
        ${prepared.phrase}::text as phrase,
        coalesce(string_to_array(nullif(${terms}::text, ''), ' '), '{}'::text[]) as terms
    ),
    matched as (
      select
        l.id,
        l.name,
        l.category,
        l.district,
        l.popularity,
        l.confidence,
        ST_Y(l.geom::geometry) as lat,
        ST_X(l.geom::geometry) as lng,
        case
          when ${near}::text is null then null
          else round(ST_Distance(l.geom, ${near}::geography))::int
        end as distance_m,
        vora_landmark_haystack(l.name, l.aliases, l.district) as haystack,
        i.phrase,
        i.terms
      from landmarks l
      cross join input i
      where l.active
        and l.city = ${CITY}
        and (
          vora_landmark_haystack(l.name, l.aliases, l.district) like '%' || i.phrase || '%'
          or vora_landmark_haystack(l.name, l.aliases, l.district) % i.phrase
          or vora_landmark_haystack(l.name, l.aliases, l.district) %> i.phrase
          or exists (
            select 1
            from unnest(i.terms) as t
            where vora_landmark_haystack(l.name, l.aliases, l.district) like '%' || t || '%'
               or vora_landmark_haystack(l.name, l.aliases, l.district) %> t
          )
        )
    ),
    scored as (
      select
        m.*,
        greatest(
          -- La saisie entière figure dans le repère : c'est le signal le plus fort qui soit.
          case when m.haystack like '%' || m.phrase || '%' then 1.0 else 0.0 end,
          similarity(m.haystack, m.phrase)::numeric,
          word_similarity(m.phrase, m.haystack)::numeric,
          -- Tous les mots utiles présents vaut presque autant, mais jamais autant : une
          -- correspondance exacte reste devant une correspondance éparpillée.
          0.9 * (
            select count(*)::numeric / greatest(cardinality(m.terms), 1)
            from unnest(m.terms) as t
            where m.haystack like '%' || t || '%'
          )
        ) as score
      from matched m
    )
    select id, name, category, district, lat, lng, distance_m, popularity, confidence, score
    from scored
    order by
      round(score, 2) desc,
      distance_m asc nulls last,
      popularity desc,
      name asc
    limit ${limit}
  `);

  return result.rows as unknown as LandmarkRow[];
}

export interface ZoneRow {
  id: string;
  kind: ZoneKind;
  name: string;
  reason: string | null;
  bonus_amount: number | null;
  /** GeoJSON produit par PostGIS, directement affichable par flutter_map et la page ops. */
  geometry: unknown;
}

/**
 * Zones publiées et actives. Le géorepérage n'utilise QUE celles-là : une zone en
 * préparation ne refuse aucune course, et une zone retirée cesse d'agir sans être
 * effacée (le motif d'un refus passé doit rester consultable).
 */
export async function listActiveZones(kind?: ZoneKind): Promise<ZoneRow[]> {
  const filter = kind ?? null;

  const result = await db.execute(sql`
    select
      z.id,
      z.kind,
      z.name,
      z.reason,
      z.bonus_amount,
      ST_AsGeoJSON(z.geom)::json as geometry
    from zones z
    where z.active
      and z.city = ${CITY}
      and (${filter}::text is null or z.kind = ${filter}::text)
    order by z.kind, z.name
  `);

  return result.rows as unknown as ZoneRow[];
}

export interface ForbiddenZoneHit {
  id: string;
  name: string;
  reason: string | null;
  geometry: unknown;
}

/**
 * LA REQUÊTE QUI PORTE LA RÈGLE. Le trajet touche-t-il une zone interdite aux motos ?
 *
 * On lui passe la SUITE COMPLÈTE de points — départ, itinéraire, arrivée — assemblée en
 * LINESTRING. `ST_Intersects` en geography travaille sur la sphère : un seul point commun
 * avec une zone active, fût-il au milieu du trajet, suffit à refuser la course. C'est la
 * lettre de CLAUDE.md § 5.5 : « dont le départ, l'arrivée OU l'itinéraire touche ».
 *
 * L'index GiST `zones_geom_idx` sert le filtre de boîte englobante ; le calcul exact ne
 * porte ensuite que sur les rares zones candidates.
 *
 * Le trajet dégénéré (départ = arrivée) devient un POINT : `ST_Intersects` accepte les
 * deux, et un LINESTRING de deux points identiques n'a pas de sens géométrique.
 */
export async function findMotoForbiddenZones(points: LatLng[]): Promise<ForbiddenZoneHit[]> {
  const path = dedupeConsecutive(points);
  if (path.length === 0) return [];

  const geometry = path.length === 1 ? pointToEwkt(path[0]!) : lineToEwkt(path);

  const result = await db.execute(sql`
    select z.id, z.name, z.reason, ST_AsGeoJSON(z.geom)::json as geometry
    from zones z
    where z.active
      and z.kind = 'moto_forbidden'
      and ST_Intersects(z.geom, ${geometry}::geography)
    order by z.name
  `);

  return result.rows as unknown as ForbiddenZoneHit[];
}

/**
 * OSRM répète parfois un point (arrêt, nœud dupliqué). Deux points identiques d'affilée
 * ne changent rien à la géométrie mais font grossir le EWKT — et un trajet entièrement
 * immobile deviendrait un LINESTRING invalide.
 */
function dedupeConsecutive(points: LatLng[]): LatLng[] {
  const output: LatLng[] = [];
  for (const point of points) {
    const previous = output[output.length - 1];
    if (previous && previous.lat === point.lat && previous.lng === point.lng) continue;
    output.push(point);
  }
  return output;
}
