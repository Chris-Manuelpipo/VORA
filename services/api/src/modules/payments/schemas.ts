// VORA — schémas zod du module payments.

import { z } from 'zod';

export const paymentMethodsResponseSchema = z.object({
  provider: z.enum(['simulated']),
  methods: z.array(z.enum(['cash', 'mobile_money'])),
  simulated_delay_ms: z.number().int(),
});

/**
 * Réponse du Mobile Money, dans le vocabulaire du FOURNISSEUR — `pending`, `succeeded`,
 * `failed` — et non dans celui de la course. Les deux ne se confondent pas : un
 * paiement peut réussir alors que la course, elle, est en litige.
 */
export const mobileMoneyResponseSchema = z.object({
  intentId: z.string().uuid(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  amount: z.number().int(),
  /** « 1 625 FCFA » — forme longue, celle des reçus (CLAUDE.md § 6.2). */
  amountFormatted: z.string(),
});

export type PaymentMethodsResponse = z.infer<typeof paymentMethodsResponseSchema>;
export type MobileMoneyResponse = z.infer<typeof mobileMoneyResponseSchema>;
