// VORA — passerelle Socket.IO. Salles par course et par chauffeur (CLAUDE.md § 3).
//
// Ce fichier est la SEULE frontière entre le temps réel et le reste du produit : il
// importe les services métier, ils ne l'importent jamais. Ce qu'ils publient passe par
// `realtime/bus.ts`, qui ne sait rien de Socket.IO. C'est ce qui permet aux tests
// d'intégration de dérouler toute la boucle sans ouvrir une seule WebSocket.
//
// ÉCART ASSUMÉ : pas d'adaptateur Redis (ADR-004). Une seule instance d'API en démo ; un
// adaptateur Redis n'apporterait rien et ajouterait un point de panne. Le jour où l'API
// se réplique, c'est une ligne — `io.adapter(createAdapter(pub, sub))` — et le tampon de
// rejeu de `bus.ts` devient un flux Redis.
//
// Ce qui se joue ici, concrètement : le passager doit voir le chauffeur avancer sur la
// carte, et le chauffeur doit recevoir une demande dans la seconde. Le reste (le détail
// de la course) se lit par REST — l'événement dit QUAND, la route dit QUOI.

import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import type { TokenPayload } from '../lib/auth.js';
import { publish, replayAll, setEmitter } from './bus.js';
import {
  driverRoom,
  rideRoom,
  DRIVER_POSITION,
  OPS_ROOM,
  REPLAY,
  RIDE_DRIVER_POSITION,
  RIDE_ETA,
  SUBSCRIBE,
} from './events.js';
import { positionSchema } from '../modules/dispatch/schemas.js';
import { applyLivePosition } from '../modules/dispatch/service.js';
import { approachEtaS } from '../modules/dispatch/scoring.js';
import * as ridesRepository from '../modules/rides/repository.js';
import { noteApproaching } from '../modules/rides/service.js';

interface SocketUser extends TokenPayload {
  /** Instant du dernier événement reçu par ce client, pour le rejeu à la reconnexion. */
  since: string | null;
}

declare module 'socket.io' {
  interface Socket {
    vora?: SocketUser;
  }
}

let io: Server | null = null;

/**
 * Monte la passerelle sur le serveur HTTP de Fastify. À appeler APRÈS `app.ready()` :
 * le serveur existe alors, et `app.jwt` est décoré.
 */
