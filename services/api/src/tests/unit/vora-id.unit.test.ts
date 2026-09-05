import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors.js';
import {
  allocateVoraId,
  formatVoraId,
  generateVoraId,
  isTrivialVoraId,
  isValidVoraId,
  luhnCheckDigit,
} from '../../modules/identity/vora-id.js';

describe('ID VORA', () => {
  it('produit 8 chiffres, clé de Luhn juste, motif non trivial', () => {
    for (let i = 0; i < 80; i += 1) {
      const id = generateVoraId();
      expect(id).toMatch(/^\d{8}$/);
      expect(isValidVoraId(id)).toBe(true);
      expect(isTrivialVoraId(id)).toBe(false);
    }
  });

  it('rejette les motifs triviaux même s’ils passent Luhn', () => {
    expect(isTrivialVoraId('11111111')).toBe(true);
    expect(isTrivialVoraId('12121212')).toBe(true);
    expect(isTrivialVoraId('48214821')).toBe(true);
    expect(isTrivialVoraId('01234567')).toBe(true);
    expect(isTrivialVoraId('12345678')).toBe(true);
    expect(isTrivialVoraId('98765432')).toBe(true);
  });

  it('détecte une faute de frappe isolée via Luhn', () => {
    const id = generateVoraId();
    const payload = id.slice(0, 7);
    expect(luhnCheckDigit(payload)).toBe(Number(id[7]));

    const flipped = `${id.slice(0, 3)}${id[3] === '0' ? '1' : '0'}${id.slice(4)}`;
    expect(isValidVoraId(flipped)).toBe(false);
  });

  it('s’affiche en deux groupes de 4', () => {
    expect(formatVoraId('48210937')).toBe('4821 0937');
  });

  it('garantit l’unicité en relançant tant que l’ID est pris', async () => {
    const taken = new Set<string>();
    const allocated: string[] = [];

    for (let i = 0; i < 8; i += 1) {
      const id = await allocateVoraId(async (candidate) => taken.has(candidate));
      expect(taken.has(id)).toBe(false);
      taken.add(id);
      allocated.push(id);
    }

    expect(new Set(allocated).size).toBe(8);
    expect(allocated.every(isValidVoraId)).toBe(true);
  });

  it('relance le tirage tant que le candidat est déjà pris', async () => {
    const drawn: string[] = [];

    // Les trois premiers candidats sont déjà en base ; le quatrième est libre.
    const id = await allocateVoraId(async (candidate) => {
      drawn.push(candidate);
      return drawn.length <= 3;
    });

    expect(drawn).toHaveLength(4);
    expect(id).toBe(drawn[3]);
    expect(drawn.slice(0, 3)).not.toContain(id);
    expect(isValidVoraId(id)).toBe(true);
  });

  it('lève VORA_ID_UNAVAILABLE si tous les tirages sont déjà pris', async () => {
    await expect(allocateVoraId(async () => true, { maxAttempts: 3 })).rejects.toMatchObject({
      code: 'VORA_ID_UNAVAILABLE',
    });
    await expect(allocateVoraId(async () => true, { maxAttempts: 3 })).rejects.toBeInstanceOf(AppError);
  });
});
