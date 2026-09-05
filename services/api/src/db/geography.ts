// VORA — colonnes PostGIS pour Drizzle.
//
// Le géorepérage moto est un `ST_Intersects` EN BASE, pas une approximation côté appli
// (CLAUDE.md § 3). Les colonnes sont donc de vrais `geography(...,4326)`, et non des
// couples de `double precision`.
//
// Sens de lecture : PostgreSQL renvoie du EWKB hexadécimal, on le décode ici ;
// sens d'écriture : on envoie du EWKT, que PostGIS accepte tel quel en paramètre.
// Convention interne : { lat, lng } — c'est ce que parlent les applis. L'ordre EWKT,
// lui, est lng puis lat : la confusion est le bug géo classique, elle est confinée ici.

import { customType } from 'drizzle-orm/pg-core';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Un anneau de polygone : le premier est l'extérieur, les suivants sont des trous. */
export type Ring = LatLng[];

const SRID = 4326;

function coordinate(point: LatLng): string {
  return `${point.lng} ${point.lat}`;
}

/** Ferme l'anneau si l'appelant a oublié de répéter le premier point — PostGIS l'exige. */
function closeRing(ring: Ring): Ring {
  if (ring.length < 3) {
    throw new Error('Un anneau de polygone demande au moins 3 points.');
  }
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first.lat === last.lat && first.lng === last.lng ? ring : [...ring, first];
}

export function pointToEwkt(point: LatLng): string {
  return `SRID=${SRID};POINT(${coordinate(point)})`;
}

export function lineToEwkt(points: LatLng[]): string {
  if (points.length < 2) throw new Error('Une ligne demande au moins 2 points.');
  return `SRID=${SRID};LINESTRING(${points.map(coordinate).join(',')})`;
}

export function polygonToEwkt(rings: Ring[]): string {
  if (rings.length === 0) throw new Error('Un polygone demande au moins un anneau.');
  const body = rings.map((ring) => `(${closeRing(ring).map(coordinate).join(',')})`).join(',');
  return `SRID=${SRID};POLYGON(${body})`;
}

// ─── Décodage EWKB ───────────────────────────────────────────────────────────

const WKB_POINT = 1;
const WKB_LINESTRING = 2;
const WKB_POLYGON = 3;
const WKB_SRID_FLAG = 0x20000000;

interface Reader {
  buffer: Buffer;
  offset: number;
  littleEndian: boolean;
}

function readUint32(reader: Reader): number {
  const value = reader.littleEndian
    ? reader.buffer.readUInt32LE(reader.offset)
    : reader.buffer.readUInt32BE(reader.offset);
  reader.offset += 4;
  return value;
}

function readDouble(reader: Reader): number {
  const value = reader.littleEndian
    ? reader.buffer.readDoubleLE(reader.offset)
    : reader.buffer.readDoubleBE(reader.offset);
  reader.offset += 8;
  return value;
}

function readPoint(reader: Reader): LatLng {
  const lng = readDouble(reader);
  const lat = readDouble(reader);
  return { lat, lng };
}

/** Lit l'en-tête d'une géométrie (boutisme, type, SRID éventuel) et renvoie son type nu. */
function readHeader(reader: Reader): number {
  reader.littleEndian = reader.buffer.readUInt8(reader.offset) === 1;
  reader.offset += 1;
  const rawType = readUint32(reader);
  if ((rawType & WKB_SRID_FLAG) !== 0) readUint32(reader); // SRID : toujours 4326 ici
  return rawType & 0xff;
}

function decode(hex: string): LatLng | LatLng[] | Ring[] {
  const reader: Reader = { buffer: Buffer.from(hex, 'hex'), offset: 0, littleEndian: true };
  const type = readHeader(reader);

  if (type === WKB_POINT) return readPoint(reader);

  if (type === WKB_LINESTRING) {
    const count = readUint32(reader);
    const points: LatLng[] = [];
    for (let i = 0; i < count; i += 1) points.push(readPoint(reader));
    return points;
  }

  if (type === WKB_POLYGON) {
    const ringCount = readUint32(reader);
    const rings: Ring[] = [];
    for (let r = 0; r < ringCount; r += 1) {
      const pointCount = readUint32(reader);
      const ring: Ring = [];
      for (let i = 0; i < pointCount; i += 1) ring.push(readPoint(reader));
      rings.push(ring);
    }
    return rings;
  }

  throw new Error(
    `Géométrie WKB de type ${type} non gérée. Les colonnes VORA sont Point, LineString ou Polygon.`,
  );
}

/** PostGIS renvoie parfois un Buffer, parfois une chaîne hexadécimale. */
function ewkbToHex(value: unknown): string {
  if (typeof value === 'string') return value.startsWith('\\x') ? value.slice(2) : value;
  if (Buffer.isBuffer(value)) return value.toString('hex');
  throw new Error('Géométrie PostGIS illisible : ni chaîne hexadécimale, ni Buffer.');
}

/** Exposé pour les tests : décode une chaîne EWKB hexadécimale de PostGIS. */
export function decodeEwkbHex(hex: string): LatLng | LatLng[] | Ring[] {
  return decode(ewkbToHex(hex));
}

// ─── Types de colonnes ───────────────────────────────────────────────────────

export const geographyPoint = customType<{
  data: LatLng;
  driverData: string;
  config: undefined;
}>({
  dataType: () => `geography(Point,${SRID})`,
  toDriver: (value) => pointToEwkt(value),
  fromDriver: (value) => decode(ewkbToHex(value)) as LatLng,
});

export const geographyLineString = customType<{
  data: LatLng[];
  driverData: string;
  config: undefined;
}>({
  dataType: () => `geography(LineString,${SRID})`,
  toDriver: (value) => lineToEwkt(value),
  fromDriver: (value) => decode(ewkbToHex(value)) as LatLng[],
});

export const geographyPolygon = customType<{
  data: Ring[];
  driverData: string;
  config: undefined;
}>({
  dataType: () => `geography(Polygon,${SRID})`,
  toDriver: (value) => polygonToEwkt(value),
  fromDriver: (value) => decode(ewkbToHex(value)) as Ring[],
});
