// VORA — endpoints de pilotage de la démonstration.
//
//   GET  /v1/demo/status          état de la flotte simulée
//   POST /v1/demo/reset           remise à zéro + flotte relancée
//   POST /v1/demo/scenario        { name } parmi les six scénarios
//
// CES ROUTES N'EXISTENT PAS QUAND DEMO_MODE=false. Elles ne sont pas seulement
// désactivées : le module n'est jamais chargé, et `index.ts` est le seul fichier du
// dépôt qui le mentionne (voir l'en-tête de `simulator.ts`). Un appel sur une instance
// de production reçoit un 404 de routeur, pas un 403 de garde applicatif — la différence
// compte, elle prouve que le code n'est pas là.
//
// Le jeton `X-Demo-Token` protège du camarade facétieux sur le réseau du hackathon. Ce
// n'est pas un secret de production : DEMO_MODE ne peut pas être actif en production
// (garde-fou dans `lib/config.ts`).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { config } from '../lib/config.js';
import { resetDemoData } from './dataset.js';
import { applyScenario, SCENARIOS } from './scenarios.js';
import * as simulator from './simulator.js';

const scenarioBodySchema = z.object({ name: z.enum(SCENARIOS) }).strict();

const fleetMemberSchema = z.object({
  voraId: z.string(),
  name: z.string(),
  kind: z.enum(['car', 'moto']),
  phase: z.string(),
  lat: z.number(),
  lng: z.number(),
  rideId: z.string().nullable(),
});

const statusSchema = z.object({
  running: z.boolean(),
  scenario: z.string(),
  fleet: z.array(fleetMemberSchema),
  /** Réglages en vigueur, pour vérifier d'un coup d'œil avant de passer devant le jury. */
  settings: z.object({
    rideSpeedup: z.number(),
    acceptDelayS: z.tuple([z.number(), z.number()]),
    boardingPauseS: z.number(),
  }),
});

const resetSchema = z.object({
  ok: z.boolean(),
  tablesCleared: z.number().int(),
  driversReset: z.number().int(),
  fleet: z.number().int(),
  message: z.string(),
});

const scenarioSchema = z.object({
  scenario: z.enum(SCENARIOS),
  applied: z.array(z.string()),
  script: z.array(z.string()),
  expect: z.string(),
});

export const demoRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * Garde de toutes les routes de ce module. Comparaison simple : le jeton n'ouvre
   * aucune donnée personnelle, il empêche seulement qu'on remette la démonstration à
   * zéro pendant qu'elle tourne.
   */
  app.addHook('preHandler', async (request) => {
    if (request.headers['x-demo-token'] !== config.DEMO_CONTROL_TOKEN) {
      throw new AppError(
        'FORBIDDEN',
        'Pilotage de démonstration : jeton absent ou invalide (en-tête X-Demo-Token).',
      );
    }
  });

  app.get(
    '/demo/status',
    {
      schema: {
        tags: ['demo'],
        summary: 'État de la flotte simulée',
        response: { 200: statusSchema },
      },
    },
    async () => ({
      running: simulator.isRunning(),
      scenario: simulator.currentScenario(),
      fleet: simulator.fleetStatus(),
      settings: {
        rideSpeedup: config.DEMO_RIDE_SPEEDUP,
        acceptDelayS: [config.DEMO_ACCEPT_MIN_S, config.DEMO_ACCEPT_MAX_S] as [number, number],
        boardingPauseS: config.DEMO_BOARDING_PAUSE_S,
      },
    }),
  );

  app.post(
    '/demo/reset',
    {
      schema: {
        tags: ['demo'],
        summary: 'Remise à zéro des courses et redémarrage de la flotte',
        response: { 200: resetSchema },
      },
    },
    async (request) => {
      // On arrête la flotte AVANT de vider les tables : un chauffeur au milieu d'une
      // course écrirait dans une table qu'on est en train de tronquer.
      await simulator.stopSimulator();
      const report = await resetDemoData();
      await simulator.startSimulator(app);

      request.log.info(report, 'Démonstration remise à zéro');

      return {
        ok: true,
        tablesCleared: report.tables,
        driversReset: report.drivers,
        fleet: simulator.fleetStatus().length,
        message:
          'Courses, devis et gains effacés. Repères, zones, tarifs et comptes conservés. Flotte relancée.',
      };
    },
  );

  app.post(
    '/demo/scenario',
    {
      schema: {
        tags: ['demo'],
        summary: 'Mettre la scène en place pour un scénario',
        body: scenarioBodySchema,
        response: { 200: scenarioSchema },
      },
    },
    async (request) => {
      const result = await applyScenario(request.body.name);
      request.log.info({ scenario: result.scenario }, 'Scénario de démonstration appliqué');
      return result;
    },
  );
};
