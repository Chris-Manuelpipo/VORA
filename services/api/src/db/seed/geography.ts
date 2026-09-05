// VORA — mise en base des repères et des zones.
//
// Isolé de `seed/index.ts` pour une raison précise : LES TESTS D'INTÉGRATION APPELLENT
// CES MÊMES FONCTIONS. `npm test` monte une base vierge, y applique les migrations, puis
// sème avec ce fichier — les tests de géorepérage travaillent donc sur les polygones qui
// partiront en démonstration, pas sur des carrés fabriqués pour l'occasion. Un test qui
// valide une autre géométrie que la production ne valide rien.
//
// Ces fonctions ne journalisent pas : elles rendent un compte rendu, et l'appelant décide
// s'il l'affiche (le script) ou l'ignore (les tests).

import { and, eq, inArray, not, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { landmarks, zones } from '../schema.js';
import { LANDMARK_SEED } from './landmarks.js';
import { RETIRED_ZONE_NAMES, ZONE_SEED } from './zones.js';

export const SEED_CITY = 'Yaoundé';

export interface LandmarkSeedReport {
  written: number;
  retired: string[];
}

/**
 * Repères de Yaoundé. C'est un UPSERT sur (ville, nom), pas un « insérer si absent » :
 * quand un chauffeur corrige une coordonnée sur le terrain, on met à jour la constante
 * de `landmarks.ts` et `npm run seed` la propage. Sans ça, une correction demanderait un
 * `db:reset` — c'est-à-dire ne se ferait jamais.
 */
export async function seedLandmarks(): Promise<LandmarkSeedReport> {
  const rows = LANDMARK_SEED.map((landmark) => ({
    name: landmark.name,
    aliases: landmark.aliases,
    category: landmark.category,
    district: landmark.district,
    city: SEED_CITY,
    geom: { lat: landmark.lat, lng: landmark.lng },
    source: 'seed',
    confidence: landmark.confidence,
    popularity: landmark.popularity,
    active: true,
  }));

  await db
    .insert(landmarks)
    .values(rows)
    .onConflictDoUpdate({
      target: [landmarks.city, landmarks.name],
      set: {
        aliases: sql`excluded.aliases`,
        category: sql`excluded.category`,
        district: sql`excluded.district`,
        geom: sql`excluded.geom`,
        confidence: sql`excluded.confidence`,
        popularity: sql`excluded.popularity`,
        active: sql`excluded.active`,
      },
      // Un repère corrigé par un chauffeur vaut mieux que notre estimation : on ne
      // l'écrase pas avec une coordonnée posée de mémoire.
      setWhere: eq(landmarks.source, 'seed'),
    });

  // Un repère retiré du fichier de données disparaît de la recherche sans être effacé :
  // une course passée a pu s'y référer, et son historique doit rester lisible.
  const retired = await db
    .update(landmarks)
    .set({ active: false })
    .where(
      and(
        eq(landmarks.source, 'seed'),
        eq(landmarks.city, SEED_CITY),
        eq(landmarks.active, true),
        not(
          inArray(
            landmarks.name,
            LANDMARK_SEED.map((landmark) => landmark.name),
          ),
        ),
      ),
    )
    .returning({ name: landmarks.name });

  return { written: rows.length, retired: retired.map((row) => row.name) };
}

export interface ZoneSeedReport {
  written: number;
  retired: string[];
}

/**
 * Zones réglementaires. Même upsert, même raison : le tracé de l'arrêté sera corrigé, et
 * il doit pouvoir l'être sans reconstruire la base.
 */
export async function seedZones(): Promise<ZoneSeedReport> {
  const rows = ZONE_SEED.map((zone) => ({
    kind: zone.kind,
    name: zone.name,
    reason: zone.reason,
    city: SEED_CITY,
    geom: [zone.ring],
    publishedVersion: 1,
    active: zone.active,
  }));

  await db
    .insert(zones)
    .values(rows)
    .onConflictDoUpdate({
      target: [zones.city, zones.name],
      set: {
        kind: sql`excluded.kind`,
        reason: sql`excluded.reason`,
        geom: sql`excluded.geom`,
        publishedVersion: sql`excluded.published_version`,
        active: sql`excluded.active`,
      },
    });

  // Désactivée, pas supprimée : une zone a pu servir à refuser une course, et le motif
  // d'un refus doit rester consultable.
  const retired =
    RETIRED_ZONE_NAMES.length === 0
      ? []
      : await db
          .update(zones)
          .set({ active: false })
          .where(
            and(
              eq(zones.city, SEED_CITY),
              eq(zones.active, true),
              inArray(zones.name, RETIRED_ZONE_NAMES),
            ),
          )
          .returning({ name: zones.name });

  return { written: rows.length, retired: retired.map((row) => row.name) };
}
