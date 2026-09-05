// VORA — tests d'intégration du module geo, SUR UNE VRAIE BASE POSTGIS.
//
// Ces tests ne simulent rien. Ils sèment les repères et les polygones qui partiront en
// démonstration (`db/seed/geography.ts`), puis interrogent PostgreSQL. C'est la seule
// façon d'avoir une réponse qui vaut quelque chose : le géorepérage moto est un
// `ST_Intersects` en base, et un test qui le simulerait ne testerait que le simulacre.
//
// `npm test` monte `vora_test`, applique les migrations, lance ceci, puis supprime la base.

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase } from '../db/client.js';
import { seedLandmarks, seedZones } from '../db/seed/geography.js';
import { decodePolyline } from '../lib/polyline.js';
import { isMotoAllowed } from '../modules/geo/service.js';

let app: FastifyInstance;

beforeAll(async () => {
  await seedLandmarks();
  await seedZones();
  app = await buildApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await closeDatabase();
});

// ─── Recherche par repères ───────────────────────────────────────────────────

interface SearchResult {
  id: string;
  name: string;
  quartier: string | null;
  category: string;
  lat: number;
  lng: number;
  distanceM: number | null;
  confidence: number;
}

async function search(q: string, extra: Record<string, string> = {}): Promise<SearchResult[]> {
  const query = new URLSearchParams({ q, ...extra }).toString();
  const response = await app.inject({ method: 'GET', url: `/v1/geo/search?${query}` });
  expect(response.statusCode).toBe(200);
  return response.json() as SearchResult[];
}

describe('GET /v1/geo/search — les cinq saisies que la démo doit servir', () => {
  it('« acacia » trouve le Carrefour Acacias, malgré le singulier', async () => {
    const results = await search('acacia');
    expect(results[0]?.name).toBe('Carrefour Acacias');
  });

  it('« ngoa » trouve Ngoa-Ekellé, malgré le trait d’union et l’accent absents', async () => {
    const results = await search('ngoa');
    expect(results.length).toBeGreaterThan(0);
    // Plusieurs repères légitimes portent ce nom (le quartier, le carrefour, la fac) :
    // ce qui compte est qu'ils sortent tous, et en tête.
    const noms = results.map((r) => `${r.name} ${r.quartier ?? ''}`);
    expect(noms[0]).toMatch(/Ngoa/i);
    expect(noms.filter((nom) => /Ngoa/i.test(nom)).length).toBeGreaterThanOrEqual(3);
  });

  it('« mokolo » met le marché devant le carrefour et le quartier (popularité)', async () => {
    const results = await search('mokolo');
    expect(results[0]?.name).toBe('Marché Mokolo');
    expect(results.map((r) => r.name)).toEqual(
      expect.arrayContaining(['Marché Mokolo', 'Carrefour Mokolo', 'Mokolo']),
    );
  });

  it('« carrefour bastos » trouve le carrefour, pas seulement le quartier', async () => {
    const results = await search('carrefour bastos');
    expect(results[0]?.name).toBe('Carrefour Bastos');
  });

  it('« en face de la pharmacie de melen » traverse le remplissage', async () => {
    // C'est la vraie phrase d'un passager de Yaoundé. La similarité brute sur la phrase
    // entière échouerait : c'est l'extraction des mots porteurs qui la rattrape.
    const results = await search('en face de la pharmacie de melen');
    expect(results[0]?.name).toBe('Pharmacie de Melen');
  });
});

describe('GET /v1/geo/search — tolérance', () => {
  it('pardonne une faute de frappe', async () => {
    expect((await search('carefour warda'))[0]?.name).toBe('Carrefour Warda');
  });

  it('pardonne les accents absents', async () => {
    expect((await search('marche central'))[0]?.name).toBe('Marché Central');
    expect((await search('universite de yaounde'))[0]?.name).toMatch(/Université de Yaoundé/);
  });

  it('pardonne les traits d’union absents', async () => {
    expect((await search('biyem assi'))[0]?.name).toMatch(/Biyem-Assi/);
  });

  it('comprend une demande en langage naturel', async () => {
    expect((await search('je veux aller au marché mokolo'))[0]?.name).toBe('Marché Mokolo');
  });

  it('ne rend rien plutôt que n’importe quoi', async () => {
    expect(await search('zzzzqqqqxxxx')).toEqual([]);
  });
});

