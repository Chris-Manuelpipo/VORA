// VORA — l'isolation du simulateur, vérifiée par un test plutôt que promise par un
// commentaire.
//
// LA QUESTION DU JURY : « votre produit fonctionne-t-il sans le simulateur ? »
//
// La réponse ne peut pas être « oui, promis ». Elle doit être vérifiable, et le rester
// quand quelqu'un ajoutera une fonctionnalité à trois heures du matin. Ce fichier lit le
// code source et échoue si la frontière bouge.
//
// La règle est asymétrique, et c'est normal :
//   · `demo/` PEUT importer les modules métier — c'est un client, il appelle le produit ;
//   · aucun module métier ne PEUT importer `demo/` — sinon le produit dépendrait de son
//     simulateur, et l'enlever le casserait.
//
// Seule exception admise : `index.ts`, qui n'est pas un module métier mais le montage du
// processus, et qui charge `demo/` par un import DYNAMIQUE sous condition DEMO_MODE.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Tous les fichiers `.ts` sous un dossier, récursivement. */
function filesUnder(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...filesUnder(full));
    } else if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }

  return found;
}

/** Chemin relatif à `src/`, en séparateurs POSIX, pour des messages lisibles. */
const relative = (file: string): string => file.slice(SRC.length + 1).replaceAll('\\', '/');

/** Le code du produit : tout `src/`, sauf le simulateur, les tests et le montage. */
function productionFiles(): string[] {
  return filesUnder(SRC).filter((file) => {
    const path = relative(file);
    return (
      !path.startsWith('demo/') &&
      !path.startsWith('tests/') &&
      path !== 'index.ts'
    );
  });
}

/** Toutes les spécifications importées d'un fichier, statiques comme dynamiques. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];

  // `import … from 'x'`, `export … from 'x'`, et `import('x')`.
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^;]*?from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }

  return specifiers;
}

describe('le produit ne dépend pas de son simulateur', () => {
  it('aucun fichier de production n’importe demo/', () => {
    const offenders: string[] = [];

    for (const file of productionFiles()) {
      for (const specifier of importsOf(file)) {
        // `./demo/x`, `../demo/x`, `../../demo/x`… quelle que soit la profondeur.
        if (/(^|\/)demo\//.test(specifier)) {
          offenders.push(`${relative(file)} → ${specifier}`);
        }
      }
    }

    expect(
      offenders,
      `Ces fichiers de production importent le simulateur :\n  ${offenders.join('\n  ')}\n` +
        'Le produit doit fonctionner sans lui. Passez par BuildOptions.plugins (voir app.ts).',
    ).toEqual([]);
  });

  it('app.ts, le cœur de l’application, ne mentionne aucun fichier de demo/', () => {
    // `app.ts` lit `config.DEMO_MODE` (un réglage, pas un module) — mais il ne doit
    // connaître aucun chemin vers `demo/`.
    const imports = importsOf(join(SRC, 'app.ts'));
    expect(imports.filter((specifier) => specifier.includes('demo'))).toEqual([]);
  });

  it('index.ts charge le simulateur DYNAMIQUEMENT et sous condition', () => {
    const source = readFileSync(join(SRC, 'index.ts'), 'utf8');

    // Un import statique chargerait le module — et toutes ses dépendances — même avec
    // DEMO_MODE=false. Le produit embarquerait alors son simulateur en production.
    expect(source).not.toMatch(/^\s*import\s[^;]*from\s+['"]\.\/demo\//m);
    expect(source).toMatch(/await import\(['"]\.\/demo\//);
    expect(source).toMatch(/config\.DEMO_MODE/);
  });

  it('le simulateur, lui, a le droit d’appeler le produit', () => {
    // La réciproque n'est pas vraie, et ce test le rend explicite : sans cette autorisation
    // le simulateur ne pourrait pas être un client du produit, ce qui est tout son intérêt.
    const simulator = readFileSync(join(SRC, 'demo/simulator.ts'), 'utf8');
    expect(simulator).toMatch(/from '\.\.\/modules\//);
  });
});

describe('les modules métier ne se contournent pas entre eux', () => {
  it('aucun module n’importe le repository d’un autre module', () => {
    // « Un module n'écrit que dans ses tables et n'appelle les autres que par leur
    // service applicatif » (CLAUDE.md § 7). Lire le repository d'un voisin, c'est
    // contourner ses règles — et découvrir six mois plus tard qu'une écriture a échappé
    // à la machine à états.
    const offenders: string[] = [];
    const modulesRoot = join(SRC, 'modules');

    for (const file of filesUnder(modulesRoot)) {
      const owner = relative(file).split('/')[1];

      for (const specifier of importsOf(file)) {
        const match = /\.\.\/([a-z]+)\/repository\.js$/.exec(specifier);
        if (match && match[1] !== owner) {
          offenders.push(`${relative(file)} → ${specifier}`);
        }
      }
    }

    expect(
      offenders,
      `Ces fichiers lisent le repository d'un autre module :\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('le chemin critique ne dépend pas de l’assistant de support', () => {
  // LA QUESTION DU JURY, deuxième version : « et si votre IA tombe ? »
  //
  // Le devis, la commande, le dispatch et le paiement ne doivent RIEN lui demander. Un
  // assistant qui répond mal fait un support médiocre ; un assistant dont dépend une
  // commande fait une application en panne. La frontière est asymétrique, comme pour le
  // simulateur : `support/` appelle le service `rides` pour lire une course, jamais
  // l'inverse.
  it('aucun module métier n’importe support/', () => {
    const offenders: string[] = [];
    const modulesRoot = join(SRC, 'modules');

    for (const file of filesUnder(modulesRoot)) {
      if (relative(file).startsWith('modules/support/')) continue;

      for (const specifier of importsOf(file)) {
        if (/(^|\/)support\//.test(specifier)) {
          offenders.push(`${relative(file)} → ${specifier}`);
        }
      }
    }

    expect(
      offenders,
      `Ces modules métier dépendent de l'assistant de support :\n  ${offenders.join('\n  ')}\n` +
        "Le produit doit commander, dispatcher et encaisser sans lui.",
    ).toEqual([]);
  });

  it('le support lit les courses par le SERVICE rides, pas par sa base', () => {
    const contextFile = join(SRC, 'modules/support/context.ts');

    // Le service applique le filtrage par destinataire de `toRideDto` : le net du
    // chauffeur ne peut pas atterrir dans le contexte d'un passager. Lire la base
    // directement contournerait ce filtre — et personne ne s'en apercevrait.
    const imports = importsOf(contextFile);
    expect(imports).toContain('../rides/service.js');
    // Ni connexion à la base, ni repository : le seul chemin vers une course est le
    // service qui sait déjà quoi montrer à qui. (Le type `UserRole`, lui, est effacé à
    // la compilation — il ne donne accès à rien.)
    expect(imports).not.toContain('../../db/client.js');
    expect(imports.filter((specifier) => specifier.endsWith('repository.js'))).toEqual([]);
  });
});
