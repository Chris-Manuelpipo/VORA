// VORA — usine Fastify. Le processus (index.ts) écoute ; les tests importent cette
// fonction pour monter l'API sans ouvrir de port.

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerAuth } from './lib/auth.js';
import { config } from './lib/config.js';
import { registerErrorHandler } from './lib/http.js';
import { loggerOptions } from './lib/logger.js';
import { dispatchRoutes } from './modules/dispatch/routes.js';
import { geoRoutes } from './modules/geo/routes.js';
import { identityRoutes } from './modules/identity/routes.js';
import { opsRoutes } from './modules/ops/routes.js';
import { paymentsRoutes } from './modules/payments/routes.js';
import { pricingRoutes } from './modules/pricing/routes.js';
import { ridesRoutes } from './modules/rides/routes.js';
import { databaseHealth } from './db/client.js';

/**
 * La base répond-elle, MAINTENANT ?
 *
 * Le délai de garde n'est pas une précaution de style : sans lui, une base qui accepte
 * la connexion mais ne répond plus ferait pendre la requête de santé jusqu'à son propre
 * délai d'expiration. Le superviseur attendrait, ne conclurait rien, et l'instance
 * resterait en rotation en distribuant des erreurs. Mieux vaut un 503 franc en 2 s.
 */
const HEALTH_TIMEOUT_MS = 2000;

async function checkDatabase(): Promise<'up' | 'down'> {
  const timeout = new Promise<'down'>((resolve) => {
    setTimeout(() => resolve('down'), HEALTH_TIMEOUT_MS).unref?.();
  });

  const probe = databaseHealth()
    .then((result): 'up' | 'down' => (result.ok ? 'up' : 'down'))
    .catch((): 'down' => 'down');

  return Promise.race([probe, timeout]);
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    routerOptions: {
      // Le défaut de Fastify est 100 caractères par paramètre d'URL, et le jeton signé
      // du partage de trajet (`GET /v1/share/:token`) en fait environ 160 : sans cette
      // ligne, le lien envoyé à un proche répond 414. La borne reste basse — 512 — et le
      // schéma zod de la route la reprend, pour que le routeur et la validation disent
      // la même chose.
      maxParamLength: 512,
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: config.DEMO_MODE ? 300 : 120,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
    errorResponseBuilder: () => ({
      code: 'TOO_MANY_REQUESTS',
      message: 'Trop de tentatives. Patientez une minute, puis réessayez.',
    }),
  });

  await registerAuth(app);

  /**
   * Contrôle de santé de la plateforme. SANS authentification et SANS limite de débit :
   * c'est un superviseur qui l'appelle, toutes les quelques secondes, et il n'a ni jeton
   * ni patience. Une 429 sur cette route ferait redémarrer une application en bonne santé.
   *
   *   200 → la base répond ; l'instance peut recevoir du trafic.
   *   503 → elle ne répond pas ; la plateforme doit la retirer de la rotation.
   *
   * Le contrôle porte sur la BASE et pas seulement sur le processus : une API qui répond
   * « je vais bien » sans pouvoir lire une course ne va pas bien, elle est juste vivante.
   */
  app.get(
    '/health',
    { config: { rateLimit: false } },
    async (_request, reply) => {
      const database = await checkDatabase();

      return reply.status(database === 'up' ? 200 : 503).send({
        status: database === 'up' ? 'ok' : 'degraded',
        db: database,
        // Quelle version répond ? C'est la première question quand quelque chose cloche.
        commit: config.COMMIT_ID,
        uptimeSeconds: Math.floor(process.uptime()),
      });
    },
  );

  await app.register(
    async (v1) => {
      await v1.register(identityRoutes);
      await v1.register(geoRoutes);
      await v1.register(pricingRoutes);
      await v1.register(ridesRoutes);
      await v1.register(dispatchRoutes);
      await v1.register(paymentsRoutes);
      await v1.register(opsRoutes);
    },
    { prefix: '/v1' },
  );

  return app;
}
