// VORA — préparation d'une requête de recherche de repère.
//
// À Yaoundé, personne ne tape « Pharmacie de Melen ». On tape « en face de la pharmacie
// de melen », « je vais à mokolo », « carrefour warda stp ». Une recherche qui compare
// bêtement la phrase entière au nom du repère rate tout ça : la similarité trigramme
// entre « en face de la pharmacie de melen » et « Pharmacie de Melen » est basse, parce
// que la moitié de la phrase est du remplissage.
//
// On sort donc deux choses de la saisie, et la requête SQL se sert des deux :
//   · la PHRASE normalisée — pour la similarité globale, qui gagne quand la saisie est
//     propre (« carrefour bastos ») ;
//   · les TERMES utiles — la phrase moins les mots de liaison, pour retrouver le repère
//     quand la saisie est bavarde.
//
// La normalisation faite ici doit donner EXACTEMENT le même texte que la fonction SQL
// `vora_unaccent(lower(...))` de la migration 0001. Les deux se rencontrent au moment de
// la comparaison : si elles divergent, la recherche cesse silencieusement de trouver.

/**
 * Mots de liaison et tournures de localisation du français parlé. Les retirer ne réduit
 * jamais la précision — un repère ne s'appelle pas « de » — et améliore beaucoup le
 * rappel sur les phrases longues.
 *
 * Ce qui n'est PAS dans cette liste, et ne doit pas y entrer : « carrefour », « marché »,
 * « station », « hôpital », « pharmacie », « rue ». Ce sont des mots porteurs à Yaoundé,
 * souvent le seul mot qui distingue deux repères d'un même quartier.
 */
const STOP_WORDS = new Set([
  // articles et prépositions
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux', 'a', 'et',
  // tournures de localisation
  'en', 'face', 'devant', 'derriere', 'cote', 'coin', 'pres', 'proche', 'vers', 'chez',
  'sur', 'dans', 'entre', 'apres', 'avant', 'juste', 'la-bas', 'ici', 'autour',
  // formules de demande, pour la recherche en langage naturel (P8)
  'je', 'j', 'me', 'moi', 'veux', 'voudrais', 'vais', 'aller', 'emmene', 'emmenez',
  'depose', 'deposez', 'conduis', 'amene', 'mon', 'ma', 'mes', 'stp', 'svp', 'merci',
  'suis', 'est', 'sont', 'pour', 'avec', 'que', 'qui',
]);

/**
 * Minuscules, sans accents, sans ponctuation. Miroir JavaScript de `vora_unaccent(lower())`.
 * NFD sépare la lettre de son accent, et on jette la catégorie « signe diacritique ».
 */
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface PreparedQuery {
  /** La saisie normalisée, telle quelle. Sert à la similarité globale. */
  phrase: string;
  /** Les mots porteurs, dédoublonnés. Sert au rappel sur les phrases bavardes. */
  terms: string[];
}

/**
 * Prépare une saisie pour la recherche.
 *
 * Les termes de moins de trois caractères sont écartés : un trigramme en demande trois,
 * et « la » ou « ce » ramènerait la moitié de la base. Si tout a été écarté (« chez
 * moi »), on retombe sur la phrase entière — mieux vaut une recherche large qu'une
 * recherche vide.
 */
export function prepareQuery(input: string): PreparedQuery {
  const phrase = normalizeSearchText(input);

  const terms = [
    ...new Set(
      phrase
        .split(' ')
        .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
    ),
  ];

  return { phrase, terms: terms.length > 0 ? terms : phrase ? [phrase] : [] };
}
