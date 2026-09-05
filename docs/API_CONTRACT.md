<!-- CE FICHIER EST GÉNÉRÉ. Ne le modifiez pas à la main.
     Source : les schémas zod des routes (via GET /openapi.json) et des réponses réelles
     capturées par un parcours curl complet.
     Régénérer : npm run docs:api
     Prose et tableaux fixes : scripts/api-contract-header.md et api-contract-footer.md -->

# Contrat d'API VORA

**45 endpoints** · généré le 2026-09-05 depuis le code, pas écrit à la main.

| Ressource | Adresse |
|---|---|
| Spécification OpenAPI 3.1 | `GET /openapi.json` |
| Interface d'essai (Swagger UI) | `GET /docs` |
| Collection de requêtes prêtes | [`docs/api.http`](./api.http) |

> Les exemples de réponse de ce document ont été **capturés sur une instance qui
> tournait**. Ce ne sont pas des inventions : les identifiants, les prix et les
> horodatages viennent d'un vrai parcours de bout en bout.

---

## Démarrer en trois minutes

```bash
# 1. Un compte passager (le code vaut toujours 123456 en mode démonstration)
curl -s -X POST http://localhost:3000/v1/auth/otp/request \
  -H 'Content-Type: application/json' \
  -d '{"channel":"phone","value":"+237690001234"}'

curl -s -X POST http://localhost:3000/v1/auth/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"value":"+237690001234","code":"123456","role":"passenger","display_name":"Aïcha"}'
# → { "access_token": "eyJ…", "user": { … } }

# 2. Un prix ferme
curl -s -X POST http://localhost:3000/v1/quotes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"pickup":{"lat":3.8541,"lng":11.4872},"dropoff":{"lat":3.8482,"lng":11.4931}}'

# 3. Commander (Idempotency-Key OBLIGATOIRE)
curl -s -X POST http://localhost:3000/v1/rides \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"quoteId":"…","offer":"eco","paymentMethod":"cash"}'
```

Le parcours complet, prêt à exécuter, est dans [`docs/api.http`](./api.http).

---

## Sept choses à savoir avant d'écrire le client

**1. Authentification.** Jeton `Bearer` partout sauf `/health`, `/v1/auth/*`,
`/v1/geo/*`, `/v1/pricing/tariffs`, `/v1/pricing/estimate`, `/v1/payments/methods` et
`/v1/share/{token}`. Le jeton vit 24 h.

**2. Deux conventions de nommage cohabitent, et c'est volontaire.**
`/v1/quotes` et les corps de requête des courses sont en **camelCase** (`quoteId`,
`paymentMethod`, `expiresAt`) ; les **réponses** des courses, du profil et de
l'administration sont en **snake_case** (`price_quoted`, `vora_id`, `boarding_code`).
Ce n'est pas élégant, c'est l'état réel du serveur : ne devinez pas, lisez les exemples.

**3. Le prix est ferme.** `POST /v1/quotes` rend trois offres **signées**, valables
**2 minutes** (`expiresInS: 120`). Le prix affiché avant la commande est celui du reçu.
Après 2 minutes : `QUOTE_EXPIRED`, redemandez un devis.

**4. `Idempotency-Key` est obligatoire sur `POST /v1/rides`.** Sans elle : `400
IDEMPOTENCY_KEY_REQUIRED`. Réutilisez la MÊME clé pour un nouvel essai après une
coupure : vous récupérez la course déjà créée au lieu d'en créer une seconde.

**5. Les erreurs ont toujours la même forme.** `{ code, message, details? }`.
Branchez votre affichage sur `code` — stable, en majuscules. `message` est une phrase
destinée à l'utilisateur : affichez-la telle quelle, mais ne testez jamais dessus.

**6. Montants en entiers de francs CFA.** Jamais de flottant. Quand la réponse porte un
champ `*_formatted` ou `*Formatted`, **affichez celui-là** : il applique l'espace fine
insécable de la charte (`1 625 F`, et `1 625 FCFA` sur les reçus).

**7. Le serveur seul décide du statut d'une course.** Le client demande une action. Si
elle n'est pas permise depuis l'état courant, il reçoit `409 INVALID_TRANSITION` et
**rien n'est écrit**. Ne calculez jamais un statut côté client.

---

## Codes d'erreur

Tous lus depuis `services/api/src/lib/errors.ts`.

