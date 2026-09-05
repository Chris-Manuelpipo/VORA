// VORA — zones réglementaires de Yaoundé.
//
// ══════════════════════════════════════════════════════════════════════════════
//  MÊME AVERTISSEMENT QUE POUR LES REPÈRES, EN PLUS GRAVE
//
//  Ces polygones sont une TRANSCRIPTION APPROXIMATIVE de l'esprit de l'arrêté
//  préfectoral qui restreint la circulation des motos-taxis dans le centre urbain
//  de Yaoundé. Ils n'ont pas été relevés sur le texte officiel, rue par rue.
//
//  Ce qui est juste ici, c'est le MÉCANISME : la zone vit en base, en
//  geography(Polygon,4326), et c'est PostGIS qui tranche par ST_Intersects. Ce qui
//  est approximatif, c'est le tracé. Avant tout usage réel il faut la liste des
//  voies de l'arrêté et un tracé validé par la Communauté urbaine — après quoi
//  seule cette constante change, pas une ligne de code.
//
//  On le dit au jury plutôt que de le laisser deviner : refuser une course pour une
//  raison légale exige de savoir exactement où passe la limite.
// ══════════════════════════════════════════════════════════════════════════════
//
//  Sens des anneaux : SENS ANTIHORAIRE (règle de la main droite, convention OGC et
//  GeoJSON). PostGIS interprète correctement nos petits polygones dans les deux sens,
//  mais une convention tenue partout évite d'y revenir le jour où une zone grandit.
//  Le premier point n'a pas besoin d'être répété : `polygonToEwkt` ferme l'anneau.

import type { Ring } from '../geography.js';
import type { ZoneKind } from '../schema.js';

export interface ZoneSeed {
  kind: ZoneKind;
  name: string;
  /** Phrase affichée au passager quand la course est refusée. Elle dit la règle ET sa source. */
  reason: string | null;
  ring: Ring;
  active: boolean;
}

/**
 * Centre urbain interdit aux motos-taxis.
 *
 * Le tracé englobe le cœur administratif et commerçant : Poste Centrale, Marché
 * Central, Hôtel de Ville, Marché Mfoundi, Hôpital Central, Cathédrale, Marché Mokolo,
 * Carrefour Warda, Palais des Congrès, jusqu'à Nlongkak au nord et Elig-Essono à l'est.
 *
 * Restent DEHORS, et c'est voulu : Bastos et Tsinga au nord, le Stade Omnisports à
 * l'est, Mvog-Mbi et Ngoa-Ekellé au sud, tout l'ouest (Melen, Obili, Biyem-Assi).
 * Une moto peut donc parfaitement faire Melen → Obili ; elle ne peut pas faire
 * Melen → Poste Centrale.
 */
const CENTRE_URBAIN: Ring = [
  { lat: 3.858, lng: 11.512 }, // sud, vers Efoulan
  { lat: 3.86, lng: 11.5215 }, // sud-est, derrière le marché Mfoundi
  { lat: 3.87, lng: 11.525 }, // est, Madagascar
  { lat: 3.88, lng: 11.5265 }, // nord-est, Elig-Essono
  { lat: 3.889, lng: 11.52 }, // nord, Nlongkak
  { lat: 3.888, lng: 11.504 }, // nord-ouest, Briqueterie
  { lat: 3.866, lng: 11.503 }, // ouest, vers Ngoa-Ekellé
];

/** Emana : axe nord, motos autorisées. */
const EMANA: Ring = [
  { lat: 3.92, lng: 11.512 },
  { lat: 3.92, lng: 11.538 },
  { lat: 3.948, lng: 11.538 },
  { lat: 3.948, lng: 11.512 },
];

/**
 * Etoudi : le quartier et son marché, PAS le périmètre du Palais de l'Unité, qui reste
 * à l'est de la limite (11.532). La zone s'arrête volontairement avant.
 */
const ETOUDI: Ring = [
  { lat: 3.9, lng: 11.518 },
  { lat: 3.9, lng: 11.532 },
  { lat: 3.92, lng: 11.532 },
  { lat: 3.92, lng: 11.518 },
];

/** Nkolbisson : ouest de la ville, desserte assurée surtout par les motos. */
const NKOLBISSON: Ring = [
  { lat: 3.854, lng: 11.428 },
  { lat: 3.854, lng: 11.452 },
  { lat: 3.879, lng: 11.452 },
  { lat: 3.879, lng: 11.428 },
];

export const ZONE_SEED: ZoneSeed[] = [
  {
    kind: 'moto_forbidden',
    name: 'Centre urbain — interdiction moto',
    reason:
      "Arrêté préfectoral : la circulation des motos-taxis est interdite dans le centre urbain de Yaoundé.",
    ring: CENTRE_URBAIN,
    active: true,
  },
  {
    kind: 'moto_allowed',
    name: 'Emana — moto autorisée',
    reason: null,
    ring: EMANA,
    active: true,
  },
  {
    kind: 'moto_allowed',
    name: 'Etoudi — moto autorisée',
    reason: null,
    ring: ETOUDI,
    active: true,
  },
  {
    kind: 'moto_allowed',
    name: 'Nkolbisson — moto autorisée',
    reason: null,
    ring: NKOLBISSON,
    active: true,
  },
];

/**
 * Zones semées par une version antérieure et retirées depuis. Le seed les désactive au
 * lieu de les supprimer : une zone a pu servir à refuser une course, et l'historique
 * d'une décision de refus doit rester lisible.
 *
 * « Palais de l'Unité » (P1) était tracé sur des coordonnées du centre-ville, à trois
 * kilomètres du vrai palais d'Étoudi. Le polygone « Centre urbain » couvre correctement
 * la surface qu'il visait.
 */
export const RETIRED_ZONE_NAMES = ["Palais de l'Unité"];
