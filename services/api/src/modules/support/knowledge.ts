// VORA — la FAQ du support. C'est TOUT ce que l'assistant sait.
//
// Chaque réponse est écrite ici, à la main, à partir de `docs/VORA_brief_produit_MVP.md`
// (§ 5.2, § 5.4, § 5.7 et § 6) et des règles de CLAUDE.md § 5. Le modèle de langage ne
// connaît rien d'autre : il reformule ce fichier et les faits de la course en cours, il
// n'invente pas une règle VORA.
//
// POURQUOI DE LA PROSE ÉCRITE À LA MAIN, et pas les constantes de `domain/rules.ts` :
// une réponse de support est une phrase adressée à quelqu'un qui attend, pas un calcul.
// Les montants qui dépendent d'une course (le prix ferme, le net) ne sont JAMAIS ici :
// ils viennent du contexte serveur, construit dans `context.ts`. Ce qui est ici, ce sont
// les règles fixes — 2 minutes, 300 mètres, 4 chiffres — qui ne bougent pas d'une course
// à l'autre, et qui sont déjà publiques.
//
// La voix suit la charte (CLAUDE.md § 9) : phrase courte, elle dit ce qui s'est passé
// ET l'action suivante.

/** À qui la réponse s'adresse. Une question de chauffeur ne reçoit pas la FAQ passager. */
export type Audience = 'passenger' | 'driver';

export interface FaqEntry {
  /** Identifiant stable : c'est lui qui remonte dans `sources[]` de la réponse API. */
  id: string;
  title: string;
  /**
   * Une question type, telle qu'un utilisateur la poserait. Sert aux suggestions de
   * l'application (`GET /v1/support/topics`) : une question suggérée tombe à coup sûr sur
   * la bonne fiche, donc escalade moins souvent et coûte moins cher qu'une reformulation.
   */
  example: string;
  /** `both` = la réponse vaut des deux côtés. */
  audience: Audience | 'both';
  /**
   * Mots de rappel, SANS ACCENT et en minuscules : ils sont comparés à la question
   * normalisée. C'est ce qui permet de répondre à « pk le prix a bougé » comme à
   * « pourquoi le tarif change-t-il ? ».
   */
  keywords: string[];
  answer: string;
}