| Code | HTTP | Domaine |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Génériques |
| `UNAUTHORIZED` | 401 | Génériques |
| `FORBIDDEN` | 403 | Génériques |
| `NOT_FOUND` | 404 | Génériques |
| `CONFLICT` | 409 | Génériques |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Génériques |
| `TOO_MANY_REQUESTS` | 429 | Génériques |
| `INTERNAL_ERROR` | 500 | Génériques |
| `SERVICE_UNAVAILABLE` | 503 | Génériques |
| `OTP_NOT_FOUND` | 404 | Identité |
| `OTP_EXPIRED` | 410 | Identité |
| `OTP_INVALID` | 400 | Identité |
| `OTP_TOO_MANY_ATTEMPTS` | 429 | Identité |
| `OTP_ALREADY_USED` | 409 | Identité |
| `ROLE_MISMATCH` | 409 | Identité |
| `ACCOUNT_SUSPENDED` | 403 | Identité |
| `VORA_ID_UNAVAILABLE` | 500 | Identité |
| `CHANNEL_ALREADY_USED` | 409 | Identité |
| `MOTO_ZONE_FORBIDDEN` | 422 | Géo |
| `OUT_OF_SERVICE_AREA` | 422 | Géo |
| `QUOTE_EXPIRED` | 410 | Prix et courses |
| `QUOTE_TAMPERED` | 400 | Prix et courses |
| `TARIFF_NOT_FOUND` | 404 | Prix et courses |
| `INVALID_TRANSITION` | 409 | Prix et courses |
| `WRONG_BOARDING_CODE` | 400 | Prix et courses |
| `DRIVER_NOT_APPROVED` | 403 | Chauffeur et paiements |
| `DEBT_LIMIT_REACHED` | 403 | Chauffeur et paiements |
| `NO_DRIVER_AVAILABLE` | 503 | Chauffeur et paiements |
| `PAYMENT_FAILED` | 402 | Chauffeur et paiements |

Les six que l'interface doit traiter explicitement :

| Code | Ce que l'utilisateur doit voir |
|---|---|
| `MOTO_ZONE_FORBIDDEN` | L'offre moto barrée, la zone dessinée sur la carte, la raison affichée. |
| `QUOTE_EXPIRED` | Redemander un prix, sans faire ressaisir le trajet. |
| `WRONG_BOARDING_CODE` | « Code incorrect », et le nombre d'essais restants (`details.remaining`). |
| `INVALID_TRANSITION` | Rafraîchir la course : l'écran est en retard sur le serveur. |
| `NO_DRIVER_AVAILABLE` | Les deux sorties : « Attendre 2 min » (`POST .../retry`) et « Réessayer ». |
| `TOO_MANY_REQUESTS` | Patienter, sans perdre la saisie en cours. |

---

## Socket.IO

Salles par course et par chauffeur. Les noms d'événements sont vérifiés contre
`services/api/src/realtime/events.ts` à chaque génération de ce document.

| Événement | Sens | Charge utile | Notes |
|---|---|---|---|
| `driver.position` | chauffeur → serveur | `{lat, lng, heading?, speed?}` | Toutes les 5 s. |
| `ride.offer` | serveur → chauffeur | `{offerId, rideId, expiresAt, pickup, dropoff, approachKm, etaMin, offer, netXaf, breakdown, paymentMethod}` | 15 s pour répondre. |
| `ride.offer_closed` | serveur → chauffeur | `{rideId, offerId?, reason}` | Offre expirée ou passée au suivant. |
| `ride.cancelled` | serveur → chauffeur | `{rideId, feeXaf, reason}` | Le passager a annulé. |
| `ride.status` | serveur → salle de course | `{rideId, status, offer, price, at, …}` | Fait autorité. Le client n’invente jamais un statut. |
| `ride.driver_position` | serveur → salle de course | `{rideId, lat, lng, heading}` | Le point qui bouge sur la carte. |
| `ride.eta` | serveur → salle de course | `{rideId, etaMin, etaS}` | Pendant l’approche seulement. |
| `ops.alert` | serveur → salle ops | `{kind, …}` — `sos`, `boarding_code`, `no_driver`, `surge`, `driver_review` | Page d’administration. |
| `ride.subscribe` | client → serveur | `{rideId}` avec accusé `{ok, status}` | Le serveur vérifie que la course est bien la vôtre. |
| `replay` | serveur → client | `{since, count, events:[{event, payload, at}]}` | Ce qui a été manqué pendant la coupure. |

### Se connecter

Le jeton voyage dans le **handshake**, pas dans un événement : un socket non
authentifié est refusé avec `connect_error: unauthorized`.

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  transports: ['polling', 'websocket'],   // polling d'abord : il passe partout
  auth: {
    token: accessToken,                    // celui de POST /v1/auth/otp/verify
    since: lastEventAt,                    // ISO 8601, facultatif — voir « rejeu »
  },
});

// Un chauffeur entre AUTOMATIQUEMENT dans sa salle : ses offres arrivent sans rien demander.
socket.on('ride.offer', (offer) => {
  // offer.netXaf : ce que le chauffeur GARDE. Affichez ce montant, pas le brut.
  console.log(offer.offerId, offer.netXaf, offer.expiresAt);
});

// Un passager doit demander à suivre SA course. Le serveur vérifie qu'elle est bien la sienne.
const ack = await socket.emitWithAck('ride.subscribe', { rideId });
// → { ok: true, status: 'accepted' }  ou  { ok: false, error: 'NOT_FOUND' }

