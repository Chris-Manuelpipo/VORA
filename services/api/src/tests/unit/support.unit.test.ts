// VORA — tests purs de l'assistant : la FAQ, le garde-fou des montants, le quota.
// Aucune base, aucun réseau. Ce qui est vérifié ici ne dépend d'aucun fournisseur.

import { describe, expect, it } from 'vitest';
import { amountsIn, inventsAmount, normalizeDigits } from '../../modules/support/guard.js';
import { FAQ, normalize, rankKnowledge } from '../../modules/support/knowledge.js';
import {
  QUOTA_PER_HOUR,
  cacheKey,
  consumeQuota,
  readCache,
  resetSupportMemory,
  writeCache,
} from '../../modules/support/limits.js';
import { StubLlmProvider } from '../../modules/support/provider.js';
import { FALLBACK_ANSWER, renderContext } from '../../modules/support/prompt.js';
import { supportContextSchema, type SupportContext } from '../../modules/support/schemas.js';
import { scrubForLog } from '../../modules/support/service.js';

const CONTEXTE_SANS_COURSE: SupportContext = {
  audience: 'passenger',
  ride: null,
  faq: [{ id: 'prix-ferme', title: 'Le prix ferme', answer: 'Le prix ne change pas.' }],
};

describe('la FAQ trouve la bonne fiche', () => {
  it('reconnaît une question mal orthographiée et sans accent', () => {
    const ranked = rankKnowledge('pk le prix a bouge apres ma commande', 'passenger');
    expect(ranked[0]?.entry.id).toBe('prix-ferme');
  });

  it('trouve l’annulation, le code de montée et les zones moto', () => {
    expect(rankKnowledge('je veux annuler, ça coûte combien ?', 'passenger')[0]?.entry.id).toBe(
      'annulation',
    );
    expect(rankKnowledge('à quoi sert le code à 4 chiffres ?', 'passenger')[0]?.entry.id).toBe(
      'code-montee',
    );
    expect(rankKnowledge('pourquoi la moto est refusée ?', 'passenger')[0]?.entry.id).toBe(
      'zones-moto',
    );
  });

  it('ne rend rien plutôt que n’importe quoi', () => {
    // Une question hors sujet doit produire une FAQ VIDE : c'est ce vide qui déclenche
    // l'escalade vers un humain, au lieu d'une réponse plausible et fausse.
    expect(rankKnowledge('quelle est la capitale de la Mongolie', 'passenger')).toEqual([]);
  });

  it('ne sert pas la fiche des gains à un passager', () => {
    const ids = rankKnowledge('commission et net', 'passenger').map((r) => r.entry.id);
    expect(ids).not.toContain('gains-chauffeur');
    expect(rankKnowledge('commission et net', 'driver')[0]?.entry.id).toBe('gains-chauffeur');
  });

  it('chaque fiche a un identifiant unique et des mots-clés normalisés', () => {
    const ids = FAQ.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of FAQ) {
      for (const keyword of entry.keywords) {
        // Un mot-clé accentué ne serait jamais trouvé : la question est normalisée avant
        // la comparaison, pas lui.
        expect(normalize(keyword), `mot-clé « ${keyword} » de ${entry.id}`).toBe(keyword);
      }
    }
  });
});

describe('le garde-fou des montants', () => {
  const rendu =
    'COURSE EN COURS : prix ferme : 1 625 F, distance : 5,0 km. ' +
    "L'annulation coûte 300 F après 2 minutes ou 300 mètres.";

  it('compare les montants malgré l’espace fine insécable de la charte', () => {
    expect(normalizeDigits('1 625 F')).toBe('1625 F');
    expect(amountsIn('la course coûte 1 625 F')).toContain('1625');
  });

  it('laisse passer un montant qui vient du contexte', () => {
    expect(inventsAmount('Votre course est à 1 625 F, et ce prix ne bougera pas.', rendu)).toBe(
      false,
    );
    expect(inventsAmount('Annuler maintenant coûte 300 F, reversés au chauffeur.', rendu)).toBe(
      false,
    );
  });

  it('refuse un montant que le modèle a inventé', () => {
    expect(inventsAmount('Votre course est à 1 500 F.', rendu)).toBe(true);
    expect(inventsAmount('Des frais de 2 000 FCFA s’appliquent.', rendu)).toBe(true);
    expect(inventsAmount('VORA prélève 30 % de commission.', rendu)).toBe(true);
  });

  it('ne se déclenche pas sur un texte sans chiffre', () => {
    expect(inventsAmount('Le prix affiché avant la commande ne change plus.', rendu)).toBe(false);
  });
});

