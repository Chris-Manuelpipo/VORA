// VORA — journalisation structurée (pino, fourni par Fastify).
// Règle absolue (CLAUDE.md § 5.6) : aucun numéro de téléphone ni e-mail complet dans un log.
// Seule exception, explicite et bornée : le code OTP en mode démonstration (§ 8.2).

import type { FastifyServerOptions } from 'fastify';
import pino from 'pino';
import { config } from './config.js';

/** Chemins masqués automatiquement par pino, quel que soit l'objet journalisé. */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.value',
  'req.body.code',
  'req.body.phone',
  'req.body.email',
  '*.phone',
  '*.email',
  '*.phone_e164',
  '*.boardingCode',
  '*.boarding_code',
  // Profil personnel de l'onboarding : rempli par l'utilisateur, jamais utile dans un
  // journal. `trustedContacts` porte des numéros de PROCHES, qui n'ont même pas de compte
  // chez nous — c'est la donnée la moins à sa place dans un fichier de logs.
  'req.body.family_name',
  'req.body.birth_date',
  '*.family_name',
  '*.birth_date',
  '*.trusted_contacts',
  '*.trustedContacts',
];

export const loggerOptions: FastifyServerOptions['logger'] = {
  level: config.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[masqué]' },
  // En développement, une ligne lisible vaut mieux qu'un JSON de 400 caractères.
  ...(config.isProduction || config.isTest
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', singleLine: false },
        },
      }),
  serializers: {
    req(request: { method: string; url: string; id: string }) {
      return { id: request.id, method: request.method, url: request.url };
    },
  },
};

/**
 * Journal HORS REQUÊTE. Le dispatch séquentiel, ses minuteries de 15 s et le balayage
 * des positions tournent en arrière-plan : ils n'ont pas de `request.log` à leur
 * disposition, et une panne qui ne s'écrit nulle part est une panne qu'on découvre
 * devant le jury. Mêmes règles de masquage que le journal des requêtes.
 */
export const logger = pino({
  level: config.isTest ? 'warn' : config.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[masqué]' },
  base: { name: 'vora-api' },
});