socket.on('ride.status', ({ status }) => setRideStatus(status));
socket.on('ride.driver_position', ({ lat, lng, heading }) => moveMarker(lat, lng, heading));
socket.on('ride.eta', ({ etaMin }) => setEta(etaMin));
```

### Rejeu après une coupure

Un téléphone perd le réseau dans un tunnel de Nsimeyong et le retrouve trente secondes
plus tard. Le serveur garde **10 minutes** d'événements par salle.

Passez dans `auth.since` l'horodatage du dernier événement reçu : à la reconnexion, le
serveur émet un seul `replay` contenant ce qui a été manqué, **dans l'ordre**.

```js
socket.on('replay', ({ count, events }) => {
  for (const { event, payload } of events) applique(event, payload);
});
```

Sans `since`, rien n'est rejoué : un nouveau client lit l'état courant par
`GET /v1/rides/{id}`, qui reste la source de vérité.

### Le côté chauffeur, en entier

```js
// 1. Se mettre en ligne (REST) — le dossier doit être validé, sinon DRIVER_NOT_APPROVED
await api.post('/v1/driver/online', { position: { lat, lng } });

// 2. Remonter sa position toutes les 5 s (WebSocket)
setInterval(() => socket.emit('driver.position', { lat, lng, heading, speed }), 5000);

// 3. Répondre à une offre dans les 15 s (REST)
await api.post(`/v1/driver/offers/${offerId}/accept`);
// → { accepted: true } … ou { accepted: false } si un autre a été plus rapide.
//   Ce n'est PAS une erreur : affichez « Trop tard », pas un message d'échec technique.
```

> `POST /v1/driver/position` existe aussi en REST : c'est le filet quand la WebSocket est
> coupée. Même effet, même cadence attendue.

---

## Endpoints


## identity

Inscription, connexion par code, profil.

### `POST /v1/auth/otp/request`

Demander un code de vérification

**Accès** : public

**Corps** : `channel` string · `value` string

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "challenge_id": "bd99ef6a-804b-4dfb-aa4a-ae782ee1744b",
  "channel": "phone",
  "destination_masked": "+237 6·· ··· ·84",
  "expires_at": "2026-09-05T20:59:49.401Z",
  "expires_in_s": 300,
  "demo_mode": true,
  "demo_code": "123456"
}
```

---

### `POST /v1/auth/otp/verify`

Vérifier le code et ouvrir une session

**Accès** : public

**Corps** : `value` string · `code` string · `role`? string · `display_name`? string · `driver_kind`? string · `device`? object

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ…q-gTM7Lo-Vz0",
  "token_type": "Bearer",
  "expires_in": 86400,
  "is_new_account": true,
  "user": {
    "vora_id": "98211113",
    "vora_id_formatted": "9821 1113",
    "role": "passenger",
    "display_name": "Aïcha Mballa",
    "photo_key": null,
    "locale": "fr",
    "status": "active",
    "phone_masked": "+237 6·· ··· ·84",
    "email_masked": null,
    "created_at": "2026-09-05T20:54:49.427Z",
    "driver": null
  }
}
```

---

### `GET /v1/me`

Profil de l’utilisateur connecté

**Accès** : connecté

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "vora_id": "98211113",
  "vora_id_formatted": "9821 1113",
  "role": "passenger",
  "display_name": "Aïcha Mballa",
  "photo_key": null,
  "locale": "fr",
  "status": "active",
  "phone_masked": "+237 6·· ··· ·84",
  "email_masked": null,
  "created_at": "2026-09-05T20:54:49.427Z",
  "driver": null
}
```

---

### `PATCH /v1/me`

Modifier son profil

**Accès** : connecté

**Corps** : `display_name`? string · `locale`? string · `photo_key`? string

**Réponses** : 200

## geo

Repères de Yaoundé, zones réglementaires, itinéraires.

### `POST /v1/geo/moto/check`

Vérifier qu’une course moto ne traverse aucune zone interdite

**Accès** : public

**Corps** : `pickup` object · `dropoff` object · `route`? objet

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "allowed": false,
  "message": "L'itinéraire traverse une zone interdite…se illégale.",
  "routing": "osrm",
  "zones": [
    {
      "id": "9def512e-6114-40a0-aa8d-01e741da54cb",
      "name": "Centre urbain — interdiction moto",
      "reason": "Arrêté préfectoral : la circulation des … de Yaoundé.",
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              11.512,
              "… 1 de plus"
            ],
            "… 7 de plus"
          ]
        ]
      }
    }
  ]
}
```

---

### `GET /v1/geo/route`

Itinéraire entre deux points (OSRM, repli haversine)

**Accès** : public

**Paramètres** : `from_lat` (query) · `from_lng` (query) · `to_lat` (query) · `to_lng` (query)

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "distanceM": 5497,
  "durationS": 493,
  "geometry": "cwoV_rbeANYb@m@L[FKR]|@_BZg@MG{@i@SMc@Ua…?Gl@YvBw@l@U",
  "routing": "osrm"
}
```

---

### `GET /v1/geo/search`

Chercher un repère de Yaoundé

**Accès** : public

**Paramètres** : `q` (query) · `lat`? (query) · `lng`? (query) · `limit`? (query)

**Réponse 200** — capturée sur une instance réelle :

```json
[
  {
    "id": "27e29087-2522-47b2-a816-386131d4f899",
    "name": "Carrefour Mokolo",
    "quartier": "Mokolo",
    "category": "carrefour",
    "lat": 3.8759,
    "lng": 11.5092,
    "distanceM": 3184,
    "confidence": 50
  },
  {
    "id": "a605ecc8-45ef-4373-85d8-8188fbc8ce71",
    "name": "Marché Mokolo",
    "quartier": "Mokolo",
    "category": "marché",
    "lat": 3.8764,
    "lng": 11.5086,
    "distanceM": 3222,
    "confidence": 55
  },
  "… 1 de plus"
]
```

