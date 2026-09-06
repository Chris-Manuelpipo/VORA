// VORA — construction des URL publiques. Test pur.
//
// CE TEST EXISTE À CAUSE D'UNE PANNE RÉELLE, en production sur Clever Cloud.
// `PUBLIC_BASE_URL` avait été collée depuis une barre d'adresse, avec sa barre oblique
// finale : `https://vora.cleverapps.io/`. Le serveur produisait alors
// `https://vora.cleverapps.io//v1/media/<id>` — et `//v1` n'est pas `/v1` pour un serveur
// HTTP, qui répond 404.
//
// Le pire n'était pas la faute, c'était le SILENCE : 200 partout dans l'API, journaux
// vides, tests au vert. Seuls l'avatar qui ne s'affiche pas et le proche qui ouvre un lien
// de partage cassé — depuis un téléphone qui n'a même pas l'application pour se plaindre.

import { describe, expect, it } from 'vitest';
import { publicUrl, stripTrailingSlashes } from '../../lib/urls.js';

describe('stripTrailingSlashes', () => {
  it('retire la barre oblique finale, une ou plusieurs', () => {
    expect(stripTrailingSlashes('https://vora.cleverapps.io/')).toBe('https://vora.cleverapps.io');
    expect(stripTrailingSlashes('https://vora.cleverapps.io///')).toBe('https://vora.cleverapps.io');
  });

  it('ne touche pas à une base déjà propre', () => {
    expect(stripTrailingSlashes('https://vora.cleverapps.io')).toBe('https://vora.cleverapps.io');
    expect(stripTrailingSlashes('http://192.168.1.42:3000')).toBe('http://192.168.1.42:3000');
  });

  it('ne touche pas au schéma', () => {
    // La règle vise la FIN de la chaîne : le `//` de `https://` n'est pas concerné.
    expect(stripTrailingSlashes('https://x.io')).toContain('https://');
  });
});

describe('publicUrl', () => {
  it('produit toujours une seule barre entre la base et le chemin', () => {
    const url = publicUrl('/v1/media/9210a942-becc-4e9e-aea6-289721751714');

    // La vérification qui compte : aucune barre doublée APRÈS le schéma.
    expect(url.replace(/^https?:\/\//, '')).not.toContain('//');
    expect(url).toMatch(/\/v1\/media\/9210a942-becc-4e9e-aea6-289721751714$/);
  });

  it('accepte un chemin avec ou sans barre initiale', () => {
    expect(publicUrl('/v1/share/abc')).toBe(publicUrl('v1/share/abc'));
  });

  it('reste une URL absolue, joignable depuis l’extérieur', () => {
    expect(publicUrl('/v1/media/x')).toMatch(/^https?:\/\/[^/]+\/v1\/media\/x$/);
  });
});
