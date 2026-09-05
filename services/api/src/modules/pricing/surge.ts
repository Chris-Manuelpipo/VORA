// VORA — interrupteur de majoration « pluie / forte demande » (CLAUDE.md § 5.1).
//
// C'est l'ops qui l'actionne, depuis la page d'administration : il pleut sur Yaoundé,
// les chauffeurs se raréfient, la majoration monte jusqu'à + 50 %. Elle apparaît alors
// en LIGNE SÉPARÉE dans le prix, jamais fondue dans le total, et le plafond global × 1,5
// continue de s'appliquer.
//
// ÉTAT EN MÉMOIRE, assumé : un seul processus API en démo (CLAUDE.md § 3), et une
// majoration est par nature éphémère — la remettre à zéro au redémarrage est le bon
// comportement par défaut, pas une perte. La valeur est bornée ici, en plus de l'être
// dans `computeFare` : une valeur aberrante ne doit jamais pouvoir entrer dans le calcul,
// même par un chemin qu'on n'a pas prévu.

import { DEMAND_SURGE_MAX_PERCENT } from '../../domain/rules.js';

export interface SurgeState {
  percent: number;
  reason: string | null;
  /** Qui l'a activée, et quand. Une majoration doit être imputable. */
  setBy: string | null;
  setAt: string | null;
}

let state: SurgeState = { percent: 0, reason: null, setBy: null, setAt: null };

export function currentSurge(): SurgeState {
  return { ...state };
}

/** Pourcentage effectivement appliqué au prix, toujours borné à [0, 50]. */
export function currentSurgePercent(): number {
  return Math.min(Math.max(Math.round(state.percent), 0), DEMAND_SURGE_MAX_PERCENT);
}

export function setSurge(input: {
  percent: number;
  reason?: string | null;
  setBy?: string | null;
}): SurgeState {
  const percent = Math.min(Math.max(Math.round(input.percent), 0), DEMAND_SURGE_MAX_PERCENT);

  state = {
    percent,
    reason: percent === 0 ? null : (input.reason ?? null),
    setBy: input.setBy ?? null,
    setAt: new Date().toISOString(),
  };

  return currentSurge();
}

/** Remise à zéro — tests et `npm run demo`. */
export function resetSurge(): void {
  state = { percent: 0, reason: null, setBy: null, setAt: null };
}
