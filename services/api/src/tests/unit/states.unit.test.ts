// VORA — machine à états de la course. Tests purs, sans base.
//
// Ce fichier vaut contrat : il énumère TOUTES les transitions autorisées, avec leurs
// acteurs, et vérifie qu'aucune autre ne passe. Si quelqu'un ajoute une flèche dans
// `domain/states.ts` sans l'ajouter ici, le test échoue — c'est voulu. Une machine à
// états qui s'élargit en silence, c'est un litige qu'on ne saura pas arbitrer.
//
// Référence : docs/VORA_cycle_de_vie_course.mermaid et CLAUDE.md § 5.7.

import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  isActive,
  isTerminal,
  nextStatuses,
  RIDE_STATUSES,
  type Actor,
  type RideStatus,
} from '../../domain/states.js';
import { AppError } from '../../lib/errors.js';

/**
 * LE TABLEAU DE RÉFÉRENCE. Écrit à la main, à partir du diagramme, et volontairement
 * pas importé de `states.ts` : un test qui relit la source qu'il vérifie ne vérifie rien.
 */
const EXPECTED: Array<[RideStatus, RideStatus, Actor[]]> = [
  // Le passager saisit sa destination, puis commande.
  ['draft', 'requested', ['passenger']],
  ['draft', 'cancelled_free', ['passenger']],

  // Le dispatch cherche un chauffeur.
  ['requested', 'offered', ['system']],
  ['requested', 'expired', ['system']],
  ['requested', 'cancelled_free', ['passenger', 'ops']],

  // D'un chauffeur au suivant, sans repasser par `requested`.
  ['offered', 'offered', ['system']],
  ['offered', 'accepted', ['driver']],
  ['offered', 'expired', ['system']],
  ['offered', 'cancelled_free', ['passenger', 'ops']],

  // Le chauffeur a accepté.
  ['accepted', 'approaching', ['driver', 'system']],
  ['accepted', 'arrived', ['driver']],
  ['accepted', 'cancelled_driver', ['driver']],
  ['accepted', 'cancelled_free', ['passenger', 'ops']],
  ['accepted', 'cancelled_late', ['passenger']],

  // Il roule vers le point de rendez-vous.
  ['approaching', 'arrived', ['driver']],
  ['approaching', 'cancelled_driver', ['driver']],
  ['approaching', 'cancelled_free', ['passenger', 'ops']],
  ['approaching', 'cancelled_late', ['passenger']],

  // Il attend le passager.
  ['arrived', 'in_progress', ['driver']],
  ['arrived', 'no_show', ['driver']],
  ['arrived', 'cancelled_driver', ['driver']],
  ['arrived', 'cancelled_free', ['passenger', 'ops']],
  ['arrived', 'cancelled_late', ['passenger']],

  // La course, puis l'argent.
  ['in_progress', 'completed', ['driver']],
  ['completed', 'paid', ['driver', 'passenger', 'system']],
  ['paid', 'rated', ['passenger', 'system']],

  // « Attendre 2 min » : la course expirée repart en dispatch, au même prix.
  ['expired', 'requested', ['passenger', 'ops']],
];

const TERMINALS: RideStatus[] = [
  'rated',
  'cancelled_free',
  'cancelled_late',
  'cancelled_driver',
  'no_show',
];

const ALL_ACTORS: Actor[] = ['passenger', 'driver', 'system', 'ops'];

