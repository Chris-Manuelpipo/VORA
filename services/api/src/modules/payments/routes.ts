// VORA — routes du module payments.
//
//   GET  /v1/payments/methods                    espèces + Mobile Money simulé
//   POST /v1/rides/:id/payments/cash-confirm     le chauffeur confirme avoir été payé
//   POST /v1/rides/:id/payments/mobile-money     le passager paie (simulé, 3 s)

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../lib/auth.js';
import { rideParamsSchema, rideSchema } from '../rides/schemas.js';
import { mobileMoneyResponseSchema, paymentMethodsResponseSchema } from './schemas.js';
import * as service from './service.js';

export const paymentsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/payments/methods',
    {
      schema: {
        tags: ['payments'],
        summary: 'Moyens de paiement disponibles',
        response: { 200: paymentMethodsResponseSchema },
      },
    },
    async () => service.listMethods(),
  );

  app.post(
    '/rides/:id/payments/cash-confirm',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['payments'],
        summary: 'Encaissement en espèces confirmé par le chauffeur',
        params: rideParamsSchema,
        response: { 200: rideSchema },
      },
    },
    async (request) => service.confirmCash(request.params.id, request.user.sub),
  );

  app.post(
    '/rides/:id/payments/mobile-money',
    {
      preHandler: [app.authenticate, requireRole('passenger')],
      schema: {
        tags: ['payments'],
        summary: 'Paiement Mobile Money (adaptateur simulé)',
        params: rideParamsSchema,
        response: { 200: mobileMoneyResponseSchema },
      },
      // L'adaptateur attend 3 s : la limite de débit doit laisser passer une reprise
      // après coupure, pas une rafale.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) => service.payWithMobileMoney(request.params.id, request.user.sub),
  );
};
