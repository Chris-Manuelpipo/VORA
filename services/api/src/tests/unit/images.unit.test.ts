// VORA — reconnaissance d'image par les octets. Test pur, sans base ni réseau.
//
// C'est huit octets de vérification qui séparent « on stocke des photos » de « on héberge
// n'importe quel fichier fourni par un inconnu ». Ils méritent leurs propres cas.

import { describe, expect, it } from 'vitest';
import {
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  sniffImageType,
} from '../../lib/images.js';

/** Un tampon de `size` octets qui commence par `magic`. */
function withMagic(magic: number[] | string, size = 256, at = 0): Buffer {
  const buffer = Buffer.alloc(size, 0x20);
  const bytes = typeof magic === 'string' ? Buffer.from(magic, 'ascii') : Buffer.from(magic);
  bytes.copy(buffer, at);
  return buffer;
}

describe('sniffImageType', () => {
  it('reconnaît les trois formats acceptés', () => {
    expect(sniffImageType(withMagic([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(withMagic([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );

    const riff = withMagic('RIFF');
    Buffer.from('WEBP', 'ascii').copy(riff, 8);
    expect(sniffImageType(riff)).toBe('image/webp');
  });

  it('refuse un fichier qui MENT sur son type', () => {
    // Le cas qui compte : l'en-tête HTTP dira « image/jpeg », le contenu est du HTML.
    const html = Buffer.from(`<html><script>alert(1)</script>${' '.repeat(300)}</html>`);
    expect(sniffImageType(html)).toBeNull();

    // Un PDF, un ZIP, un exécutable ELF : mêmes refus.
    expect(sniffImageType(withMagic('%PDF-1.4'))).toBeNull();
    expect(sniffImageType(withMagic([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(sniffImageType(withMagic([0x7f, 0x45, 0x4c, 0x46]))).toBeNull();
  });

  it('refuse un RIFF qui n’est pas du WebP', () => {
    // Un fichier WAV commence aussi par RIFF : c'est le second marqueur qui tranche.
    const wav = withMagic('RIFF');
    Buffer.from('WAVE', 'ascii').copy(wav, 8);
    expect(sniffImageType(wav)).toBeNull();
  });

  it('refuse ce qui est trop court pour être une image', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    // Les bons octets, mais rien derrière : une image de 3 octets n'existe pas.
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it('ne se laisse pas avoir par un marqueur placé plus loin', () => {
    // FF D8 FF présent, mais pas au début : ce n'est pas un JPEG.
    expect(sniffImageType(withMagic([0xff, 0xd8, 0xff], 256, 10))).toBeNull();
  });
});

describe('les constantes restent cohérentes', () => {
  it('chaque type accepté a son extension', () => {
    for (const mime of IMAGE_MIME_TYPES) {
      expect(IMAGE_EXTENSIONS[mime], mime).toBeTruthy();
    }
  });

  it('la borne de taille vaut 2 Mo, comme la contrainte en base', () => {
    // La migration 0006 porte `size_bytes <= 2097152` : les deux doivent dire la même
    // chose, sinon une écriture passe ici et échoue là-bas avec une erreur SQL brute.
    expect(MAX_IMAGE_BYTES).toBe(2_097_152);
  });
});