---

### `GET /v1/geo/zones`

Zones réglementaires actives, en GeoJSON

**Accès** : public

**Paramètres** : `kind`? (query)

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "9def512e-6114-40a0-aa8d-01e741da54cb",
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              11.512,
              "… 1 de plus"
            ],
            "… 7 de plus"
          ]
        ]
      },
      "properties": {
        "id": "9def512e-6114-40a0-aa8d-01e741da54cb",
        "kind": "moto_forbidden",
        "name": "Centre urbain — interdiction moto",
        "reason": "Arrêté préfectoral : la circulation des … de Yaoundé.",
        "bonusAmount": null
      }
    }
  ]
}
```

## pricing

Grille tarifaire et DEVIS FERME signé (2 minutes).

### `POST /v1/pricing/estimate`

Prix indicatif pour une distance et une durée

**Accès** : public

**Corps** : `offer` string · `distance_m` integer · `duration_s` integer · `at`? string · `demand_surge_percent`? integer

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "offer": "eco",
  "total": 1625,
  "total_formatted": "1 625 F",
  "currency": "XAF",
  "base_amount": 1625,
  "lines": [
    {
      "key": "base",
      "label": "Prise en charge",
      "amount": 500
    },
    "… 2 de plus"
  ],
  "night": false,
  "demand_surge_percent": 0,
  "capped": false
}
```

---

### `GET /v1/pricing/tariffs`

Grille tarifaire publiée

**Accès** : public

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "city": "Yaoundé",
  "tariffs": [
    {
      "offer": "confort",
      "version": 1,
      "base_fare": 700,
      "per_km": 210,
      "per_min": 35,
      "minimum_fare": 1400,
      "night_surge_percent": 25,
      "demand_surge_max_percent": 50,
      "total_cap_percent": 150,
      "cancel_fee": 300
    },
    "… 2 de plus"
  ]
}
```

---

### `POST /v1/quotes`

Devis ferme : 3 offres signées, valables 2 minutes

**Accès** : connecté

**Corps** : `pickup` object · `dropoff` object

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "expiresAt": "2026-09-05T20:56:52.396Z",
  "expiresInS": 120,
  "routing": "osrm",
  "distanceKm": 1.1,
  "durationMin": 3,
  "routePolyline": "cwoV_rbeANYb@m@L[FKR]|@_BZg@PL`@Tb@V`Al@…k@pCq@xA_@DE",
  "offers": [
    {
      "offer": "eco",
      "quoteId": "94791541-0b57-4c00-bbb2-e3b35ab8da89",
      "price": 1000,
      "priceFormatted": "1 000 F",
      "currency": "XAF",
      "etaMin": 3,
      "breakdown": {
        "base": 763,
        "distance": 164,
        "time": 73,
        "surge": 0
      },
      "lines": [
        {
          "key": "base",
          "label": "Prise en charge",
          "amount": 500
        },
        "… 3 de plus"
      ],
      "night": false,
      "surgePercent": 0,
      "capped": false,
      "available": true,
      "unavailableReason": null,
      "unavailableZoneId": null,
      "signature": "79b5a58f4600ee1d2f7f85463ac9eb2566914dee0bc332d64416047532d605d1"
    },
    "… 2 de plus"
  ]
}
```

## rides

Cycle de vie d’une course, de la commande à la note.

### `GET /v1/driver/earnings`

Ce que le chauffeur a gagné, au franc près

**Accès** : chauffeur

**Paramètres** : `period`? (query)

**Réponses** : 200

---

### `GET /v1/rides`

Historique des courses

**Accès** : connecté

