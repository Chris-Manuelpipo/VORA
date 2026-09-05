// VORA — contrôle de santé, celui que la plateforme interroge.
//
// Ce que ces tests protègent : un `/health` qui répond 200 alors que la base ne répond
// plus est PIRE que pas de contrôle du tout. La plateforme garderait l'instance en
// rotation, et chaque passager recevrait une erreur 500 sur sa commande. Le contrat est
// donc : 200 seulement si la base répond, 503 sinon, et aucune authentification puisque
// c'est un superviseur qui appelle.
//
// Le dernier test FERME LE POOL pour de bon. Il est volontairement le dernier du
// fichier, et ce fichier tourne dans son propre processus (vitest, pool `forks`).

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase } from '../db/client.js';

let app: FastifyInstance;
let databaseClosed = false;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  // Le dernier test ferme déjà le pool : `pool.end()` deux fois lève.
  if (!databaseClosed) await closeDatabase();
});

describe('GET /health — base debout', () => {
  it('répond 200 avec exactement les quatre champs attendus', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(Object.keys(body).sort()).toEqual(['commit', 'db', 'status', 'uptimeSeconds']);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');
    expect(typeof body.commit).toBe('string');
    expect(Number.isInteger(body.uptimeSeconds)).toBe(true);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('n’exige aucun jeton : c’est un superviseur qui appelle', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('n’est pas soumis à la limite de débit', async () => {
    // Un superviseur interroge toutes les quelques secondes. Une 429 sur cette route
    // ferait redémarrer une application en parfaite santé — le contraire du but.
    const codes = await Promise.all(
      Array.from({ length: 40 }, () =>
        app.inject({ method: 'GET', url: '/health' }).then((r) => r.statusCode),
      ),
    );

    expect(new Set(codes)).toEqual(new Set([200]));
  });

  it('ne divulgue rien sur l’infrastructure', async () => {
    // Le contrôle de santé est public : il dit si le service répond, pas comment il est
    // construit. Ni chaîne de connexion, ni nom d'hôte, ni version de PostgreSQL.
    const brut = (await app.inject({ method: 'GET', url: '/health' })).body;

    expect(brut).not.toMatch(/postgres|password|@|amazonaws|clever/i);
  });
});

describe('GET /health — base tombée', () => {
  it('répond 503 et `db: down` dès que la base ne répond plus', async () => {
    // On ferme le pool : toute requête ultérieure échoue. C'est la simulation la plus
    // fidèle qu'on puisse faire sans arrêter PostgreSQL sous les pieds des autres tests.
    await closeDatabase();
    databaseClosed = true;

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'degraded', db: 'down' });
    // Même dégradée, la réponse reste exploitable : on veut savoir QUELLE version est
    // tombée, et depuis combien de temps elle tourne.
    expect(response.json().commit).toBeDefined();
    expect(Number.isInteger(response.json().uptimeSeconds)).toBe(true);
  });
});
