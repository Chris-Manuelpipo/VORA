// VORA — le profil personnel d'un compte, rempli à l'onboarding.
//
// ÉCART ASSUMÉ AVEC `docs/`. La vision UX (PA-05) ne demandait que le PRÉNOM : « elle ne
// veut pas remplir un formulaire ». On collecte désormais aussi le nom, le sexe et la date
// de naissance — décision produit prise après coup, en connaissance de cause.
//
// Ce que cet écart coûte, et comment on le paie :
//   · trois données personnelles de plus à protéger. Elles ne sortent JAMAIS vers l'autre
//     partie — `toPublicUserDto` ne montre que le prénom, la photo, l'ID VORA et la note
//     (CLAUDE.md § 5.6), et aucun de ces champs n'entre dans le contexte de l'assistant ;
//   · un formulaire plus long à l'inscription, donc des abandons. D'où la règle ci-dessous :
//     seuls le prénom et le nom sont exigés. Le sexe et la date de naissance sont
//     facultatifs, et « Je préfère ne pas dire » est une réponse, pas un champ vide.
//
// Si une fonctionnalité vient un jour s'appuyer sur le sexe (une chauffeure pour une
// passagère, la nuit), c'est ici qu'on la retrouvera — et il faudra alors trancher le
// consentement, pas seulement le stockage.

export const SEXES = ['female', 'male', 'undisclosed'] as const;
export type Sex = (typeof SEXES)[number];

/** Libellés français de référence. Résolus par le client ; le serveur ne transporte que le code. */
export const SEX_LABELS_FR: Record<Sex, string> = {
  female: 'Femme',
  male: 'Homme',
  undisclosed: 'Je préfère ne pas dire',
};

/**
 * Contacts de confiance (PA-07). Trois au maximum : au-delà, ce n'est plus une liste de
 * personnes qu'on prévient en urgence, c'est un carnet d'adresses.
 */
export const MAX_TRUSTED_CONTACTS = 3;

/**
 * Bornes de plausibilité d'une date de naissance. Ce n'est PAS une règle d'âge minimum —
 * aucun document du projet n'en fixe une, et l'inventer ici reviendrait à décider seul
 * qu'un lycéen ne peut pas commander une moto. C'est un garde-fou de saisie : une date
 * dans le futur ou un âge de 150 ans est une faute de frappe, pas un utilisateur.
 */
export const MIN_PLAUSIBLE_AGE_YEARS = 10;
export const MAX_PLAUSIBLE_AGE_YEARS = 120;

/** Âge en années révolues à une date donnée. */
export function ageOn(birthDate: Date, on: Date = new Date()): number {
  let age = on.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = on.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function isPlausibleBirthDate(birthDate: Date, on: Date = new Date()): boolean {
  if (Number.isNaN(birthDate.getTime())) return false;
  if (birthDate.getTime() > on.getTime()) return false;
  const age = ageOn(birthDate, on);
  return age >= MIN_PLAUSIBLE_AGE_YEARS && age <= MAX_PLAUSIBLE_AGE_YEARS;
}

/**
 * Ce qui est EXIGÉ pour considérer un compte comme renseigné : le prénom et le nom.
 * Le reste est proposé et ignorable — un onboarding qui bloque est un compte qui ne se
 * crée pas, et VORA a besoin de passagers avant d'avoir des fiches complètes.
 */
export const REQUIRED_PROFILE_FIELDS = ['first_name', 'family_name'] as const;

/** Ce qui est proposé sans être exigé. Sert à dire à l'application ce qu'elle peut relancer. */
export const OPTIONAL_PROFILE_FIELDS = [
  'sex',
  'birth_date',
  'photo',
  'trusted_contacts',
] as const;

export type ProfileField =
  | (typeof REQUIRED_PROFILE_FIELDS)[number]
  | (typeof OPTIONAL_PROFILE_FIELDS)[number];
