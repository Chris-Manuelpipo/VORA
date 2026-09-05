// VORA — les six scénarios de démonstration (CLAUDE.md § 8.2).
//
// Un scénario ne joue PAS la démonstration à la place du présentateur : il met la scène
// en place, et rend le mode d'emploi. C'est délibéré. Ce que le jury doit voir, c'est un
// humain qui commande une course sur un vrai téléphone et le produit qui répond — pas un
// film qui se déroule tout seul.
//
// Chaque scénario rend donc un `script` : les gestes à faire sur le téléphone pour que
// la scène ait lieu. Le présentateur lit trois lignes, il n'improvise pas devant le jury.

import type { LatLng } from '../db/geography.js';
import { DEMAND_SURGE_MAX_PERCENT } from '../domain/rules.js';
import { setSurge } from '../modules/pricing/surge.js';
import * as simulator from './simulator.js';

export const SCENARIOS = [
  'nominal',
  'aucun_chauffeur',
  'annulation_tardive',
  'pluie',
  'moto_zone_interdite',
  'sos',
] as const;

export type ScenarioName = (typeof SCENARIOS)[number];

export interface ScenarioResult {
  scenario: ScenarioName;
  /** Ce que le scénario vient de faire côté serveur. */
  applied: string[];
  /** Ce que le présentateur doit faire sur le téléphone. */
  script: string[];
  /** Ce que le jury doit voir. La phrase qui justifie le scénario. */
  expect: string;
}

/** Carrefour Melen — départ légal, à deux pas du centre interdit aux motos. */
const MELEN: LatLng = { lat: 3.8541, lng: 11.4872 };

export async function applyScenario(name: ScenarioName): Promise<ScenarioResult> {
  simulator.setScenario(name);

  switch (name) {
    case 'nominal':
      return nominal();
    case 'aucun_chauffeur':
      return aucunChauffeur();
    case 'annulation_tardive':
      return annulationTardive();
    case 'pluie':
      return pluie();
    case 'moto_zone_interdite':
      return motoZoneInterdite();
    case 'sos':
      return sos();
  }
}

async function nominal(): Promise<ScenarioResult> {
  setSurge({ percent: 0, reason: null, setBy: 'demo' });
  await simulator.setFleetOnline(true);

  return {
    scenario: 'nominal',
    applied: [
      'Les 12 chauffeurs sont en ligne et roulent sur de vrais itinéraires.',
      'Aucune majoration.',
    ],
    script: [
      'Commandez une course Éco entre deux repères de Yaoundé.',
      'Montrez le prix ferme et sa décomposition AVANT de commander.',
      'Le chauffeur le mieux placé accepte en 4 à 8 secondes.',
      'Lisez le code de montée à 4 chiffres sur l’écran du passager.',
    ],
    expect:
      'Le prix affiché avant la commande est celui du reçu, au franc près, et le chauffeur voit son net avant d’accepter.',
  };
}

async function aucunChauffeur(): Promise<ScenarioResult> {
  // La flotte passe HORS LIGNE plutôt que de refuser une à une : trois vagues de refus
  // prendraient deux minutes, et la démonstration en dure cinq. La carte se vide — c'est
  // précisément le scénario.
  await simulator.setFleetOnline(false);

  return {
    scenario: 'aucun_chauffeur',
    applied: ['Les 12 chauffeurs sont hors ligne. La carte est vide, volontairement.'],
    script: [
      'Commandez une course normalement.',
      'Laissez les trois vagues du dispatch se dérouler.',
      'Reprenez ensuite avec le scénario « nominal » pour repeupler la carte.',
    ],
    expect:
      'La course passe en « expirée » avec DEUX SORTIES offertes — « Attendre 2 min » et « Réessayer » — jamais un spinner muet.',
  };
}

async function annulationTardive(): Promise<ScenarioResult> {
  await simulator.setFleetOnline(true);

  return {
    scenario: 'annulation_tardive',
    applied: [
      'La flotte est en ligne.',
      'Dès qu’un chauffeur accepte, son heure d’acceptation est reculée de 3 minutes.',
    ],
    script: [
      'Commandez une course et laissez un chauffeur accepter.',
      'Attendez quelques secondes qu’il se mette en route.',
      'Ouvrez le bouton « Annuler » : son libellé a changé.',
    ],
    expect:
      'Le bouton dit la vérité du moment : « Annuler · 300 F reversés à … ». Les frais sont crédités INTÉGRALEMENT au chauffeur, sans commission ni retenue.',
  };
}

async function pluie(): Promise<ScenarioResult> {
  await simulator.setFleetOnline(true);
  setSurge({
    percent: DEMAND_SURGE_MAX_PERCENT,
    reason: 'Pluie sur Yaoundé',
    setBy: 'demo',
  });

  return {
    scenario: 'pluie',
    applied: [`Majoration forte demande activée à ${DEMAND_SURGE_MAX_PERCENT} %.`],
    script: [
      'Demandez un prix pour un trajet — notez-le.',
      'Montrez la ligne « Forte demande » dans le détail du prix.',
      'Repassez au scénario « nominal » pour couper la majoration.',
    ],
    expect:
      'La majoration apparaît en LIGNE SÉPARÉE, jamais fondue dans le total, et le plafond global × 1,5 n’est jamais dépassé.',
  };
}

async function motoZoneInterdite(): Promise<ScenarioResult> {
  await simulator.setFleetOnline(true);
  // Des motos VISIBLES à quelques centaines de mètres du départ : sans elles, le jury
  // pourrait croire que l'offre est refusée faute de chauffeur, alors que c'est la loi
  // qui la refuse. La démonstration ne tient que si la moto est à l'écran.
  const motos = await simulator.gatherMotosNear(MELEN);

  return {
    scenario: 'moto_zone_interdite',
    applied: [`${motos} motos rapprochées du Carrefour Melen, et visibles sur la carte.`],
    script: [
      'Départ : Carrefour Melen. Arrivée : Marché Central.',
      'Demandez le prix — les trois offres s’affichent.',
      'Montrez l’offre Moto : elle est barrée, avec sa raison et la zone sur la carte.',
    ],
    expect:
      '« L’arrivée est en zone interdite aux motos (arrêté préfectoral). » Des motos sont pourtant disponibles à 400 m : ce n’est pas une pénurie, c’est un refus réglementaire, vérifié en base par ST_Intersects avant même de chercher un chauffeur.',
  };
}

async function sos(): Promise<ScenarioResult> {
  await simulator.setFleetOnline(true);

  return {
    scenario: 'sos',
    applied: [
      'La flotte est en ligne.',
      'Le chauffeur simulé déclenchera un SOS dès son arrivée au point de rendez-vous.',
    ],
    script: [
      'Ouvrez la page d’administration à côté du téléphone.',
      'Commandez une course et laissez le chauffeur arriver.',
      'Le SOS remonte à l’ops en direct.',
    ],
    expect:
      'L’alerte arrive sur la page ops avec la plaque et la position — et AUCUN numéro de téléphone. La course, elle, continue : un SOS ne change pas son statut.',
  };
}
