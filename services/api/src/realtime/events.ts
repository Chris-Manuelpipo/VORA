// VORA — noms et formes des événements temps réel.
//
// Ces noms sont ceux du § 8.3 du document de conception et de `docs/API_CONTRACT.md`,
// À LA LETTRE. L'équipe mobile écrit son client contre ce contrat pendant qu'on écrit le
// serveur : un nom d'événement inventé ici coûterait une soirée de débogage à deux
// personnes, et il se découvrirait la veille de la démo.
//
// Le découpage en SALLES suit la même logique que les DTO (CLAUDE.md § 5.6) : on ne
// diffuse pas largement en filtrant côté client. Ce qui part dans la salle d'une course
// n'est lisible que par ses deux parties, ce qui part dans la salle d'un chauffeur n'est
// lisible que par lui.

/** Salle d'une course : le passager et le chauffeur qui la font. */
export const rideRoom = (rideId: string): string => `ride:${rideId}`;

/** Salle d'un chauffeur : ses offres, et rien d'autre. */
export const driverRoom = (driverId: string): string => `driver:${driverId}`;

/** Salle de la page ops : carte live et alertes. */
export const OPS_ROOM = 'ops';

// ─── Chauffeur → serveur ─────────────────────────────────────────────────────

/** `driver.position` — toutes les 5 s, tant que le chauffeur est en ligne. */
export const DRIVER_POSITION = 'driver.position';

// ─── Serveur → chauffeur ─────────────────────────────────────────────────────

/** `ride.offer` — une demande de course, 15 s pour répondre, net affiché. */
export const RIDE_OFFER = 'ride.offer';
/** `ride.offer_closed` — l'offre n'est plus valable (expirée, ou passée au suivant). */
export const RIDE_OFFER_CLOSED = 'ride.offer_closed';
/** `ride.cancelled` — le passager s'est désisté ; le chauffeur redevient disponible. */
export const RIDE_CANCELLED = 'ride.cancelled';

// ─── Serveur → passager ──────────────────────────────────────────────────────

/** `ride.status` — le statut fait autorité ; le client ne l'invente jamais. */
export const RIDE_STATUS = 'ride.status';
/** `ride.driver_position` — le point qui bouge sur la carte pendant l'approche. */
export const RIDE_DRIVER_POSITION = 'ride.driver_position';
/** `ride.eta` — minutes restantes avant l'arrivée du chauffeur. */
export const RIDE_ETA = 'ride.eta';

// ─── Serveur → les deux parties de la course ─────────────────────────────────

/**
 * `message.new` — un message prédéfini vient d'être envoyé sur cette course.
 *
 * La charge utile ne porte QUE le code (`IM_HERE`, `ARRIVING`…), l'expéditeur et
 * l'horodatage. Le libellé français se résout sur le téléphone : un code se traduit en
 * anglais sans toucher au serveur, et il ne peut pas transporter autre chose que ce que
 * `domain/messages.ts` autorise.
 */
export const RIDE_MESSAGE = 'message.new';

// ─── Serveur → ops ───────────────────────────────────────────────────────────

/** `ops.alert` — 3 codes de montée ratés, SOS, course expirée sans chauffeur. */
export const OPS_ALERT = 'ops.alert';

/** Rejeu : le client annonce où il en était, le serveur lui renvoie ce qu'il a manqué. */
export const REPLAY = 'replay';
/** Le client demande à suivre une course (le serveur vérifie qu'elle est bien à lui). */
export const SUBSCRIBE = 'ride.subscribe';