describe('GET /v1/geo/search — tri et contrat', () => {
  it('à pertinence égale, le repère le plus proche passe devant', async () => {
    // Trois « Mokolo » à pertinence identique. Depuis Biyem-Assi, au sud-ouest, c'est
    // la distance qui doit départager, pas la popularité.
    const depuisBiyemAssi = await search('mokolo', { lat: '3.8341', lng: '11.4784' });
    const distances = depuisBiyemAssi.map((r) => r.distanceM);
    expect(distances.every((d) => typeof d === 'number')).toBe(true);
    // Le tri annoncé est : similarité, puis distance, puis popularité.
    const croissantes = [...distances].sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(distances).toEqual(croissantes);
  });

  it('sans position, la distance est nulle et le tri retombe sur la popularité', async () => {
    const results = await search('mokolo');
    expect(results.every((r) => r.distanceM === null)).toBe(true);
  });

  it('respecte le contrat mobile : id, name, quartier, category, lat, lng, distanceM', async () => {
    const [premier] = await search('poste centrale');
    expect(premier).toMatchObject({
      id: expect.any(String),
      name: 'Poste Centrale',
      quartier: 'Centre-ville',
      category: 'institution',
      lat: expect.any(Number),
      lng: expect.any(Number),
      distanceM: null,
    });
    // Les coordonnées du seed sont approximatives et le disent : jamais plus de 65.
    expect(premier!.confidence).toBeLessThanOrEqual(65);
  });

  it('refuse une position à moitié donnée plutôt que de l’ignorer', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/geo/search?q=mokolo&lat=3.87' });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('répond en moins de 300 ms', async () => {
    // Exigence de la fiche produit. La marge est large et c'est voulu : le jour où elle
    // ne l'est plus, c'est que la recherche a cessé d'être indexée.
    const debut = performance.now();
    await search('en face de la pharmacie de melen');
    expect(performance.now() - debut).toBeLessThan(300);
  });
});

// ─── Zones ───────────────────────────────────────────────────────────────────

describe('GET /v1/geo/zones', () => {
  it('rend une FeatureCollection GeoJSON directement affichable', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/geo/zones' });
    expect(response.statusCode).toBe(200);

    const collection = response.json();
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features.length).toBeGreaterThanOrEqual(4);

    const zone = collection.features[0];
    expect(zone.type).toBe('Feature');
    expect(zone.geometry.type).toBe('Polygon');
    // La géométrie affichée sur la carte est celle qui a servi à décider : c'est PostGIS
    // qui la sérialise, on ne la reconstruit nulle part.
    expect(Array.isArray(zone.geometry.coordinates)).toBe(true);
  });

  it('publie le centre urbain interdit aux motos, avec le motif à afficher', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/geo/zones?kind=moto_forbidden' });
    const features = response.json().features;

    expect(features).toHaveLength(1);
    expect(features[0].properties.name).toBe('Centre urbain — interdiction moto');
    expect(features[0].properties.reason).toMatch(/[Aa]rrêté préfectoral/);
  });

  it('publie les trois zones moto autorisées', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/geo/zones?kind=moto_allowed' });
    const noms = response.json().features.map((f: { properties: { name: string } }) => f.properties.name);

    expect(noms).toHaveLength(3);
    expect(noms.join(' ')).toMatch(/Emana/);
    expect(noms.join(' ')).toMatch(/Etoudi/);
    expect(noms.join(' ')).toMatch(/Nkolbisson/);
  });
});

// ─── Géorepérage moto : les six trajets ──────────────────────────────────────

/** Repères réels, aux coordonnées du seed. */
const P = {
  melen: { lat: 3.8541, lng: 11.4872 }, // Carrefour Melen — ouest
  obili: { lat: 3.8482, lng: 11.4931 }, // Carrefour Obili — ouest
  biyemAssi: { lat: 3.8341, lng: 11.4784 }, // Carrefour Biyem-Assi — sud-ouest
  mendong: { lat: 3.8248, lng: 11.4652 }, // Marché Mendong — sud-ouest
  emana: { lat: 3.9366, lng: 11.5233 }, // Carrefour Emana — nord
  etoudi: { lat: 3.9092, lng: 11.5298 }, // Carrefour Etoudi — nord
  posteCentrale: { lat: 3.8659, lng: 11.5171 }, // DANS le centre urbain
  marcheCentral: { lat: 3.8664, lng: 11.5183 }, // DANS le centre urbain
  tsinga: { lat: 3.8879, lng: 11.4984 }, // hors zone, à l'ouest du centre
  essos: { lat: 3.8768, lng: 11.5386 }, // hors zone, à l'est du centre
};

