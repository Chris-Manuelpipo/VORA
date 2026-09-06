// VORA — schémas zod du module support.
//
// `supportContextSchema` n'est PAS un schéma d'API : c'est le filtre par lequel passe
// tout ce qui part vers un modèle de langage, à l'extérieur de nos machines.
//
// Il est `.strict()`, et c'est le point : la liste des champs autorisés est POSITIVE.
// Une colonne ajoutée demain à `rides` ne peut pas se retrouver dans un prompt parce que
// personne n'aurait pensé à l'exclure — elle ferait échouer la validation. C'est la même
// discipline que `toSharedRideDto` (CLAUDE.md § 5.6), appliquée à un destinataire qui
// n'est ni le passager ni le chauffeur, mais un tiers.

import { z } from 'zod';
import { OFFERS } from '../../domain/rules.js';
import { RIDE_STATUSES } from '../../domain/states.js';

// ─── Entrée ──────────────────────────────────────────────────────────────────

export const askBodySchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(3, 'Écrivez votre question en quelques mots.')
      // 500 caractères : une question de support, pas un roman. La borne protège aussi
      // le coût — le contexte, lui, est de taille fixe.
      .max(500),
  })
  .strict();

export type AskBody = z.infer<typeof askBodySchema>;

// ─── Sortie ──────────────────────────────────────────────────────────────────

export const answerSchema = z.object({
  /** Deux à quatre phrases, en français. Affichable telle quelle. */
  answer: z.string(),
  /**
   * Les entrées de FAQ qui ont servi, par leur identifiant (`prix-ferme`, `annulation`…).
   * L'application peut ouvrir l'article correspondant. Vide = rien de pertinent trouvé.
   */
  sources: z.array(z.string()),
  /**
   * `true` : l'assistant n'a pas la réponse et un humain doit reprendre. L'application
   * affiche alors le bouton « Écrire à VORA » plutôt que de laisser l'utilisateur seul.
   */
  escalate: z.boolean(),
});

export type AnswerDto = z.infer<typeof answerSchema>;

/**
 * Les sujets que l'assistant sait traiter, pour les proposer AVANT que l'utilisateur
 * n'écrive. Une question suggérée tombe à coup sûr sur la bonne fiche : elle escalade
 * moins souvent, et elle coûte moins cher qu'une reformulation approximative.
 *
 * Ce sont les MÊMES fiches que celles qui répondent : la liste ne peut pas se désynchroniser
 * de la FAQ, parce qu'elle en est extraite.
 */
export const supportTopicsSchema = z.object({
  topics: z.array(
    z.object({
      /** Identifiant stable, celui qui revient dans `sources[]` d'une réponse. */
      id: z.string(),
      title: z.string(),
      /** Question type, à envoyer telle quelle si l'utilisateur tape dessus. */
      example: z.string(),
    }),
  ),
});

export type SupportTopicsDto = z.infer<typeof supportTopicsSchema>;

// ─── Contexte envoyé au modèle ───────────────────────────────────────────────

/**
 * Les faits de la course en cours. RIEN d'autre n'a le droit d'y entrer :
 * ni numéro, ni e-mail, ni coordonnées GPS, ni identifiant d'un autre utilisateur.
 * `.strict()` transforme cette phrase en contrainte vérifiée à l'exécution.
 */
export const rideFactsSchema = z
  .object({
    status: z.enum(RIDE_STATUSES),
    offer: z.enum(OFFERS),
    /** Prix ferme, en francs entiers. */
    price_xaf: z.number().int(),
    price_formatted: z.string(),
    /**
     * Décomposition de l'argent, TELLE QUE LE DEMANDEUR A LE DROIT DE LA VOIR : le
     * chauffeur voit brut, commission, DGI et net ; le passager voit son prix, et rien
     * du net de son chauffeur.
     */
    breakdown: z
      .object({
        gross: z.number().int(),
        commission: z.number().int(),
        dgi: z.number().int(),
        net: z.number().int(),
      })
      .strict()
      .nullable(),
    distance_km: z.number().nullable(),
    /** La plaque : le passager la lit déjà sur sa fiche course, et elle sert à répondre. */
    driver_plate: z.string().nullable(),
  })
  .strict();

export type RideFacts = z.infer<typeof rideFactsSchema>;

export const supportContextSchema = z
  .object({
    audience: z.enum(['passenger', 'driver']),
    ride: rideFactsSchema.nullable(),
    faq: z
      .array(
        z.object({ id: z.string(), title: z.string(), answer: z.string() }).strict(),
      )
      .max(6),
  })
  .strict();

export type SupportContext = z.infer<typeof supportContextSchema>;
