// VORA — routes du module support.
//
//   POST /v1/support/ask     poser une question (authentifié)
//
// UNE SEULE ROUTE, ET ELLE NE S'APPELLE QUE SUR UNE ACTION EXPLICITE. L'application ne
// doit jamais l'appeler toute seule : ni à l'ouverture d'un écran, ni pour reformuler une
// erreur, ni pour « suggérer » quelque chose. Chaque appel coûte de l'argent et le
// quota — 10 questions par heure et par personne — appartient à l'utilisateur, pas à
// l'application. Voir `limits.ts` et le README.
//
// Aucune autre partie du produit n'appelle ce module : commander, dispatcher, encaisser
// se passent très bien de lui, et doivent continuer à le faire s'il tombe.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { askBodySchema, answerSchema } from './schemas.js';
import * as service from './service.js';

export const supportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/support/ask',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['support'],
        summary: 'Poser une question au support (sur action explicite uniquement)',
        description:
          "L'assistant explique, il ne décide rien. Les prix, les statuts et les règles " +
          'viennent du serveur ; le modèle ne fait que les mettre en phrases. Sans ' +
          'fournisseur configuré, la réponse vient de la FAQ seule — la route répond ' +
          'toujours.\n\n' +
          "**À n'appeler que lorsque l'utilisateur envoie sa question.** Jamais " +
          "automatiquement : 10 questions par heure et par personne, et chaque appel a un coût.",
        body: askBodySchema,
        response: { 200: answerSchema },
      },
      // Deuxième barrière, après le quota horaire : une rafale de questions est un bug
      // de client, et un bug de client ne doit pas vider un crédit d'API.
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    },
    async (request) =>
      service.ask({
        userId: request.user.sub,
        role: request.user.role,
        question: request.body.question,
      }),
  );
};
