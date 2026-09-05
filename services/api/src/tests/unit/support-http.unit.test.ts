// VORA — l'adaptateur HTTP, contre un vrai serveur compatible OpenAI.
//
// On monte un serveur HTTP local plutôt que de simuler `fetch` : ce qu'on veut vérifier,
// c'est le comportement au bout du fil — un 500, une réponse tronquée, un service qui ne
// répond pas en 4 secondes. Un `fetch` simulé vérifierait surtout qu'on sait écrire un
// `fetch` simulé.
//
// Aucun appel vers l'extérieur : le serveur écoute sur 127.0.0.1, port éphémère.

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpLlmProvider, selectProvider } from '../../modules/support/provider.js';
import { FALLBACK_ANSWER } from '../../modules/support/prompt.js';
import type { SupportContext } from '../../modules/support/schemas.js';

const CONTEXTE: SupportContext = {
  audience: 'passenger',
  ride: null,
  faq: [{ id: 'paiement', title: 'Payer la course', answer: 'En espèces ou par Mobile Money.' }],
};

let server: Server | null = null;

/** Un faux fournisseur compatible OpenAI. Rend son URL de base. */
async function serveur(
  handler: (body: unknown) => { status?: number; payload?: unknown; delayMs?: number },
): Promise<string> {
  server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const { status = 200, payload = {}, delayMs = 0 } = handler(JSON.parse(raw || '{}'));
      setTimeout(() => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      }, delayMs);
    });
  });

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('port introuvable');
  return `http://127.0.0.1:${address.port}/v1`;
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

function completion(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

describe('HttpLlmProvider', () => {
  it('envoie le prompt système et le contexte, et rend la réponse du modèle', async () => {
    let recu: Record<string, unknown> = {};
    const baseUrl = await serveur((body) => {
      recu = body as Record<string, unknown>;
      return { payload: completion('Vous payez en espèces à la fin de la course.') };
    });

    const answer = await new HttpLlmProvider({
      baseUrl,
      model: 'modele-de-test',
      apiKey: 'cle-de-test',
    }).answer('comment je paie ?', CONTEXTE);

    expect(answer.text).toBe('Vous payez en espèces à la fin de la course.');
    expect(answer.escalate).toBe(false);
    // Les sources sont décidées par le SERVEUR : ce sont les fiches qu'on a envoyées,
    // pas celles que le modèle prétendrait avoir lues.
    expect(answer.sources).toEqual(['paiement']);

    expect(recu.model).toBe('modele-de-test');
    const messages = recu.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toMatch(/deux à quatre phrases/);
    // Le contexte part en PROSE française, pas en JSON : le modèle n'a rien à traduire.
    expect(messages[1]?.content).toContain('En espèces ou par Mobile Money.');
    expect(messages[1]?.content).toContain('comment je paie ?');
  });

  it('accepte une URL de base terminée par une barre oblique', async () => {
    const baseUrl = await serveur(() => ({ payload: completion('Réponse.') }));

    const answer = await new HttpLlmProvider({
      baseUrl: `${baseUrl}/`,
      model: 'm',
      apiKey: 'k',
    }).answer('question', CONTEXTE);

    expect(answer.text).toBe('Réponse.');
  });

  it('escalade quand le modèle dit qu’il ne sait pas', async () => {
    const baseUrl = await serveur(() => ({ payload: completion('ESCALADE') }));

    const answer = await new HttpLlmProvider({ baseUrl, model: 'm', apiKey: 'k' }).answer(
      'question hors sujet',
      CONTEXTE,
    );

    expect(answer.escalate).toBe(true);
    // Le marqueur ne sort JAMAIS vers l'utilisateur : il lit une phrase, pas un jeton.
    expect(answer.text).toBe(FALLBACK_ANSWER);
    expect(answer.text).not.toContain('ESCALADE');
  });

  it('échoue franchement sur une erreur du fournisseur : le service basculera sur la FAQ', async () => {
    const baseUrl = await serveur(() => ({ status: 500, payload: { error: 'boom' } }));

    await expect(
      new HttpLlmProvider({ baseUrl, model: 'm', apiKey: 'k' }).answer('question', CONTEXTE),
    ).rejects.toThrow(/500/);
  });

  it('échoue aussi sur une réponse inexploitable', async () => {
    const baseUrl = await serveur(() => ({ payload: { choices: [] } }));

    await expect(
      new HttpLlmProvider({ baseUrl, model: 'm', apiKey: 'k' }).answer('question', CONTEXTE),
    ).rejects.toThrow(/inexploitable/);
  });

  it('abandonne au bout du délai de garde, sans réessayer', async () => {
    let appels = 0;
    const baseUrl = await serveur(() => {
      appels += 1;
      return { payload: completion('trop tard'), delayMs: 300 };
    });

    await expect(
      // 60 ms au lieu de 4 s : le test vérifie le mécanisme, pas la patience.
      new HttpLlmProvider({ baseUrl, model: 'm', apiKey: 'k', timeoutMs: 60 }).answer(
        'question',
        CONTEXTE,
      ),
    ).rejects.toThrow();

    // UNE SEULE TENTATIVE : un support qui réessaie trois fois coûte trois fois plus
    // cher et répond trois fois plus tard.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(appels).toBe(1);
  });
});

describe('le choix du fournisseur', () => {
  it('reste sur la FAQ tant que la configuration est incomplète', () => {
    // Configuration par défaut des tests : LLM_ENABLED=false, aucune clé. C'est aussi
    // celle de la démonstration, et elle doit répondre.
    const { provider, reason } = selectProvider();
    expect(provider.name).toBe('stub');
    expect(reason).toBeTruthy();
  });
});
