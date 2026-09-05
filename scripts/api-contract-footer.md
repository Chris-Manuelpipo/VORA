
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
