// VORA — routes du module identity.
//
//   POST /v1/auth/otp/request   demande un code à 6 chiffres
//   POST /v1/auth/otp/verify    vérifie le code, crée le compte au besoin, ouvre la session
//   GET  /v1/me                 profil de l'utilisateur connecté
//   POST /v1/me/onboarding      profil personnel + contacts de confiance (PA-05 → PA-07)
//   PATCH /v1/me                nom affiché, langue, photo
//
// Les routes ne contiennent aucune règle : elles valident, appellent le service, renvoient.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { config } from '../../lib/config.js';
import {
  meSchema,
  onboardingBodySchema,
  otpRequestBodySchema,
  otpRequestResponseSchema,
  otpVerifyBodySchema,
  otpVerifyResponseSchema,
  updateMeBodySchema,
} from './schemas.js';
import * as service from './service.js';

export const identityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/auth/otp/request',
    {
      schema: {
        tags: ['identity'],
        summary: 'Demander un code de vérification',
        body: otpRequestBodySchema,
        response: { 200: otpRequestResponseSchema },
      },
      config: {
        // Le mode démonstration enchaîne les connexions devant le jury : on desserre,
        // sans supprimer la protection (l'anti-abus par destination reste actif).
        rateLimit: config.DEMO_MODE
          ? { max: 60, timeWindow: '5 minutes' }
          : { max: 10, timeWindow: '5 minutes' },
      },
    },
    async (request) =>
      service.requestOtp({
        channel: request.body.channel,
        value: request.body.value,
        ip: request.ip,
        logger: request.log,
      }),
  );

  app.post(
    '/auth/otp/verify',
    {
      schema: {
        tags: ['identity'],
        summary: 'Vérifier le code et ouvrir une session',
        body: otpVerifyBodySchema,
        response: { 200: otpVerifyResponseSchema },
      },
      config: {
        rateLimit: config.DEMO_MODE
          ? { max: 60, timeWindow: '5 minutes' }
          : { max: 20, timeWindow: '5 minutes' },
      },
    },
    async (request) =>
      service.verifyOtp({
        value: request.body.value,
        code: request.body.code,
        role: request.body.role,
        displayName: request.body.display_name,
        driverKind: request.body.driver_kind,
        device: request.body.device,
        logger: request.log,
        // La clé de signature appartient à Fastify : le service ne la voit jamais.
        signToken: (payload) => app.jwt.sign(payload),
      }),
  );

  app.get(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['identity'],
        summary: 'Profil de l’utilisateur connecté',
        response: { 200: meSchema },
      },
    },
    async (request) => service.getMe(request.user.sub),
  );

  /**
   * Onboarding (PA-05 → PA-07), en UN SEUL appel, à la fin de la connexion.
   *
   * L'application l'ouvre quand `GET /v1/me` renvoie `onboarding.completed: false`, et
   * ne le rouvre plus ensuite : quelqu'un qui a répondu « Plus tard » à la photo a bien
   * terminé son onboarding. Le même appel sert d'enregistrement depuis l'écran Profil.
   */
  app.post(
    '/me/onboarding',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['identity'],
        summary: 'Enregistrer le profil personnel et les contacts de confiance',
        description:
          'Un seul appel, rejouable : le dernier envoi fait foi. Les contacts de confiance ' +
          'sont REMPLACÉS (une liste vide les efface, un champ absent n’y touche pas). ' +
          'Nom, sexe et date de naissance restent visibles de leur propriétaire seul.',
        body: onboardingBodySchema,
        response: { 200: meSchema },
      },
    },
    async (request) => service.completeOnboarding(request.user.sub, request.body),
  );

  app.patch(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['identity'],
        summary: 'Modifier son profil',
        body: updateMeBodySchema,
        response: { 200: meSchema },
      },
    },
    async (request) => service.updateMe(request.user.sub, request.body),
  );
};