export const FAQ: readonly FaqEntry[] = [
  {
    id: 'prix-ferme',
    example: "Le prix peut-il changer après ma commande ?",
    title: 'Le prix ferme',
    audience: 'both',
    keywords: [
      'prix',
      'tarif',
      'cout',
      'coute',
      'montant',
      'ferme',
      'change',
      'bouge',
      'augmente',
      'plus cher',
      'devis',
      'estimation',
      'majoration',
      'nuit',
      'pluie',
    ],
    answer:
      "Le prix affiché avant la commande est ferme : il est calculé sur l'itinéraire, " +
      "figé au moment où vous commandez, et il ne change plus jusqu'à la fin de la course. " +
      "Les majorations de nuit ou de pluie apparaissent en lignes séparées avant que vous " +
      "confirmiez, jamais après. Seul un changement de destination crée un nouveau prix, " +
      'affiché et accepté par les deux parties.',
  },
  {
    id: 'paiement',
    example: "Comment je paie ma course ?",
    title: 'Payer la course',
    audience: 'both',
    keywords: [
      'payer',
      'paiement',
      'paie',
      'especes',
      'cash',
      'liquide',
      'momo',
      'mobile money',
      'orange money',
      'mtn',
      'recu',
      'facture',
      'monnaie',
    ],
    answer:
      "Le paiement se fait en espèces par défaut, ou par Mobile Money depuis l'application " +
      'à la fin de la course. Le montant à payer est celui affiché avant la commande, au franc près. ' +
      "Si le chauffeur réclame un supplément, refusez et signalez-le depuis l'écran de fin de course : " +
      'VORA traite le signalement.',
  },
  {
    id: 'code-montee',
    example: "À quoi sert le code à 4 chiffres ?",
    title: 'Le code de montée',
    audience: 'both',
    keywords: [
      'code',
      'chiffres',
      'monter',
      'montee',
      'demarrer',
      'demarrage',
      'commence',
      'embarquer',
      'bon vehicule',
      'bonne voiture',
    ],
    answer:
      'Le code de montée est un nombre à 4 chiffres affiché sur votre écran de suivi, à vous seul. ' +
      "Donnez-le au chauffeur en montant : sans lui, la course ne peut pas démarrer. " +
      "C'est ce qui garantit que vous montez dans le bon véhicule, et le chauffeur ne peut jamais le lire à votre place.",
  },
  {
    id: 'annulation',
    example: "Annuler maintenant, ça me coûte combien ?",
    title: 'Annuler une course',
    audience: 'both',
    keywords: [
      'annuler',
      'annulation',
      'annule',
      'frais',
      'penalite',
      'gratuit',
      'trop tard',
      'attendre',
      'retard',
    ],
    answer:
      "L'annulation est gratuite dans les 2 minutes qui suivent l'acceptation, ou tant que le chauffeur " +
      "a parcouru moins de 300 mètres. Passé ce point, elle coûte 300 F en voiture et 100 F en moto, " +
      'reversés intégralement au chauffeur qui était déjà en route. ' +
      "Le bouton d'annulation affiche toujours ce qu'il en coûte à l'instant où vous le regardez.",
  },
  {
    id: 'zones-moto',
    example: "Pourquoi la moto n'est pas proposée ?",
    title: 'Les zones interdites aux motos',
    audience: 'both',
    keywords: [
      'moto',
      'motos',
      'zone',
      'interdite',
      'interdit',
      'refuse',
      'refusee',
      'prefecture',
      'arrete',
      'centre ville',
      'pas disponible',
    ],
    answer:
      "Certaines zones de Yaoundé sont interdites aux motos-taxis par arrêté préfectoral. " +
      "Quand le départ, l'arrivée ou l'itinéraire touche une de ces zones, VORA ne propose pas l'offre Moto : " +
      'nous ne proposons pas de course illégale. ' +
      "Prenez Éco ou Confort pour ce trajet, ou déplacez le point de rendez-vous hors de la zone affichée sur la carte.",
  },
  {
    id: 'sos-partage',
    example: "Comment prévenir un proche pendant ma course ?",
    title: 'SOS et partage de trajet',
    audience: 'both',
    keywords: [
      'sos',
      'urgence',
      'securite',
      'danger',
      'peur',
      'partager',
      'partage',
      'trajet',
      'proche',
      'famille',
      'suivre',
      'lien',
    ],
    answer:
      "Le bouton SOS, en rouge sur l'écran de course, alerte immédiatement l'équipe VORA avec votre " +
      "position, et lui transmet vos contacts de confiance pour qu'elle les appelle. " +
      '« Partager mon trajet » envoie à un proche un lien qui montre en direct où vous êtes, le véhicule ' +
      'et la plaque, sans compte à créer. ' +
      "En cas de danger immédiat, appelez d'abord les secours, puis appuyez sur SOS.",
  },
  {
    id: 'vie-privee',
    example: "Le chauffeur voit-il mon numéro de téléphone ?",
    title: 'Numéro de téléphone et ID VORA',
    audience: 'both',
    keywords: [
      'numero',
      'telephone',
      'contact',
      'appeler',
      'appel',
      'sms',
      'whatsapp',
      'email',
      'mail',
      'prive',
      'vie privee',
      'donnees',
      'id vora',
      'identifiant',
    ],
    answer:
      "Votre numéro et votre e-mail ne sont jamais montrés à l'autre partie, ni dans l'application, " +
      "ni sur un reçu. Vous êtes identifié par votre ID VORA à 8 chiffres, affiché en deux groupes de 4. " +
      "Pour vous coordonner pendant la course, utilisez les messages prédéfinis de l'écran de suivi.",
  },
  {
    id: 'attente-chauffeur',
    example: "Pourquoi aucun chauffeur ne répond ?",
    title: 'Aucun chauffeur trouvé',
    audience: 'passenger',
    keywords: [
      'chauffeur',
      'personne',
      'aucun',
      'trouve',
      'attente',
      'attendre',
      'long',
      'longtemps',
      'expire',
      'expiree',
      'reessayer',
    ],
    answer:
      'La demande part à un chauffeur à la fois, qui a 15 secondes pour répondre, sur trois vagues ' +
      'de rayon croissant. Si personne ne répond, la course expire et vous choisissez : attendre 2 minutes, ' +
      'ou réessayer tout de suite au même prix. ' +
      "Aux heures creuses, élargir le point de rendez-vous jusqu'à un axe passant aide beaucoup.",
  },
  {
    id: 'gains-chauffeur',
    example: "Combien me reste-t-il sur une course ?",
    title: 'Commission, retenue DGI et net',
    audience: 'driver',
    keywords: [
      'net',
      'gain',
      'gains',
      'commission',
      'dgi',
      'impot',
      'retenue',
      'combien je gagne',
      'reste',
      'solde',
      'dette',
    ],
    answer:
      'VORA prélève 15 % sur les courses en voiture et 50 F fixes par course moto, plus une retenue DGI ' +
      "de 1 % du brut que VORA reverse à l'administration pour vous. Le net qui vous reste est affiché " +
      "avant que vous acceptiez la course, et il ne change pas ensuite. " +
      "Le détail course par course est dans l'onglet Gains.",
  },
] as const;

