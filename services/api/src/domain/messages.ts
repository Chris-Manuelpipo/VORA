// VORA — les messages prédéfinis d'une course. Six codes, et rien d'autre.
//
// CE QUI EST COUPÉ, ET POURQUOI (CLAUDE.md § 8.3) : pas de texte libre, pas de message
// vocal, pas d'appel. Le brief (§ 5.7) prévoit tout cela en v1 ; en 48 h on garde la
// partie qui résout le vrai problème — se retrouver au point de rendez-vous — et on
// laisse tomber celle qui demanderait un TURN, une modération et un stockage de 90 jours.
//
// LE SERVEUR NE TRANSPORTE QU'UN CODE. Le libellé français est résolu par l'application,
// et c'est un choix, pas une économie :
//   · un code se traduit (le brief demande FR/EN en v1) sans toucher au serveur ;
//   · un code ne peut pas transporter un numéro de téléphone, une insulte ou un rendez-vous
//     hors application — c'est la messagerie libre qui pose ce problème, pas celle-ci ;
//   · un litige s'arbitre sur une liste fermée : « CANT_FIND à 21:42 » est un fait.
//
// Les libellés ci-dessous sont là pour que l'équipe mobile écrive les mêmes, à la lettre.
// Ils ne sortent JAMAIS dans une réponse d'API.

export const MESSAGE_SENDERS = ['passenger', 'driver'] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

/** Ce que le passager peut dire. */
export const PASSENGER_MESSAGE_CODES = ['IM_HERE', 'WHERE_ARE_YOU', 'WAIT_2MIN'] as const;

/** Ce que le chauffeur peut dire. */
export const DRIVER_MESSAGE_CODES = ['ARRIVING', 'IM_OUTSIDE', 'CANT_FIND'] as const;

export const MESSAGE_CODES = [
  ...PASSENGER_MESSAGE_CODES,
  ...DRIVER_MESSAGE_CODES,
] as const;

export type MessageCode = (typeof MESSAGE_CODES)[number];

/**
 * Libellés français, à afficher CÔTÉ CLIENT. Référence pour `packages/vora_core` ;
 * le serveur ne les envoie pas.
 */
export const MESSAGE_LABELS_FR: Record<MessageCode, string> = {
  IM_HERE: 'Je suis là',
  WHERE_ARE_YOU: 'Où êtes-vous ?',
  WAIT_2MIN: '2 minutes svp',
  ARRIVING: "J'arrive",
  IM_OUTSIDE: 'Je suis devant',
  CANT_FIND: 'Je ne vous trouve pas',
};

/** Les codes qu'un rôle a le droit d'envoyer. Un passager ne dit pas « J'arrive ». */
export function codesFor(sender: MessageSender): readonly MessageCode[] {
  return sender === 'passenger' ? PASSENGER_MESSAGE_CODES : DRIVER_MESSAGE_CODES;
}

export function isCodeAllowedFor(sender: MessageSender, code: string): code is MessageCode {
  return (codesFor(sender) as readonly string[]).includes(code);
}

/**
 * La conversation se ferme 30 min après la fin de la course (brief § 5.7 et § 6).
 * Assez pour « vous avez oublié votre sac », pas assez pour devenir une messagerie.
 */
export const MESSAGING_WINDOW_AFTER_END_S = 30 * 60;

/**
 * 10 messages par course ET par personne. Ce n'est pas une brimade : au-delà, ce n'est
 * plus une coordination, c'est un problème — et un problème se traite avec l'ops, pas
 * avec un bouton.
 */
export const MAX_MESSAGES_PER_PARTY = 10;
