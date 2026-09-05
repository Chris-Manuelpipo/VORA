// VORA — DTO de sortie du module pricing. Aucune entité de base ne sort telle quelle.

import type { Tariff } from '../../db/schema.js';
import { type Fare, formatAmount } from './fare.js';
import type { FareDto, TariffDto } from './schemas.js';

export function toFareDto(fare: Fare): FareDto {
  return {
    offer: fare.offer,
    total: fare.total,
    // Le montant formaté voyage avec le nombre : les trois surfaces affichent la même
    // chose, avec la même espace fine, sans réimplémenter le formatage chacune de leur côté.
    total_formatted: formatAmount(fare.total),
    currency: fare.currency,
    base_amount: fare.baseAmount,
    lines: fare.lines,
    night: fare.night,
    demand_surge_percent: fare.demandSurgePercent,
    capped: fare.capped,
  };
}

export function toTariffDto(tariff: Tariff): TariffDto {
  return {
    offer: tariff.offer,
    version: tariff.version,
    base_fare: tariff.baseFare,
    per_km: tariff.perKm,
    per_min: tariff.perMin,
    minimum_fare: tariff.minimumFare,
    night_surge_percent: tariff.nightSurgePercent,
    demand_surge_max_percent: tariff.demandSurgeMaxPercent,
    total_cap_percent: tariff.totalCapPercent,
    cancel_fee: tariff.cancelFee,
    // La commission et la retenue DGI ne sont PAS ici : c'est l'affaire du chauffeur,
    // elle s'affiche dans son application, pas dans une grille publique.
  };
}