**Paramètres** : `limit`? (query) · `before`? (query) · `status`? (query)

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "rides": [
    {
      "id": "1e6e399d-ebcb-4b3c-91f4-8873050497ec",
      "status": "accepted",
      "offer": "eco",
      "pickup": {
        "lat": 3.8541,
        "lng": 11.4872,
        "label": "Carrefour Melen"
      },
      "dropoff": {
        "lat": 3.8482,
        "lng": 11.4931,
        "label": "Carrefour Obili"
      },
      "route_polyline": "cwoV_rbeANYb@m@L[FKR]|@_BZg@PL`@Tb@V`Al@…k@pCq@xA_@DE",
      "boarding_code": null,
      "cancellation": null,
      "approach_distance_m": null,
      "price_quoted": 1000,
      "price_quoted_formatted": "1 000 F",
      "price_final": null,
      "distance_m": 1094,
      "duration_s": 176,
      "payment_method": "cash",
      "payment_status": "pending",
      "driver": {
        "vora_id": "35728245",
        "first_name": "Étienne",
        "photo_key": null,
        "rating": 5,
        "verified": true
      },
      "vehicle": {
        "make": "Toyota",
        "model": "Corolla",
        "color": "Blanc",
        "plate": "CE 3041 AB"
      },
      "passenger": null,
      "earnings": null,
      "requested_at": "2026-09-05T20:54:53.000Z",
      "accepted_at": "2026-09-05T20:54:59.637Z",
      "arrived_at": null,
      "started_at": null,
      "completed_at": null,
      "paid_at": null,
      "created_at": "2026-09-05T20:54:52.994Z"
    }
  ],
  "next_cursor": null
}
```

---

### `POST /v1/rides`

Commander : le prix ferme se fige ici

**Accès** : passager

**Corps** : `quoteId` string · `offer` string · `paymentMethod`? string · `pickupNote`? string

**Réponse 201** — capturée sur une instance réelle :

```json
{
  "id": "1e6e399d-ebcb-4b3c-91f4-8873050497ec",
  "status": "offered",
  "offer": "eco",
  "pickup": {
    "lat": 3.8541,
    "lng": 11.4872,
    "label": "Carrefour Melen"
  },
  "dropoff": {
    "lat": 3.8482,
    "lng": 11.4931,
    "label": "Carrefour Obili"
  },
  "route_polyline": "cwoV_rbeANYb@m@L[FKR]|@_BZg@PL`@Tb@V`Al@…k@pCq@xA_@DE",
  "boarding_code": null,
  "cancellation": {
    "free": true,
    "fee_xaf": 0,
    "fee_formatted": "0 F",
    "free_until": null,
    "rule": "no_driver_yet"
  },
  "approach_distance_m": null,
  "price_quoted": 1000,
  "price_quoted_formatted": "1 000 F",
  "price_final": null,
  "distance_m": 1094,
  "duration_s": 176,
  "payment_method": "cash",
  "payment_status": "pending",
  "driver": null,
  "vehicle": null,
  "passenger": null,
  "earnings": null,
  "requested_at": "2026-09-05T20:54:53.000Z",
  "accepted_at": null,
  "arrived_at": null,
  "started_at": null,
  "completed_at": null,
  "paid_at": null,
  "created_at": "2026-09-05T20:54:52.994Z"
}
```

---

### `GET /v1/rides/{id}`

Détail d’une course

**Accès** : connecté

**Paramètres** : `id` (path)

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "id": "1e6e399d-ebcb-4b3c-91f4-8873050497ec",
  "status": "accepted",
  "offer": "eco",
  "pickup": {
    "lat": 3.8541,
    "lng": 11.4872,
    "label": "Carrefour Melen"
  },
  "dropoff": {
    "lat": 3.8482,
    "lng": 11.4931,
    "label": "Carrefour Obili"
  },
  "route_polyline": "cwoV_rbeANYb@m@L[FKR]|@_BZg@PL`@Tb@V`Al@…k@pCq@xA_@DE",
  "boarding_code": "2668",
  "cancellation": {
    "free": false,
    "fee_xaf": 300,
    "fee_formatted": "300 F",
    "free_until": "2026-09-05T20:56:59.637Z",
    "rule": "late"
  },
  "approach_distance_m": 1513,
  "price_quoted": 1000,
  "price_quoted_formatted": "1 000 F",
  "price_final": null,
  "distance_m": 1094,
  "duration_s": 176,
  "payment_method": "cash",
  "payment_status": "pending",
  "driver": {
    "vora_id": "35728245",
    "first_name": "Étienne",
    "photo_key": null,
    "rating": 5,
    "verified": true
  },
  "vehicle": {
    "make": "Toyota",
    "model": "Corolla",
    "color": "Blanc",
    "plate": "CE 3041 AB"
  },
  "passenger": null,
  "earnings": null,
  "requested_at": "2026-09-05T20:54:53.000Z",
  "accepted_at": "2026-09-05T20:54:59.637Z",
  "arrived_at": null,
  "started_at": null,
  "completed_at": null,
  "paid_at": null,
  "created_at": "2026-09-05T20:54:52.994Z"
}
```

---

### `POST /v1/rides/{id}/arrived`

« Je suis arrivé » au point de rendez-vous

**Accès** : chauffeur

**Paramètres** : `id` (path)

**Corps** : `lat`? number · `lng`? number

**Réponses** : 200

---

### `POST /v1/rides/{id}/cancel`

Annuler (le serveur décide si c’est gratuit)

**Accès** : connecté

**Paramètres** : `id` (path)

**Corps** : `reason`? string

**Réponses** : 200

---

### `POST /v1/rides/{id}/complete`

Arrivée à destination

**Accès** : chauffeur

**Paramètres** : `id` (path)

**Corps** : `lat`? number · `lng`? number

**Réponses** : 200

---

### `GET /v1/rides/{id}/events`

Journal d’une course

**Accès** : connecté

**Paramètres** : `id` (path)

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "events": [
    {
      "id": 44,
      "type": "ride.created",
      "from_status": null,
      "to_status": null,
      "actor_type": "passenger",
      "occurred_at": "2026-09-05T20:54:52.998Z"
    },
    "… 3 de plus"
  ]
}
```

---

### `POST /v1/rides/{id}/no-show`

Passager absent après le délai d’attente

**Accès** : chauffeur

**Paramètres** : `id` (path)

**Réponses** : 200

---

### `POST /v1/rides/{id}/rating`

Noter la course (des deux côtés)

**Accès** : connecté

**Paramètres** : `id` (path)

**Corps** : `stars` integer · `tags`? array · `comment`? string

**Réponse 409** — capturée sur une instance réelle :

```json
{
  "code": "INVALID_TRANSITION",
  "message": "Cette course ne peut pas encore être notée. Elle doit être payée.",
  "details": {
    "from": "accepted"
  }
}
```

---

### `POST /v1/rides/{id}/retry`

« Attendre 2 min » : relancer le dispatch au même prix

**Accès** : passager

**Paramètres** : `id` (path)

**Réponses** : 200

---

### `POST /v1/rides/{id}/share`

Lien public « Partager mon trajet »

**Accès** : passager

**Paramètres** : `id` (path)

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "url": "http://localhost:3000/v1/share/djEuMWU2Z…M1ZmYzOTJjNQ",
  "expiresAt": "2026-09-06T00:57:46.763Z"
}
```

