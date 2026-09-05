// VORA — schémas zod du module ops.
//
// Rappel qui vaut ici plus qu'ailleurs : l'ops voit TOUT sauf les coordonnées
// personnelles. Un tableau de bord n'a jamais besoin d'un numéro de téléphone — et le
// jour où le support en a besoin, il passe par l'ID VORA (CLAUDE.md § 5.6).

import { z } from 'zod';
import { RIDE_STATUSES } from '../../domain/states.js';

// ─── Tableau de bord ─────────────────────────────────────────────────────────

export const dashboardSchema = z.object({
  /** Les six compteurs de la page ops. */
  counters: z.object({
    driversOnline: z.number().int(),
    ridesLive: z.number().int(),
    ridesToday: z.number().int(),
    /** Courses qu'aucun chauffeur n'a prises : le compteur qui dit s'il faut recruter. */
    ridesUnservedToday: z.number().int(),
    grossTodayXaf: z.number().int(),
    driverNetTodayXaf: z.number().int(),
  }),
  formatted: z.object({
    grossToday: z.string(),
    driverNetToday: z.string(),
  }),
  /** Répartition des courses vivantes : où ça coince, en un coup d'œil. */
  liveByStatus: z.array(
    z.object({ status: z.enum(RIDE_STATUSES), count: z.number().int() }),
  ),
  /** État des deux interrupteurs que l'ops peut actionner ou surveiller. */
  surge: z.object({
    percent: z.number().int(),
    reason: z.string().nullable(),
    setAt: z.string().nullable(),
  }),
  /**
   * Disjoncteur du routage. Il doit être VISIBLE : c'est la dégradation gracieuse du
   * brief, et savoir qu'on tourne en repli avant de passer devant le jury vaut mieux
   * que de le découvrir pendant (CLAUDE.md § 3).
   */
  routing: z.object({
    circuitOpen: z.boolean(),
    reopensInS: z.number().int(),
  }),
  driversPendingReview: z.number().int(),
  at: z.string(),
});

// ─── File de revue des dossiers ──────────────────────────────────────────────

export const driverQueueQuerySchema = z
  .object({ status: z.enum(['pending', 'approved', 'suspended', 'rejected']).default('pending') })
  .strict();

export const driverFileSchema = z.object({
  /** Aucun identifiant interne exposé : l'ops travaille sur l'ID VORA. */
  vora_id: z.string(),
  user_id: z.string().uuid(),
  display_name: z.string(),
  kind: z.enum(['car', 'moto']),
  status: z.enum(['pending', 'approved', 'suspended', 'rejected']),
  license_number: z.string().nullable(),
  vehicle: z
    .object({
      make: z.string(),
      model: z.string(),
      color: z.string(),
      plate: z.string(),
    })
    .nullable(),
  submitted_at: z.string(),
});

export const driverQueueSchema = z.object({
  count: z.number().int(),
  drivers: z.array(driverFileSchema),
});

export const driverDecisionParamsSchema = z.object({ userId: z.string().uuid() }).strict();

export const driverDecisionBodySchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'suspend', 'reinstate']),
    /** Motif, obligatoire pour tout ce qui n'est pas une validation. */
    reason: z.string().max(280).optional(),
  })
  .strict()
  .refine((body) => body.decision === 'approve' || body.decision === 'reinstate' || Boolean(body.reason), {
    message: 'Un refus ou une suspension demande un motif.',
    path: ['reason'],
  });

export const driverDecisionResponseSchema = z.object({
  vora_id: z.string(),
  status: z.enum(['pending', 'approved', 'suspended', 'rejected']),
  message: z.string(),
});

// ─── Majoration ──────────────────────────────────────────────────────────────

export const setSurgeBodySchema = z
  .object({
    percent: z.number().int().min(0).max(50),
    reason: z.string().max(120).optional(),
  })
  .strict();

export const surgeStateSchema = z.object({
  percent: z.number().int(),
  reason: z.string().nullable(),
  set_at: z.string().nullable(),
});

// ─── Courses récentes ────────────────────────────────────────────────────────

export const opsRideSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(RIDE_STATUSES),
  offer: z.enum(['eco', 'confort', 'moto']),
  price: z.number().int(),
  price_formatted: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  created_at: z.string(),
});

export const opsRidesSchema = z.object({ rides: z.array(opsRideSchema) });

export type DashboardDto = z.infer<typeof dashboardSchema>;
export type DriverDecisionBody = z.infer<typeof driverDecisionBodySchema>;
export type SetSurgeBody = z.infer<typeof setSurgeBodySchema>;