describe('toutes les transitions autorisées, et leurs acteurs', () => {
  it.each(EXPECTED)('%s → %s est ouverte à %j', (from, to, actors) => {
    for (const actor of actors) {
      expect(canTransition(from, to, actor)).toBe(true);
      expect(() => assertTransition(from, to, actor)).not.toThrow();
    }
  });

  it.each(EXPECTED)('%s → %s est FERMÉE aux autres acteurs', (from, to, actors) => {
    // Une flèche existe, mais elle n'appartient pas à tout le monde : le passager ne
    // décide pas d'un `accepted`, le chauffeur ne décide pas d'un `cancelled_free`.
    for (const actor of ALL_ACTORS.filter((candidate) => !actors.includes(candidate))) {
      expect(canTransition(from, to, actor)).toBe(false);
      expect(() => assertTransition(from, to, actor)).toThrow(AppError);
    }
  });

  it('n’autorise RIEN d’autre que ce tableau', () => {
    const allowed = new Set(EXPECTED.map(([from, to]) => `${from}→${to}`));

    for (const from of RIDE_STATUSES) {
      for (const to of RIDE_STATUSES) {
        const expected = allowed.has(`${from}→${to}`);
        expect(
          nextStatuses(from).includes(to),
          `${from} → ${to} devrait être ${expected ? 'autorisée' : 'refusée'}`,
        ).toBe(expected);
      }
    }
  });

  it('reconnaît les états terminaux et les états vivants', () => {
    for (const status of RIDE_STATUSES) {
      expect(isTerminal(status)).toBe(TERMINALS.includes(status));
    }
    // `draft` n'est pas terminal, mais pas « actif » non plus : rien n'est encore engagé.
    expect(isActive('draft')).toBe(false);
    expect(isActive('requested')).toBe(true);
    expect(isActive('in_progress')).toBe(true);
    expect(isActive('paid')).toBe(true);
    expect(isActive('cancelled_late')).toBe(false);
    // `expired` reste « vivante » : le passager peut encore la relancer.
    expect(isActive('expired')).toBe(true);
    expect(isTerminal('expired')).toBe(false);
  });
});

describe('cinq transitions invalides, et pourquoi chacune compte', () => {
  /** Extrait le code métier d'une transition refusée. */
  function refusal(from: RideStatus, to: RideStatus, actor: Actor): AppError {
    try {
      assertTransition(from, to, actor);
    } catch (error) {
      return error as AppError;
    }
    throw new Error(`${from} → ${to} par ${actor} aurait dû être refusée.`);
  }

  it('1. requested → in_progress : démarrer une course sans chauffeur', () => {
    // Le raccourci qui ferait disparaître le dispatch, l'acceptation et le code de
    // montée d'un seul coup.
    const error = refusal('requested', 'in_progress', 'driver');
    expect(error.code).toBe('INVALID_TRANSITION');
    expect(error.statusCode).toBe(409);
  });

  it('2. arrived → completed : encaisser une course qui n’a jamais démarré', () => {
    // C'est LE contournement du code de montée (CLAUDE.md § 5.5) : sans ce refus, un
    // chauffeur pourrait clôturer et se faire payer sans que personne ne monte.
    expect(refusal('arrived', 'completed', 'driver').code).toBe('INVALID_TRANSITION');
  });

  it('3. completed → in_progress : revenir en arrière pour rallonger la course', () => {
    // Une course ne remonte jamais le temps. Le prix est ferme, la durée est close.
    expect(refusal('completed', 'in_progress', 'driver').code).toBe('INVALID_TRANSITION');
  });

  it('4. paid → cancelled_late : annuler une course déjà payée', () => {
    // Après le paiement, on ne « décommande » plus : on ouvre un litige, et c'est l'ops
    // qui tranche. Un remboursement n'est pas une annulation.
    expect(refusal('paid', 'cancelled_late', 'passenger').code).toBe('INVALID_TRANSITION');
  });

  it('5. offered → accepted par le PASSAGER : accepter à la place du chauffeur', () => {
    // La flèche existe, l'acteur n'est pas le bon. Le message le dit autrement — « cette
    // action ne vous appartient pas » — et c'est ce que l'appli doit afficher.
    const error = refusal('offered', 'accepted', 'passenger');
    expect(error.code).toBe('INVALID_TRANSITION');
    expect(error.message).toMatch(/ne vous appartient pas/i);
  });

  it('un état terminal ne mène plus nulle part, pour personne', () => {
    for (const status of TERMINALS) {
      expect(nextStatuses(status)).toEqual([]);
      for (const actor of ALL_ACTORS) {
        expect(canTransition(status, 'requested', actor)).toBe(false);
      }
    }
  });

  it('porte le détail de ce qui était possible, pour que l’appli se resynchronise', () => {
    const error = refusal('completed', 'arrived', 'driver');
    expect(error.details).toMatchObject({
      from: 'completed',
      to: 'arrived',
      allowed: ['paid'],
    });
  });
});
