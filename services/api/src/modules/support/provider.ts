// VORA — l'adaptateur de modèle de langage, derrière une interface.
//
// Même dessin que `PaymentProvider` (CLAUDE.md § 3) : une interface, deux implémentations,
// et le choix dans la configuration. Ce qui est simulé, ici, ce n'est pas la réponse —
// c'est la dépendance à un service tiers.
//
//   · `HttpLlmProvider`  appelle une API compatible OpenAI (`/chat/completions`).
//     N'importe quel fournisseur gratuit convient : OpenRouter, Groq, un llama.cpp posé
//     sur le portable de l'équipe. Trois variables suffisent à en changer, et rien
//     d'autre dans le code ne sait lequel répond.
//   · `StubLlmProvider`  répond avec la FAQ seule, sans réseau. Ce n'est pas un
//     bouche-trou : c'est le mode par défaut, celui qui tourne si la salle n'a pas
//     d'internet le jour de la démonstration.
//
// LE REPLI EST AUTOMATIQUE ET SILENCIEUX pour l'utilisateur. Clé absente, service en
// panne, 4 secondes dépassées, JSON illisible : on passe au stub et on répond quand même.
// Le support qui dit « service indisponible » est un support qui n'existe pas.

import { config } from '../../lib/config.js';
import { formatAmount } from '../pricing/fare.js';
import {
  ESCALATE_MARKER,
  FALLBACK_ANSWER,
  SYSTEM_PROMPT,
  renderContext,
} from './prompt.js';
import type { SupportContext } from './schemas.js';

/** Une seule tentative, 4 secondes. Au-delà, la question a déjà l'air sans réponse. */
export const LLM_TIMEOUT_MS = 4000;

export interface Answer {
  text: string;
  /** Identifiants des fiches de FAQ qui ont servi. Décidés par le SERVEUR, pas par le modèle. */
  sources: string[];
  escalate: boolean;
}

export type ProviderName = 'http' | 'stub';

export interface LlmProvider {
  readonly name: ProviderName;
  answer(question: string, context: SupportContext): Promise<Answer>;
}

/** Les fiches retenues, dans l'ordre : c'est ce qu'on publie dans `sources[]`. */
function sourcesOf(context: SupportContext): string[] {
  return context.faq.map((entry) => entry.id);
}

// ─── Sans réseau : la FAQ seule ──────────────────────────────────────────────

/**
 * Répond avec la fiche la plus proche de la question, et rien d'autre.
 *
 * Volontairement bête : il RECOPIE une réponse écrite à la main. Aucun risque
 * d'invention, aucune latence, aucun coût. Quand rien ne correspond, il escalade — c'est
 * une réponse honnête, pas un échec.
 */
export class StubLlmProvider implements LlmProvider {
  readonly name = 'stub' as const;

  async answer(question: string, context: SupportContext): Promise<Answer> {
    const best = context.faq[0];
    if (!best) {
      return { text: FALLBACK_ANSWER, sources: [], escalate: true };
    }

    return {
      text: `${best.answer}${this.rideNote(context)}`,
      sources: sourcesOf(context),
      escalate: false,
    };
  }

  /**
   * Une phrase de rappel tirée de la course en cours, quand la question portait sur
   * l'argent. Les chiffres viennent du contexte — donc du serveur — et c'est
   * précisément la démonstration qu'on veut faire au jury.
   */
  private rideNote(context: SupportContext): string {
    const ride = context.ride;
    if (!ride) return '';

    const aboutMoney = context.faq.some((entry) =>
      ['prix-ferme', 'paiement', 'gains-chauffeur'].includes(entry.id),
    );
    if (!aboutMoney) return '';

    return ride.breakdown
      ? ` Sur votre course en cours, il vous reste ${formatAmount(ride.breakdown.net)} net.`
      : ` Votre course en cours est à ${ride.price_formatted}, et ce prix ne bougera pas.`;
  }
}

// ─── Avec réseau : une API compatible OpenAI ─────────────────────────────────

