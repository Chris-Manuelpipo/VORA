// VORA — positions des chauffeurs en ligne.
//
// ÉCART ASSUMÉ (CLAUDE.md § 3) : la cible de production est Redis `GEOADD`/`GEOSEARCH`
// (ADR-003). Pour le hackathon, tout tient dans une Map du processus — 12 chauffeurs
// simulés et quelques téléphones réels. Redis serait un service de plus à installer,
// surveiller et redémarrer devant le jury, pour un gain nul à cette échelle.
//
// Ce que ça coûte, et qu'on dit au jury :
//   · un redémarrage de l'API vide les positions (les chauffeurs se réannoncent en 5 s) ;
//   · l'API ne peut pas être répliquée.
//
// Ce que ça ne coûte pas : le dispatch ne connaît que l'INTERFACE ci-dessous. Brancher
// Redis, c'est écrire une seconde implémentation de `DriverPresenceStore`, rien d'autre.

import type { LatLng } from '../../db/geography.js';
import { haversineMeters } from '../../lib/geodesy.js';
import { DRIVER_POSITION_TTL_S, type VehicleKind } from '../../domain/rules.js';

export type DriverAvailability = 'available' | 'on_ride';

/**
 * En deçà de ce déplacement entre deux relevés, on considère que le chauffeur n'a pas
 * bougé : c'est la dérive du GPS, pas de la route. 15 m est la précision courante d'un
 * téléphone d'entrée de gamme en ville.
 */
const GPS_NOISE_FLOOR_M = 15;

export interface DriverPresence {
  driverId: string;
  kind: VehicleKind;
  lat: number;
  lng: number;
  /** Cap en degrés, pour orienter la flèche sur la carte. */
  heading: number | null;
  /** Vitesse en km/h, telle que remontée par le téléphone. */
  speed: number | null;
  availability: DriverAvailability;
  updatedAt: Date;
  /**
   * Début de la session en ligne en cours. Sert au « temps en ligne » de l'écran des
   * gains — la seule valeur approchée de cet écran, et elle repart de zéro au
   * redémarrage de l'API. Un historique fidèle demanderait une table de sessions, hors
   * périmètre (CLAUDE.md § 8.3) : mieux vaut un chiffre daté qu'un chiffre inventé.
   */
  onlineSince: Date;
  /**
   * Compteur cumulé, en mètres, depuis la mise en ligne. Sert à UNE règle et une seule :
   * l'annulation est gratuite tant que le chauffeur a parcouru moins de 300 m
   * (CLAUDE.md § 5.3). On mesure bien une DISTANCE PARCOURUE, somme des déplacements
   * successifs, et non l'écart au point de départ : le chauffeur qui a fait le tour du
   * pâté de maisons a travaillé, même s'il est revenu près de son point de départ.
   */
  odometerM: number;
}

export interface NearbyDriver extends DriverPresence {
  distanceM: number;
}

export interface DriverPresenceStore {
  upsert(presence: Omit<DriverPresence, 'updatedAt' | 'odometerM' | 'onlineSince'>): void;
  get(driverId: string): DriverPresence | null;
  remove(driverId: string): void;
  /** Change la disponibilité sans toucher à la position ni au compteur. */
  setAvailability(driverId: string, availability: DriverAvailability): void;
  /** Compteur cumulé du chauffeur, ou `null` si sa position n'est plus vivante. */
  odometer(driverId: string): number | null;
  /** Chauffeurs vivants dans un rayon, du plus proche au plus lointain. */
  nearby(center: LatLng, radiusKm: number, filter?: { kind?: VehicleKind }): NearbyDriver[];
  /** Tous les chauffeurs vivants — la carte de la page ops. */
  all(): DriverPresence[];
  size(): number;
  clear(): void;
  stop(): void;
}

export class InMemoryDriverPresenceStore implements DriverPresenceStore {
  private readonly positions = new Map<string, DriverPresence>();
  private readonly ttlMs: number;
  private readonly sweeper: NodeJS.Timeout;

