// VORA — authentification par jeton. JWT 24 h, signé par l'API (CLAUDE.md § 3).
//
// Le jeton ne porte QUE de quoi identifier : l'identifiant interne, l'ID VORA et le rôle.
// Ni numéro, ni e-mail : un JWT se lit sans clé, tout ce qu'il contient est public.

import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { config } from './config.js';
import { AppError } from './errors.js';
import type { UserRole } from '../db/schema.js';

export interface TokenPayload {
  sub: string;
  vora_id: string;
  role: UserRole;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload & { iat: number; exp: number };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler : exige un jeton valide. Le payload est dans `request.user`. */
    authenticate: preHandlerHookHandler;
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
    messages: {
      noAuthorizationInHeaderMessage: 'unauthorized',
      authorizationTokenExpiredMessage: 'unauthorized',
      authorizationTokenInvalid: 'unauthorized',
      authorizationTokenUntrusted: 'unauthorized',
    },
  });

  app.decorate('authenticate', async function authenticate(request: FastifyRequest) {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(
        'UNAUTHORIZED',
        'Votre session a expiré. Reconnectez-vous pour continuer.',
      );
    }
  });
}

/**
 * preHandler complémentaire : réserve une route à certains rôles.
 * À poser APRÈS `authenticate` dans le tableau des preHandler.
 */
export function requireRole(...roles: UserRole[]): preHandlerHookHandler {
  return async function checkRole(request: FastifyRequest, _reply: FastifyReply) {
    if (!roles.includes(request.user.role)) {
      throw new AppError(
        'FORBIDDEN',
        "Cette action n'est pas disponible depuis votre compte.",
        { required_roles: roles },
      );
    }
  };
}
