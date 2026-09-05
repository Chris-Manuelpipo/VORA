// VORA — le garde-fou des montants. « Les prix viennent du serveur, jamais du modèle. »
//
// Un modèle de langage qui répond « votre course coûte 1 500 F » alors qu'elle en coûte
// 1 625 ne fait pas une faute de style : il casse le premier moment de vérité
// (CLAUDE.md § 2). Le prompt le lui interdit ; ce fichier VÉRIFIE, parce qu'une consigne
// n'est pas une garantie.
//
// La règle appliquée : tout nombre de la réponse qui ressemble à un MONTANT doit déjà
// figurer dans le contexte qu'on a envoyé. Sinon la réponse entière est jetée et
// remplacée par la réponse de repli — on préfère « un humain va reprendre » à un chiffre
// faux dit avec assurance.
//
// Pourquoi seulement les montants, et pas tous les nombres : « deux minutes »,
// « quatre chiffres » et « trois vagues » sont dans les fiches de la FAQ, donc dans le
// contexte de toute façon ; mais un modèle qui écrit « 5 km » pour une course de 5,2 km
// arrondit, il n'invente pas de l'argent. Le franc, lui, ne s'arrondit pas.

/**
 * Retire les séparateurs de milliers ENTRE CHIFFRES : « 1\u202f625 » (espace fine
 * insécable, celle que pose `formatAmount`), « 1 625 » et « 1.625 » deviennent tous
 * « 1625 ». Sans cela, le franc du serveur et le franc du modèle ne se compareraient
 * jamais.
 */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[\u202f\u00a0\u2009]/g, ' ')
    .replace(/(\d)[ .,](?=\d{3}\b)/g, '$1');
}

/**
 * Les montants cités dans un texte, sous forme de suites de chiffres.
 *
 * Est un montant : un nombre suivi d'une unité monétaire (F, FCFA, franc, XAF) ou d'un
 * pourcentage, et tout nombre d'au moins trois chiffres — en francs CFA, un nombre à
 * trois chiffres est presque toujours de l'argent.
 */
export function amountsIn(text: string): string[] {
  const normalized = normalizeDigits(text);
  const found = new Set<string>();

  for (const match of normalized.matchAll(/(\d+)\s*(?:f\b|fcfa|francs?|xaf|%)/gi)) {
    if (match[1]) found.add(match[1]);
  }
  for (const match of normalized.matchAll(/\b(\d{3,})\b/g)) {
    if (match[1]) found.add(match[1]);
  }

  return [...found];
}

/**
 * La réponse cite-t-elle un montant absent du contexte ?
 *
 * `renderedContext` est la chaîne EXACTE envoyée au modèle (`renderContext`) : on compare
 * à ce qu'il a vu, pas à ce qu'on croit lui avoir donné.
 */
export function inventsAmount(answer: string, renderedContext: string): boolean {
  const allowed = new Set(amountsIn(renderedContext));
  // Les nombres nus du contexte comptent aussi : « 15 secondes » dans une fiche autorise
  // « 15 » dans la réponse. Ce qui est interdit, c'est le chiffre venu de nulle part.
  for (const match of normalizeDigits(renderedContext).matchAll(/\d+/g)) {
    allowed.add(match[0]);
  }

  return amountsIn(answer).some((amount) => !allowed.has(amount));
}
