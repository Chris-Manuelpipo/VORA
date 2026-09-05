// VORA — logique du module pricing : grille, estimation, et LE DEVIS FERME.
//
// Le calcul lui-même est dans fare.ts (fonction pure) ; la signature dans quote.ts
// (fonction pure). Ce service ne fait que les assembler avec ce qui vient du monde
// extérieur : la grille publiée en base, l'itinéraire OSRM, le géorepérage moto, la
// majoration décidée par l'ops, et la présence des chauffeurs pour l'ETA.
//
// L'ORDRE DES OPÉRATIONS N'EST PAS LIBRE (CLAUDE.md § 5.5) : l'itinéraire est calculé
// AVANT le géorepérage, et le géorepérage AVANT qu'une offre moto soit proposée. Une
// course illégale ne doit pas exister, même une seconde, même à l'écran.

import { randomUUID } from 'node:crypto';
import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import {
  OFFERS,
  QUOTE_TTL_S,
  TARIFFS,
  vehicleKindForOffer,
  type Offer,
  type TariffGrid,
} from '../../domain/rules.js';
import type { LatLng } from '../../db/geography.js';
import type { Quote } from '../../db/schema.js';
import { encodePolyline } from '../../lib/polyline.js';
import { isMotoAllowed, MOTO_FORBIDDEN_MESSAGE } from '../geo/service.js';
import { route } from '../geo/routing.js';
import { nearestApproachEtaS } from '../dispatch/service.js';
import { computeFare, formatAmount, type Fare } from './fare.js';
import { signQuote, verifyQuoteSignature, type QuoteSignatureInput } from './quote.js';
import { currentSurgePercent } from './surge.js';
import { toFareDto, toTariffDto } from './dto.js';
import * as repository from './repository.js';
import type {
  CreateQuoteBody,
  CreateQuoteResponse,
  EstimateBody,
  FareDto,
  QuoteOfferDto,
  TariffDto,
} from './schemas.js';

function gridOf(tariff: {
  baseFare: number;
  perKm: number;
  perMin: number;
  minimumFare: number;
}): TariffGrid {
  return {
    baseFare: tariff.baseFare,
    perKm: tariff.perKm,
    perMin: tariff.perMin,
    minimumFare: tariff.minimumFare,
  };
}

/** Grille effective d'une offre : celle publiée en base, sinon celle des règles. */
export async function resolveGrid(
  offer: Offer,
): Promise<{ grid: TariffGrid; tariffId: string | null }> {
  const published = await repository.findActiveTariff(offer);
  return published
    ? { grid: gridOf(published), tariffId: published.id }
    : { grid: TARIFFS[offer], tariffId: null };
}

/**
 * Prix indicatif à partir d'une distance et d'une durée déjà connues.
 *
 * Ce n'est PAS un devis ferme : il n'est ni signé, ni stocké, ni opposable, et on ne
 * peut pas commander dessus. Il sert aux essais et à la page ops. Le prix, lui, sort de
 * la même fonction pure que le devis — les deux chemins ne peuvent pas diverger.
 */
export async function estimate(body: EstimateBody): Promise<FareDto> {
  const { grid } = await resolveGrid(body.offer);

  const fare = computeFare({
    offer: body.offer,
    distanceM: body.distance_m,
    durationS: body.duration_s,
    at: body.at ? new Date(body.at) : new Date(),
    demandSurgePercent: body.demand_surge_percent ?? currentSurgePercent(),
    tariff: grid,
  });

  return toFareDto(fare);
}

export async function listTariffs(): Promise<{ city: string; tariffs: TariffDto[] }> {
  const rows = await repository.listActiveTariffs();
  return { city: 'Yaoundé', tariffs: rows.map(toTariffDto) };
}

// ─── Le devis ferme ──────────────────────────────────────────────────────────

