import { describe, expect, it } from 'vitest';
import { hashOtpCode, generateOtpCode, verifyOtpCode } from '../../modules/identity/otp.js';

const PEPPER = 'test-pepper-vora';

function challenge(overrides: Partial<Parameters<typeof verifyOtpCode>[0]> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    codeHash: hashOtpCode('123456', PEPPER),
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date('2026-09-05T12:05:00.000Z'),
    consumedAt: null,
    ...overrides,
  };
}

describe('vérification du code OTP', () => {
  it('accepte le code juste, encore valide et non consommé', () => {
    const verdict = verifyOtpCode(
      challenge(),
      '123456',
      PEPPER,
      new Date('2026-09-05T12:00:00.000Z'),
    );
    expect(verdict).toEqual({ ok: true });
  });

  it('en mode démo, le code émis est toujours celui fourni', () => {
    expect(generateOtpCode({ enabled: true, code: '123456' })).toBe('123456');
    const random = generateOtpCode({ enabled: false, code: '123456' });
    expect(random).toMatch(/^\d{6}$/);
  });

  it('refuse un code faux et compte un essai', () => {
    const verdict = verifyOtpCode(
      challenge(),
      '000000',
      PEPPER,
      new Date('2026-09-05T12:00:00.000Z'),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.countsAsAttempt).toBe(true);
    expect(verdict.error.code).toBe('OTP_INVALID');
    expect(verdict.error.message).toContain('4 essai');
  });

  it('passe à OTP_TOO_MANY_ATTEMPTS au dernier essai faux', () => {
    const verdict = verifyOtpCode(
      challenge({ attempts: 4, maxAttempts: 5 }),
      '000000',
      PEPPER,
      new Date('2026-09-05T12:00:00.000Z'),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.countsAsAttempt).toBe(true);
    expect(verdict.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('ne compte pas un essai si le code est déjà consommé', () => {
    const verdict = verifyOtpCode(
      challenge({ consumedAt: new Date('2026-09-05T11:59:00.000Z') }),
      '123456',
      PEPPER,
      new Date('2026-09-05T12:00:00.000Z'),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.countsAsAttempt).toBe(false);
    expect(verdict.error.code).toBe('OTP_ALREADY_USED');
  });

  it('ne compte pas un essai si le code est expiré', () => {
    const verdict = verifyOtpCode(
      challenge(),
      '123456',
      PEPPER,
      new Date('2026-09-05T12:06:00.000Z'),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.countsAsAttempt).toBe(false);
    expect(verdict.error.code).toBe('OTP_EXPIRED');
  });

  it('refuse sans consommer d’essai si le plafond est déjà atteint', () => {
    const verdict = verifyOtpCode(
      challenge({ attempts: 5, maxAttempts: 5 }),
      '123456',
      PEPPER,
      new Date('2026-09-05T12:00:00.000Z'),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.countsAsAttempt).toBe(false);
    expect(verdict.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });
});