export function registerRealtime(app: FastifyInstance): Server {
  const server = new Server(app.server, {
    // CORS borné à CORS_ORIGINS : le contrôle d'origine d'une WebSocket est distinct de
    // celui des routes HTTP, et Socket.IO n'hérite pas du plugin CORS de Fastify. Une
    // application mobile n'envoie pas d'en-tête Origin et n'est donc pas concernée ;
    // c'est le back-office dans un navigateur qui l'est.
    cors: { origin: config.corsOrigins, credentials: true, methods: ['GET', 'POST'] },

    /**
     * LES DEUX TRANSPORTS, dans cet ordre, et c'est important derrière un proxy.
     *
     * `polling` d'abord : la connexion s'établit en HTTP ordinaire, qui passe partout —
     * proxy d'entreprise, réseau d'hôtel, portail captif de salle de conférence. Le
     * client bascule ensuite en `websocket` si la montée en gamme réussit.
     *
     * Ne garder que `websocket` économiserait un aller-retour et rendrait le temps réel
     * inutilisable partout où la montée en gamme est bloquée : le passager verrait une
     * carte figée sans comprendre pourquoi. Le repli vaut son aller-retour.
     *
     * ATTENTION À L'ÉCHELLE : `polling` répartit une même session sur plusieurs requêtes.
     * Avec deux instances et sans sessions persistantes (« sticky sessions »), une
     * requête sur deux tomberait sur l'instance qui ne connaît pas la session. Une seule
     * instance en démonstration (CLAUDE.md § 3) : le problème ne se pose pas encore, et
     * `infra/deploy/CLEVER_CLOUD.md` dit quoi faire le jour où il se posera.
     */
    transports: ['polling', 'websocket'],

    // Un téléphone en 3G à Yaoundé perd la WebSocket régulièrement : on laisse une
    // marge confortable avant de le déclarer parti.
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  // Le jeton voyage dans le handshake, pas dans un événement : un socket non
  // authentifié ne doit jamais atteindre le premier `on(...)`.
  server.use((socket, next) => {
    const raw = socket.handshake.auth?.token ?? socket.handshake.headers.authorization;
    const token = typeof raw === 'string' ? raw.replace(/^Bearer\s+/i, '') : null;

    if (!token) {
      next(new Error('unauthorized'));
      return;
    }

    try {
      const payload = app.jwt.verify<TokenPayload>(token);
      const since = socket.handshake.auth?.since;
      socket.vora = { ...payload, since: typeof since === 'string' ? since : null };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  server.on('connection', (socket) => onConnection(socket));

  // Tout ce que les modules publient part d'ici. Une seule ligne : c'est exactement ce
  // qu'on voulait — le métier ne connaît pas le transport.
  setEmitter((room, event, payload) => {
    server.to(room).emit(event, payload);
  });

  io = server;
  return server;
}

/** Ferme la passerelle (arrêt du serveur, fin des tests). */
export async function closeRealtime(): Promise<void> {
  setEmitter(null);
  if (!io) return;
  await io.close();
  io = null;
}

function onConnection(socket: Socket): void {
  const user = socket.vora;
  if (!user) {
    socket.disconnect(true);
    return;
  }

  // LES GESTIONNAIRES D'ABORD, AVANT TOUT `await`.
  //
  // Socket.IO ne met pas en file d'attente les événements qui n'ont pas d'auditeur : ce
  // qui arrive avant le `socket.on(...)` est perdu, en silence. Or l'application
  // chauffeur émet sa position dès qu'elle est connectée, et l'inscription aux salles
  // ci-dessous demande une lecture en base. Enregistrer les gestionnaires après cette
  // lecture ferait disparaître la première position de chaque connexion — une seconde
  // de retard invisible, tous les jours, chez tous les chauffeurs.
  socket.on(SUBSCRIBE, (raw: unknown, ack?: (result: unknown) => void) => {
    void subscribeToRide(socket, raw, ack);
  });

  socket.on(DRIVER_POSITION, (raw: unknown) => {
    void onDriverPosition(socket, raw);
  });

  socket.on('error', (error: Error) => {
    logger.warn({ err: error, voraId: user.vora_id }, 'Erreur de socket');
  });

  void joinOwnRooms(socket, user);
}

/** Salles auxquelles ce client appartient d'office, puis rejeu de ce qu'il a manqué. */
async function joinOwnRooms(socket: Socket, user: SocketUser): Promise<void> {
  const rooms: string[] = [];

  if (user.role === 'driver') {
    // Le chauffeur entre dans SA salle dès la connexion : c'est là qu'arrivent les
    // demandes de course, et il n'a rien à demander pour les recevoir.
    await socket.join(driverRoom(user.sub));
    rooms.push(driverRoom(user.sub));

    // Il rejoint aussi la course qu'il est en train de faire : à la reconnexion, il
    // retrouve le fil sans que son application ait à savoir laquelle c'était.
    const engaged = await ridesRepository.findEngagedRideForDriver(user.sub);
    if (engaged) {
      await socket.join(rideRoom(engaged.id));
      rooms.push(rideRoom(engaged.id));
    }
  }

  if (user.role === 'ops') {
    await socket.join(OPS_ROOM);
    rooms.push(OPS_ROOM);
  }

  // Rejeu : ce que ce client a manqué pendant sa coupure, dans l'ordre.
  emitReplay(socket, rooms, user.since);
}

/** Rejoue les événements manqués, sur les salles où ce client a le droit d'être. */
function emitReplay(socket: Socket, rooms: string[], since: string | null): void {
  if (rooms.length === 0 || !since) return;

  const missed = replayAll(rooms, since);
  if (missed.length === 0) return;

  socket.emit(REPLAY, {
    since,
    count: missed.length,
    events: missed.map((entry) => ({ event: entry.event, payload: entry.payload, at: entry.at })),
  });
}

/**
 * Le passager (ou le chauffeur) demande à suivre une course. On VÉRIFIE qu'elle est bien
 * la sienne avant de le laisser entrer : une salle de course porte des positions et des
 * statuts, et l'identifiant d'une course est un UUID, pas un secret.
 */
async function subscribeToRide(
  socket: Socket,
  raw: unknown,
  ack?: (result: unknown) => void,
): Promise<void> {
  const user = socket.vora;
  const rideId =
    typeof raw === 'object' && raw !== null && 'rideId' in raw
      ? String((raw as { rideId: unknown }).rideId)
      : null;

  if (!user || !rideId) {
    ack?.({ ok: false, error: 'BAD_REQUEST' });
    return;
  }

  const ride = await ridesRepository.findRideRow(rideId);
  const allowed =
    ride !== null &&
    (user.role === 'ops' || ride.passengerId === user.sub || ride.driverId === user.sub);

  if (!allowed) {
    ack?.({ ok: false, error: 'NOT_FOUND' });
    return;
  }

  await socket.join(rideRoom(rideId));
  emitReplay(socket, [rideRoom(rideId)], user.since);
  ack?.({ ok: true, status: ride.status });
}

/**
 * `driver.position`, toutes les 5 secondes.
 *
 * Trois effets, dans cet ordre :
 *   1. la position vit en mémoire (TTL 60 s) — c'est elle que le dispatch interroge ;
 *   2. si le chauffeur est engagé sur une course, son point et son ETA partent au
 *      passager : c'est le deuxième moment de vérité qui se joue à l'écran ;
 *   3. la première position reçue après l'acceptation fait passer la course en
 *      `approaching` — le chauffeur a bougé, donc il vient.
 */
async function onDriverPosition(socket: Socket, raw: unknown): Promise<void> {
  const user = socket.vora;
  if (!user || user.role !== 'driver') return;

  const parsed = positionSchema.safeParse(raw);
  if (!parsed.success) {
    logger.debug({ voraId: user.vora_id }, 'Position ignorée : forme invalide');
    return;
  }

  const presence = applyLivePosition(user.sub, parsed.data);
  // Chauffeur hors ligne : sa position n'intéresse personne, et l'accepter le ferait
  // réapparaître sur la carte de l'ops.
  if (!presence) return;

  const ride = await ridesRepository.findEngagedRideForDriver(user.sub);
  if (!ride) return;

  publish(rideRoom(ride.id), RIDE_DRIVER_POSITION, {
    rideId: ride.id,
    lat: presence.lat,
    lng: presence.lng,
    heading: presence.heading,
  });

  // L'ETA n'a de sens que tant que le chauffeur vient CHERCHER le passager. Une fois à
  // bord, c'est la destination qui compte, et elle est déjà dans le devis.
  if (ride.status === 'accepted' || ride.status === 'approaching') {
    const etaS = approachEtaS({ lat: presence.lat, lng: presence.lng }, ride.pickup, presence.kind);
    publish(rideRoom(ride.id), RIDE_ETA, {
      rideId: ride.id,
      etaMin: Math.max(1, Math.round(etaS / 60)),
      etaS,
    });
  }

  if (ride.status === 'accepted') {
    await noteApproaching(ride.id, user.sub);
  }
}