interface ChatCompletion {
  choices?: Array<{ message?: { content?: unknown } }>;
}

/** Lecture DÉFENSIVE : un service gratuit renvoie parfois autre chose qu'un message. */
function readCompletion(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const content = (payload as ChatCompletion).choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim().length > 0 ? content.trim() : null;
}

export class HttpLlmProvider implements LlmProvider {
  readonly name = 'http' as const;

  constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      apiKey: string;
      timeoutMs?: number;
    },
  ) {}

  async answer(question: string, context: SupportContext): Promise<Answer> {
    const rendered = renderContext(context);
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      // UNE SEULE TENTATIVE : pas de reprise, pas de boucle. Un support qui réessaie
      // trois fois coûte trois fois plus cher et répond trois fois plus tard, pour une
      // question à laquelle la FAQ savait répondre.
      signal: AbortSignal.timeout(this.options.timeoutMs ?? LLM_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
        // Certaines passerelles (OpenRouter) demandent à savoir qui appelle.
        'x-title': 'VORA support',
      },
      body: JSON.stringify({
        model: this.options.model,
        // Une question de support n'appelle pas de créativité.
        temperature: 0.2,
        // Deux à quatre phrases : 300 jetons sont larges, et bornent la dépense.
        max_tokens: 300,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `CONTEXTE :\n${rendered}\n\nQUESTION :\n${question}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`le fournisseur a répondu ${response.status}`);
    }

    const text = readCompletion(await response.json());
    if (!text) throw new Error('réponse du fournisseur inexploitable');

    // Le modèle dit « je ne sais pas » avec un mot ; on ne lui demande pas de JSON, que
    // les petits modèles gratuits rendent mal une fois sur dix.
    if (text.toUpperCase().includes(ESCALATE_MARKER)) {
      return { text: FALLBACK_ANSWER, sources: sourcesOf(context), escalate: true };
    }

    return { text, sources: sourcesOf(context), escalate: false };
  }
}

// ─── Choix du fournisseur ────────────────────────────────────────────────────

export const stubProvider = new StubLlmProvider();

export interface ProviderChoice {
  provider: LlmProvider;
  /** Pourquoi ce fournisseur — écrit dans le journal au démarrage et dans la page ops. */
  reason: string;
}

/**
 * Le fournisseur actif. Appelé à CHAQUE question (et non mémorisé) pour que la
 * configuration puisse changer sans redémarrage, et pour que les tests puissent poser
 * leur propre implémentation.
 */
export function selectProvider(): ProviderChoice {
  if (!config.LLM_ENABLED) {
    return { provider: stubProvider, reason: 'LLM_ENABLED=false' };
  }
  if (!config.LLM_API_KEY || !config.LLM_BASE_URL || !config.LLM_MODEL) {
    // Clé, URL ou modèle absents : on ne tente rien. Ce n'est pas une erreur de
    // configuration à signaler à l'utilisateur, c'est le mode dégradé prévu.
    return { provider: stubProvider, reason: 'LLM_API_KEY, LLM_BASE_URL ou LLM_MODEL absent' };
  }

  return {
    provider: new HttpLlmProvider({
      baseUrl: config.LLM_BASE_URL,
      model: config.LLM_MODEL,
      apiKey: config.LLM_API_KEY,
    }),
    reason: `${config.LLM_MODEL} via ${config.LLM_BASE_URL}`,
  };
}

/**
 * Réponse de dernier recours, quand même la FAQ n'a rien. Existe séparément du stub pour
 * que `service.ts` puisse l'utiliser après avoir REFUSÉ une réponse du modèle.
 */
export function fallbackAnswer(context: SupportContext): Answer {
  // Les fiches restent renvoyées : l'application peut les afficher pendant que l'humain
  // n'a pas encore répondu, et elles sont souvent la vraie réponse.
  return { text: FALLBACK_ANSWER, sources: sourcesOf(context), escalate: true };
}
