// VORA — routes du module dispatch.
//
//   POST /v1/driver/online     se mettre en ligne (dossier validé exigé)
//   POST /v1/driver/offline    se mettre hors ligne
//   POST /v1/driver/position   remontée de position (repli REST de `driver.position`)
//   GET  /v1/dispatch/drivers  carte live de la page ops
//
//   POST /v1/driver/offers/:offerId/accept    accepter (15 s pour le faire)
//   POST /v1/driver/offers/:offerId/decline   passer au suivant, tout de suite

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../lib/auth.js';
import { respondToOffer } from './engine.js';
import {
  driverStatusSchema,
  goOnlineBodySchema,
  liveDriversResponseSchema,
  offerParamsSchema,
  offerResponseSchema,
  positionSchema,
} from './schemas.js';
import * as service from './service.js';

export const dispatchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/driver/online',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['dispatch'],
        summary: 'Se mettre en ligne',
        body: goOnlineBodySchema,
        response: { 200: driverStatusSchema },
      },
    },
    async (request) => service.goOnline(request.user.sub, request.body),
  );

  app.post(
    '/driver/offline',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['dispatch'],
        summary: 'Se mettre hors ligne',
        response: { 200: driverStatusSchema },
      },
    },
    async (request) => service.goOffline(request.user.sub),
  );

  app.post(
    '/driver/position',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['dispatch'],
        summary: 'Remonter sa position',
        body: positionSchema,
        response: { 200: driverStatusSchema },
      },
      // Une position toutes les 5 s, plus une marge pour les reprises après coupure.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => service.updatePosition(request.user.sub, request.body),
  );

  app.get(
    '/dispatch/drivers',
    {
      preHandler: [app.authenticate, requireRole('ops')],
      schema: {
        tags: ['dispatch'],
        summary: 'Chauffeurs en ligne (carte de la page ops)',
        response: { 200: liveDriversResponseSchema },
      },
    },
    async () => service.listLiveDrivers(),
  );

  // ─── Réponse à une offre ─────────────────────────────────────────────────
  //
  // Les deux routes répondent 200 même quand l'offre était déjà close : ce n'est pas
  // une erreur du chauffeur, c'est une course de vitesse qu'il a perdue. Son
  // application affiche « Trop tard », pas un message d'échec technique.

  app.post(
    '/driver/offers/:offerId/accept',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['dispatch'],
        summary: 'Accepter une course proposée',
        params: offerParamsSchema,
        response: { 200: offerResponseSchema },
      },
    },
    async (request) => {
      const taken = await respondToOffer(request.params.offerId, request.user.sub, 'accepted');
      return {
        accepted: taken,
        message: taken
          ? 'Course acceptée. Rendez-vous au point de départ.'
          : 'Trop tard : cette course est partie. La prochaine arrive.',
      };
    },
  );

  app.post(
    '/driver/offers/:offerId/decline',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['dispatch'],
        summary: 'Passer une course (le suivant est sollicité aussitôt)',
        params: offerParamsSchema,
        response: { 200: offerResponseSchema },
      },
    },
    async (request) => {
      await respondToOffer(request.params.offerId, request.user.sub, 'declined');
      return { accepted: false, message: 'Course passée.' };
    },
  );
};
