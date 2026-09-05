// VORA — règles métier. SOURCE UNIQUE des valeurs de CLAUDE.md § 5.
//
// Aucune de ces valeurs ne doit être recopiée ailleurs dans le code : un prix qui bouge,
// un net faux ou une moto en zone interdite ne sont pas des raccourcis de hackathon, ce
// sont les trois moments de vérité qui tombent (CLAUDE.md § 8.4).
//
// Les montants sont des ENTIERS DE FRANCS CFA. Jamais de flottant sur de l'argent.

/** Les trois offres commercialisées. */
export const OFFERS = ['eco', 'confort', 'moto'] as const;
export type Offer = (typeof OFFERS)[number];

/** Un véhicule est une voiture ou une moto ; l'offre Confort reste une voiture. */
export const VEHICLE_KINDS = ['car', 'moto'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];

export function vehicleKindForOffer(offer: Offer): VehicleKind {
  return offer === 'moto' ? 'moto' : 'car';
}

// ─── Tarification (CLAUDE.md § 5.1) ──────────────────────────────────────────

export interface TariffGrid {
  /** Prise en charge, en francs. */
  baseFare: number;
  /** Francs par kilomètre. */
  perKm: number;
  /** Francs par minute. La moto ne facture pas le temps. */
  perMin: number;
  /** Plancher : aucune course en dessous. */
  minimumFare: number;
}

/** Grille Éco. Confort en est dérivée par un multiplicateur, pour qu'il n'y ait qu'une vérité. */
export const ECO_TARIFF: TariffGrid = {
  baseFare: 500,
  perKm: 150,
  perMin: 25,
  minimumFare: 1000,
};

/** Confort = Éco × 1,4, arrondi au franc ligne par ligne. */
export const CONFORT_MULTIPLIER = 1.4;

export const MOTO_TARIFF: TariffGrid = {
  baseFare: 200,
  perKm: 60,
  perMin: 0,
  minimumFare: 300,
};

export const TARIFFS: Record<Offer, TariffGrid> = {
  eco: ECO_TARIFF,
  confort: {
    baseFare: Math.round(ECO_TARIFF.baseFare * CONFORT_MULTIPLIER),
    perKm: Math.round(ECO_TARIFF.perKm * CONFORT_MULTIPLIER),
    perMin: Math.round(ECO_TARIFF.perMin * CONFORT_MULTIPLIER),
    minimumFare: Math.round(ECO_TARIFF.minimumFare * CONFORT_MULTIPLIER),
  },
  moto: MOTO_TARIFF,
};

/** Majoration de nuit : + 25 %, de 22 h à 5 h (heure de la COMMANDE, pas de la fin de course). */
export const NIGHT_SURGE_PERCENT = 25;
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 5;

/** Pluie / forte demande : jusqu'à + 50 %, activée par l'ops. */
export const DEMAND_SURGE_MAX_PERCENT = 50;

/** Plafond global : le total ne dépasse jamais 1,5 × le prix de base, majorations comprises. */
export const TOTAL_SURGE_CAP_PERCENT = 150;

/** Le devis est figé et expire au bout de 2 minutes (CLAUDE.md § 5.1). */
export const QUOTE_TTL_S = 120;

/** Fuseau des heures ouvrées et de la majoration de nuit. */
export const CITY_TIMEZONE = 'Africa/Douala';

// ─── Argent du chauffeur (CLAUDE.md § 5.2) ───────────────────────────────────

/** Commission VORA : 15 % sur les voitures. */
export const COMMISSION_PERCENT_CAR = 15;
/** Commission VORA : 50 F fixes par course moto. */
export const COMMISSION_FLAT_MOTO = 50;
/** Retenue DGI : 1 % du brut, par course, reversée par VORA. Ligne visible côté chauffeur. */
export const DGI_PERCENT = 1;

// ─── Annulation (CLAUDE.md § 5.3) ────────────────────────────────────────────

/** Annulation gratuite dans les 2 min suivant l'acceptation… */
export const FREE_CANCEL_WINDOW_S = 120;
/** …OU tant que le chauffeur a parcouru moins de 300 m. Les deux conditions sont alternatives. */
export const FREE_CANCEL_DISTANCE_M = 300;

/** Frais d'annulation tardive, reversés INTÉGRALEMENT au chauffeur. */
export const CANCEL_FEE: Record<VehicleKind, number> = { car: 300, moto: 100 };

/** Attente après « Je suis arrivé » avant de pouvoir clôturer pour passager absent. */
export const NO_SHOW_WAIT_S: Record<VehicleKind, number> = { car: 300, moto: 180 };

// ─── Dispatch (CLAUDE.md § 5.4) ──────────────────────────────────────────────

/** Un seul chauffeur à la fois, 15 s pour répondre. */
export const DISPATCH_OFFER_TIMEOUT_S = 15;
/** 3 vagues au maximum, puis la course passe `expired` avec deux sorties offertes. */
export const DISPATCH_MAX_WAVES = 3;
/** Rayon de recherche de chaque vague, en kilomètres. */
export const DISPATCH_WAVE_RADII_KM = [1, 3, 5] as const;

/** Score d'attribution : eta 55 %, acceptation 20 %, non-annulation 15 %, note 10 %. */
export const DISPATCH_SCORE_WEIGHTS = {
  eta: 0.55,
  acceptance: 0.2,
  reliability: 0.15,
  rating: 0.1,
} as const;

/** Une position de chauffeur plus vieille que ça n'est plus considérée comme vivante. */
export const DRIVER_POSITION_TTL_S = 60;

// ─── Sécurité de la course (CLAUDE.md § 5.5) ─────────────────────────────────

/** Code de montée à 4 chiffres, stocké haché, jamais renvoyé au chauffeur. */
export const BOARDING_CODE_LENGTH = 4;
/** 3 échecs de code de montée → alerte ops. */
export const BOARDING_CODE_MAX_ATTEMPTS = 3;

// ─── Identité (CLAUDE.md § 5.6) ──────────────────────────────────────────────

/** L'ID VORA fait 8 chiffres, affiché en deux groupes de 4 : « 4821 0937 ». */
export const VORA_ID_LENGTH = 8;
/** Longueur du code de vérification envoyé par SMS ou e-mail. */
export const OTP_CODE_LENGTH = 6;