describe('isMotoAllowed — six trajets, trois autorisés, trois refusés', () => {
  // ─── Autorisés ─────────────────────────────────────────────────────────────

  it('1. Melen → Obili : plein ouest, la zone n’est jamais approchée', async () => {
    const verdict = await isMotoAllowed(P.melen, P.obili);
    expect(verdict.allowed).toBe(true);
    expect(verdict.zones).toEqual([]);
  });

  it('2. Biyem-Assi → Mendong : sud-ouest, hors du centre urbain', async () => {
    expect((await isMotoAllowed(P.biyemAssi, P.mendong)).allowed).toBe(true);
  });

  it('3. Emana → Etoudi : plein nord, dans les zones moto autorisées', async () => {
    expect((await isMotoAllowed(P.emana, P.etoudi)).allowed).toBe(true);
  });

  // ─── Refusés ───────────────────────────────────────────────────────────────

  it('4. Poste Centrale → Obili : LE DÉPART est dans la zone interdite', async () => {
    const verdict = await isMotoAllowed(P.posteCentrale, P.obili);
    expect(verdict.allowed).toBe(false);
    expect(verdict.zones[0]?.name).toBe('Centre urbain — interdiction moto');
    // La zone revient avec sa géométrie : l'appli la dessine au lieu de dire « impossible ».
    expect(verdict.zones[0]?.geometry).toBeTruthy();
  });

  it('5. Melen → Marché Central : L’ARRIVÉE est dans la zone interdite', async () => {
    const verdict = await isMotoAllowed(P.melen, P.marcheCentral);
    expect(verdict.allowed).toBe(false);
    expect(verdict.zones[0]?.name).toBe('Centre urbain — interdiction moto');
  });

  it('6. Tsinga → Essos : les DEUX BOUTS sont légaux, L’ITINÉRAIRE ne l’est pas', async () => {
    // Le cas qui justifie à lui seul de faire le contrôle côté serveur sur la ligne
    // entière : une vérification des deux extrémités laisserait passer cette course.
    expect((await isMotoAllowed(P.tsinga, P.tsinga)).allowed).toBe(true);
    expect((await isMotoAllowed(P.essos, P.essos)).allowed).toBe(true);

    const verdict = await isMotoAllowed(P.tsinga, P.essos);
    expect(verdict.allowed).toBe(false);
    expect(verdict.zones[0]?.name).toBe('Centre urbain — interdiction moto');
  });

  // ─── Et la réciproque ──────────────────────────────────────────────────────

  it('le même Tsinga → Essos redevient légal si l’itinéraire contourne par le nord', async () => {
    // Symétrique du cas 6, et tout aussi important : on ne refuse pas une course
    // légale parce que le segment droit, lui, coupait la zone. C'est l'itinéraire réel
    // qui décide — d'où l'appel à OSRM avant le contrôle, dans `pricing`.
    const contournement = [
      { lat: 3.8929, lng: 11.5104 }, // Bastos
      { lat: 3.895, lng: 11.525 },
      { lat: 3.89, lng: 11.538 },
    ];
    expect((await isMotoAllowed(P.tsinga, P.essos, contournement)).allowed).toBe(true);
  });

  it('accepte l’itinéraire sous forme de polyligne encodée, comme il est stocké', async () => {
    const { encodePolyline } = await import('../lib/polyline.js');
    const encoded = encodePolyline([P.tsinga, P.posteCentrale, P.essos]);
    expect((await isMotoAllowed(P.tsinga, P.essos, encoded)).allowed).toBe(false);
  });
});

describe('POST /v1/geo/moto/check', () => {
  it('répond 200 avec le verdict et la phrase à afficher, jamais une erreur', async () => {
    // C'est une question, pas une commande : le refus se lit dans le corps.
    const response = await app.inject({
      method: 'POST',
      url: '/v1/geo/moto/check',
      payload: { pickup: P.melen, dropoff: P.marcheCentral, route: [P.melen, P.marcheCentral] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.allowed).toBe(false);
    expect(body.message).toMatch(/arrêté préfectoral/i);
    expect(body.zones).toHaveLength(1);
  });

  it('laisse le message à null quand la course est possible', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/geo/moto/check',
      payload: { pickup: P.melen, dropoff: P.obili, route: [P.melen, P.obili] },
    });

    expect(response.json()).toMatchObject({ allowed: true, message: null, zones: [] });
  });
});

// ─── Routage ─────────────────────────────────────────────────────────────────

describe('GET /v1/geo/route', () => {
  it('rend une distance, une durée, une géométrie, et dit d’où elles viennent', async () => {
    // Ce test passe AVEC ou SANS réseau, et c'est tout l'intérêt : si OSRM répond, on
    // valide la lecture de sa réponse ; s'il ne répond pas, on valide le repli. Dans
    // les deux cas la réponse a la même forme et le champ `routing` dit laquelle.
    const response = await app.inject({
      method: 'GET',
      url: '/v1/geo/route?from_lat=3.8541&from_lng=11.4872&to_lat=3.8659&to_lng=11.5171',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(['osrm', 'fallback']).toContain(body.routing);
    expect(body.distanceM).toBeGreaterThan(0);
    expect(body.durationS).toBeGreaterThan(0);
    expect(decodePolyline(body.geometry).length).toBeGreaterThanOrEqual(2);

    // Melen → Poste Centrale fait environ 3,5 km à vol d'oiseau ; par la route, entre
    // 4 et 12 km selon l'itinéraire. Au-delà, c'est qu'on a lu la réponse de travers.
    expect(body.distanceM).toBeGreaterThan(3_000);
    expect(body.distanceM).toBeLessThan(12_000);
  }, 15_000);

  it('valide les coordonnées avant d’appeler quoi que ce soit', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/geo/route?from_lat=200&from_lng=11.48&to_lat=3.86&to_lng=11.51',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });
});
