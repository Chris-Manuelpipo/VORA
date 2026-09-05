import { describe, expect, it } from 'vitest';
import { computeDriverEarnings, computeFare } from '../../modules/pricing/fare.js';

/** 5 septembre 2026, 14 h à Yaoundé : hors tranche de nuit. */
const DAY = new Date('2026-09-05T13:00:00.000Z');
/** 5 septembre 2026, 23 h à Yaoundé (UTC+1). */
const NIGHT = new Date('2026-09-05T22:00:00.000Z');

describe('tables de vérité tarifaires (CLAUDE.md § 5.2)', () => {
  it('Éco 5 km / 15 min, jour : 1 625 F, net chauffeur 1 365 F', () => {
    const fare = computeFare({
      offer: 'eco',
      distanceM: 5_000,
      durationS: 15 * 60,
      at: DAY,
    });
    expect(fare.total).toBe(1_625);
    expect(fare.night).toBe(false);

    const earnings = computeDriverEarnings(fare.total, 'eco');
    expect(earnings.commission).toBe(244);
    expect(earnings.dgi).toBe(16);
    expect(earnings.net).toBe(1_365);
  });

  it('la même course de nuit : 2 031 F', () => {
    const fare = computeFare({
      offer: 'eco',
      distanceM: 5_000,
      durationS: 15 * 60,
      at: NIGHT,
    });
    expect(fare.night).toBe(true);
    expect(fare.total).toBe(2_031);
  });

  it('Moto 3 km : 380 F, commission 50, DGI 4, net 326 F', () => {
    const fare = computeFare({
      offer: 'moto',
      distanceM: 3_000,
      durationS: 12 * 60,
      at: DAY,
    });
    expect(fare.total).toBe(380);

    const earnings = computeDriverEarnings(fare.total, 'moto');
    expect(earnings.commission).toBe(50);
    expect(earnings.dgi).toBe(4);
    expect(earnings.net).toBe(326);
  });

  it('ne dépasse jamais le plafond × 1,5 du prix de base', () => {
    const fare = computeFare({
      offer: 'eco',
      distanceM: 5_000,
      durationS: 15 * 60,
      at: NIGHT,
      demandSurgePercent: 50,
    });
    expect(fare.capped).toBe(true);
    expect(fare.total).toBe(Math.round((1_625 * 150) / 100));
  });
});