/** Les quatre nombres du contrat mobile, tirés des lignes détaillées. Aucun recalcul. */
function compactBreakdown(fare: Fare): {
  base: number;
  distance: number;
  time: number;
  surge: number;
} {
  const amountOf = (key: string): number =>
    fare.lines.filter((line) => line.key === key).reduce((total, line) => total + line.amount, 0);

  return {
    // L'ajustement au tarif minimum appartient à la prise en charge : c'est ce que le
    // passager comprend (« le minimum de la course »), et le total reste exact.
    base: amountOf('base') + amountOf('minimum'),
    distance: amountOf('distance'),
    time: amountOf('time'),
    // Nuit, forte demande et plafond forment une seule ligne « majorations » côté
    // affichage compact. Le plafond est négatif : il RETIRE, et il doit se voir.
    surge: amountOf('night') + amountOf('demand') + amountOf('cap'),
  };
}

/**
 * Calcule les trois offres pour un trajet, les signe, les stocke, et les fait expirer
 * dans 2 minutes.
 *
 * Un seul appel à OSRM pour les trois offres : le trajet est le même, seule la grille
 * change. Un seul géorepérage aussi — c'est l'itinéraire qui est légal ou non, pas
 * l'offre.
 */
export async function createQuote(
  passengerId: string,
  body: CreateQuoteBody,
): Promise<CreateQuoteResponse> {
  const pickup: LatLng = { lat: body.pickup.lat, lng: body.pickup.lng };
  const dropoff: LatLng = { lat: body.dropoff.lat, lng: body.dropoff.lng };

  // 1. L'itinéraire réel. S'il n'est pas disponible, le repli répond et le dit.
  const routed = await route(pickup, dropoff);

  // 2. Le géorepérage moto, sur l'itinéraire complet, EN BASE (ST_Intersects).
  const motoVerdict = await isMotoAllowed(pickup, dropoff, routed.points);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_S * 1000);
  const surgePercent = currentSurgePercent();

  const offers: QuoteOfferDto[] = [];

  for (const offer of OFFERS) {
    const { grid, tariffId } = await resolveGrid(offer);

    const fare = computeFare({
      offer,
      distanceM: routed.distanceM,
      durationS: routed.durationS,
      // L'heure de la COMMANDE, pas celle de la fin de course (CLAUDE.md § 5.1).
      at: now,
      demandSurgePercent: surgePercent,
      tariff: grid,
    });

    const etaS = nearestApproachEtaS(pickup, vehicleKindForOffer(offer));
    const breakdown = compactBreakdown(fare);

    // L'offre moto refusée par le géorepérage n'est pas masquée : elle est montrée
    // barrée, avec la raison et la zone. Le passager doit comprendre POURQUOI, sinon il
    // pense que l'application est cassée et il rappelle un moto-taxi dans la rue.
    const forbiddenZone = offer === 'moto' && !motoVerdict.allowed ? motoVerdict.zones[0] : null;

    if (forbiddenZone) {
      offers.push({
        offer,
        quoteId: null,
        price: fare.total,
        priceFormatted: formatAmount(fare.total),
        currency: 'XAF',
        etaMin: null,
        breakdown,
        lines: fare.lines,
        night: fare.night,
        surgePercent: fare.demandSurgePercent,
        capped: fare.capped,
        available: false,
        unavailableReason: MOTO_FORBIDDEN_MESSAGE,
        unavailableZoneId: forbiddenZone.id,
        signature: null,
      });
      continue;
    }

    // Sans grille publiée, pas de devis : le devis référence la version tarifaire qui a
    // servi, sinon un changement de tarif réécrirait le prix d'une course passée.
    if (!tariffId) {
      throw new AppError(
        'TARIFF_NOT_FOUND',
        "La grille tarifaire n'est pas publiée. Lancez `npm run seed` avant de commander.",
        { offer },
      );
    }

    // L'identifiant est tiré ICI : la signature le couvre, donc il doit exister avant
    // l'insertion. Un devis dont l'identifiant ne serait pas signé pourrait être
    // rejoué sur un autre trajet.
    const quoteId = randomUUID();
    const signatureInput: QuoteSignatureInput = {
      quoteId,
      passengerId,
      offer,
      tariffId,
      pickup,
      dropoff,
      distanceM: routed.distanceM,
      durationS: routed.durationS,
      price: fare.total,
      night: fare.night,
      surgePercent: fare.demandSurgePercent,
      expiresAt: expiresAt.toISOString(),
    };
    const signature = signQuote(signatureInput, config.QUOTE_HMAC_SECRET);

    await repository.insertQuote({
      id: quoteId,
      passengerId,
      offer,
      tariffId,
      pickup,
      pickupLabel: body.pickup.label ?? null,
      dropoff,
      dropoffLabel: body.dropoff.label ?? null,
      route: routed.points,
      distanceM: routed.distanceM,
      durationS: routed.durationS,
      routing: routed.routing,
      breakdown: { lines: fare.lines, compact: breakdown },
      price: fare.total,
      night: fare.night,
      surgePercent: fare.demandSurgePercent,
      signature,
      expiresAt,
    });

    offers.push({
      offer,
      quoteId,
      price: fare.total,
      priceFormatted: formatAmount(fare.total),
      currency: 'XAF',
      etaMin: etaS === null ? null : Math.max(1, Math.round(etaS / 60)),
      breakdown,
      lines: fare.lines,
      night: fare.night,
      surgePercent: fare.demandSurgePercent,
      capped: fare.capped,
      available: true,
      unavailableReason: null,
      unavailableZoneId: null,
      signature,
    });
  }

  return {
    expiresAt: expiresAt.toISOString(),
    expiresInS: QUOTE_TTL_S,
    routing: routed.routing,
    distanceKm: Math.round(routed.distanceM / 100) / 10,
    durationMin: Math.max(1, Math.round(routed.durationS / 60)),
    routePolyline: encodePolyline(routed.points),
    offers,
  };
}