describe('le stub répond sans réseau', () => {
  it('recopie la fiche trouvée, sans escalader', async () => {
    const answer = await new StubLlmProvider().answer('le prix change ?', CONTEXTE_SANS_COURSE);

    expect(answer.escalate).toBe(false);
    expect(answer.text).toContain('Le prix ne change pas.');
    expect(answer.sources).toEqual(['prix-ferme']);
  });

  it('escalade quand aucune fiche ne correspond', async () => {
    const answer = await new StubLlmProvider().answer('question hors sujet', {
      ...CONTEXTE_SANS_COURSE,
      faq: [],
    });

    expect(answer.escalate).toBe(true);
    expect(answer.text).toBe(FALLBACK_ANSWER);
    expect(answer.sources).toEqual([]);
  });

  it('cite le prix du contexte, jamais un prix à lui', async () => {
    const context = supportContextSchema.parse({
      audience: 'passenger',
      ride: {
        status: 'accepted',
        offer: 'eco',
        price_xaf: 1625,
        price_formatted: '1 625 F',
        breakdown: null,
        distance_km: 5,
        driver_plate: 'CE 4821 AB',
      },
      faq: [{ id: 'prix-ferme', title: 'Le prix ferme', answer: 'Le prix ne change pas.' }],
    });

    const answer = await new StubLlmProvider().answer('combien je paie ?', context);
    expect(answer.text).toContain('1 625 F');
    // Et ce chiffre est bien dans ce qu'on a envoyé au modèle : le garde-fou l'accepte.
    expect(inventsAmount(answer.text, renderContext(context))).toBe(false);
  });
});

describe('le contexte refuse tout champ non prévu', () => {
  it('rejette une clé ajoutée par mégarde', () => {
    // C'est le scénario réel : quelqu'un ajoute un champ « pour aider le modèle », et
    // c'est un numéro de téléphone. Le schéma `.strict()` le refuse à l'exécution.
    expect(() =>
      supportContextSchema.parse({
        audience: 'passenger',
        ride: null,
        faq: [],
        passenger_phone: '+237690000000',
      }),
    ).toThrow();
  });
});

describe('les garde-fous de coût', () => {
  it('laisse passer 10 questions par heure, puis refuse en disant quand revenir', () => {
    resetSupportMemory();
    const now = Date.now();

    for (let i = 0; i < QUOTA_PER_HOUR; i += 1) {
      expect(consumeQuota('user-1', now + i * 1000).allowed).toBe(true);
    }

    const refus = consumeQuota('user-1', now + 11_000);
    expect(refus.allowed).toBe(false);
    expect(refus.retryAfterS).toBeGreaterThan(0);

    // Fenêtre GLISSANTE : une heure après la première question, elle sort du compte.
    expect(consumeQuota('user-1', now + 3_600_001).allowed).toBe(true);
    // Et le quota est bien PAR PERSONNE.
    expect(consumeQuota('user-2', now).allowed).toBe(true);
  });

  it('deux formulations de la même question partagent une entrée de cache', () => {
    resetSupportMemory();
    const a = cacheKey('Comment payer ?', 'passenger:sans-course');
    const b = cacheKey('comment payer', 'passenger:sans-course');
    expect(a).toBe(b);

    writeCache(a, { text: 'En espèces.', sources: ['paiement'], escalate: false });
    expect(readCache(b)?.text).toBe('En espèces.');
  });

  it('ne partage JAMAIS le cache entre deux situations différentes', () => {
    resetSupportMemory();
    // Le point qui compte : sans l'empreinte du contexte, la course d'un passager
    // serait resservie au suivant.
    const aicha = cacheKey('combien je paie ?', 'passenger:accepted:eco:1625:-:5:CE 4821 AB');
    const marc = cacheKey('combien je paie ?', 'passenger:accepted:eco:3000:-:9:CE 1111 ZZ');

    expect(aicha).not.toBe(marc);
    writeCache(aicha, { text: '1 625 F', sources: [], escalate: false });
    expect(readCache(marc)).toBeNull();
  });

  it('ne met pas une escalade en cache', () => {
    resetSupportMemory();
    const key = cacheKey('question sans réponse', 'passenger:sans-course');
    writeCache(key, { text: FALLBACK_ANSWER, sources: [], escalate: true });
    // La fiche manquante sera peut-être écrite dans l'heure : ne figeons pas l'échec.
    expect(readCache(key)).toBeNull();
  });

  it('oublie une réponse expirée', () => {
    resetSupportMemory();
    const key = cacheKey('comment payer', 'passenger:sans-course');
    const now = Date.now();
    writeCache(key, { text: 'En espèces.', sources: [], escalate: false }, now);

    expect(readCache(key, now + 23 * 3600 * 1000)).not.toBeNull();
    expect(readCache(key, now + 25 * 3600 * 1000)).toBeNull();
  });
});

describe('le journal ne porte pas de donnée personnelle', () => {
  it('masque un numéro ou un e-mail tapé dans la question', () => {
    expect(scrubForLog('rappelez-moi au +237 690 12 34 56 svp')).not.toMatch(/690/);
    expect(scrubForLog('mon mail est aicha@example.cm')).not.toContain('aicha@example.cm');
    expect(scrubForLog('rappelez-moi au 690123456')).toContain('[masqué]');
  });

  it('garde la question lisible : c’est elle qui dit quelle fiche manque', () => {
    expect(scrubForLog('pourquoi le prix a changé ?')).toBe('pourquoi le prix a changé ?');
  });
});
