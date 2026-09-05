// VORA — le canal de messages prédéfinis d'une course.
//
// Six codes, deux parties, une fenêtre. Ce fichier tient les trois règles qui font que
// ce canal reste un outil de coordination et ne devient jamais une messagerie :
//
//   1. QUI — seulement le passager et le chauffeur DE CETTE COURSE. Un tiers reçoit 403,
//      en lecture comme en écriture. L'ops non plus n'entre pas : le brief (§ 5.7) ne lui
//      ouvre la conversation que sur litige ouvert, et les litiges sont hors périmètre.
//   2. QUAND — de l'acceptation à 30 min après la fin. Avant, il n'y a pas d'autre partie
//      à qui parler ; après, la course est close et le sujet aussi.
//   3. COMBIEN — 10 messages par course et par personne. Au-delà, ce n'est plus une
//      coordination, c'est un problème : il se traite avec l'ops.
//
// Le serveur ne transporte QUE le code. Le libellé français est résolu par l'application
// (`domain/messages.ts` en porte la liste de référence).

import { AppError } from '../../lib/errors.js';
import type { Ride, RideMessage, UserRole } from '../../db/schema.js';
import {
  MAX_MESSAGES_PER_PARTY,
  MESSAGING_WINDOW_AFTER_END_S,
  isCodeAllowedFor,
  type MessageCode,
  type MessageSender,
} from '../../domain/messages.js';
import { isTerminal } from '../../domain/states.js';
import { publish } from '../../realtime/bus.js';
import { RIDE_MESSAGE, rideRoom } from '../../realtime/events.js';
import * as repository from './repository.js';
import type { RideMessageDto } from './schemas.js';

export interface MessageViewer {
  id: string;
  role: UserRole;
}

/**
 * Quelle partie est cette personne sur cette course ?
 *
 * C'est le JETON qui décide, jamais le corps de la requête : sans cela, un passager
 * pourrait envoyer « J'arrive » à sa propre place et fabriquer une preuve.
 * `null` = cette personne n'est pas partie à cette course.
 */
function senderOf(ride: Ride, viewer: MessageViewer): MessageSender | null {
  if (viewer.role === 'passenger' && ride.passengerId === viewer.id) return 'passenger';
  if (viewer.role === 'driver' && ride.driverId === viewer.id) return 'driver';
  return null;
}

/**
 * Exige d'être partie à la course, et rend son rôle.
 *
 * 403 et pas 404 : la demande est explicitement REFUSÉE. `GET /v1/rides/:id` répond 404
 * pour ne pas révéler qu'une course existe ; ici l'identifiant vient forcément d'une
 * course qu'on a déjà en main, et un refus clair vaut mieux qu'une devinette.
 */
function requireParty(ride: Ride, viewer: MessageViewer): MessageSender {
  const sender = senderOf(ride, viewer);
  if (!sender) {
    throw new AppError('FORBIDDEN', "Cette conversation ne vous concerne pas.");
  }
  return sender;
}

export interface MessagingWindow {
  open: boolean;
  reason: 'before_accept' | 'after_end' | null;
  /** Instant de fermeture, quand il est connu. Le client peut afficher un compte à rebours. */
  closesAt: string | null;
}

/**
 * La conversation est-elle ouverte, MAINTENANT ?
 *
 * `acceptedAt` est le seul point de départ possible : avant l'acceptation il n'y a pas
 * de chauffeur, donc personne à qui parler — et une course annulée depuis `requested`
 * n'a jamais eu de conversation à rouvrir.
 *
 * La fin, c'est `completedAt` si la course est allée à son terme, et sinon l'instant de
 * la dernière transition (`updatedAt`, tenu par le déclencheur `rides_touch` en base) :
 * une annulation tardive ou un passager absent ferment aussi la course, et le sac oublié
 * dans le coffre existe quand même.
 */
