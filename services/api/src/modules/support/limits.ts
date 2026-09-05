// VORA — les garde-fous de coût du support : quota par personne, cache par question.
//
// UN APPEL À UN MODÈLE DE LANGAGE SE PAIE, en argent et en latence. Ce module est donc
// bordé de trois côtés, et le troisième n'est pas du code :
//
//   1. QUOTA — 10 questions par heure et par personne. Au-delà, on le dit et on propose
//      d'écrire à VORA. Une fenêtre glissante, pas un compteur remis à zéro à l'heure
//      pile : sinon 10 questions à 13 h 59 et 10 à 14 h 01 passent sans rien déclencher.
//   2. CACHE — 24 h par question normalisée. « comment payer ? » et « Comment payer ? »
//      sont la même question, et la deuxième ne coûte rien.
//   3. CONSIGNE — le module ne doit JAMAIS être appelé automatiquement. Pas de
//      pré-chargement à l'ouverture d'un écran, pas de suggestion en arrière-plan, pas
//      de reformulation d'une erreur d'API : uniquement quand quelqu'un appuie sur
//      « Poser ma question ». Cette règle-là ne se code pas côté serveur — elle se tient
//      côté client, et elle est écrite dans le README pour que personne ne l'ignore.
//
// ÉTAT EN MÉMOIRE, assumé (CLAUDE.md § 3) : un seul processus API. Un redémarrage vide
// le cache et les compteurs — au pire, quelques questions repayées. Le jour où l'API se
// réplique, ces deux Map deviennent deux clés Redis.

import { createHash } from 'node:crypto';
import { normalize } from './knowledge.js';
import type { Answer } from './provider.js';

/** 10 questions par heure et par personne (consigne de coût du module). */
export const QUOTA_PER_HOUR = 10;
export const QUOTA_WINDOW_MS = 60 * 60 * 1000;
/** 24 h : une FAQ ne change pas dans la journée. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Garde-fou mémoire : le cache d'un module de support ne mange pas le processus. */
const MAX_CACHE_ENTRIES = 500;

const askedAt = new Map<string, number[]>();
const cache = new Map<string, { answer: Answer; expiresAt: number }>();

export interface QuotaState {
  allowed: boolean;
  remaining: number;
  /** Secondes avant que la plus ancienne question sorte de la fenêtre. */
  retryAfterS: number;
}

/**
 * Consomme une question du quota de cette personne, ou refuse.
 *
 * Le compteur est consommé AVANT le cache : le quota protège la personne d'elle-même
 * autant que le portefeuille de VORA, et vingt questions en deux minutes veulent dire
 * qu'un humain doit reprendre, pas qu'il faut répondre vingt fois.
 */
export function consumeQuota(userId: string, now = Date.now()): QuotaState {
  const horizon = now - QUOTA_WINDOW_MS;
  const recent = (askedAt.get(userId) ?? []).filter((at) => at > horizon);

  if (recent.length >= QUOTA_PER_HOUR) {
    askedAt.set(userId, recent);
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterS: Math.max(1, Math.ceil((oldest + QUOTA_WINDOW_MS - now) / 1000)),
    };
  }

  recent.push(now);
  askedAt.set(userId, recent);
  return { allowed: true, remaining: QUOTA_PER_HOUR - recent.length, retryAfterS: 0 };
}

/**
 * Clé de cache : la question normalisée ET l'empreinte du contexte.
 *
 * L'empreinte n'est pas une précaution de plus, c'est une CLOISON : sans elle, la réponse
 * « votre course est à 1 625 F » servie à un passager serait resservie au suivant. Une
 * question posée sans course en cours (le cas courant) partage sa réponse entre tout le
 * monde — c'est là que le cache économise vraiment.
 */
export function cacheKey(question: string, fingerprint: string): string {
  return createHash('sha256')
    .update(`${fingerprint}\n${normalize(question)}`)
    .digest('hex');
}

export function readCache(key: string, now = Date.now()): Answer | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.answer;
}

export function writeCache(key: string, answer: Answer, now = Date.now()): void {
  // Une escalade ne se met pas en cache : l'assistant n'a pas su répondre CETTE fois,
  // et la fiche qui manquait sera peut-être ajoutée dans l'heure.
  if (answer.escalate) return;

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { answer, expiresAt: now + CACHE_TTL_MS });
}

/** Remise à zéro — tests et `POST /v1/demo/reset`. */
export function resetSupportMemory(): void {
  askedAt.clear();
  cache.clear();
}

/** Taille des deux réserves, pour la page ops et les tests. */
export function supportMemorySize(): { cached: number; users: number } {
  return { cached: cache.size, users: askedAt.size };
}
