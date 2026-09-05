// VORA — le simulateur, et surtout son ISOLATION. Sur une vraie base.
//
// Deux questions, et le jury posera la seconde :
//   1. le simulateur peuple-t-il la carte ? (sinon la démonstration montre un écran vide)
//   2. le produit fonctionne-t-il SANS lui ?
//
// La réponse à la seconde est vérifiée ici de la façon la plus directe qui soit :
// `buildApp()` — l'application telle que la production la monte — ne sert AUCUNE route
// `/v1/demo/*`. Elles n'existent que si `index.ts` les lui passe, et il ne le fait que
// si DEMO_MODE=true. Le complément statique est dans `unit/architecture.unit.test.ts` :
// aucun fichier de production n'importe `demo/`.

import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, db } from '../db/client.js';
import { driverProfiles, users } from '../db/schema.js';
import { seedZones, seedLandmarks } from '../db/seed/geography.js';
import { config } from '../lib/config.js';
import { driverPresence } from '../modules/dispatch/presence.js';
import { currentSurge, resetSurge } from '../modules/pricing/surge.js';
import { clearBuffers } from '../realtime/bus.js';
import { demoRoutes } from '../demo/routes.js';
import { FLEET, FLEET_PHONE_PREFIX } from '../demo/fleet.js';
import * as simulator from '../demo/simulator.js';
import { auth, createPassenger, seedTariffs } from './support/fixtures.js';

/** L'application telle que la production la monte : sans le moindre greffon. */
let production: FastifyInstance;
/** L'application de démonstration : la même, plus les routes de pilotage. */
let demo: FastifyInstance;

const token = { 'x-demo-token': config.DEMO_CONTROL_TOKEN };

beforeAll(async () => {
  await seedLandmarks();
  await seedZones();
  await seedTariffs();

  production = await buildApp();
  demo = await buildApp({ plugins: [demoRoutes] });
  await Promise.all([production.ready(), demo.ready()]);
}, 90_000);

afterAll(async () => {
  await simulator.stopSimulator();
  driverPresence.clear();
  clearBuffers();
  resetSurge();
  await production?.close();
  await demo?.close();
  await closeDatabase();
});

// ─── L'isolation, la question du jury ────────────────────────────────────────

describe('le produit fonctionne sans le simulateur', () => {
  it('l’application de production ne sert AUCUNE route /v1/demo/*', async () => {
    for (const url of ['/v1/demo/status', '/v1/demo/reset', '/v1/demo/scenario']) {
      const response = await production.inject({
        method: url === '/v1/demo/status' ? 'GET' : 'POST',
        url,
        headers: token,
        payload: { name: 'nominal' },
      });

      // 404 de ROUTEUR, pas 403 de garde applicative : la route n'existe pas, le code
      // n'est pas là. C'est la différence entre « désactivé » et « absent ».
      expect(response.statusCode, url).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    }
  });

  it('et sert malgré tout le produit entier', async () => {
    // Le même `buildApp()` sans greffon répond sur les routes métier : rien de ce qui
    // fait VORA ne dépend du simulateur.
    const passenger = await createPassenger(production, 'Aïcha Sans Simulateur');

    const quote = await production.inject({
      method: 'POST',
      url: '/v1/quotes',
      headers: auth(passenger),
      payload: {
        pickup: { lat: 3.8541, lng: 11.4872 },
        dropoff: { lat: 3.8482, lng: 11.4931 },
      },
    });

    expect(quote.statusCode).toBe(200);
    expect(quote.json().offers).toHaveLength(3);
  }, 30_000);

  it('les routes de pilotage exigent le jeton de démonstration', async () => {
    const sansJeton = await demo.inject({ method: 'GET', url: '/v1/demo/status' });
    expect(sansJeton.statusCode).toBe(403);

    const mauvaisJeton = await demo.inject({
      method: 'GET',
      url: '/v1/demo/status',
      headers: { 'x-demo-token': 'pas-le-bon' },
    });
    expect(mauvaisJeton.statusCode).toBe(403);
  });
});

// ─── La flotte ───────────────────────────────────────────────────────────────

