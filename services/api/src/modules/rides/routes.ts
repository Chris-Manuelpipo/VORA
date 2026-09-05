// VORA — routes du module rides.
//
//   GET  /v1/rides                    historique de l'utilisateur connecté
//   GET  /v1/rides/:id                détail (sans PII de l'autre partie)
//   GET  /v1/rides/:id/events         journal de la course
//   POST /v1/rides                    COMMANDER — devis signé + Idempotency-Key
//   POST /v1/rides/:id/cancel         annuler (le serveur décide gratuit ou payant)
//   POST /v1/rides/:id/arrived        « Je suis arrivé »        (chauffeur)
//   POST /v1/rides/:id/start          code de montée à 4 chiffres (chauffeur)
//   POST /v1/rides/:id/complete       arrivée à destination      (chauffeur)
//   POST /v1/rides/:id/no-show        passager absent            (chauffeur)
//
// Les routes ne contiennent aucune règle : elles valident, appellent le service,
// renvoient. Tout ce qui décide d'un statut est dans `service.ts`.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { formatAmount } from '../pricing/fare.js';
import {
  arrivedBodySchema,
  cancelRideBodySchema,
  cancelRideResponseSchema,
  completeBodySchema,
  createRideBodySchema,
  driverEarningsSchema,
  earningsQuerySchema,
  listRidesQuerySchema,
  rateRideBodySchema,
  rateRideResponseSchema,
  rideEventsSchema,
  rideParamsSchema,
  rideSchema,
  ridesListSchema,
  shareParamsSchema,
  sharedRideSchema,
  shareResponseSchema,
  sosBodySchema,
  sosResponseSchema,
  startRideBodySchema,
} from './schemas.js';
import * as repository from './repository.js';
import * as service from './service.js';

/**
 * `Idempotency-Key` est OBLIGATOIRE sur les créations (CLAUDE.md § 9). On la lit dans
 * l'en-tête et on refuse sans elle : mieux vaut une erreur explicite au premier essai
 * qu'un passager avec deux chauffeurs en route le jour où le réseau bégaie.
 */
const idempotencyHeaderSchema = z.object({
  'idempotency-key': z
    .string()
    .trim()
    .min(8, 'Idempotency-Key : au moins 8 caractères (un UUID convient).')
    .max(128),
});

/** Le corps d'une position optionnelle devient un point, ou rien. */
function toPosition(body: { lat?: number; lng?: number }): { lat: number; lng: number } | undefined {
  return body.lat !== undefined && body.lng !== undefined ? { lat: body.lat, lng: body.lng } : undefined;
}

