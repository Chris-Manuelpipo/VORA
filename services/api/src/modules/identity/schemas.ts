// VORA — schémas zod du module identity : validation des entrées ET contrat de sortie.
//
// Les schémas de RÉPONSE ne sont pas décoratifs : Fastify sérialise à travers eux, donc
// toute propriété non déclarée est retirée de la réponse. C'est le filet mécanique de la
// règle « aucune PII vers l'autre partie » (CLAUDE.md § 5.6) : même si un jour un service
// renvoyait une entité brute, `phone` et `email` ne franchiraient pas la frontière.

import { z } from 'zod';
import { MAX_TRUSTED_CONTACTS, SEXES } from '../../domain/profile.js';
import { IMAGE_MIME_TYPES } from '../../lib/images.js';

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

// ─── Onboarding (PA-05 → PA-07) ──────────────────────────────────────────────

/**
 * Un contact de confiance. Le numéro entre en clair — il faut bien le saisir — mais il
 * ne ressort JAMAIS : le DTO ne rend qu'une version masquée.
 */
export const trustedContactInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Donnez un nom à ce contact (« Maman », « Paul »).').max(40),
    phone: z.string().trim().min(6).max(24),
  })
  .strict();

/**
 * L'onboarding complet, en UN SEUL appel — et c'est délibéré : sur une 3G de Yaoundé,
 * quatre requêtes, c'est quatre occasions d'échouer au milieu et de laisser un compte à
 * moitié rempli. Renvoyable à l'identique depuis l'écran Profil : le dernier envoi fait foi.
 */
export const onboardingBodySchema = z
  .object({
    /** Le prénom. C'est LUI que verra le chauffeur, et rien d'autre du nom. */
    first_name: z.string().trim().min(2, 'Votre prénom, tel qu’on vous appelle.').max(40),
    family_name: z.string().trim().min(2, 'Votre nom de famille.').max(60),
    /** `undisclosed` est une réponse, pas un champ vide : on ne repose pas la question. */
    sex: z.enum(SEXES).nullable().optional(),
    /** Date ISO (AAAA-MM-JJ). Facultative. */
    birth_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.')
      .nullable()
      .optional(),
    locale: z.enum(['fr', 'en']).optional(),
    /** Jusqu'à 3. Une liste vide EFFACE les contacts existants — « Plus tard » n'envoie rien. */
    trusted_contacts: z.array(trustedContactInputSchema).max(MAX_TRUSTED_CONTACTS).optional(),
  })
  .strict();

export const trustedContactSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Masqué, même pour son propriétaire : « +237 6·· ··· ·67 ». */
  phone_masked: z.string(),
});

/**
 * `photo_key` N'EST PAS ICI, ni dans l'onboarding — délibérément.
 *
 * C'est `POST /v1/me/photo` qui la pose, et `DELETE /v1/me/photo` qui la retire. Laisser
 * le client l'écrire, c'était accepter une clé étrangère non vérifiée : n'importe qui
 * pouvait s'attribuer l'identifiant de l'image d'un autre, ou une valeur qui ne pointe
 * sur rien — et l'avatar cassé n'aurait été visible que sur le téléphone d'en face.
 */
export const updateMeBodySchema = z
  .object({
    display_name: z.string().trim().min(2).max(60).optional(),
    locale: z.enum(['fr', 'en']).optional(),
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
  /** Le prénom. Seul élément du nom que voit l'autre partie. */
  display_name: z.string(),
  /** Nom de famille, sexe et date de naissance : visibles de leur propriétaire SEUL. */
  family_name: z.string().nullable(),
  sex: z.enum(SEXES).nullable(),
  birth_date: z.string().nullable(),
  photo_key: z.string().nullable(),
  /** URL prête à poser dans un widget Image. `null` tant qu'aucune photo n'est envoyée. */
  photo_url: z.string().nullable(),
  locale: z.string(),
  status: z.enum(['active', 'suspended', 'deleted']),
  phone_masked: z.string().nullable(),
  email_masked: z.string().nullable(),
  created_at: z.string(),
  driver: driverProfileSchema.nullable(),
  trusted_contacts: z.array(trustedContactSchema),
  /**
   * De quoi décider, côté application, s'il faut ouvrir l'onboarding après la connexion.
   * `completed` ne devient vrai qu'une fois l'onboarding envoyé : quelqu'un qui a répondu
   * « Plus tard » à la photo l'a bien terminé, et ne doit pas le revoir chaque matin.
   */
  onboarding: z.object({
    completed: z.boolean(),
    completed_at: z.string().nullable(),
    /** Ce qui reste à remplir, exigé comme facultatif. Sert aux relances, pas aux blocages. */
    missing: z.array(z.string()),
    /** Le chauffeur a en plus son dossier de pièces (CH-03 → CH-06). */
    driver_kyc_required: z.boolean(),
  }),
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
  photo_url: z.string().nullable(),
  rating: z.number().nullable(),
  verified: z.boolean(),
});

export type OtpRequestBody = z.infer<typeof otpRequestBodySchema>;
export type OtpVerifyBody = z.infer<typeof otpVerifyBodySchema>;
export type UpdateMeBody = z.infer<typeof updateMeBodySchema>;
export type OnboardingBody = z.infer<typeof onboardingBodySchema>;
export type TrustedContactInput = z.infer<typeof trustedContactInputSchema>;
export type TrustedContactDto = z.infer<typeof trustedContactSchema>;
export type MeDto = z.infer<typeof meSchema>;
export type PublicUserDto = z.infer<typeof publicUserSchema>;
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponseSchema>;

/** Réponse de `POST /v1/me/photo`. */
export const photoUploadSchema = z.object({
  photo_key: z.string().uuid(),
  photo_url: z.string(),
  mime: z.enum(IMAGE_MIME_TYPES),
  size_bytes: z.number().int(),
});

export const mediaParamsSchema = z.object({ id: z.string().uuid() }).strict();