  constructor(ttlSeconds: number = DRIVER_POSITION_TTL_S) {
    this.ttlMs = ttlSeconds * 1000;

    // Balayage périodique : une position vieille de plus d'une minute n'est pas une
    // position, c'est un souvenir. On ne veut pas l'offrir à un passager qui attend.
    this.sweeper = setInterval(() => this.sweep(), Math.max(this.ttlMs / 2, 5_000));
    // Ne retient pas le processus : `npm test` et Ctrl-C rendent la main immédiatement.
    this.sweeper.unref();
  }

  upsert(presence: Omit<DriverPresence, 'updatedAt' | 'odometerM' | 'onlineSince'>): void {
    const previous = this.get(presence.driverId);

    // Le compteur s'incrémente du déplacement depuis la dernière position CONNUE. Un
    // chauffeur dont la position a expiré (tunnel, batterie) repart de son compteur, pas
    // de zéro : c'est la même course, et la règle des 300 m doit rester juste.
    const travelled = previous
      ? haversineMeters(
          { lat: previous.lat, lng: previous.lng },
          { lat: presence.lat, lng: presence.lng },
        )
      : 0;

    // Le GPS d'un téléphone bon marché « saute » de quelques mètres à l'arrêt. Sans ce
    // seuil, un chauffeur immobile parcourrait 300 m en dix minutes de dérive, et
    // perdrait le droit du passager à annuler gratuitement.
    const step = travelled >= GPS_NOISE_FLOOR_M ? travelled : 0;

    this.positions.set(presence.driverId, {
      ...presence,
      updatedAt: new Date(),
      // La session en ligne survit aux relevés : elle ne se rouvre qu'après un passage
      // hors ligne, ou après l'expiration de la position (TTL 60 s).
      onlineSince: previous?.onlineSince ?? new Date(),
      odometerM: (previous?.odometerM ?? 0) + step,
    });
  }

  setAvailability(driverId: string, availability: DriverAvailability): void {
    const presence = this.get(driverId);
    if (!presence) return;
    this.positions.set(driverId, { ...presence, availability });
  }

  odometer(driverId: string): number | null {
    return this.get(driverId)?.odometerM ?? null;
  }

  get(driverId: string): DriverPresence | null {
    const presence = this.positions.get(driverId);
    if (!presence) return null;
    if (this.isStale(presence)) {
      this.positions.delete(driverId);
      return null;
    }
    return presence;
  }

  remove(driverId: string): void {
    this.positions.delete(driverId);
  }

  nearby(center: LatLng, radiusKm: number, filter?: { kind?: VehicleKind }): NearbyDriver[] {
    const radiusM = radiusKm * 1000;
    const found: NearbyDriver[] = [];

    for (const presence of this.positions.values()) {
      if (this.isStale(presence)) continue;
      if (filter?.kind && presence.kind !== filter.kind) continue;
      if (presence.availability !== 'available') continue;

      const distanceM = haversineMeters(center, { lat: presence.lat, lng: presence.lng });
      if (distanceM <= radiusM) found.push({ ...presence, distanceM });
    }

    return found.sort((a, b) => a.distanceM - b.distanceM);
  }

  all(): DriverPresence[] {
    return [...this.positions.values()].filter((presence) => !this.isStale(presence));
  }

  size(): number {
    return this.all().length;
  }

  clear(): void {
    this.positions.clear();
  }

  stop(): void {
    clearInterval(this.sweeper);
  }

  private isStale(presence: DriverPresence): boolean {
    return Date.now() - presence.updatedAt.getTime() > this.ttlMs;
  }

  private sweep(): void {
    for (const [driverId, presence] of this.positions) {
      if (this.isStale(presence)) this.positions.delete(driverId);
    }
  }
}

/** Instance unique du processus. Le jour où c'est Redis, seule cette ligne change. */
export const driverPresence: DriverPresenceStore = new InMemoryDriverPresenceStore();
