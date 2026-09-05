// VORA — encaissement. Espèces réelles, Mobile Money SIMULÉ (CLAUDE.md § 3 et § 8.2).
//
// Ce qui est simulé : l'appel à l'opérateur. Trois secondes d'attente, puis un succès.
// Ce qui ne l'est PAS : l'interface `PaymentProvider`, l'intention de paiement en base,
// la transition de la course, le crédit du chauffeur, et la dette d'espèces. Brancher
// MTN MoMo ou Orange Money, c'est écrire une seconde implémentation de `PaymentProvider`
// et des identifiants opérateur — pas retoucher cette logique.
//
// Ce module n'écrit que dans `payment_intents`. Le passage `completed` → `paid` est
// demandé au service `rides`, qui possède la machine à états.

import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import type { PaymentMethod } from '../../db/schema.js';
import { formatAmount } from '../pricing/fare.js';
import * as rides from '../rides/service.js';
import * as repository from './repository.js';
import { PAYMENT_METHODS } from './repository.js';
import type { MobileMoneyResponse, PaymentMethodsResponse } from './schemas.js';

export interface PaymentRequest {
  rideId: string;
  amount: number;
  /** Le numéro n'arrive JAMAIS ici en clair : l'adaptateur n'en a pas besoin (§ 5.6). */
  phoneMasked: string;
}

export interface PaymentResult {
  status: 'paid' | 'failed';
  providerRef: string;
}

export interface PaymentProvider {
  readonly name: 'simulated';
  requestToPay(request: PaymentRequest): Promise<PaymentResult>;
}

export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = 'simulated' as const;

  async requestToPay(request: PaymentRequest): Promise<PaymentResult> {
    await new Promise((resolve) => setTimeout(resolve, config.PAYMENT_SIMULATED_DELAY_MS));
    return {
      status: 'paid',
      providerRef: `sim_${request.rideId.slice(0, 8)}`,
    };
  }
}

export const paymentProvider: PaymentProvider = new SimulatedPaymentProvider();

export function listMethods(): PaymentMethodsResponse {
  return {
    provider: paymentProvider.name,
    methods: [...PAYMENT_METHODS],
    simulated_delay_ms: config.PAYMENT_SIMULATED_DELAY_MS,
  };
}

// ─── Espèces ─────────────────────────────────────────────────────────────────

/**
 * Le chauffeur confirme avoir reçu l'argent. C'est LUI qui déclare, parce que c'est lui
 * qui tient les billets — et c'est aussi lui qui devra la commission et la retenue DGI
 * à VORA ensuite (`cash_debt`).
 *
 * Une intention de paiement est écrite malgré tout, alors qu'aucun fournisseur n'est en
 * jeu : la course payée en espèces doit laisser la même trace que les autres, sinon la
 * comptabilité de la journée a deux formes selon le moyen de paiement.
 */
export async function confirmCash(rideId: string, driverId: string) {
  const ride = await rides.payableRide(rideId);
  if (!ride) throw new AppError('NOT_FOUND', 'Cette course est introuvable.');
  if (ride.driverId !== driverId) {
    throw new AppError('FORBIDDEN', "Cette course n'est pas la vôtre.");
  }

  const { amount } = ride;
  const intent = await repository.createIntent({
    rideId,
    method: 'cash',
    amount,
    provider: 'cash',
  });
  await repository.settleIntent(intent.id, 'succeeded', null);

  // La transition appartient à `rides` : c'est lui qui refusera si la course n'est pas
  // `completed`, avec INVALID_TRANSITION et sans rien écrire.
  await rides.markPaid({
    rideId,
    method: 'cash',
    providerRef: null,
    actorId: driverId,
    actorType: 'driver',
  });

  return rides.getRide(rideId, { id: driverId, role: 'driver' });
}

// ─── Mobile Money (simulé) ───────────────────────────────────────────────────

/**
 * Le passager paie par Mobile Money. L'attente de 3 s est celle de l'adaptateur simulé,
 * réglable par `PAYMENT_SIMULATED_DELAY_MS` — la vraie API MoMo répond en quelques
 * secondes elle aussi, et l'écran d'attente du passager est donc déjà le bon.
 *
 * Réponse au contrat mobile : `{intentId, status}` avec le vocabulaire du fournisseur
 * (`pending` / `succeeded` / `failed`), pas celui de la course.
 */
export async function payWithMobileMoney(
  rideId: string,
  passengerId: string,
): Promise<MobileMoneyResponse> {
  const ride = await rides.payableRide(rideId);
  if (!ride) throw new AppError('NOT_FOUND', 'Cette course est introuvable.');
  if (ride.passengerId !== passengerId) {
    throw new AppError('FORBIDDEN', "Cette course n'est pas la vôtre.");
  }

  // Rejouable sans danger : si le paiement a déjà abouti, on rend la même réponse plutôt
  // que de déclencher une seconde demande de paiement chez l'opérateur.
  const already = await repository.findSucceededIntent(rideId);
  if (already) {
    return {
      intentId: already.id,
      status: 'succeeded',
      amount: already.amount,
      amountFormatted: formatAmount(already.amount, 'FCFA'),
    };
  }

  const { amount } = ride;
  const intent = await repository.createIntent({
    rideId,
    method: 'mobile_money',
    amount,
    provider: paymentProvider.name,
  });

  const result = await paymentProvider.requestToPay({
    rideId,
    amount,
    phoneMasked: '••• ••• ••',
  });

  if (result.status !== 'paid') {
    await repository.settleIntent(intent.id, 'failed', result.providerRef);
    throw new AppError(
      'PAYMENT_FAILED',
      "Le paiement n'a pas abouti. Réessayez, ou réglez la course en espèces.",
      { intentId: intent.id },
    );
  }

  await repository.settleIntent(intent.id, 'succeeded', result.providerRef);

  const method: PaymentMethod = 'mobile_money';
  await rides.markPaid({
    rideId,
    method,
    providerRef: result.providerRef,
    actorId: passengerId,
    actorType: 'passenger',
  });

  return {
    intentId: intent.id,
    status: 'succeeded',
    amount,
    amountFormatted: formatAmount(amount, 'FCFA'),
  };
}
