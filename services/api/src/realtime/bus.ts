// VORA — bus d'événements temps réel, et tampon de rejeu.
//
// POURQUOI CE FICHIER EXISTE, alors que Socket.IO sait très bien émettre tout seul :
//
//   1. Les modules métier (`rides`, `dispatch`, `payments`) ne doivent connaître ni
//      Socket.IO, ni Fastify, ni le fait qu'un serveur écoute. Ils publient un fait
//      (« la course est passée en `arrived` ») ; la passerelle le transporte, ou non.
//      C'est ce qui permet aux tests d'intégration de faire tourner toute la boucle
//      passager → chauffeur → paiement SANS ouvrir de WebSocket : sans émetteur branché,
//      `publish` remplit le tampon et ne fait rien d'autre.
//
//   2. Le tampon de REJEU. Un téléphone à Yaoundé perd le réseau dans un tunnel de
//      Nsimeyong et le retrouve trente secondes plus tard. Sans rejeu, il rate le
//      passage `accepted` → `approaching` et son écran ment jusqu'au prochain événement.
//      On garde donc 10 minutes d'événements par salle : à la reconnexion, le client
//      annonce l'horodatage de son dernier événement reçu et le serveur lui rejoue la
//      suite, dans l'ordre.
//
// ÉCART ASSUMÉ (CLAUDE.md § 3) : ce tampon est EN MÉMOIRE, comme les positions. La
// cible est l'adaptateur Redis de Socket.IO (ADR-004). À une seule instance d'API, un
// adaptateur Redis n'apporte rien et ajoute un point de panne devant le jury. Ce que
// ça coûte : un redémarrage de l'API vide le tampon (les clients repartent d'un
// `GET /v1/rides/{id}`, qui reste la source de vérité), et l'API ne peut pas être
// répliquée.

/** Durée de conservation d'un événement pour le rejeu (CLAUDE.md § 3 : 10 min). */
export const REPLAY_WINDOW_MS = 10 * 60 * 1000;

/** Garde-fou : une salle bavarde (positions toutes les 5 s) ne mange pas la mémoire. */
const MAX_EVENTS_PER_ROOM = 500;

export interface BufferedEvent {
  /** Numéro d'ordre global, croissant. Deux événements de la même milliseconde restent ordonnés. */
  seq: number;
  room: string;
  event: string;
  payload: unknown;
  /** ISO 8601. C'est ce que le client renvoie à la reconnexion. */
  at: string;
}

type Emitter = (room: string, event: string, payload: unknown) => void;

const buffers = new Map<string, BufferedEvent[]>();
let emitter: Emitter | null = null;
let sequence = 0;

/**
 * Branche le transport. Appelé une fois par la passerelle Socket.IO ; jamais par un
 * module métier. Tant que rien n'est branché, publier reste sans effet visible — et
 * c'est exactement ce qu'on veut en test.
 */
export function setEmitter(fn: Emitter | null): void {
  emitter = fn;
}

/** Émet un fait dans une salle, et le garde 10 minutes pour ceux qui reviendront. */
export function publish(room: string, event: string, payload: unknown): BufferedEvent {
  sequence += 1;
  const buffered: BufferedEvent = {
    seq: sequence,
    room,
    event,
    payload,
    at: new Date().toISOString(),
  };

  const list = buffers.get(room) ?? [];
  list.push(buffered);
  prune(list);
  buffers.set(room, list);

  // Un client injoignable ne doit jamais faire échouer une transition de course : la
  // course a eu lieu, que la WebSocket ait suivi ou non.
  try {
    emitter?.(room, event, payload);
  } catch {
    // Volontairement silencieux ici : la passerelle journalise ses propres pannes.
  }

  return buffered;
}

/**
 * Ce qu'un client a manqué dans une salle depuis `since` (exclu).
 * Sans `since`, on ne rejoue rien : un client qui se connecte pour la première fois lit
 * l'état courant par `GET /v1/rides/{id}`, il n'a pas besoin de l'historique.
 */
export function replay(room: string, since?: string | null): BufferedEvent[] {
  if (!since) return [];

  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) return [];

  const list = buffers.get(room);
  if (!list) return [];

  prune(list);
  return list.filter((entry) => Date.parse(entry.at) > sinceMs);
}

/** Rejeu sur plusieurs salles à la fois, remis dans l'ordre d'émission. */
export function replayAll(rooms: string[], since?: string | null): BufferedEvent[] {
  return rooms
    .flatMap((room) => replay(room, since))
    .sort((a, b) => a.seq - b.seq);
}

/** Oublie une salle. Appelé quand une course se termine : elle ne recevra plus rien. */
export function forget(room: string): void {
  buffers.delete(room);
}

/** Remise à zéro — tests et `POST /v1/demo/reset`. */
export function clearBuffers(): void {
  buffers.clear();
}

/** Taille du tampon, pour la page ops et les tests. */
export function bufferedCount(room?: string): number {
  if (room) return (buffers.get(room) ?? []).length;
  let total = 0;
  for (const list of buffers.values()) total += list.length;
  return total;
}

function prune(list: BufferedEvent[]): void {
  const horizon = Date.now() - REPLAY_WINDOW_MS;
  while (list.length > 0 && Date.parse(list[0]!.at) < horizon) list.shift();
  while (list.length > MAX_EVENTS_PER_ROOM) list.shift();
}
