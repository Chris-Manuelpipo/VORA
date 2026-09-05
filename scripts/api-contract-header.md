<!-- CE FICHIER EST GÉNÉRÉ. Ne le modifiez pas à la main.
     Source : les schémas zod des routes (via GET /openapi.json) et des réponses réelles
     capturées par un parcours curl complet.
     Régénérer : npm run docs:api
     Prose et tableaux fixes : scripts/api-contract-header.md et api-contract-footer.md -->

# Contrat d'API VORA

**{{TOTAL}} endpoints** · généré le {{GENERATED}} depuis le code, pas écrit à la main.

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
{{ERRORS}}

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
{{SOCKET_EVENTS}}

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

