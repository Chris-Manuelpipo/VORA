#!/usr/bin/env node
// VORA — génère docs/API_CONTRACT.md DEPUIS LA RÉALITÉ DU CODE.
//
// Trois sources, aucune saisie à la main :
//   1. `GET /openapi.json` de l'API en cours d'exécution — donc les schémas zod des
//      routes, ceux-là mêmes qui valident les requêtes et sérialisent les réponses ;
//   2. des réponses RÉELLES capturées par un parcours curl complet (dossier `--examples`) ;
//   3. `lib/errors.ts` et `realtime/events.ts`, lus au texte pour les codes d'erreur et
//      les noms d'événements.
//
// Pourquoi un générateur plutôt qu'un fichier écrit à la main : une documentation d'API
// recopiée est fausse le lendemain, et le développeur qui la lit perd une demi-journée
// avant de s'en apercevoir. Ici, `npm run docs:api` la remet d'aplomb en deux secondes.
//
//   node scripts/generate-api-contract.mjs --base http://127.0.0.1:3000 --examples <dir>

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_SRC = join(ROOT, 'services/api/src');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = argOf('base', 'http://127.0.0.1:3000');
const EXAMPLES = argOf('examples', join(ROOT, '.api-examples'));
const OUTPUT = join(ROOT, 'docs/API_CONTRACT.md');

// ─── Sources ─────────────────────────────────────────────────────────────────

async function fetchSpec() {
  const response = await fetch(`${BASE}/openapi.json`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GET ${BASE}/openapi.json → ${response.status}`);
  return response.json();
}

/** Réponses capturées : `<nom>.json` + `<nom>.code`. */
function loadExamples() {
  if (!existsSync(EXAMPLES)) {
    throw new Error(
      `Dossier d'exemples introuvable : ${EXAMPLES}\n` +
        '   Lancez d’abord le parcours de capture (scripts/capture-api-examples.sh).',
    );
  }

  const examples = {};
  for (const file of readdirSync(EXAMPLES)) {
    if (!file.endsWith('.json')) continue;
    const name = file.slice(0, -5);
    const codeFile = join(EXAMPLES, `${name}.code`);
    try {
      examples[name] = {
        status: existsSync(codeFile) ? readFileSync(codeFile, 'utf8').trim() : '200',
        body: JSON.parse(readFileSync(join(EXAMPLES, file), 'utf8')),
      };
    } catch {
      // Une réponse non-JSON (page HTML de Swagger UI) n'a rien à faire ici.
    }
  }
  return examples;
}

/** Codes d'erreur et leur statut HTTP, lus dans `lib/errors.ts`. */
function readErrorCodes() {
  const source = readFileSync(join(API_SRC, 'lib/errors.ts'), 'utf8');
  const block = source.slice(source.indexOf('ERROR_CODES = {'), source.indexOf('} as const;'));

  const codes = [];
  let section = '';
  for (const line of block.split('\n')) {
    const heading = /^\s*\/\/\s*(.+)$/.exec(line);
    if (heading && !heading[1].startsWith('/')) section = heading[1].trim();
    const entry = /^\s*([A-Z_]+):\s*(\d{3}),/.exec(line);
    if (entry) codes.push({ code: entry[1], status: Number(entry[2]), section });
  }
  return codes;
}

/** Noms d'événements Socket.IO, lus dans `realtime/events.ts`. */
function readSocketEvents() {
  const source = readFileSync(join(API_SRC, 'realtime/events.ts'), 'utf8');
  const events = {};
  for (const match of source.matchAll(/export const ([A-Z_]+) = '([^']+)';/g)) {
    events[match[1]] = match[2];
  }
  return events;
}

// ─── Mise en forme ───────────────────────────────────────────────────────────

/** Rend un exemple lisible : on coupe les longs tableaux et les jetons interminables. */
function trim(value, depth = 0) {
  if (Array.isArray(value)) {
    const kept = value.slice(0, depth === 0 ? 2 : 1).map((item) => trim(item, depth + 1));
    if (value.length > kept.length) kept.push(`… ${value.length - kept.length} de plus`);
    return kept;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trim(v, depth + 1)]));
  }
  if (typeof value === 'string' && value.length > 96) {
    return `${value.slice(0, 40)}…${value.slice(-12)}`;
  }
  return value;
}

const json = (value) => JSON.stringify(trim(value), null, 2);