export const ridesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/rides',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['rides'],
        summary: 'Historique des courses',
        querystring: listRidesQuerySchema,
        response: { 200: ridesListSchema },
      },
    },
    async (request) =>
      service.listRides({ id: request.user.sub, role: request.user.role }, request.query),
  );

  app.get(
    '/rides/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['rides'],
        summary: 'Détail d’une course',
        params: rideParamsSchema,
        response: { 200: rideSchema },
      },
    },
    async (request) =>
      service.getRide(request.params.id, { id: request.user.sub, role: request.user.role }),
  );

  app.get(
    '/rides/:id/events',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['rides'],
        summary: 'Journal d’une course',
        params: rideParamsSchema,
        response: { 200: rideEventsSchema },
      },
    },
    async (request) => {
      await service.getRide(request.params.id, {
        id: request.user.sub,
        role: request.user.role,
      });
      const events = await repository.listRideEvents(request.params.id);
      return {
        events: events.map((event) => ({
          id: event.id,
          type: event.type,
          from_status: event.fromStatus,
          to_status: event.toStatus,
          actor_type: event.actorType,
          occurred_at: event.occurredAt.toISOString(),
        })),
      };
    },
  );

  // ─── Commander ─────────────────────────────────────────────────────────────

  app.post(
    '/rides',
    {
      preHandler: [app.authenticate, requireRole('passenger')],
      schema: {
        tags: ['rides'],
        summary: 'Commander : le prix ferme se fige ici',
        body: createRideBodySchema,
        response: { 201: rideSchema },
      },
    },
    async (request, reply) => {
      const headers = idempotencyHeaderSchema.safeParse(request.headers);
      if (!headers.success) {
        throw new AppError(
          'IDEMPOTENCY_KEY_REQUIRED',
          "Cette commande n'a pas pu être identifiée. Réessayez depuis l'application.",
          { header: 'Idempotency-Key' },
        );
      }

      const ride = await service.requestRide({
        passengerId: request.user.sub,
        body: request.body,
        idempotencyKey: headers.data['idempotency-key'],
      });

      return reply.status(201).send(ride);
    },
  );

  // ─── Annuler ───────────────────────────────────────────────────────────────

  app.post(
    '/rides/:id/cancel',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['rides'],
        summary: 'Annuler (le serveur décide si c’est gratuit)',
        params: rideParamsSchema,
        body: cancelRideBodySchema,
        response: { 200: cancelRideResponseSchema },
      },
    },
    async (request) => {
      // C'est le rôle du jeton qui dit qui annule, jamais le corps de la requête : un
      // passager ne peut pas se déclarer chauffeur pour éviter des frais.
      const actorType = request.user.role === 'ops' ? 'ops' : request.user.role;
      const result = await service.cancelRide({
        rideId: request.params.id,
        actorId: request.user.sub,
        actorType,
        reason: request.body.reason,
      });

      return { ...result, feeFormatted: formatAmount(result.feeXaf) };
    },
  );

  // ─── Actions du chauffeur ──────────────────────────────────────────────────

  app.post(
    '/rides/:id/arrived',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['rides'],
        summary: '« Je suis arrivé » au point de rendez-vous',
        params: rideParamsSchema,
        body: arrivedBodySchema,
        response: { 200: rideSchema },
      },
    },
    async (request) =>
      service.driverArrived(request.params.id, request.user.sub, toPosition(request.body)),
  );

  app.post(
    '/rides/:id/start',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['rides'],
        summary: 'Démarrer la course avec le code de montée',
        params: rideParamsSchema,
        body: startRideBodySchema,
        response: { 200: rideSchema },
      },
      // Un code à 4 chiffres se force en 10 000 essais : la limite de débit est la
      // seconde barrière, après le compteur des 3 essais.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) =>
      service.startRide(request.params.id, request.user.sub, request.body.boardingCode),
  );

  app.post(
    '/rides/:id/complete',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['rides'],
        summary: 'Arrivée à destination',
        params: rideParamsSchema,
        body: completeBodySchema,
        response: { 200: rideSchema },
      },
    },
    async (request) =>
      service.completeRide(request.params.id, request.user.sub, toPosition(request.body)),
  );

  app.post(
    '/rides/:id/no-show',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['rides'],
        summary: 'Passager absent après le délai d’attente',
        params: rideParamsSchema,
        response: { 200: cancelRideResponseSchema },
      },
    },
    async (request) => {
      const result = await service.noShow(request.params.id, request.user.sub);
      return { ...result, feeFormatted: formatAmount(result.feeXaf) };
    },
  );

  // ─── Après la course ───────────────────────────────────────────────────────

  app.post(
    '/rides/:id/retry',
    {
      preHandler: [app.authenticate, requireRole('passenger')],
      schema: {
        tags: ['rides'],
        summary: '« Attendre 2 min » : relancer le dispatch au même prix',
        params: rideParamsSchema,
        response: { 200: rideSchema },
      },
    },
    async (request) => service.retryRide(request.params.id, request.user.sub),
  );

  app.post(
    '/rides/:id/rating',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['rides'],
        summary: 'Noter la course (des deux côtés)',
        params: rideParamsSchema,
        body: rateRideBodySchema,
        response: { 200: rateRideResponseSchema },
      },
    },
    async (request) =>
      service.rateRide({
        rideId: request.params.id,
        raterId: request.user.sub,
        role: request.user.role,
        stars: request.body.stars,
        tags: request.body.tags,
        comment: request.body.comment,
      }),
  );

  // ─── Sécurité ──────────────────────────────────────────────────────────────

  app.post(
    '/rides/:id/sos',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['rides'],
        summary: 'Alerte SOS (ne change pas le statut de la course)',
        params: rideParamsSchema,
        body: sosBodySchema,
        response: { 200: sosResponseSchema },
      },
      // Une limite existe — un bouton bloqué peut être pressé en rafale — mais elle est
      // large : rien ne doit empêcher un deuxième SOS.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request) =>
      service.raiseSos({
        rideId: request.params.id,
        actorId: request.user.sub,
        role: request.user.role,
        position: toPosition(request.body),
        note: request.body.note,
      }),
  );

  app.post(
    '/rides/:id/share',
    {
      preHandler: [app.authenticate, requireRole('passenger')],
      schema: {
        tags: ['rides'],
        summary: 'Lien public « Partager mon trajet »',
        params: rideParamsSchema,
        response: { 200: shareResponseSchema },
      },
    },
    async (request) => service.shareRide(request.params.id, request.user.sub),
  );

  /**
   * Vue publique d'un trajet partagé. PAS d'authentification : c'est tout l'objet du
   * lien. Le jeton signé tient lieu d'autorisation, le schéma de sortie tient lieu de
   * garde-fou, et la limite de débit tient lieu de protection contre le balayage — même
   * si un jeton ne se devine pas.
   */
  app.get(
    '/share/:token',
    {
      schema: {
        tags: ['rides'],
        summary: 'Suivre un trajet partagé (lien public, sans compte)',
        params: shareParamsSchema,
        response: { 200: sharedRideSchema },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => service.readSharedRide(request.params.token),
  );

  // ─── Gains du chauffeur ────────────────────────────────────────────────────
  //
  // La route vit dans ce module parce que `driver_earnings` y est écrite (à la fin de
  // course, à l'annulation tardive, au passager absent). Un module n'écrit que dans ses
  // tables — et il est le mieux placé pour les relire (CLAUDE.md § 7).

  app.get(
    '/driver/earnings',
    {
      preHandler: [app.authenticate, requireRole('driver')],
      schema: {
        tags: ['rides'],
        summary: 'Ce que le chauffeur a gagné, au franc près',
        querystring: earningsQuerySchema,
        response: { 200: driverEarningsSchema },
      },
    },
    async (request) => service.driverEarnings(request.user.sub, request.query.period),
  );
};