describe('la flotte simulée peuple la carte', () => {
  it('démarre 12 chauffeurs : 8 voitures et 4 motos', async () => {
    await simulator.startSimulator(demo);

    const status = await demo.inject({ method: 'GET', url: '/v1/demo/status', headers: token });
    expect(status.statusCode).toBe(200);

    const body = status.json();
    expect(body.running).toBe(true);
    expect(body.fleet).toHaveLength(12);
    expect(body.fleet.filter((d: { kind: string }) => d.kind === 'car')).toHaveLength(8);
    expect(body.fleet.filter((d: { kind: string }) => d.kind === 'moto')).toHaveLength(4);
  }, 90_000);

  it('ce sont de VRAIS comptes : dossiers validés, plaques camerounaises', async () => {
    const rows = await db
      .select({ displayName: users.displayName, status: driverProfiles.status })
      .from(users)
      .innerJoin(driverProfiles, eq(driverProfiles.userId, users.id))
      .where(eq(users.role, 'driver'));

    const simules = rows.filter((row) =>
      FLEET.some((member) => member.displayName === row.displayName),
    );

    expect(simules).toHaveLength(12);
    // Rien en base ne les distingue d'un chauffeur ordinaire : le dispatch ne PEUT pas
    // les traiter autrement.
    expect(simules.every((row) => row.status === 'approved')).toBe(true);
    expect(FLEET.every((member) => /^CE\d{4}[A-Z]{2}$/.test(member.vehicle.plate))).toBe(true);
    expect(FLEET.every((member) => member.phone.startsWith(FLEET_PHONE_PREFIX))).toBe(true);
  });

  it('ils sont réellement en ligne, vus par le dispatch', () => {
    // La présence vient de la mémoire du dispatch, pas du simulateur : s'ils y sont,
    // c'est qu'ils sont passés par `POST /v1/driver/online` comme un vrai téléphone.
    expect(driverPresence.size()).toBeGreaterThanOrEqual(12);
  });

  it('les motos ne sont QUE dans les zones qui leur sont autorisées', async () => {
    const status = await demo.inject({ method: 'GET', url: '/v1/demo/status', headers: token });
    const motos = (status.json().fleet as Array<{ kind: string; lat: number; lng: number }>).filter(
      (driver) => driver.kind === 'moto',
    );

    expect(motos.length).toBe(4);

    // Vérification par PostGIS, pas par une approximation : chaque moto doit être dans
    // une zone `moto_allowed`. C'est la règle du § 5.5 appliquée à la flotte elle-même.
    for (const moto of motos) {
      const result = await db.execute(sql`
          select exists (
            select 1 from zones z
            where z.active and z.kind = 'moto_allowed'
              and ST_Intersects(z.geom, ST_SetSRID(ST_MakePoint(${moto.lng}, ${moto.lat}), 4326)::geography)
          ) as inside
      `);
      expect((result.rows[0] as { inside: boolean }).inside, `moto en ${moto.lat},${moto.lng}`).toBe(
        true,
      );
    }
  }, 30_000);
});

// ─── Les scénarios ───────────────────────────────────────────────────────────

describe('scénarios de démonstration', () => {
  async function scenario(name: string) {
    const response = await demo.inject({
      method: 'POST',
      url: '/v1/demo/scenario',
      headers: token,
      payload: { name },
    });
    expect(response.statusCode, name).toBe(200);
    return response.json();
  }

  it('refuse un scénario inconnu', async () => {
    const response = await demo.inject({
      method: 'POST',
      url: '/v1/demo/scenario',
      headers: token,
      payload: { name: 'peripetie_inattendue' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('chaque scénario rend le mode d’emploi du présentateur', async () => {
    for (const name of ['nominal', 'annulation_tardive', 'moto_zone_interdite', 'sos']) {
      const result = await scenario(name);
      expect(result.scenario).toBe(name);
      expect(result.script.length).toBeGreaterThan(0);
      expect(result.expect.length).toBeGreaterThan(20);
    }
  }, 60_000);

  it('« pluie » active vraiment la majoration, « nominal » la coupe', async () => {
    await scenario('pluie');
    expect(currentSurge().percent).toBe(50);

    await scenario('nominal');
    expect(currentSurge().percent).toBe(0);
  }, 30_000);

  it('« aucun_chauffeur » vide la carte, « nominal » la repeuple', async () => {
    await scenario('aucun_chauffeur');
    expect(driverPresence.size()).toBe(0);

    await scenario('nominal');
    expect(driverPresence.size()).toBeGreaterThanOrEqual(12);
  }, 60_000);

  it('« moto_zone_interdite » rapproche les motos pour que le refus soit lisible', async () => {
    const result = await scenario('moto_zone_interdite');

    // Sans motos visibles, le jury croirait à une pénurie plutôt qu'à un refus légal.
    expect(result.applied.join(' ')).toMatch(/motos rapprochées/i);
    expect(result.expect).toMatch(/arrêté préfectoral/i);
  }, 30_000);
});

// ─── La remise à zéro ────────────────────────────────────────────────────────

describe('POST /v1/demo/reset', () => {
  it('efface les courses, garde les données de référence, relance la flotte', async () => {
    const response = await demo.inject({ method: 'POST', url: '/v1/demo/reset', headers: token });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.tablesCleared).toBe(8);
    expect(body.fleet).toBe(12);

    // Les données de référence survivent : sans elles, il faudrait reséquencer 120
    // repères entre deux répétitions.
    const tariffs = await demo.inject({ method: 'GET', url: '/v1/pricing/tariffs' });
    expect(tariffs.json().tariffs.length).toBeGreaterThan(0);

    const zones = await demo.inject({ method: 'GET', url: '/v1/geo/zones?kind=moto_forbidden' });
    expect(zones.json().features).toHaveLength(1);
  }, 90_000);
});