export function messagingWindow(ride: Ride, now: Date = new Date()): MessagingWindow {
  if (!ride.acceptedAt) {
    return { open: false, reason: 'before_accept', closesAt: null };
  }

  const endedAt = ride.completedAt ?? (isTerminal(ride.status) ? ride.updatedAt : null);
  if (!endedAt) {
    // Course en cours : ouverte, et sa fermeture n'a pas encore de date.
    return { open: true, reason: null, closesAt: null };
  }

  const closesAt = new Date(endedAt.getTime() + MESSAGING_WINDOW_AFTER_END_S * 1000);
  return closesAt > now
    ? { open: true, reason: null, closesAt: closesAt.toISOString() }
    : { open: false, reason: 'after_end', closesAt: closesAt.toISOString() };
}

function requireOpenWindow(ride: Ride): void {
  const window = messagingWindow(ride);
  if (window.open) return;

  throw new AppError(
    'MESSAGING_CLOSED',
    window.reason === 'before_accept'
      ? "Les messages s'ouvrent quand un chauffeur accepte la course."
      : 'Cette course est terminée depuis plus de 30 minutes. Écrivez à VORA depuis Aide.',
    { reason: window.reason, closes_at: window.closesAt },
  );
}

async function loadRide(rideId: string): Promise<Ride> {
  const ride = await repository.findRideRow(rideId);
  if (!ride) throw new AppError('NOT_FOUND', 'Cette course est introuvable.');
  return ride;
}

/**
 * Le fil de la course. Aucune donnée personnelle : un expéditeur, un code, une heure.
 * Ni nom, ni ID VORA, ni identifiant interne — le client sait déjà qui est en face.
 */
export function toMessageDto(message: RideMessage): RideMessageDto {
  return {
    id: message.id,
    sender: message.sender,
    code: message.code,
    created_at: message.createdAt.toISOString(),
  };
}

export async function listMessages(
  rideId: string,
  viewer: MessageViewer,
): Promise<{ messages: RideMessageDto[]; window: MessagingWindow }> {
  const ride = await loadRide(rideId);
  requireParty(ride, viewer);
  // La LECTURE n'exige pas la fenêtre ouverte : après une course, chacun doit pouvoir
  // relire ce qui a été dit. C'est l'écriture qui se ferme.
  const messages = await repository.listRideMessages(rideId);

  return { messages: messages.map(toMessageDto), window: messagingWindow(ride) };
}

export async function sendMessage(input: {
  rideId: string;
  viewer: MessageViewer;
  code: string;
}): Promise<RideMessageDto> {
  const ride = await loadRide(input.rideId);
  const sender = requireParty(ride, input.viewer);
  requireOpenWindow(ride);

  // Le catalogue est apparié à l'expéditeur : « J'arrive » est un message de chauffeur.
  // La contrainte CHECK de la base dit la même chose — deux barrières, une seule vérité.
  if (!isCodeAllowedFor(sender, input.code)) {
    throw new AppError('VALIDATION_ERROR', "Ce message n'existe pas.", { code: input.code });
  }

  const sent = await repository.countRideMessages(input.rideId, sender);
  if (sent >= MAX_MESSAGES_PER_PARTY) {
    throw new AppError(
      'MESSAGE_QUOTA_REACHED',
      'Vous avez envoyé 10 messages sur cette course. Appelez VORA si vous ne vous trouvez pas.',
      { max: MAX_MESSAGES_PER_PARTY },
    );
  }

  const message = await repository.insertRideMessage({
    rideId: input.rideId,
    sender,
    code: input.code as MessageCode,
  });

  // Vers la salle de la course : les deux parties, et personne d'autre. La charge utile
  // ne porte que le code — le libellé se résout sur le téléphone.
  publish(rideRoom(input.rideId), RIDE_MESSAGE, {
    rideId: input.rideId,
    id: message.id,
    sender: message.sender,
    code: message.code,
    at: message.createdAt.toISOString(),
  });

  return toMessageDto(message);
}
