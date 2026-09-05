// VORA — calcul du prix. FONCTION PURE, sans base ni réseau ni horloge implicite.
//
// C'est le premier moment de vérité : « le prix s'affiche avant la commande, et ne bouge
// plus ». Il est donc calculé ici, une fois, par une fonction qu'on peut lire en entier et
// dont les trois tables de vérité de CLAUDE.md § 5.2 sont des tests
// (src/tests/unit/fare.unit.test.ts).
//
// Formule (CLAUDE.md § 5.1) :
//   prix = max(minimum, base + tarif_km × km + tarif_min × min)
//   arrondi au franc PAR LIGNE, puis total. Majorations en lignes séparées et visibles.
//   Plafond global × 1,5 du prix de base, jamais dépassé.
//
// Tout est en ENTIERS DE FRANCS CFA. Aucun flottant ne survit à une ligne de ce fichier.

import {
  CITY_TIMEZONE,
  COMMISSION_FLAT_MOTO,
  COMMISSION_PERCENT_CAR,
  DEMAND_SURGE_MAX_PERCENT,
  DGI_PERCENT,
  NIGHT_END_HOUR,
  NIGHT_START_HOUR,
  NIGHT_SURGE_PERCENT,
  TARIFFS,
  TOTAL_SURGE_CAP_PERCENT,
  type Offer,
  type TariffGrid,
} from '../../domain/rules.js';

/** Une ligne du prix, telle qu'elle s'affiche au passager. */
export interface FareLine {
  key: 'base' | 'distance' | 'time' | 'minimum' | 'night' | 'demand' | 'cap';
  label: string;
  amount: number;
}

export interface Fare {
  offer: Offer;
  /** Prix hors majorations : c'est lui que le plafond × 1,5 borne. */
  baseAmount: number;
  lines: FareLine[];
  total: number;
  currency: 'XAF';
  night: boolean;
  /** Majoration pluie / forte demande retenue, en pourcentage. */
  demandSurgePercent: number;
  /** Vrai si le plafond global a mordu : l'information se montre, elle ne se cache pas. */
  capped: boolean;
}

/**
 * Est-on dans la tranche de nuit (22 h → 5 h) à Yaoundé ?
 * L'heure est celle de la COMMANDE, pas celle de la fin de course (CLAUDE.md § 5.1),
 * et elle est lue dans le fuseau de la ville, quel que soit celui du serveur.
 */
export function isNight(at: Date, timeZone: string = CITY_TIMEZONE): boolean {
  const hourPart = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone,
  })
    .formatToParts(at)
    .find((part) => part.type === 'hour');
  const hour = Number(hourPart?.value);
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

export interface FareInput {
  offer: Offer;
  distanceM: number;
  durationS: number;
  /** Heure de la commande. Obligatoire : la majoration de nuit en dépend. */
  at: Date;
  /** Majoration pluie / forte demande activée par l'ops, en pourcentage (0 par défaut). */
  demandSurgePercent?: number;
  /** Grille utilisée. Par défaut celle de domain/rules.ts ; la base peut en publier une version. */
  tariff?: TariffGrid;
}

/** Calcule le prix ferme et sa décomposition. */
export function computeFare(input: FareInput): Fare {
  if (input.distanceM < 0 || input.durationS < 0) {
    throw new Error('Distance et durée ne peuvent pas être négatives.');
  }

  const grid = input.tariff ?? TARIFFS[input.offer];
  const kilometres = input.distanceM / 1000;
  const minutes = input.durationS / 60;

  // 1. Les trois lignes de base, arrondies au franc chacune.
  const base = Math.round(grid.baseFare);
  const distance = Math.round(grid.perKm * kilometres);
  const time = Math.round(grid.perMin * minutes);

  const lines: FareLine[] = [{ key: 'base', label: 'Prise en charge', amount: base }];
  if (distance > 0) {
    lines.push({
      key: 'distance',
      label: `Distance · ${kilometres.toFixed(1).replace('.', ',')} km`,
      amount: distance,
    });
  }
  // La moto ne facture pas le temps : la ligne n'apparaît pas plutôt que d'afficher 0 F.
  if (grid.perMin > 0 && time > 0) {
    lines.push({
      key: 'time',
      label: `Temps · ${Math.round(minutes)} min`,
      amount: time,
    });
  }

  // 2. Plancher : aucune course en dessous du minimum de l'offre.
  const computed = base + distance + time;
  const baseAmount = Math.max(grid.minimumFare, computed);
  if (baseAmount > computed) {
    lines.push({
      key: 'minimum',
      label: 'Ajustement au tarif minimum',
      amount: baseAmount - computed,
    });
  }

  // 3. Majorations, en lignes séparées et visibles.
  const night = isNight(input.at);
  const demandSurgePercent = Math.min(
    Math.max(Math.round(input.demandSurgePercent ?? 0), 0),
    DEMAND_SURGE_MAX_PERCENT,
  );

  let total = baseAmount;

  if (night) {
    const amount = Math.round((baseAmount * NIGHT_SURGE_PERCENT) / 100);
    lines.push({ key: 'night', label: `Majoration de nuit · +${NIGHT_SURGE_PERCENT} %`, amount });
    total += amount;
  }

  if (demandSurgePercent > 0) {
    const amount = Math.round((baseAmount * demandSurgePercent) / 100);
    lines.push({
      key: 'demand',
      label: `Forte demande · +${demandSurgePercent} %`,
      amount,
    });
    total += amount;
  }

  // 4. Plafond global : le total ne dépasse jamais 1,5 × le prix de base.
  const cap = Math.round((baseAmount * TOTAL_SURGE_CAP_PERCENT) / 100);
  const capped = total > cap;
  if (capped) {
    lines.push({ key: 'cap', label: 'Plafond VORA appliqué', amount: cap - total });
    total = cap;
  }

  return {
    offer: input.offer,
    baseAmount,
    lines,
    total,
    currency: 'XAF',
    night,
    demandSurgePercent,
    capped,
  };
}

/** Ce que le chauffeur garde. Troisième moment de vérité : ce montant doit être exact. */
export interface DriverEarnings {
  gross: number;
  /** 15 % sur les voitures, 50 F fixes en moto. */
  commission: number;
  /** Retenue DGI : 1 % du brut, reversée par VORA. Ligne visible côté chauffeur. */
  dgi: number;
  net: number;
}

export function computeDriverEarnings(gross: number, offer: Offer): DriverEarnings {
  const commission =
    offer === 'moto'
      ? COMMISSION_FLAT_MOTO
      : Math.round((gross * COMMISSION_PERCENT_CAR) / 100);
  const dgi = Math.round((gross * DGI_PERCENT) / 100);

  return { gross, commission, dgi, net: gross - commission - dgi };
}

/** Espace fine insécable, imposée par la charte pour les montants (CLAUDE.md § 6.2). */
const NARROW_NBSP = ' ';

/** « 1 625 F » dans l'interface, « 1 625 FCFA » sur les reçus. */
export function formatAmount(amount: number, unit: 'F' | 'FCFA' = 'F'): string {
  const digits = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  return `${amount < 0 ? '−' : ''}${digits}${NARROW_NBSP}${unit}`;
}