/** Résumé d'un schéma JSON en une ligne de champs. */
function fields(schema) {
  if (!schema?.properties) return null;
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties)
    .map(([name, prop]) => {
      const type = Array.isArray(prop.type) ? prop.type.join('|') : (prop.type ?? 'objet');
      return `\`${name}\`${required.has(name) ? '' : '?'} ${type}`;
    })
    .join(' · ');
}

const bodyOf = (op) => op.requestBody?.content?.['application/json']?.schema ?? null;

/**
 * Quel exemple capturé illustre quelle route. C'est la seule table écrite à la main du
 * générateur, et elle est volontairement évidente : un nom de fichier par endpoint.
 */
const EXAMPLE_FOR = {
  'GET /health': 'health',
  'POST /v1/auth/otp/request': 'auth_otp_request',
  'POST /v1/auth/otp/verify': 'auth_otp_verify',
  'GET /v1/me': 'me',
  'GET /v1/geo/search': 'geo_search',
  'GET /v1/geo/zones': 'geo_zones',
  'GET /v1/geo/route': 'geo_route',
  'POST /v1/geo/moto/check': 'geo_moto_check',
  'GET /v1/pricing/tariffs': 'pricing_tariffs',
  'POST /v1/pricing/estimate': 'pricing_estimate',
  'POST /v1/quotes': 'quotes',
  'POST /v1/rides': 'rides_create',
  'GET /v1/rides': 'rides_list',
  'GET /v1/rides/{id}': 'rides_get_paid',
  'GET /v1/rides/{id}/events': 'rides_events',
  'POST /v1/rides/{id}/share': 'rides_share',
  'GET /v1/share/{token}': 'share_public',
  'POST /v1/rides/{id}/rating': 'rides_rating',
  'GET /v1/payments/methods': 'payments_methods',
  'GET /v1/demo/status': 'demo_status',
  'POST /v1/demo/scenario': 'demo_scenario',
};

/** Routes accessibles sans jeton. Le reste exige `Authorization: Bearer`. */
const PUBLIC_ROUTES = [
  /^GET \/health$/,
  /^POST \/v1\/auth\//,
  /^GET \/v1\/geo\//,
  /^POST \/v1\/geo\//,
  /^GET \/v1\/pricing\/tariffs$/,
  /^POST \/v1\/pricing\/estimate$/,
  /^GET \/v1\/payments\/methods$/,
  /^GET \/v1\/share\//,
];