---

### `POST /v1/rides/{id}/sos`

Alerte SOS (ne change pas le statut de la course)

**Accès** : connecté

**Paramètres** : `id` (path)

**Corps** : `lat`? number · `lng`? number · `note`? string

**Réponses** : 200

---

### `POST /v1/rides/{id}/start`

Démarrer la course avec le code de montée

**Accès** : chauffeur

**Paramètres** : `id` (path)

**Corps** : `boardingCode` string

**Réponses** : 200

---

### `GET /v1/share/{token}`

Suivre un trajet partagé (lien public, sans compte)

**Accès** : public

**Paramètres** : `token` (path)

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "status": "accepted",
  "offer": "eco",
  "pickup": {
    "lat": 3.8541,
    "lng": 11.4872,
    "label": "Carrefour Melen"
  },
  "dropoff": {
    "lat": 3.8482,
    "lng": 11.4931,
    "label": "Carrefour Obili"
  },
  "route_polyline": "cwoV_rbeANYb@m@L[FKR]|@_BZg@PL`@Tb@V`Al@…k@pCq@xA_@DE",
  "driver": {
    "first_name": "Étienne",
    "rating": 5,
    "verified": true
  },
  "vehicle": {
    "make": "Toyota",
    "model": "Corolla",
    "color": "Blanc",
    "plate": "CE 3041 AB"
  },
  "driver_position": {
    "lat": 3.8639919061457415,
    "lng": 11.49656,
    "heading": 0
  },
  "started_at": null,
  "completed_at": null,
  "link_expires_at": "2026-09-06T00:57:46.000Z"
}
```

## dispatch

Mise en ligne, position, réponse aux offres.

### `GET /v1/dispatch/drivers`

Chauffeurs en ligne (carte de la page ops)

**Accès** : ops

**Réponses** : 200

---

### `POST /v1/driver/offers/{offerId}/accept`

Accepter une course proposée

**Accès** : chauffeur

**Paramètres** : `offerId` (path)

**Réponses** : 200

---

### `POST /v1/driver/offers/{offerId}/decline`

Passer une course (le suivant est sollicité aussitôt)

**Accès** : chauffeur

**Paramètres** : `offerId` (path)

**Réponses** : 200

---

### `POST /v1/driver/offline`

Se mettre hors ligne

**Accès** : chauffeur

**Réponses** : 200

---

### `POST /v1/driver/online`

Se mettre en ligne

**Accès** : chauffeur

**Corps** : `position` object · `vehicle_id`? string

**Réponses** : 200

---

### `POST /v1/driver/position`

Remonter sa position

**Accès** : chauffeur

**Corps** : `lat` number · `lng` number · `heading`? number · `speed`? number

**Réponses** : 200

## payments

Espèces et Mobile Money (adaptateur simulé).

### `GET /v1/payments/methods`

Moyens de paiement disponibles

**Accès** : public

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "provider": "simulated",
  "methods": [
    "cash",
    "… 1 de plus"
  ],
  "simulated_delay_ms": 3000
}
```

---

### `POST /v1/rides/{id}/payments/cash-confirm`

Encaissement en espèces confirmé par le chauffeur

**Accès** : chauffeur

**Paramètres** : `id` (path)

**Réponses** : 200

---

### `POST /v1/rides/{id}/payments/mobile-money`

Paiement Mobile Money (adaptateur simulé)

**Accès** : passager

**Paramètres** : `id` (path)

**Réponses** : 200

## ops

Tableau de bord, dossiers chauffeurs, majoration.

### `GET /v1/ops/dashboard`

Tableau de bord : 6 compteurs, majoration, disjoncteur de routage

**Accès** : ops

**Réponses** : 200

---

### `GET /v1/ops/drivers`

File de revue des dossiers chauffeurs

**Accès** : ops

**Paramètres** : `status`? (query)

**Réponses** : 200

---

### `POST /v1/ops/drivers/{userId}/decision`

Valider, refuser, suspendre ou rétablir un chauffeur

**Accès** : ops

**Paramètres** : `userId` (path)

**Corps** : `decision` string · `reason`? string

**Réponses** : 200

---

### `GET /v1/ops/rides`

Dernières courses

**Accès** : ops

**Réponses** : 200

---

### `GET /v1/ops/surge`

Majoration pluie / forte demande en vigueur

**Accès** : ops

**Réponses** : 200

---

### `POST /v1/ops/surge`

Activer ou couper la majoration (0 à 50 %)

**Accès** : ops

