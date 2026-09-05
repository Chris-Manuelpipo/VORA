// VORA — routes du module pricing.
//
//   GET  /v1/pricing/tariffs    grille publiée (publique : le prix se lit avant de commander)
//   POST /v1/pricing/estimate   prix indicatif pour une distance et une durée données
//   POST /v1/quotes             LE DEVIS FERME : 3 offres, signées, valables 2 minutes
//
// L'interrupteur de majoration pluie vit dans le module `ops` (CLAUDE.md § 7) : c'est
// l'ops qui l'actionne. L'ÉTAT, lui, reste ici — `pricing/surge.ts` — parce que c'est
// ce module qui calcule le prix, et qu'il ne peut pas y avoir deux sources.
//
// Les routes ne contiennent aucune règle : elles valident, appellent le service, renvoient.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createQuoteBodySchema,
  createQuoteResponseSchema,
  estimateBodySchema,
  fareSchema,
  tariffsResponseSchema,
} from './schemas.js';
import * as service from './service.js';

export const pricingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/pricing/tariffs',
    {
      schema: {
        tags: ['pricing'],
        summary: 'Grille tarifaire publiée',
        response: { 200: tariffsResponseSchema },
      },
    },
    async () => service.listTariffs(),
  );

  app.post(
    '/pricing/estimate',
    {
      schema: {
        tags: ['pricing'],
        summary: 'Prix indicatif pour une distance et une durée',
        body: estimateBodySchema,
        response: { 200: fareSchema },
      },
    },
    async (request) => service.estimate(request.body),
  );

  app.post(
    '/quotes',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['pricing'],
        summary: 'Devis ferme : 3 offres signées, valables 2 minutes',
        body: createQuoteBodySchema,
        response: { 200: createQuoteResponseSchema },
      },
      // Un devis appelle OSRM et écrit trois lignes : on ne l'ouvre pas en boucle.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => service.createQuote(request.user.sub, request.body),
  );
};
