// VORA — accès aux données du module pricing : la grille tarifaire publiée.
// Ce module n'écrit que dans `tariffs` et `quotes` (les devis arrivent en P3).

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { quotes, tariffs, type Quote, type Tariff } from '../../db/schema.js';
import type { Offer } from '../../domain/rules.js';

const DEFAULT_CITY = 'Yaoundé';

/** Grille active la plus récente pour une offre. */
export async function findActiveTariff(
  offer: Offer,
  city: string = DEFAULT_CITY,
): Promise<Tariff | null> {
  const [row] = await db
    .select()
    .from(tariffs)
    .where(and(eq(tariffs.offer, offer), eq(tariffs.city, city), eq(tariffs.active, true)))
    .orderBy(desc(tariffs.version))
    .limit(1);
  return row ?? null;
}

/** Toutes les grilles actives : ce que l'appli affiche avant même de saisir une destination. */
export async function listActiveTariffs(city: string = DEFAULT_CITY): Promise<Tariff[]> {
  return db
    .select()
    .from(tariffs)
    .where(and(eq(tariffs.city, city), eq(tariffs.active, true)))
    .orderBy(tariffs.offer, desc(tariffs.version));
}

// ─── Devis ───────────────────────────────────────────────────────────────────

/**
 * Enregistre un devis. Une LIGNE PAR OFFRE : la table porte un prix, une offre et une
 * signature, et c'est bien ainsi — le passager choisit une offre, il commande ce
 * devis-là, et le prix qu'il a vu est celui qui est stocké, pas un des trois.
 */
export async function insertQuote(values: typeof quotes.$inferInsert): Promise<Quote> {
  const [row] = await db.insert(quotes).values(values).returning();
  if (!row) throw new Error("Le devis n'a pas été enregistré.");
  return row;
}

export async function findQuoteById(quoteId: string): Promise<Quote | null> {
  const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  return row ?? null;
}

/**
 * Consomme un devis, et une seule fois.
 *
 * Le `where` porte sur `consumed_at IS NULL` : deux `POST /v1/rides` simultanés avec le
 * même devis (double tap, reprise réseau) n'aboutissent pas à deux courses. Le second
 * reçoit `null` et l'idempotence prend le relais pour lui rendre la course déjà créée.
 */
export async function consumeQuote(quoteId: string): Promise<Quote | null> {
  const [row] = await db
    .update(quotes)
    .set({ consumedAt: sql`now()` })
    .where(and(eq(quotes.id, quoteId), isNull(quotes.consumedAt)))
    .returning();
  return row ?? null;
}
