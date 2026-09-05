// VORA — l'assistant de support. Module ISOLÉ : rien du chemin critique n'en dépend.
//
// Le devis, la commande, le dispatch et le paiement ne l'appellent pas, ne l'importent
// pas, et fonctionnent à l'identique s'il tombe. Un test d'architecture le vérifie
// (`tests/unit/architecture.unit.test.ts`) — la promesse est tenue par le compilateur,
// pas par ce commentaire.
//
// L'ORDRE DES OPÉRATIONS N'EST PAS ANODIN :
//   1. quota      — avant tout travail, même gratuit ;
//   2. contexte   — construit côté serveur, filtré par `supportContextSchema` ;
//   3. cache      — la même question dans la même situation ne se repaie pas ;
//   4. modèle     — une tentative, 4 s, repli automatique sur la FAQ ;
//   5. garde-fou  — une réponse qui invente un montant est jetée ;
//   6. journal    — ce qui s'est passé, sans une donnée personnelle.

import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { UserRole } from '../../db/schema.js';
import { buildContext, contextFingerprint, type Viewer } from './context.js';
import { inventsAmount } from './guard.js';
import { cacheKey, consumeQuota, readCache, writeCache } from './limits.js';
import { fallbackAnswer, selectProvider, stubProvider, type Answer } from './provider.js';
import { renderContext } from './prompt.js';
import type { AnswerDto } from './schemas.js';

export interface AskInput {
  userId: string;
  role: UserRole;
  question: string;
}

/**
 * Nettoie une question AVANT de l'écrire dans le journal.
 *
 * On journalise la question — c'est ce qui permet d'ajouter les fiches qui manquent —
 * mais quelqu'un finira par taper son numéro dedans (« rappelez-moi au 6XX… »). Les
 * suites de chiffres longues et les adresses e-mail sont donc masquées à l'écriture :
 * CLAUDE.md § 5.6 ne souffre pas d'exception, pas même pour un log utile.
 */
export function scrubForLog(question: string): string {
  return question
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[masqué]')
    .replace(/(\+?\d[\d\s.-]{6,})/g, '[masqué]')
    .slice(0, 160);
}

export async function ask(input: AskInput): Promise<AnswerDto> {
  const startedAt = Date.now();
  const viewer: Viewer = { id: input.userId, role: input.role };

  const quota = consumeQuota(input.userId);
  if (!quota.allowed) {
    throw new AppError(
      'SUPPORT_QUOTA_REACHED',
      `Vous avez posé 10 questions cette heure. L'assistant revient dans ${Math.ceil(
        quota.retryAfterS / 60,
      )} min ; en attendant, écrivez à VORA depuis Aide.`,
      { retry_after_s: quota.retryAfterS },
    );
  }

  const context = await buildContext(viewer, input.question);
  const key = cacheKey(input.question, contextFingerprint(context));

  const cached = readCache(key);
  if (cached) {
    log({ input, provider: 'cache', startedAt, answer: cached, hasRide: !!context.ride });
    return toDto(cached);
  }

  const { provider } = selectProvider();
  let answer: Answer;
  let used = provider.name;
  let fallbackReason: string | null = null;

  try {
    answer = await provider.answer(input.question, context);
  } catch (error) {
    // Le fournisseur est en panne, lent, ou refuse la clé : on ne propage RIEN à
    // l'utilisateur. La FAQ répond, et le journal dit pourquoi on a basculé.
    fallbackReason = error instanceof Error ? error.message : String(error);
    used = 'stub';
    answer = await stubProvider.answer(input.question, context);
  }

  // Le garde-fou s'applique à TOUTE réponse, y compris celle du stub : ce n'est pas la
  // confiance qu'on accorde au fournisseur qui décide, c'est la règle « les montants
  // viennent du serveur ». Une exception pour l'implémentation qu'on croit sûre est le
  // genre de nuance qui se perd à la relecture suivante.
  if (inventsAmount(answer.text, renderContext(context))) {
    logger.warn(
      { provider: used, question: scrubForLog(input.question) },
      'Réponse refusée : montant absent du contexte',
    );
    answer = fallbackAnswer(context);
    used = 'stub';
    fallbackReason = fallbackReason ?? 'montant inventé';
  }

  writeCache(key, answer);
  log({ input, provider: used, startedAt, answer, hasRide: !!context.ride, fallbackReason });
  return toDto(answer);
}

function toDto(answer: Answer): AnswerDto {
  return { answer: answer.text, sources: answer.sources, escalate: answer.escalate };
}

/**
 * Une ligne par question. Ce qu'elle porte : la question nettoyée, le fournisseur qui a
 * répondu, la latence, l'escalade. Ce qu'elle ne porte PAS : ni identifiant de
 * l'utilisateur, ni numéro, ni e-mail, ni la réponse elle-même — qui peut contenir le
 * prix d'une course, donc un fait de quelqu'un.
 */
function log(entry: {
  input: AskInput;
  provider: string;
  startedAt: number;
  answer: Answer;
  hasRide: boolean;
  fallbackReason?: string | null;
}): void {
  logger.info(
    {
      module: 'support',
      question: scrubForLog(entry.input.question),
      role: entry.input.role,
      provider: entry.provider,
      latencyMs: Date.now() - entry.startedAt,
      escalate: entry.answer.escalate,
      sources: entry.answer.sources,
      withRide: entry.hasRide,
      ...(entry.fallbackReason ? { fallbackReason: entry.fallbackReason } : {}),
    },
    'Question de support',
  );
}

/** État du module, pour la page ops et le contrôle avant la démonstration. */
export function supportStatus(): { provider: string; reason: string } {
  const { provider, reason } = selectProvider();
  return { provider: provider.name, reason };
}
