// VORA — les journées se comptent à Yaoundé, pas en UTC.
//
// « Les gains d'aujourd'hui », « les courses du jour » : un chauffeur qui roule à 23 h
// verrait ses chiffres basculer au lendemain sous ses yeux si on comptait en UTC. Le
// décalage est d'une heure seulement, mais c'est justement l'heure la plus chargée.

import { CITY_TIMEZONE } from '../domain/rules.js';

/** Yaoundé est à UTC+1 toute l'année : le Cameroun ne change pas d'heure. */
export const CITY_UTC_OFFSET_MS = 3600 * 1000;

export const DAY_MS = 24 * 3600 * 1000;

/** Minuit à Yaoundé, exprimé en instant absolu. */
export function startOfCityDay(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CITY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);

  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - CITY_UTC_OFFSET_MS);
}
