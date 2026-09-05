// VORA — la spécification publiée doit rester VRAIE quand le code change.
//
// Le développeur frontend travaille sur une autre machine : il ne peut pas demander,
// il lit. Une spécification qui décrit une API d'il y a deux jours lui coûte plus cher
// que pas de spécification du tout, parce qu'il lui fait confiance.
//
// Ces tests vérifient donc que le document est bien DÉRIVÉ des schémas zod, et pas une
// coquille vide qui répondrait 200.

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase } from '../db/client.js';

let app: FastifyInstance;
let spec: {
  openapi: string;
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { securitySchemes: Record<string, unknown> };
};

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await closeDatabase();
});

describe('GET /openapi.json', () => {
  it('publie de l’OpenAPI 3.1, sans authentification', async () => {
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(spec.openapi).toBe('3.1.0');
  });

  it('décrit toutes les routes métier, pas seulement quelques-unes', () => {
    const routes = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
    );

    // Les endpoints dont dépend le parcours complet. Si l'un disparaît de la
    // spécification, le client généré perd une étape sans que personne ne le voie.
    for (const route of [
      'POST /v1/auth/otp/verify',
      'POST /v1/quotes',
      'POST /v1/rides',
      'GET /v1/rides/{id}',
      'POST /v1/rides/{id}/start',
      'POST /v1/rides/{id}/payments/cash-confirm',
      'POST /v1/driver/offers/{offerId}/accept',
      'GET /v1/share/{token}',
    ]) {
      expect(routes, `${route} absente de la spécification`).toContain(route);
    }

    expect(routes.length).toBeGreaterThan(35);
  });

  it('les corps de requête viennent des schémas zod, champ par champ', () => {
    // Si ce test échoue, c'est que la spécification a cessé d'être dérivée du code —
    // et qu'elle décrit une API imaginaire.
    const body = spec.paths['/v1/rides']!.post!.requestBody as {
      content: { 'application/json': { schema: { properties: Record<string, unknown>; required: string[] } } };
    };
    const schema = body.content['application/json'].schema;

    expect(Object.keys(schema.properties).sort()).toEqual([
      'offer',
      'paymentMethod',
      'pickupNote',
      'quoteId',
    ]);
    expect(schema.required).toContain('quoteId');
  });

  it('les réponses aussi : le devis annonce ses sept champs', () => {
    const response = spec.paths['/v1/quotes']!.post!.responses as Record<
      string,
      { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } }
    >;
    const properties = response['200']!.content['application/json'].schema.properties;

    expect(Object.keys(properties)).toEqual([
      'expiresAt',
      'expiresInS',
      'routing',
      'distanceKm',
      'durationMin',
      'routePolyline',
      'offers',
    ]);
  });

  it('déclare comment s’authentifier', () => {
    expect(Object.keys(spec.components.securitySchemes)).toContain('bearerAuth');
  });

  it('ne documente PAS les routes de démonstration quand elles ne sont pas montées', () => {
    // `buildApp()` sans greffon, c'est la production : `/v1/demo/*` n'existe pas, donc
    // la spécification n'en parle pas non plus.
    expect(Object.keys(spec.paths).filter((path) => path.startsWith('/v1/demo'))).toEqual([]);
  });
});

describe('GET /docs', () => {
  it('sert l’interface d’essai, sans authentification', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });
});

describe('un POST sans corps avec Content-Type: application/json', () => {
  it('est accepté, parce que tous les clients HTTP posent cet en-tête', async () => {
    // Régression. Fastify refusait ces requêtes avec « Body cannot be empty », et le
    // développeur voyait un 400 sur un appel parfaitement correct. Plusieurs actions
    // n'ont rien à transmettre : /share, /sos, /retry, /cash-confirm, /no-show…
    const response = await app.inject({
      method: 'POST',
      url: '/v1/rides/11111111-1111-4111-8111-111111111111/share',
      headers: { 'content-type': 'application/json' },
    });

    // 401 (pas de jeton), et surtout PAS 400 : le corps vide a été accepté.
    expect(response.statusCode).toBe(401);
  });

  it('mais un JSON réellement invalide reste refusé', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      headers: { 'content-type': 'application/json' },
      payload: '{ceci nest pas du json',
    });

    expect(response.statusCode).toBe(400);
  });
});
