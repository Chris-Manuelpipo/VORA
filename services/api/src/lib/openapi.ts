// VORA — spécification OpenAPI 3.1, GÉNÉRÉE depuis les schémas zod des routes.
//
// Rien n'est écrit à la main ici. `jsonSchemaTransform` lit les `schema: { body, params,
// querystring, response }` que chaque route déclare déjà — les MÊMES objets zod qui
// valident les requêtes et sérialisent les réponses — et les traduit en JSON Schema.
//
// C'est la seule façon d'avoir une documentation qui reste vraie : le jour où quelqu'un
// ajoute un champ à un schéma, la spécification l'a le jour même. Une documentation
// recopiée à la main est fausse le lendemain, et le développeur qui la lit perd une
// demi-journée avant de s'en apercevoir.
//
// Deux surfaces :
//   GET /openapi.json  la spécification, pour générer un client
//   GET /docs          Swagger UI, pour essayer les endpoints depuis un navigateur
//
// Les fichiers de Swagger UI sont SERVIS PAR L'API, pas chargés depuis un CDN : sur le
// réseau d'un hackathon, une page de documentation qui dépend d'Internet ne s'affiche pas.

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { config } from './config.js';

/** Description des groupes de routes, affichée en tête de chaque section de Swagger UI. */
const TAGS = [
  { name: 'identity', description: 'Inscription, connexion par code, profil.' },
  { name: 'geo', description: 'Repères de Yaoundé, zones réglementaires, itinéraires.' },
  { name: 'pricing', description: 'Grille tarifaire et DEVIS FERME signé (2 minutes).' },
  { name: 'rides', description: 'Cycle de vie d’une course, de la commande à la note.' },
  { name: 'dispatch', description: 'Mise en ligne, position, réponse aux offres.' },
  { name: 'payments', description: 'Espèces et Mobile Money (adaptateur simulé).' },
  { name: 'ops', description: 'Tableau de bord, dossiers chauffeurs, majoration.' },
  {
    name: 'support',
    description:
      'Assistant de support : il explique, il ne décide rien. Sur action explicite seulement.',
  },
  { name: 'demo', description: 'Pilotage de la démonstration (DEMO_MODE uniquement).' },
];

const DESCRIPTION = `
API de **VORA** — VTC et motos-taxis à Yaoundé.

## Ce qu'il faut savoir avant d'écrire un client

**Authentification.** Jeton \`Bearer\` sur toutes les routes sauf \`/health\`,
\`/v1/auth/*\`, \`/v1/geo/*\`, \`/v1/pricing/tariffs\` et \`/v1/share/{token}\`.
Le jeton s'obtient par \`POST /v1/auth/otp/request\` puis \`POST /v1/auth/otp/verify\`.
En mode démonstration, le code vaut toujours \`123456\` et il est renvoyé dans la réponse.

**Erreurs.** Toutes les erreurs ont la même forme : \`{ code, message, details? }\`.
Branchez votre affichage sur \`code\` — une valeur stable en majuscules — jamais sur
\`message\`, qui est une phrase destinée à l'utilisateur et qui peut changer.

**Montants.** Entiers de francs CFA, jamais de flottant. Les réponses portent souvent
le montant formaté à côté du nombre (\`1 625 F\`) : affichez celui-là, il applique
l'espace fine insécable de la charte.

**Le prix est ferme.** \`POST /v1/quotes\` rend trois offres signées, valables
**2 minutes**. Le prix affiché avant la commande est celui du reçu. Il ne bouge pas.

**Statuts de course.** Le serveur seul décide du statut. Le client demande une action ;
si elle n'est pas permise, il reçoit \`INVALID_TRANSITION\` et rien n'est écrit.

**Temps réel.** Socket.IO, salles par course et par chauffeur.
Voir \`docs/API_CONTRACT.md\` § Socket.IO pour les événements et un exemple de connexion.
`.trim();

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  if (!config.DOCS_ENABLED) return;

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'VORA API',
        description: DESCRIPTION,
        version: '1.0.0',
        contact: { name: 'Équipe VORA', url: 'https://github.com/Chris-Manuelpipo/VORA' },
      },
      servers: [
        { url: config.PUBLIC_BASE_URL, description: 'Instance courante' },
        { url: 'http://localhost:3000', description: 'Développement local' },
      ],
      tags: TAGS,
      /**
       * Exigence de sécurité GLOBALE, et c'est un choix pratique assumé.
       *
       * La plupart des routes demandent un jeton ; quelques-unes non (`/health`,
       * `/v1/auth/*`, `/v1/geo/*`, `/v1/pricing/tariffs`, `/v1/share/{token}`). Déclarer
       * l'exigence route par route demanderait quarante déclarations et divergerait dès
       * la première étourderie. En la posant globalement, « Authorize » dans Swagger UI
       * envoie le jeton partout : les routes publiques ignorent simplement l'en-tête, et
       * le développeur frontend n'a plus qu'un seul geste à faire pour tout essayer.
       */
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Jeton rendu par POST /v1/auth/otp/verify (champ access_token).',
          },
          demoToken: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Demo-Token',
            description: 'Pilotage de la démonstration. DEMO_MODE uniquement.',
          },
        },
      },
    },
    // LA LIGNE QUI FAIT TOUT : les schémas zod des routes deviennent le contrat publié.
    transform: jsonSchemaTransform,
  });

  /**
   * `GET /openapi.json` — l'adresse canonique de la spécification.
   *
   * `@fastify/swagger` la publie sous le préfixe de l'interface (`/docs/json`), ce qui
   * est un détail d'implémentation : le développeur frontend, lui, la cherche à la
   * racine, et c'est cette adresse-là qui part dans un générateur de client. On la sert
   * donc explicitement, sans limite de débit — un générateur de client la rappelle à
   * chaque build.
   *
   * `app.swagger()` construit le document à l'appel, à partir des routes réellement
   * enregistrées : il n'y a rien à régénérer quand le code change.
   */
  app.get(
    '/openapi.json',
    {
      schema: { hide: true },
      config: { rateLimit: false },
    },
    async (_request, reply) => reply.type('application/json').send(app.swagger()),
  );

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      // Les routes sont rangées par étiquette, dans l'ordre du parcours plutôt que par
      // ordre alphabétique : on lit l'API comme on lit le produit.
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
      tryItOutEnabled: true,
    },
    staticCSP: true,
  });
}
