// VORA — routes du module ops. TOUTES réservées au rôle `ops`.
//
//   GET  /v1/ops/dashboard              6 compteurs + état des interrupteurs
//   GET  /v1/ops/rides                  dernières courses (liste à côté de la carte)
//   GET  /v1/ops/drivers                file de revue des dossiers
//   POST /v1/ops/drivers/:userId/decision   valider, refuser, suspendre, rétablir
//   GET  /v1/ops/surge                  majoration en vigueur
//   POST /v1/ops/surge                  l'activer ou la couper
//
// La carte live des chauffeurs reste `GET /v1/dispatch/drivers` : les positions
// appartiennent au dispatch, l'ops les lit par son service (CLAUDE.md § 7).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../lib/auth.js';
import {
  dashboardSchema,
  driverDecisionBodySchema,
  driverDecisionParamsSchema,
  driverDecisionResponseSchema,
  driverQueueQuerySchema,
  driverQueueSchema,
  opsRidesSchema,
  setSurgeBodySchema,
  surgeStateSchema,
} from './schemas.js';
import * as service from './service.js';

export const opsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/ops/dashboard',
    {
      preHandler: [app.authenticate, requireRole('ops')],
      schema: {
        tags: ['ops'],
        summary: 'Tableau de bord : 6 compteurs, majoration, disjoncteur de routage',
        response: { 200: dashboardSchema },
      },
    },
    async () => service.dashboard(),
  );

  app.get(
    '/ops/rides',
    {
      preHandler: [app.authenticate, requireRole('ops')],
      schema: {
        tags: ['ops'],
        summary: 'Dernières courses',
        response: { 200: opsRidesSchema },
      },
    },
    async () => service.listRecentRides(),
  );

  app.get(
    '/ops/drivers',
    {
      preHandler: [app.authenticate, requireRole('ops')],
      schema: {
        tags: ['ops'],
        summary: 'File de revue des dossiers chauffeurs',
        querystring: driverQueueQuerySchema,
        response: { 200: driverQueueSchema },
      },
    },
    async (request) => service.driverQueue(request.query.status),
  );

  app.post(
    '/ops/drivers/:userId/decision',
    {
      preHandler: [app.authenticate, requireRole('ops')],
      schema: {
        tags: ['ops'],
        summary: 'Valider, refuser, suspendre ou rétablir un chauffeur',
        params: driverDecisionParamsSchema,
        body: driverDecisionBodySchema,
        response: { 200: driverDecisionResponseSchema },
      },
    },
    async (request) => {
      const result = await service.decideOnDriver(
        request.params.userId,
        request.body,
        request.user.vora_id,
      );
      // Une décision qui retire une autorisation de travailler se journalise : c'est la
      // trace qu'on relira si le chauffeur la conteste.
      request.log.info(
        { userId: request.params.userId, decision: request.body.decision, by: request.user.vora_id },
        'Décision sur un dossier chauffeur',
      );
      return result;
    },
  );

  app.get(
    '/ops/surge',
    {
      preHandler: [app.authenticate, requireRole('ops')],
      schema: {
        tags: ['ops'],
        summary: 'Majoration pluie / forte demande en vigueur',
        response: { 200: surgeStateSchema },
      },
    },
    async () => service.readSurge(),
  );

  app.post(
    '/ops/surge',
    {
      preHandler: [app.authenticate, requireRole('ops')],
      schema: {
        tags: ['ops'],
        summary: 'Activer ou couper la majoration (0 à 50 %)',
        body: setSurgeBodySchema,
        response: { 200: surgeStateSchema },
      },
    },
    async (request) => {
      const state = service.applySurge(request.body, request.user.vora_id);
      request.log.info(
        { percent: state.percent, reason: state.reason, by: request.user.vora_id },
        'Majoration modifiée',
      );
      return state;
    },
  );
};
