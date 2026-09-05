// VORA — gestionnaire d'erreurs HTTP. Format unique, CLAUDE.md § 9 :
//   { code, message, details }

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from './errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toBody());
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Cette requête est incomplète ou mal formée. Vérifiez les champs, puis réessayez.',
        details: error.validation.map((issue) => ({
          path: issue.instancePath || issue.schemaPath,
          message: issue.message,
        })),
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'Réponse hors contrat de sortie');
      return reply.status(500).send({
        code: 'INTERNAL_ERROR',
        message: 'Une erreur inattendue est survenue. Réessayez dans un instant.',
      });
    }

    const statusCode = 'statusCode' in error ? (error.statusCode ?? 500) : 500;

    if (statusCode === 429) {
      return reply.status(429).send({
        code: 'TOO_MANY_REQUESTS',
        message: 'Trop de tentatives. Patientez une minute, puis réessayez.',
      });
    }

    if (statusCode === 401) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Votre session a expiré. Reconnectez-vous pour continuer.',
      });
    }

    request.log.error({ err: error }, 'Erreur non gérée');
    return reply.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).send({
      code: 'INTERNAL_ERROR',
      message: 'Une erreur inattendue est survenue. Réessayez dans un instant.',
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      code: 'NOT_FOUND',
      message: "Cette ressource n'existe pas.",
    });
  });
}