/**
 * Phrase française pour chaque statut de course. Le contexte envoyé au modèle est de la
 * PROSE, pas un statut technique : « in_progress » ne veut rien dire pour un modèle qui
 * doit répondre à quelqu'un, et lui laisser traduire un jargon interne est le meilleur
 * moyen d'obtenir une invention.
 *
 * Formulation neutre : la même phrase doit être vraie côté passager et côté chauffeur.
 */
export const STATUS_SENTENCE: Record<string, string> = {
  draft: 'course en préparation, pas encore commandée',
  requested: 'course commandée, recherche d’un chauffeur en cours',
  offered: 'demande envoyée à un chauffeur, en attente de sa réponse',
  accepted: 'chauffeur trouvé, en route vers le point de rendez-vous',
  approaching: 'chauffeur en approche du point de rendez-vous',
  arrived: 'chauffeur arrivé au point de rendez-vous, en attente du code de montée',
  in_progress: 'course en cours vers la destination',
  completed: 'course terminée, paiement à confirmer',
  paid: 'course terminée et payée',
  rated: 'course terminée, payée et notée',
  expired: 'aucun chauffeur n’a répondu, la course a expiré',
  cancelled_free: 'course annulée sans frais',
  cancelled_late: 'course annulée tardivement, des frais s’appliquent',
  cancelled_driver: 'course annulée par le chauffeur',
  no_show: 'course close pour passager absent',
};

// ─── Recherche dans la FAQ ───────────────────────────────────────────────────

/**
 * Met un texte sous une forme comparable : minuscules, sans accent, sans ponctuation.
 * Sert au classement de la FAQ ET à la clé de cache — deux formulations de la même
 * question doivent tomber sur la même entrée de cache.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Un mot de la question correspond-il à ce mot-clé ?
 *
 * Égalité stricte, plus un préfixe pour les mots longs : « annulée » doit trouver
 * « annule », sans que « code » ne se trouve dans « décodeur ». C'est de la
 * lemmatisation du pauvre, et elle suffit à neuf entrées.
 */
function tokenMatches(token: string, keyword: string): boolean {
  if (token === keyword) return true;
  return keyword.length >= 5 && token.startsWith(keyword);
}

export interface RankedEntry {
  entry: FaqEntry;
  score: number;
}

/**
 * Les entrées de FAQ qui parlent de la question posée, la plus proche d'abord.
 *
 * Un simple comptage de mots-clés, et c'est volontaire : une recherche vectorielle
 * demanderait un service d'embeddings — donc un appel réseau de plus sur un chemin qui
 * doit répondre même sans réseau. Neuf entrées se classent très bien à la main.
 */
export function rankKnowledge(
  question: string,
  audience: Audience,
  limit = 4,
): RankedEntry[] {
  const normalized = normalize(question);
  const haystack = ` ${normalized} `;
  const tokens = normalized.split(' ').filter(Boolean);

  return FAQ.filter((entry) => entry.audience === 'both' || entry.audience === audience)
    .map((entry) => {
      let score = 0;
      for (const keyword of entry.keywords) {
        // Une locution (« mobile money ») pèse double : elle est bien plus discriminante
        // qu'un mot isolé, et deux mots côte à côte ne se rencontrent pas par hasard.
        if (keyword.includes(' ')) {
          if (haystack.includes(` ${keyword} `)) score += 2;
        } else if (tokens.some((token) => tokenMatches(token, keyword))) {
          score += 1;
        }
      }
      return { entry, score };
    })
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
