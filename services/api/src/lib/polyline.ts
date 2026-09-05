// VORA — polylignes encodées (algorithme Google, précision 5).
//
// C'est le format que renvoie OSRM par défaut et celui que `flutter_map` sait relire.
// Trente lignes ici évitent une dépendance de plus dans une APK qu'on veut légère.
//
// Le serveur a besoin des DEUX sens :
//   · décoder — l'itinéraire d'OSRM devient une suite de points, qu'on donne à PostGIS
//     pour le géorepérage moto (`ST_Intersects`) et qu'on stocke en geography(LineString) ;
//   · encoder — le repli haversine fabrique un segment droit, et le client doit le
//     recevoir dans le même format que l'itinéraire réel, sans savoir lequel il tient.
//
// Principe : chaque coordonnée est un delta par rapport à la précédente, multiplié par
// 1e5, arrondi, en complément à deux, découpé en tranches de 5 bits, chaque tranche
// décalée de 63 pour tomber dans l'ASCII imprimable.

import type { LatLng } from '../db/geography.js';

const PRECISION = 1e5;

function encodeSignedValue(value: number, output: string[]): void {
  // Décalage à gauche d'un bit, puis inversion des bits si négatif : le signe passe
  // dans le bit de poids faible, ce qui rend les petits deltas négatifs aussi courts
  // que les positifs.
  let remaining = value < 0 ? ~(value << 1) : value << 1;

  while (remaining >= 0x20) {
    output.push(String.fromCharCode((0x20 | (remaining & 0x1f)) + 63));
    remaining >>= 5;
  }
  output.push(String.fromCharCode(remaining + 63));
}

/** Encode une suite de points en polyligne. Une liste vide donne une chaîne vide. */
export function encodePolyline(points: LatLng[]): string {
  const output: string[] = [];
  let previousLat = 0;
  let previousLng = 0;

  for (const point of points) {
    // On arrondit AVANT de faire la différence, sinon les erreurs d'arrondi
    // s'accumulent le long de la ligne.
    const lat = Math.round(point.lat * PRECISION);
    const lng = Math.round(point.lng * PRECISION);
    encodeSignedValue(lat - previousLat, output);
    encodeSignedValue(lng - previousLng, output);
    previousLat = lat;
    previousLng = lng;
  }

  return output.join('');
}

/**
 * Décode une polyligne. Une chaîne vide donne une liste vide ; une chaîne tronquée
 * s'arrête proprement plutôt que de fabriquer un point aberrant — un itinéraire
 * incomplet doit se voir comme tel, pas se deviner.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    const deltas: number[] = [];

    for (let axis = 0; axis < 2; axis += 1) {
      let result = 0;
      let shift = 0;
      let byte: number;

      do {
        if (index >= encoded.length) return points; // chaîne tronquée
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      deltas.push(result & 1 ? ~(result >> 1) : result >> 1);
    }

    lat += deltas[0]!;
    lng += deltas[1]!;
    points.push({ lat: lat / PRECISION, lng: lng / PRECISION });
  }

  return points;
}