// ─── Consommation du devis à la commande ─────────────────────────────────────

/**
 * Vérifie un devis et le consomme, une fois pour toutes. C'est le module `rides` qui
 * appelle ceci — il n'écrit jamais dans `quotes` lui-même (CLAUDE.md § 7).
 *
 * Quatre refus possibles, et chacun a son code métier parce que l'appli n'affiche pas
 * la même chose :
 *   NOT_FOUND      le devis n'existe pas
 *   FORBIDDEN      il appartient à quelqu'un d'autre
 *   QUOTE_EXPIRED  les 2 minutes sont passées → l'appli redemande un prix
 *   QUOTE_TAMPERED la signature ne colle pas → on ne commande pas là-dessus
 *   CONFLICT       il a déjà servi à créer une course
 */
export async function redeemQuote(input: {
  quoteId: string;
  passengerId: string;
  offer: Offer;
}): Promise<Quote> {
  const quote = await repository.findQuoteById(input.quoteId);

  if (!quote) {
    throw new AppError('NOT_FOUND', "Ce devis n'existe plus. Demandez un nouveau prix.");
  }

  if (quote.passengerId !== input.passengerId) {
    throw new AppError('FORBIDDEN', "Ce devis n'est pas le vôtre. Demandez un nouveau prix.");
  }

  if (quote.offer !== input.offer) {
    throw new AppError(
      'CONFLICT',
      "L'offre choisie ne correspond pas à ce devis. Reprenez votre choix.",
      { expected: quote.offer, received: input.offer },
    );
  }

  if (quote.expiresAt.getTime() <= Date.now()) {
    throw new AppError(
      'QUOTE_EXPIRED',
      'Le prix affiché a expiré. Nous en calculons un nouveau.',
      { expired_at: quote.expiresAt.toISOString() },
    );
  }

  const valid = verifyQuoteSignature(
    {
      quoteId: quote.id,
      passengerId: quote.passengerId,
      offer: quote.offer,
      tariffId: quote.tariffId,
      pickup: quote.pickup,
      dropoff: quote.dropoff,
      distanceM: quote.distanceM,
      durationS: quote.durationS,
      price: quote.price,
      night: quote.night,
      surgePercent: quote.surgePercent,
      expiresAt: quote.expiresAt.toISOString(),
    },
    quote.signature,
    config.QUOTE_HMAC_SECRET,
  );

  if (!valid) {
    throw new AppError(
      'QUOTE_TAMPERED',
      "Ce prix ne peut pas être vérifié. Par sécurité, nous en recalculons un.",
    );
  }

  const consumed = await repository.consumeQuote(quote.id);
  if (!consumed) {
    throw new AppError(
      'CONFLICT',
      'Ce devis a déjà servi à créer une course. Ouvrez votre course en cours.',
    );
  }

  return consumed;
}
