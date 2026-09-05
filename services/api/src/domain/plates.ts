// VORA — plaques d'immatriculation camerounaises.
//
// Forme courante : deux lettres de région, trois ou quatre chiffres, deux lettres.
// « CE 4821 AB » (CE = Centre, dont Yaoundé ; LT = Littoral ; OU = Ouest ; NO = Nord…).
// On stocke sans espaces et en majuscules pour que la recherche et l'unicité soient
// exactes, et on remet les espaces à l'affichage : c'est ce que le passager compare
// à la voiture qui se gare devant lui.

import { AppError } from '../lib/errors.js';

const PLATE_PATTERN = /^([A-Z]{2})(\d{2,4})([A-Z]{2})$/;

/** « ce 4821-ab » → « CE4821AB ». */
export function normalizePlate(raw: string): string {
  const compact = raw.toUpperCase().replace(/[\s.\-]/g, '');
  if (!PLATE_PATTERN.test(compact)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Cette plaque ne ressemble pas à une plaque camerounaise. Exemple : CE 4821 AB.',
      { received: raw },
    );
  }
  return compact;
}

/** « CE4821AB » → « CE 4821 AB ». Toujours utilisé pour l'affichage, jamais pour stocker. */
export function formatPlate(plate: string): string {
  const match = PLATE_PATTERN.exec(plate);
  if (!match) return plate;
  return `${match[1]} ${match[2]} ${match[3]}`;
}
