// VORA — signature du devis et score de dispatch. Tests purs, sans base.

import { describe, expect, it } from 'vitest';
import {
  canonicalQuotePayload,
  signQuote,
  verifyQuoteSignature,
  type QuoteSignatureInput,
} from '../../modules/pricing/quote.js';
import { approachEtaS, scoreDriver, ETA_SATURATION_S } from '../../modules/dispatch/scoring.js';
import { DISPATCH_SCORE_WEIGHTS } from '../../domain/rules.js';

const SECRET = 'secret-de-test-uniquement';

const QUOTE: QuoteSignatureInput = {
  quoteId: '11111111-1111-4111-8111-111111111111',
  passengerId: '22222222-2222-4222-8222-222222222222',
  offer: 'eco',
  tariffId: '33333333-3333-4333-8333-333333333333',
  pickup: { lat: 3.8541, lng: 11.4872 },
  dropoff: { lat: 3.8659, lng: 11.5171 },
  distanceM: 5_000,
  durationS: 900,
  price: 1_625,
  night: false,
  surgePercent: 0,
  expiresAt: '2026-09-05T13:02:00.000Z',
};

describe('signature du devis (CLAUDE.md § 5.1)', () => {
  it('valide un devis intact', () => {
    const signature = signQuote(QUOTE, SECRET);
    expect(verifyQuoteSignature(QUOTE, signature, SECRET)).toBe(true);
  });

  it('détecte un PRIX modifié — c’est la raison d’être de la signature', () => {
    const signature = signQuote(QUOTE, SECRET);
    expect(verifyQuoteSignature({ ...QUOTE, price: 900 }, signature, SECRET)).toBe(false);
  });

  it('détecte un trajet, une offre ou une expiration modifiés', () => {
    const signature = signQuote(QUOTE, SECRET);

    // Rejouer un prix de 5 km sur un trajet de 20 km.
    expect(verifyQuoteSignature({ ...QUOTE, distanceM: 20_000 }, signature, SECRET)).toBe(false);
    // Payer une Confort au tarif Éco.
    expect(verifyQuoteSignature({ ...QUOTE, offer: 'confort' }, signature, SECRET)).toBe(false);
    // Prolonger soi-même la validité de 2 minutes.
    expect(
      verifyQuoteSignature({ ...QUOTE, expiresAt: '2026-09-05T23:00:00.000Z' }, signature, SECRET),
    ).toBe(false);
    // Rejouer le devis d'un autre passager.
    expect(
      verifyQuoteSignature(
        { ...QUOTE, passengerId: '44444444-4444-4444-8444-444444444444' },
        signature,
        SECRET,
      ),
    ).toBe(false);
  });

  it('refuse une signature faite avec une autre clé', () => {
    expect(verifyQuoteSignature(QUOTE, signQuote(QUOTE, 'autre-clé'), SECRET)).toBe(false);
  });

  it('tolère le bruit du GPS sous le mètre, mais pas un vrai déplacement', () => {
    const signature = signQuote(QUOTE, SECRET);

    // Le sixième chiffre après la virgule vaut ~10 cm : on signe une position, pas un
    // capteur. Sans cet arrondi, un devis parfaitement légitime serait rejeté.
    const bruit = { ...QUOTE, pickup: { lat: 3.8541004, lng: 11.4872003 } };
    expect(verifyQuoteSignature(bruit, signature, SECRET)).toBe(true);

    // 100 m plus loin, en revanche, ce n'est plus le même point de départ.
    const ailleurs = { ...QUOTE, pickup: { lat: 3.8550, lng: 11.4872 } };
    expect(verifyQuoteSignature(ailleurs, signature, SECRET)).toBe(false);
  });

  it('produit une chaîne canonique relisible à la main dans un litige', () => {
    expect(canonicalQuotePayload(QUOTE)).toBe(
      'vora.quote.v1|11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222|eco|' +
        '33333333-3333-4333-8333-333333333333|3.85410|11.48720|3.86590|11.51710|5000|900|1625|day|0|' +
        '2026-09-05T13:02:00.000Z',
    );
  });
});

describe('score d’attribution (CLAUDE.md § 5.4)', () => {
  it('vaut 1 pour le chauffeur idéal, 0 pour le pire', () => {
    expect(
      scoreDriver({ etaS: 0, acceptanceRate: 1, cancellationRate: 0, rating: 5 }).score,
    ).toBeCloseTo(1, 10);

    expect(
      scoreDriver({
        etaS: ETA_SATURATION_S,
        acceptanceRate: 0,
        cancellationRate: 1,
        rating: 0,
      }).score,
    ).toBeCloseTo(0, 10);
  });

  it('applique exactement les quatre pondérations du brief', () => {
    // Chauffeur parfait sauf sur l'ETA, qui est au maximum : il perd tout le poids ETA.
    const sansEta = scoreDriver({
      etaS: ETA_SATURATION_S,
      acceptanceRate: 1,
      cancellationRate: 0,
      rating: 5,
    });
    expect(sansEta.score).toBeCloseTo(1 - DISPATCH_SCORE_WEIGHTS.eta, 10);

    // Parfait sauf la note : il perd exactement 10 %.
    const sansNote = scoreDriver({
      etaS: 0,
      acceptanceRate: 1,
      cancellationRate: 0,
      rating: 0,
    });
    expect(sansNote.score).toBeCloseTo(1 - DISPATCH_SCORE_WEIGHTS.rating, 10);
  });

  it('la proximité l’emporte sur la note — 55 % contre 10 %', () => {
    // Le passager attend un chauffeur, pas une étoile de plus. C'est le sens des poids.
    const proche = scoreDriver({ etaS: 120, acceptanceRate: 0.8, cancellationRate: 0.1, rating: 4.2 });
    const loinMaisNote = scoreDriver({ etaS: 720, acceptanceRate: 0.8, cancellationRate: 0.1, rating: 5 });
    expect(proche.score).toBeGreaterThan(loinMaisNote.score);
  });

  it('ne sort jamais de [0, 1], même avec des statistiques aberrantes', () => {
    const aberrant = scoreDriver({
      etaS: 99_999,
      acceptanceRate: 3,
      cancellationRate: -2,
      rating: 12,
    });
    expect(aberrant.score).toBeGreaterThanOrEqual(0);
    expect(aberrant.score).toBeLessThanOrEqual(1);
  });

  it('estime l’approche avec les constantes du repli de routage', () => {
    // ~1,1 km à vol d'oiseau entre ces deux points de Yaoundé → ~1,5 km par la route à
    // 22 km/h, soit environ 4 minutes. On vérifie l'ordre de grandeur, pas la seconde.
    const etaS = approachEtaS({ lat: 3.8541, lng: 11.4872 }, { lat: 3.8541, lng: 11.4972 });
    expect(etaS).toBeGreaterThan(120);
    expect(etaS).toBeLessThan(400);
  });
});
