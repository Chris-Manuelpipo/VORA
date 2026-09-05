// VORA — schémas zod du module identity : validation des entrées ET contrat de sortie.
//
// Les schémas de RÉPONSE ne sont pas décoratifs : Fastify sérialise à travers eux, donc
// toute propriété non déclarée est retirée de la réponse. C'est le filet mécanique de la
// règle « aucune PII vers l'autre partie » (CLAUDE.md § 5.6) : même si un jour un service
// renvoyait une entité brute, `phone` et `email` ne franchiraient pas la frontière.

import { z } from 'zod';

// ─── Entrées ─────────────────────────────────────────────────────────────────

export const channelSchema = z.enum(['phone', 'email']);

export const otpRequestBodySchema = z
  .object({
    channel: channelSchema,
    /** Numéro camerounais ou e-mail, sous n'importe quelle graphie usuelle. */
    value: z.string().trim().min(3).max(160),
  })
  .strict();

export const otpVerifyBodySchema = z
  .object({
    value: z.string().trim().min(3).max(160),
    code: z.string().trim().regex(/^\d{6}$/, 'Le code compte 6 chiffres.'),
    /** Détermine le compte créé si la personne est nouvelle. L'ops ne s'inscrit pas ainsi. */
    role: z.enum(['passenger', 'driver']).default('passenger'),
    /** Facultatif : évite un aller-retour par PATCH /v1/me juste après l'inscription. */
    display_name: z.string().trim().min(2).max(60).optional(),
    /** Le chauffeur déclare s'il roule en voiture ou en moto dès l'inscription. */
    driver_kind: z.enum(['car', 'moto']).optional(),
    device: z
      .object({
        platform: z.enum(['android', 'ios', 'web']),
        push_token: z.string().min(8).max(512).optional(),
        app_version: z.string().max(32).optional(),
        model: z.string().max(64).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const updateMeBodySchema = z
  .object({
    display_name: z.string().trim().min(2).max(60).optional(),
    locale: z.enum(['fr', 'en']).optional(),
    photo_key: z.string().max(256).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Indiquez au moins un champ à modifier.',
  });

// ─── Sorties ─────────────────────────────────────────────────────────────────

export const otpRequestResponseSchema = z.object({
  challenge_id: z.string().uuid(),
  channel: channelSchema,
  /** Jamais la destination complète : « +237 6·· ··· ·67 ». */
  destination_masked: z.string(),
  expires_at: z.string(),
  expires_in_s: z.number().int(),
  /** Mode démonstration uniquement : le code est renvoyé pour que le jury le voie. */
  demo_mode: z.boolean(),
  demo_code: z.string().nullable(),
});

/** Bloc chauffeur, visible par le chauffeur lui-même. */
export const driverProfileSchema = z.object({
  kind: z.enum(['car', 'moto']),
  status: z.enum(['pending', 'approved', 'suspended', 'rejected']),
  rating: z.number(),
  rides_count: z.number().int(),
  online: z.boolean(),
  cash_debt: z.number().int(),
  vehicle: z
    .object({
      id: z.string().uuid(),
      kind: z.enum(['car', 'moto']),
      make: z.string(),
      model: z.string(),
      color: z.string(),
      /** Plaque affichée avec ses espaces : « CE 4821 AB ». */
      plate: z.string(),
      offers: z.array(z.enum(['eco', 'confort', 'moto'])),
    })
    .nullable(),
});

/**
 * `GET /v1/me` : ce que l'utilisateur voit de LUI-MÊME. Même ici, le numéro n'est que
 * masqué — l'appli n'en a aucun usage, et un journal d'API ne doit jamais le contenir.
 */
export const meSchema = z.object({
  vora_id: z.string(),
  vora_id_formatted: z.string(),
  role: z.enum(['passenger', 'driver', 'ops']),
  display_name: z.string(),
  photo_key: z.string().nullable(),
  locale: z.string(),
  status: z.enum(['active', 'suspended', 'deleted']),
  phone_masked: z.string().nullable(),
  email_masked: z.string().nullable(),
  created_at: z.string(),
  driver: driverProfileSchema.nullable(),
});

export const otpVerifyResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int(),
  /** Vrai à la première connexion : l'appli enchaîne alors sur « Comment vous appelez-vous ? ». */
  is_new_account: z.boolean(),
  user: meSchema,
});

/**
 * Ce que l'AUTRE partie voit d'une personne : prénom, photo, ID VORA. Rien d'autre.
 * Ni téléphone, ni e-mail, ni nom complet.
 */
export const publicUserSchema = z.object({
  vora_id: z.string(),
  first_name: z.string(),
  photo_key: z.string().nullable(),
  rating: z.number().nullable(),
  verified: z.boolean(),
});

export type OtpRequestBody = z.infer<typeof otpRequestBodySchema>;
export type OtpVerifyBody = z.infer<typeof otpVerifyBodySchema>;
export type UpdateMeBody = z.infer<typeof updateMeBodySchema>;
export type MeDto = z.infer<typeof meSchema>;
export type PublicUserDto = z.infer<typeof publicUserSchema>;
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponseSchema>;
