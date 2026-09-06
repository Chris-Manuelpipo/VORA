// VORA — routes du module identity.
//
//   POST /v1/auth/otp/request   demande un code à 6 chiffres
//   POST /v1/auth/otp/verify    vérifie le code, crée le compte au besoin, ouvre la session
//   GET  /v1/me                 profil de l'utilisateur connecté
//   POST /v1/me/onboarding      profil personnel + contacts de confiance (PA-05 → PA-07)
//   POST /v1/me/photo           envoi de la photo de profil (octets bruts)
//   DELETE /v1/me/photo         retrait de la photo
//   GET  /v1/media/:id          les octets d'une image
//   PATCH /v1/me                nom affiché, langue, photo
//
// Les routes ne contiennent aucune règle : elles valident, appellent le service, renvoient.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '../../lib/images.js';
import {
  mediaParamsSchema,
  meSchema,
  onboardingBodySchema,
  photoUploadSchema,
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

  /**
   * Photo de profil. Le corps est l'IMAGE ELLE-MÊME, brute, avec son `Content-Type` :
   *
   *     POST /v1/me/photo
   *     Content-Type: image/jpeg
   *     <octets>
   *
   * Pas de multipart, pas de base64. Le multipart demanderait une dépendance de plus pour
   * transporter un seul fichier sans métadonnée ; le base64 gonflerait de 33 % une requête
   * qui part d'un téléphone en 3G. `dio` envoie des octets bruts sans rien de spécial.
   *
   * L'en-tête annoncé ne décide de RIEN : le type réel est déduit des premiers octets
   * (`lib/images.ts`). C'est ce qui empêche de stocker un fichier HTML et de le faire
   * resservir plus tard par `GET /v1/media/:id`.
   */
  app.post(
    '/me/photo',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['identity'],
        summary: 'Envoyer sa photo de profil (corps = octets de l’image)',
        description:
          'Corps brut, `Content-Type: image/jpeg | image/png | image/webp`. 2 Mo maximum — ' +
          'redimensionnez à 512 px de côté avant l’envoi. La photo remplace la précédente. ' +
          'Le type est déduit des octets, jamais de l’en-tête.',
        response: { 201: photoUploadSchema },
      },
      // La borne du corps, en plus de celle du service : une requête de 40 Mo doit être
      // refusée AVANT d'être entièrement lue en mémoire.
      bodyLimit: MAX_IMAGE_BYTES,
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          "Aucune image reçue. Envoyez le fichier avec l'en-tête Content-Type: image/jpeg.",
          { accepted: IMAGE_MIME_TYPES },
        );
      }

      return reply.status(201).send(await service.uploadPhoto(request.user.sub, bytes));
    },
  );

  app.delete(
    '/me/photo',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['identity'],
        summary: 'Retirer sa photo de profil',
        response: { 200: meSchema },
      },
    },
    async (request) => service.removePhoto(request.user.sub),
  );

  /**
   * Les octets d'une image.
   *
   * Authentifiée, mais SANS contrôle de propriétaire : une photo de profil existe pour
   * être vue par l'autre partie de la course — le passager doit voir le visage de son
   * chauffeur avant de monter. Les deux barrières sont le jeton et l'UUID, qui ne se
   * devine pas. Voir `service.readMedia` pour le raisonnement complet.
   */
  app.get(
    '/media/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['identity'],
        summary: 'Lire une image (photo de profil)',
        params: mediaParamsSchema,
      },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const media = await service.readMedia(request.params.id);

      // Une image ne change jamais d'identifiant (la table est immuable) : le téléphone
      // peut la garder sans jamais revenir demander. `private` parce qu'il a fallu un
      // jeton pour l'obtenir — elle n'a rien à faire dans un cache partagé.
      return reply
        .header('content-type', media.mime)
        .header('cache-control', 'private, max-age=31536000, immutable')
        .header('etag', `"${media.sha256}"`)
        .send(media.bytes);
    },
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