**Corps** : `percent` integer · `reason`? string

**Réponses** : 200

## demo

Pilotage de la démonstration (DEMO_MODE uniquement).

### `POST /v1/demo/reset`

Remise à zéro des courses et redémarrage de la flotte

**Accès** : jeton X-Demo-Token

**Réponses** : 200

---

### `POST /v1/demo/scenario`

Mettre la scène en place pour un scénario

**Accès** : jeton X-Demo-Token

**Corps** : `name` string

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "scenario": "moto_zone_interdite",
  "applied": [
    "4 motos rapprochées du Carrefour Melen, et visibles sur la carte."
  ],
  "script": [
    "Départ : Carrefour Melen. Arrivée : Marché Central.",
    "… 2 de plus"
  ],
  "expect": "« L’arrivée est en zone interdite aux mo…n chauffeur."
}
```

---

### `GET /v1/demo/status`

État de la flotte simulée

**Accès** : jeton X-Demo-Token

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "running": true,
  "scenario": "moto_zone_interdite",
  "fleet": [
    {
      "voraId": "35728245",
      "name": "Étienne Ateba",
      "kind": "car",
      "phase": "cruising",
      "lat": 3.86399,
      "lng": 11.49656,
      "rideId": null
    },
    "… 11 de plus"
  ],
  "settings": {
    "rideSpeedup": 8,
    "acceptDelayS": [
      4,
      "… 1 de plus"
    ],
    "boardingPauseS": 6
  }
}
```

## autres

### `GET /health`

**Accès** : public

**Réponse 200** — capturée sur une instance réelle :

```json
{
  "status": "ok",
  "db": "up",
  "commit": "inconnu",
  "uptimeSeconds": 146
}
```


---

## Comptes de démonstration

Le code de vérification vaut toujours **`123456`** tant que `DEMO_MODE=true`, et il est
renvoyé dans la réponse de `POST /v1/auth/otp/request` (champ `demo_code`).

| Téléphone | Rôle | Nom |
|---|---|---|
| `+237691234567` | passagère | Aïcha Mballa |
| `+237677001122` | chauffeur voiture | Boris Nguema |
| `+237655334455` | chauffeur voiture | Nadine Fouda |
| `+237699778899` | chauffeur voiture | Jean-Pierre Mbarga |
| `+237650112233` | chauffeur moto | Samuel Tchinda |
| `+237670445566` | chauffeur moto | Fatou Ngo |

`npm run seed` les crée, `npm run demo` les recrée et affiche leurs ID VORA.

**Aucun compte `ops` n'est semé** : le rôle s'obtient en base, jamais par une API.
Créez le compte normalement, puis
`update users set role = 'ops' where phone = '+237…';`

### La flotte simulée

Douze chauffeurs supplémentaires (8 voitures, 4 motos) roulent sur de vraies routes tant
que `DEMO_MODE=true`. Ils acceptent les courses, arrivent, démarrent et encaissent. Ce ne
sont pas des comptes à utiliser : ils n'ont pas d'application, ils ont un simulateur.

Pilotage — en-tête `X-Demo-Token: vora-demo` :

```bash
curl -X POST http://localhost:3000/v1/demo/scenario \
  -H 'X-Demo-Token: vora-demo' -H 'Content-Type: application/json' \
  -d '{"name":"moto_zone_interdite"}'
```

Scénarios : `nominal` · `aucun_chauffeur` · `annulation_tardive` · `pluie` ·
`moto_zone_interdite` · `sos`. Chacun rend un `script` : ce qu'il faut faire sur le
téléphone pour que la scène ait lieu.

---

## Ce que le serveur ne fera jamais

Utile pour ne pas coder une interface qui attend l'impossible.

- **Le prix ne bouge pas.** Entre le devis et le reçu, pas un franc d'écart. Si votre
  écran affiche un prix différent à l'arrivée, c'est votre écran qui a tort.
- **Le chauffeur ne voit jamais le code de montée.** `boarding_code` vaut `null` dans sa
  réponse, et il vaudra toujours `null`. C'est la sécurité de la montée à bord.
- **Aucun numéro de téléphone ni e-mail ne franchit la frontière entre les parties.**
  Ni dans une réponse, ni dans un reçu, ni dans un événement temps réel. L'identification
  se fait par ID VORA à 8 chiffres.
- **Une course moto dont l'itinéraire touche une zone interdite n'existe pas.** L'offre
  est refusée au devis, avant même de chercher un chauffeur.
- **Un statut ne recule jamais.** Et il ne se calcule pas côté client.

---

## Écarts avec le contrat provisoire

Le contrat distribué avant l'écriture du serveur a bougé. Voici tout ce que le client
doit corriger, du plus cassant au plus anodin.

### 1. Ce qui casse à coup sûr

