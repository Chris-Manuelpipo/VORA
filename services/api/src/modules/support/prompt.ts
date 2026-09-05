// VORA — le prompt système, et le rendu du contexte en français.
//
// Le modèle ne reçoit pas de JSON : il reçoit de la prose, écrite par nous. Un statut
// `in_progress` ou un `price_xaf: 1625` obligeraient le modèle à TRADUIRE, et une
// traduction est une occasion d'inventer. On lui donne donc des phrases déjà justes, et
// on ne lui demande que de choisir laquelle répond à la question.
//
// Le prompt est une contrainte, pas une suggestion. Ce qu'il impose est ensuite VÉRIFIÉ
// côté serveur (`guard.ts`) : un modèle qui désobéit ne passe pas.

import { STATUS_SENTENCE } from './knowledge.js';
import type { SupportContext } from './schemas.js';

/**
 * Marqueur d'escalade. Le modèle n'a qu'un mot à écrire pour dire « je ne sais pas », ce
 * qui est plus fiable que d'attendre un JSON bien formé d'un petit modèle gratuit. On le
 * cherche aussi dans les réponses en texte libre (voir `provider.ts`).
 */
export const ESCALATE_MARKER = 'ESCALADE';

/** La réponse quand l'assistant ne sait pas, ou quand on a refusé la sienne. */
export const FALLBACK_ANSWER =
  "Je n'ai pas la réponse à cette question dans ce que VORA me donne. " +
  "Un conseiller reprend la conversation et vous répond dans l'application.";

export const SYSTEM_PROMPT = [
  "Tu es l'assistant de support de VORA, application de VTC et de motos-taxis à Yaoundé (Cameroun).",
  '',
  'RÈGLES ABSOLUES :',
  '1. Réponds en français, en deux à quatre phrases. Jamais de liste, jamais de titre.',
  "2. Dis ce qui s'est passé ET l'action suivante. Phrase courte, ton calme, vouvoiement.",
  "3. N'invente RIEN. Tu ne connais que le CONTEXTE ci-dessous : la FAQ VORA et, s'il y en",
  "   a une, la course en cours de la personne. Tout le reste, tu ne le sais pas.",
  `4. Si la réponse n'est pas dans le contexte, réponds exactement ce mot : ${ESCALATE_MARKER}`,
  "   N'ajoute rien d'autre. Un humain reprendra.",
  '5. Les montants, les statuts et les règles viennent du contexte, jamais de toi. Ne cite',
  "   aucun chiffre qui ne s'y trouve pas : ni prix, ni délai, ni pourcentage.",
  "6. Tu expliques, tu ne décides pas. Tu ne peux ni annuler une course, ni rembourser, ni",
  '   modifier un prix, ni contacter le chauffeur. Dis quel bouton fait cela.',
  "7. Ne demande jamais un numéro de téléphone, un e-mail ni un moyen de paiement.",
].join('\n');

/** Rend les faits de la course en phrases françaises. Vide s'il n'y a pas de course. */
function renderRide(context: SupportContext): string[] {
  const ride = context.ride;
  if (!ride) return ['Course en cours : aucune.'];

  const offerLabel = { eco: 'Éco', confort: 'Confort', moto: 'Moto' }[ride.offer];
  const lines = [
    'COURSE EN COURS de la personne qui pose la question :',
    `- offre : ${offerLabel}`,
    `- état : ${STATUS_SENTENCE[ride.status] ?? ride.status}`,
    `- prix ferme : ${ride.price_formatted}`,
  ];

  if (ride.distance_km !== null) {
    lines.push(`- distance : ${ride.distance_km.toFixed(1).replace('.', ',')} km`);
  }
  if (ride.driver_plate) {
    lines.push(`- plaque du véhicule : ${ride.driver_plate}`);
  }
  if (ride.breakdown) {
    lines.push(
      `- décomposition pour le chauffeur : brut ${ride.breakdown.gross} F, ` +
        `commission VORA ${ride.breakdown.commission} F, retenue DGI ${ride.breakdown.dgi} F, ` +
        `net ${ride.breakdown.net} F`,
    );
  }

  return lines;
}

/**
 * Le contexte, tel que le modèle le lit — et tel que `guard.ts` le relit pour vérifier
 * qu'aucun montant de la réponse n'a été inventé. Une seule chaîne, une seule vérité.
 */
export function renderContext(context: SupportContext): string {
  const who =
    context.audience === 'passenger'
      ? 'La personne qui pose la question est un PASSAGER.'
      : 'La personne qui pose la question est un CHAUFFEUR VORA.';

  const faq =
    context.faq.length > 0
      ? context.faq.map((entry) => `### ${entry.title}\n${entry.answer}`).join('\n\n')
      : '(aucune fiche ne correspond à cette question)';

  return [who, '', ...renderRide(context), '', 'FICHES VORA :', '', faq].join('\n');
}
