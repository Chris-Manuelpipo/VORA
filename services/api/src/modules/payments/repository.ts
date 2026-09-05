// VORA — accès aux données du module payments.
// Ce module n'écrit QUE dans `payment_intents` (CLAUDE.md § 7). Le statut de la course
// appartient à `rides` : il est changé par un appel à son service, jamais par un UPDATE
// depuis ici.

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { paymentIntents, type PaymentIntent, type PaymentIntentStatus } from '../../db/schema.js';

export const PAYMENT_METHODS = ['cash', 'mobile_money'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export async function createIntent(input: {
  rideId: string;
  method: PaymentMethod;
  amount: number;
  provider: string;
}): Promise<PaymentIntent> {
  const [row] = await db.insert(paymentIntents).values(input).returning();
  if (!row) throw new Error("L'intention de paiement n'a pas été créée.");
  return row;
}

export async function settleIntent(
  intentId: string,
  status: PaymentIntentStatus,
  providerRef: string | null,
): Promise<PaymentIntent | null> {
  const [row] = await db
    .update(paymentIntents)
    .set({ status, providerRef, settledAt: new Date() })
    .where(eq(paymentIntents.id, intentId))
    .returning();
  return row ?? null;
}

/** Intention réussie déjà enregistrée pour cette course, s'il y en a une. */
export async function findSucceededIntent(rideId: string): Promise<PaymentIntent | null> {
  const [row] = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.rideId, rideId), eq(paymentIntents.status, 'succeeded')))
    .orderBy(desc(paymentIntents.createdAt))
    .limit(1);
  return row ?? null;
}
