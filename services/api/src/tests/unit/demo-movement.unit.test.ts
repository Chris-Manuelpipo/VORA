// VORA — déplacement des chauffeurs simulés. Tests purs, sans base ni OSRM.
//
// Ce que ces tests protègent : un point qui bouge sur la carte du jury doit ressembler à
// une voiture dans une rue. Un chauffeur qui saute d'un carrefour à l'autre, qui dépasse
// la fin de son itinéraire ou dont la flèche pointe à l'envers, ça se voit — et ça se
// remarque plus qu'un prix juste.

import { describe, expect, it } from 'vitest';
import { advanceAlong, bearing, pathLength, pickOne } from '../../demo/movement.js';
import { haversineMeters } from '../../lib/geodesy.js';

/** Trois points de Yaoundé, d'ouest en est, à peu près alignés. */
const MELEN = { lat: 3.8541, lng: 11.4872 };
const TSINGA = { lat: 3.8879, lng: 11.4984 };
const POSTE = { lat: 3.8659, lng: 11.5171 };

describe('advanceAlong — avancer le long d’un itinéraire', () => {
  it('reste au départ tant qu’on n’a pas roulé', () => {
    const progress = advanceAlong([MELEN, POSTE], 0);
    expect(progress.position).toEqual(MELEN);
    expect(progress.finished).toBe(false);
  });

  it('avance de la distance demandée, au mètre près', () => {
    const progress = advanceAlong([MELEN, POSTE], 1_000);
    const parcouru = haversineMeters(MELEN, progress.position);

    // Interpolation linéaire sur un segment de quelques kilomètres : l'écart à la
    // distance orthodromique se compte en dizaines de centimètres.
    expect(parcouru).toBeGreaterThan(995);
    expect(parcouru).toBeLessThan(1_005);
    expect(progress.finished).toBe(false);
  });

  it('traverse les segments successifs sans sauter de sommet', () => {
    const chemin = [MELEN, TSINGA, POSTE];
    const longueurPremier = haversineMeters(MELEN, TSINGA);

    // Un mètre après le premier sommet : on doit être sur le SECOND segment, donc à
    // peine plus loin que Tsinga — pas revenu au départ, pas téléporté à l'arrivée.
    const progress = advanceAlong(chemin, longueurPremier + 1);
    expect(haversineMeters(TSINGA, progress.position)).toBeLessThan(5);
  });

  it('s’arrête au bout plutôt que de continuer dans le vide', () => {
    const chemin = [MELEN, TSINGA, POSTE];
    const progress = advanceAlong(chemin, pathLength(chemin) + 10_000);

    expect(progress.finished).toBe(true);
    expect(progress.position).toEqual(POSTE);
    // Le compteur ne ment pas : il rend la longueur réelle, pas la distance demandée.
    expect(progress.travelledM).toBeCloseTo(pathLength(chemin), 5);
  });

  it('ignore les points répétés, qu’OSRM produit', () => {
    const avecDoublons = [MELEN, MELEN, TSINGA, TSINGA, POSTE];
    const sans = [MELEN, TSINGA, POSTE];

    expect(pathLength(avecDoublons)).toBeCloseTo(pathLength(sans), 6);
    const a = advanceAlong(avecDoublons, 2_000).position;
    const b = advanceAlong(sans, 2_000).position;
    expect(haversineMeters(a, b)).toBeLessThan(1);
  });

  it('refuse un chemin vide plutôt que de rendre une position fantaisiste', () => {
    expect(() => advanceAlong([], 100)).toThrow(/vide/i);
  });

  it('gère un chemin d’un seul point : on est déjà arrivé', () => {
    const progress = advanceAlong([MELEN], 500);
    expect(progress.position).toEqual(MELEN);
    expect(progress.finished).toBe(true);
  });
});

describe('bearing — la flèche du véhicule', () => {
  it('pointe au nord, à l’est, au sud et à l’ouest', () => {
    expect(bearing({ lat: 3.85, lng: 11.5 }, { lat: 3.95, lng: 11.5 })).toBeCloseTo(0, 1);
    expect(bearing({ lat: 3.85, lng: 11.5 }, { lat: 3.85, lng: 11.6 })).toBeCloseTo(90, 1);
    expect(bearing({ lat: 3.85, lng: 11.5 }, { lat: 3.75, lng: 11.5 })).toBeCloseTo(180, 1);
    expect(bearing({ lat: 3.85, lng: 11.5 }, { lat: 3.85, lng: 11.4 })).toBeCloseTo(270, 1);
  });

  it('reste dans [0, 360)', () => {
    const cap = bearing(POSTE, MELEN);
    expect(cap).toBeGreaterThanOrEqual(0);
    expect(cap).toBeLessThan(360);
  });

  it('suit l’itinéraire : le cap change quand la route tourne', () => {
    const versLeNord = advanceAlong([MELEN, TSINGA, POSTE], 100).heading;
    const apresLeVirage = advanceAlong([MELEN, TSINGA, POSTE], pathLength([MELEN, TSINGA]) + 100)
      .heading;

    expect(Math.abs(versLeNord - apresLeVirage)).toBeGreaterThan(10);
  });
});

describe('pickOne', () => {
  it('rend null sur une liste vide plutôt qu’undefined', () => {
    expect(pickOne([])).toBeNull();
  });

  it('rend toujours un élément de la liste', () => {
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i += 1) {
      expect(items).toContain(pickOne(items));
    }
  });
});