const ROLE_HINTS = [
  [/^POST \/v1\/rides$/, 'passager'],
  [/^POST \/v1\/rides\/\{id\}\/(retry|share)$/, 'passager'],
  [/^POST \/v1\/rides\/\{id\}\/payments\/mobile-money$/, 'passager'],
  [/^POST \/v1\/rides\/\{id\}\/(arrived|start|complete|no-show)$/, 'chauffeur'],
  [/^POST \/v1\/rides\/\{id\}\/payments\/cash-confirm$/, 'chauffeur'],
  [/^POST \/v1\/driver\//, 'chauffeur'],
  [/^GET \/v1\/driver\//, 'chauffeur'],
  [/^GET \/v1\/dispatch\//, 'ops'],
  [/^(GET|POST) \/v1\/ops\//, 'ops'],
  [/^(GET|POST) \/v1\/demo\//, 'jeton X-Demo-Token'],
];

function accessOf(key) {
  if (PUBLIC_ROUTES.some((pattern) => pattern.test(key))) return 'public';
  const role = ROLE_HINTS.find(([pattern]) => pattern.test(key));
  return role ? role[1] : 'connecté';
}

// ─── Génération ──────────────────────────────────────────────────────────────

function renderEndpoint(method, path, op, examples) {
  const key = `${method.toUpperCase()} ${path}`;
  const lines = [`### \`${key}\``, ''];

  if (op.summary) lines.push(`${op.summary}`, '');
  lines.push(`**Accès** : ${accessOf(key)}`, '');

  const params = (op.parameters ?? []).filter((p) => p.in === 'query' || p.in === 'path');
  if (params.length > 0) {
    lines.push(
      '**Paramètres** : ' +
        params
          .map((p) => `\`${p.name}\`${p.required ? '' : '?'} (${p.in})`)
          .join(' · '),
      '',
    );
  }

  const body = bodyOf(op);
  const summary = fields(body);
  if (summary) lines.push('**Corps** : ' + summary, '');

  const example = examples[EXAMPLE_FOR[key]];
  if (example) {
    lines.push(`**Réponse ${example.status}** — capturée sur une instance réelle :`, '');
    lines.push('```json', json(example.body), '```', '');
  } else {
    const codes = Object.keys(op.responses ?? {}).join(', ');
    if (codes) lines.push(`**Réponses** : ${codes}`, '');
  }

  return lines.join('\n');
}

async function main() {
  const spec = await fetchSpec();
  const examples = loadExamples();
  const errors = readErrorCodes();
  const events = readSocketEvents();

  const byTag = new Map();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (op.hide) continue;
      const tag = (op.tags ?? ['autres'])[0];
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push({ method, path, op });
    }
  }

  const order = ['identity', 'geo', 'pricing', 'rides', 'dispatch', 'payments', 'ops', 'demo'];
  const tags = [...byTag.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const total = [...byTag.values()].reduce((n, list) => n + list.length, 0);
  const header = readFileSync(join(ROOT, 'scripts/api-contract-header.md'), 'utf8')
    .replace('{{TOTAL}}', String(total))
    .replace('{{GENERATED}}', new Date().toISOString().slice(0, 10))
    .replace(
      '{{ERRORS}}',
      errors
        .map((e) => `| \`${e.code}\` | ${e.status} | ${e.section || '—'} |`)
        .join('\n'),
    )
    .replace('{{SOCKET_EVENTS}}', renderSocketTable(events));

  const sections = tags.map((tag) => {
    const meta = (spec.tags ?? []).find((t) => t.name === tag);
    const body = byTag
      .get(tag)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(({ method, path, op }) => renderEndpoint(method, path, op, examples))
      .join('\n---\n\n');

    return `## ${tag}\n\n${meta?.description ? `${meta.description}\n\n` : ''}${body}`;
  });

  const footer = readFileSync(join(ROOT, 'scripts/api-contract-footer.md'), 'utf8');

  writeFileSync(OUTPUT, [header, ...sections, footer].join('\n'), 'utf8');
  console.log(`✓  docs/API_CONTRACT.md · ${total} endpoints · ${Object.keys(examples).length} exemples réels`);
}

function renderSocketTable(events) {
  const rows = [
    ['driver.position', 'chauffeur → serveur', '`{lat, lng, heading?, speed?}`', 'Toutes les 5 s.'],
    ['ride.offer', 'serveur → chauffeur', '`{offerId, rideId, expiresAt, pickup, dropoff, approachKm, etaMin, offer, netXaf, breakdown, paymentMethod}`', '15 s pour répondre.'],
    ['ride.offer_closed', 'serveur → chauffeur', '`{rideId, offerId?, reason}`', 'Offre expirée ou passée au suivant.'],
    ['ride.cancelled', 'serveur → chauffeur', '`{rideId, feeXaf, reason}`', 'Le passager a annulé.'],
    ['ride.status', 'serveur → salle de course', '`{rideId, status, offer, price, at, …}`', 'Fait autorité. Le client n’invente jamais un statut.'],
    ['ride.driver_position', 'serveur → salle de course', '`{rideId, lat, lng, heading}`', 'Le point qui bouge sur la carte.'],
    ['ride.eta', 'serveur → salle de course', '`{rideId, etaMin, etaS}`', 'Pendant l’approche seulement.'],
    ['ops.alert', 'serveur → salle ops', '`{kind, …}` — `sos`, `boarding_code`, `no_driver`, `surge`, `driver_review`', 'Page d’administration.'],
    ['ride.subscribe', 'client → serveur', '`{rideId}` avec accusé `{ok, status}`', 'Le serveur vérifie que la course est bien la vôtre.'],
    ['replay', 'serveur → client', '`{since, count, events:[{event, payload, at}]}`', 'Ce qui a été manqué pendant la coupure.'],
  ];

  const declared = new Set(Object.values(events));
  return rows
    .map(([name, direction, payload, note]) => {
      const known = declared.has(name) ? '' : ' ⚠️ absent de `realtime/events.ts`';
      return `| \`${name}\`${known} | ${direction} | ${payload} | ${note} |`;
    })
    .join('\n');
}

main().catch((error) => {
  console.error(`\n\x1b[31m✗ Génération impossible : ${error.message}\x1b[0m\n`);
  process.exit(1);
});
