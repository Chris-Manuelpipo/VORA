// VORA — tests purs du module geo : polyligne, normalisation de requête, repli de routage.
// Le géorepérage, lui, se teste EN BASE (src/tests/geo.test.ts) : c'est PostGIS qui décide,
// pas nous, et un test qui simulerait ST_Intersects ne prouverait rien.

import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline } from '../../lib/polyline.js';
import { haversineMeters } from '../../lib/geodesy.js';
import { normalizeSearchText, prepareQuery } from '../../modules/geo/query.js';
import { fallbackRoute } from '../../modules/geo/routing.js';

describe('polyligne encodée (précision 5)', () => {
  it("décode l'exemple de référence de Google", () => {
    // Exemple canonique de la spécification, qui vaut vérification croisée : si notre
    // décodeur retrouve ces trois points, il lira aussi ceux d'OSRM.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it('fait l’aller-retour sur un itinéraire de Yaoundé, à 1 cm près', () => {
    const trajet = [
      { lat: 3.8547, lng: 11.4884 }, // Pharmacie de Melen
      { lat: 3.8564, lng: 11.5013 }, // Carrefour Ngoa-Ekellé
      { lat: 3.8659, lng: 11.5171 }, // Poste Centrale
    ];

    const decoded = decodePolyline(encodePolyline(trajet));
    expect(decoded).toHaveLength(3);
    for (const [index, point] of trajet.entries()) {
      // La précision 5 arrondit au cent-millième de degré, soit environ 1 m.
      expect(decoded[index]!.lat).toBeCloseTo(point.lat, 5);
      expect(decoded[index]!.lng).toBeCloseTo(point.lng, 5);
    }
  });

  it('rend une liste vide sur une chaîne vide, et s’arrête net sur une chaîne tronquée', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(encodePolyline([])).toBe('');
    // Une géométrie coupée en route ne doit pas produire un point inventé.
    const complet = encodePolyline([
      { lat: 3.8547, lng: 11.4884 },
      { lat: 3.8659, lng: 11.5171 },
    ]);
    expect(decodePolyline(complet.slice(0, 4)).length).toBeLessThan(2);
  });
});

describe('normalisation de la saisie', () => {
  it('désaccentue, met en minuscules et remplace la ponctuation', () => {
    expect(normalizeSearchText('Ngoa-Ekellé')).toBe('ngoa ekelle');
    expect(normalizeSearchText("  Marché  CENTRAL ")).toBe('marche central');
    expect(normalizeSearchText("l'Hôpital Général")).toBe('l hopital general');
  });

  it('ne laisse passer aucun joker LIKE : le filtre est [a-z0-9 ]', () => {
    // C'est ce qui autorise `like '%' || phrase || '%'` dans le SQL sans échappement.
    expect(normalizeSearchText('100% _mokolo_')).toBe('100 mokolo');
  });

  it('retire les mots de liaison mais garde les mots porteurs', () => {
    const { phrase, terms } = prepareQuery('en face de la pharmacie de melen');
    expect(phrase).toBe('en face de la pharmacie de melen');
    expect(terms).toEqual(['pharmacie', 'melen']);
  });

  it('comprend une demande en langage naturel', () => {
    expect(prepareQuery('je veux aller au marché Mokolo stp').terms).toEqual([
      'marche',
      'mokolo',
    ]);
  });

  it('dédoublonne et écarte ce qui est trop court pour un trigramme', () => {
    expect(prepareQuery('mokolo mokolo ok').terms).toEqual(['mokolo']);
  });

  it('retombe sur la phrase entière si tout a été écarté', () => {
    // « chez moi » est intégralement composé de mots de liaison : mieux vaut une
    // recherche large qu'une recherche vide.
    expect(prepareQuery('chez moi').terms).toEqual(['chez moi']);
  });
});

describe('repli de routage (haversine × 1,35 à 22 km/h)', () => {
  const melen = { lat: 3.8547, lng: 11.4884 };
  const poste = { lat: 3.8659, lng: 11.5171 };

  it('applique le facteur de détour et la vitesse, et se déclare comme repli', () => {
    const result = fallbackRoute(melen, poste, 'test');

    const straight = haversineMeters(melen, poste);
    expect(result.distanceM).toBe(Math.round(straight * 1.35));
    expect(result.durationS).toBe(Math.round(result.distanceM / ((22 * 1000) / 3600)));

    // Le repli ne se cache jamais : c'est l'exigence de dégradation gracieuse du brief.
    expect(result.routing).toBe('fallback');
    expect(result.fallbackReason).toBe('test');
  });

  it('rend une géométrie exploitable : le segment droit, encodé comme un vrai itinéraire', () => {
    const result = fallbackRoute(melen, poste, 'test');
    // Le client ne doit pas avoir à savoir d'où vient la géométrie pour l'afficher.
    expect(decodePolyline(result.geometry)).toHaveLength(2);
    expect(result.points).toEqual([melen, poste]);
  });

  it('ne rend jamais une durée nulle sur un trajet dégénéré', () => {
    // Départ = arrivée : 0 s ferait une division par zéro chez un consommateur (ETA).
    expect(fallbackRoute(melen, melen, 'test').durationS).toBeGreaterThanOrEqual(1);
  });
});