| Sujet | Contrat provisoire | Réalité du serveur |
|---|---|---|
| Moyen de paiement | `paymentMethod: "momo"` | **`"mobile_money"`** — la valeur `momo` est refusée |
| Jeton de session | `{ token, … }` | **`{ access_token, token_type, expires_in, is_new_account, user }`** |
| Identifiant du devis | `quoteId` au niveau du devis | **un `quoteId` PAR OFFRE** : `offers[i].quoteId`. Trois prix, trois devis signés |
| Se mettre en ligne | `POST /driver/online {offers:[…]}` | **`{ position: {lat,lng}, vehicle_id? }`** — la position, pas les offres |
| Accepter une offre | `→ ride` | **`→ { accepted: boolean, message }`**. `accepted:false` = un autre a été plus rapide, ce n'est pas une erreur |
| Demande de code | `→ { requestId, demoCode? }` | **`{ challenge_id, channel, destination_masked, expires_at, expires_in_s, demo_mode, demo_code }`** |
| Nom du chauffeur | `driver.displayName` | **`driver.first_name`** — le prénom seul, jamais l'état civil complet |
| Véhicule | `driver.plate`, `driver.vehicle`, `driver.color` | **objet `vehicle` séparé** : `{make, model, color, plate}` |

### 2. Champs renommés dans `GET /rides/{id}`

La réponse est en **snake_case**, pas en camelCase.

| Contrat provisoire | Réalité |
|---|---|
| `boardingCode` | `boarding_code` |
| `price` | `price_quoted` (+ `price_final` après la course, + `price_quoted_formatted`) |
| `routePolyline` | `route_polyline` |
| `cancellationFreeUntil` · `cancellationFeeXaf` | un seul objet **`cancellation`** : `{free, fee_xaf, fee_formatted, free_until, rule}`, ou `null` quand la course n'est plus annulable |
| `paymentMethod` | `payment_method` (+ `payment_status`) |

`user.id` **n'existe pas** dans la réponse de connexion : l'identifiant public est
`vora_id` (8 chiffres). L'UUID interne ne sort jamais.

### 3. Codes d'erreur qui n'existent pas

| Attendu par le contrat | À faire |
|---|---|
| `RATE_LIMITED` | Utiliser **`TOO_MANY_REQUESTS`** |
| `NETWORK_UNAVAILABLE` | N'existe pas et n'existera pas : c'est un état du **client**, pas une réponse du serveur |

À traiter en plus, ils n'étaient pas dans le contrat : `IDEMPOTENCY_KEY_REQUIRED`,
`QUOTE_TAMPERED`, `TARIFF_NOT_FOUND`, `DRIVER_NOT_APPROVED`, `PAYMENT_FAILED`,
`OTP_EXPIRED`, `OTP_INVALID`, `OTP_ALREADY_USED`, `OTP_TOO_MANY_ATTEMPTS`.

### 4. Socket.IO

| Sujet | Contrat provisoire | Réalité |
|---|---|---|
| Authentification | non précisée | **dans le handshake** : `auth: { token }`. Sinon `connect_error: unauthorized` |
| Suivre une course | implicite | le passager doit émettre **`ride.subscribe {rideId}`** ; le serveur vérifie que la course est la sienne |
| `ride.status` | `{status, ride}` | **`{rideId, status, offer, price, at, …}`** — pas de course imbriquée ; rechargez par REST |
| `driver.position` | `{lat,lng,heading,speed,ts}` | `ts` ignoré : c'est le serveur qui horodate |
| Événements en plus | — | `ride.offer_closed`, `ops.alert`, `replay` |

### 5. Endpoints qui n'étaient pas au contrat

`POST /v1/rides/{id}/retry` (« Attendre 2 min ») · `GET /v1/rides/{id}/events` ·
`GET /v1/rides` (historique paginé) · `GET /v1/share/{token}` (vue publique) ·
`GET /v1/pricing/tariffs` · `POST /v1/pricing/estimate` · `GET /v1/geo/route` ·
`POST /v1/geo/moto/check` · `GET /v1/payments/methods` · tout `/v1/ops/*` ·
`GET /v1/dispatch/drivers` · `GET /health` · `GET /openapi.json` · `GET /docs`.

### 6. Un statut a changé de nature

`expired` **n'est plus terminal**. Une course expirée peut repartir par
`POST /v1/rides/{id}/retry`, au même prix : c'est la sortie « Attendre 2 min ».
Prévoyez la transition `expired → requested` dans votre machine à états côté client.

### 7. Ce que le contrat n'annonçait pas et qui simplifie la vie

- Les montants voyagent **formatés** à côté du nombre (`price_quoted_formatted`,
  `netFormatted`, `fee_formatted`) : plus besoin de reproduire l'espace fine insécable.
- Le devis porte le **détail ligne par ligne** (`lines[]`) en plus du `breakdown`
  compact : affichez `lines`, c'est ce qu'exige la charte.
- Un `POST` **sans corps** avec `Content-Type: application/json` est accepté.

---

## Régénérer ce document

```bash
npm run dev                        # dans un terminal, avec DEMO_MODE=true
npm run docs:api                   # dans un autre : capture + génération
```

La capture rejoue un parcours complet (inscription → devis → commande → acceptation par
un chauffeur simulé → code de montée → course → encaissement) et enregistre chaque
réponse. Le générateur relit `GET /openapi.json`, ces réponses, `lib/errors.ts` et
`realtime/events.ts`, puis réécrit ce fichier.

Si un endpoint apparaît sans exemple de réponse, c'est qu'il n'est pas couvert par le
parcours de capture : ajoutez-le dans `scripts/capture-api-examples.sh`.
