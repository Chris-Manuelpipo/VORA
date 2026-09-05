# Déploiement de l'API VORA sur Clever Cloud

Application **Node.js** reliée au dépôt GitHub, add-on **PostgreSQL** avec PostGIS.
Le développement local ne change pas : `npm run dev` et `npm run db:setup` fonctionnent
exactement comme avant (`CLAUDE.md` § 4 et § 10).

> Ce dossier remplace `infra/docker/` pour le déploiement réel. `infra/docker/` reste la
> réponse à « et si vous vouliez héberger vous-même ? » ; il n'est pas utilisé ici.

---

## 1. Ce que le code fait déjà pour la plateforme

Trois choses sont réglées côté code, il n'y a rien à faire de plus :

| Contrainte de la plateforme | Comment le code y répond |
|---|---|
| Le port est imposé par `PORT` (8080) | `lib/config.ts` lit `PORT` depuis l'environnement, sans valeur codée en dur. |
| Il faut écouter sur `0.0.0.0` | `HOST` vaut `0.0.0.0` par défaut, **et le démarrage est refusé** si `HOST` est une adresse de boucle locale en production : une API injoignable ne doit pas ressembler à une API en bonne santé. |
| La chaîne de connexion s'appelle `POSTGRESQL_ADDON_URI` | `lib/config.ts` accepte `DATABASE_URL` **ou** `POSTGRESQL_ADDON_URI`. Rien à recopier à la main. |

Le processus applique aussi les **migrations au démarrage** (§ 4) et refuse de démarrer si
elles échouent ou si une extension PostgreSQL manque.

---

## 2. Procédure complète

### 2.1 Créer l'add-on PostgreSQL et activer les extensions

L'add-on doit porter **quatre** extensions, pas seulement PostGIS :

| Extension | À quoi elle sert |
|---|---|
| `postgis` | géorepérage moto — `ST_Intersects` en base (`CLAUDE.md` § 5.5) |
| `pg_trgm` | recherche de repères tolérante aux fautes |
| `unaccent` | « Ngoa-Ekellé » trouvé en tapant « ngoa ekelle » |
| `pgcrypto` | `gen_random_uuid()`, hachage du code de montée |

C'est **le premier motif d'échec d'un premier déploiement** : PostGIS est souvent activé
seul, et la migration `0001_geo` échoue alors sur `unaccent`. Vérifiez les quatre :

```bash
# Depuis votre poste, avec l'URI de l'add-on (console Clever Cloud → add-on → Informations)
psql "$POSTGRESQL_ADDON_URI" -c "select extname from pg_extension order by 1;"
```

S'il en manque, activez-les depuis la console de l'add-on. Si votre rôle a le droit de le
faire directement :

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

C'est le même fichier qu'en local : `infra/postgres/init/01-extensions.sql`. Les deux
environnements ne divergent pas.

### 2.2 Créer l'application et la relier au dépôt

1. Console Clever Cloud → **Create an application** → **Node.js**.
2. Reliez-la au dépôt GitHub, branche `main`.
3. **Liez l'add-on PostgreSQL à l'application** (onglet *Service dependencies*). C'est ce
   lien qui publie `POSTGRESQL_ADDON_URI` dans l'environnement de l'application ; sans
   lui, l'API démarre sans base et s'arrête sur `PostgreSQL ne répond pas`.

### 2.3 Faire compiler le TypeScript

L'API démarre depuis `dist/`, il faut donc compiler avant de lancer. Le script de build
compile **et copie les migrations** (`tsc` n'émet que du JavaScript ; les `.sql` sont
copiés par `scripts/copy-migrations.mjs`).

Dans *Environment variables* :

```
CC_PRE_BUILD_HOOK=npm run build
```

Si le build échoue avec `tsc: not found` ou `Cannot find module 'typescript'`, c'est que
les dépendances de développement n'ont pas été installées. Ajoutez alors :

```
CC_NODE_DEV_DEPENDENCIES=install
```

La commande de démarrage par défaut (`npm start`) convient : à la racine du dépôt elle
délègue au workspace, qui lance `node dist/index.js`.

### 2.4 Poser les variables d'environnement

Voir la liste exhaustive au § 3. Le minimum vital :

```
PORT=8080
NODE_ENV=production
DEMO_MODE=false
JWT_SECRET=<openssl rand -hex 32>
QUOTE_HMAC_SECRET=<openssl rand -hex 32>
CORS_ORIGINS=https://<votre-back-office>
PUBLIC_BASE_URL=https://<votre-app>.cleverapps.io
DATABASE_SSL=true
CC_PRE_BUILD_HOOK=npm run build
```

**Ne recopiez pas les valeurs de `.env.example`.** Le démarrage est refusé si
`JWT_SECRET` ou `QUOTE_HMAC_SECRET` contient encore `changeme` : ces deux clés signent
les jetons de session et les prix fermes.

### 2.5 Déployer, puis vérifier

```bash
curl -i https://<votre-app>.cleverapps.io/health
```

Attendu : `HTTP/1.1 200` et

```json
{ "status": "ok", "db": "up", "commit": "a1b2c3d", "uptimeSeconds": 42 }
```

Puis une vérification qui touche réellement la base et PostGIS :

```bash
curl -s "https://<votre-app>.cleverapps.io/v1/geo/zones?kind=moto_forbidden"
```

Tant que le seed n'a pas tourné (§ 5), la réponse est une `FeatureCollection` **vide** :
c'est normal, et ça prouve déjà que la requête spatiale s'exécute.

---

## 3. Variables d'environnement — liste exhaustive

`✅ à poser` = à renseigner sur Clever Cloud. Les autres ont une valeur par défaut
raisonnable ; ne les posez que si vous voulez changer le comportement.

### Plateforme

| Variable | À poser | Défaut | Rôle |
|---|---|---|---|
| `PORT` | ✅ `8080` | `3000` | Port d'écoute. Imposé par Clever Cloud. |
| `HOST` | — | `0.0.0.0` | Interface d'écoute. **Ne la mettez pas à `127.0.0.1`** : le démarrage serait refusé. |
| `NODE_ENV` | ✅ `production` | `development` | Active les garde-fous de production et coupe le journal coloré. |
| `LOG_LEVEL` | — | `info` | `fatal`·`error`·`warn`·`info`·`debug`·`trace`·`silent`. |
| `TZ` | — | `Africa/Douala` | Fuseau du processus. |
| `COMMIT_ID` | auto | `inconnu` | Renseignée par Clever Cloud sur un déploiement git. Exposée par `/health`. |
| `CC_PRE_BUILD_HOOK` | ✅ `npm run build` | — | Compile le TypeScript et copie les migrations. |
| `CC_NODE_DEV_DEPENDENCIES` | si besoin | — | `install` si le build ne trouve pas `typescript`. |

### Base de données

| Variable | À poser | Défaut | Rôle |
|---|---|---|---|
| `POSTGRESQL_ADDON_URI` | auto | — | Publiée par l'add-on lié. Utilisée si `DATABASE_URL` est absente. |
| `DATABASE_URL` | — | — | Prioritaire sur la précédente. À poser seulement pour viser une autre base. |
| `DATABASE_SSL` | ✅ `true` | `false` | Chiffre la connexion sans exiger que Node reconnaisse le certificat de l'add-on. Laissez `false` en local. |
| `MIGRATE_ON_BOOT` | — | `true` | Applique les migrations au démarrage. `false` seulement si une étape séparée s'en charge. |

### Sécurité

| Variable | À poser | Défaut | Rôle |
|---|---|---|---|
| `JWT_SECRET` | ✅ | — | Signe les jetons de session **et** les codes de montée. `openssl rand -hex 32`. |
| `JWT_EXPIRES_IN` | — | `24h` | Durée de vie d'une session. |
| `QUOTE_HMAC_SECRET` | ✅ | — | Signe les devis : c'est ce qui rend le prix ferme vérifiable. `openssl rand -hex 32`. |
| `CORS_ORIGINS` | ✅ | `http://localhost:5173,http://localhost:3000` | Origines autorisées, séparées par des virgules. Vaut pour les routes HTTP **et** pour Socket.IO. Sans effet sur les applications mobiles, qui n'envoient pas d'en-tête `Origin`. |

### Partage de trajet

| Variable | À poser | Défaut | Rôle |
|---|---|---|---|
| `PUBLIC_BASE_URL` | ✅ | `http://localhost:3000` | Base des liens « Partager mon trajet ». **Doit être l'URL publique** : le lien s'ouvre dans le navigateur d'un proche, `localhost` n'y mène nulle part. |
| `SHARE_LINK_TTL_S` | — | `14400` | Durée de validité du lien (4 h). |

### Mode démonstration

| Variable | À poser | Défaut | Rôle |
|---|---|---|---|
| `DEMO_MODE` | ✅ `false` | `false` | `true` fige le code OTP et le renvoie dans la réponse. **Le démarrage est refusé si `true` avec `NODE_ENV=production`.** |
| `DEMO_OTP_CODE` | — | `123456` | Code fixe en mode démonstration. |

> Si vous déployez pour **montrer** le produit au jury et non pour le mettre en service,
> il faut `DEMO_MODE=true` — donc **`NODE_ENV=development`**, pas `production`. C'est un
> choix conscient : sans agrégateur SMS, personne ne peut recevoir de code (`CLAUDE.md`
> § 8.2). Dans ce cas, les garde-fous du § 2.4 ne s'appliquent plus : posez quand même de
> vraies clés.

### Identité, prix, dispatch

| Variable | Défaut | Rôle |
|---|---|---|
| `OTP_TTL_S` | `300` | Durée de vie d'un code de vérification. |
| `OTP_MAX_ATTEMPTS` | `5` | Essais avant invalidation. |
| `QUOTE_TTL_S` | `120` | Validité du devis ferme — **2 min, règle métier** (`CLAUDE.md` § 5.1). |
| `DISPATCH_OFFER_TIMEOUT_S` | `15` | Temps de réponse laissé à un chauffeur (§ 5.4). |
| `DISPATCH_MAX_WAVES` | `3` | Nombre de vagues avant expiration (§ 5.4). |
| `DISPATCH_RADII_KM` | `1,3,5` | Rayon de chaque vague (§ 5.4). |
| `DRIVER_POSITION_TTL_S` | `60` | Au-delà, une position n'est plus une position. |

> Les quatre dernières sont des **règles métier**, pas des réglages. Les changer change le
> produit ; `CLAUDE.md` § 8.4 dit lesquelles ne se négocient pas.

### Routage

| Variable | Défaut | Rôle |
|---|---|---|
| `OSRM_BASE_URL` | `https://router.project-osrm.org` | Instance OSRM publique. |
| `OSRM_PROFILE` | `driving` | Profil de calcul. |
| `OSRM_TIMEOUT_MS` | `2000` | Délai de garde avant repli. |
| `OSRM_ENABLED` | `true` | `false` force le repli haversine — utile pour **répéter la dégradation gracieuse avant le jury** sans débrancher le réseau. |
| `FALLBACK_DISTANCE_FACTOR` | `1.35` | Détour moyen du réseau urbain. |
| `FALLBACK_SPEED_KMH` | `22` | Vitesse moyenne retenue pour Yaoundé. |

### Paiement

| Variable | Défaut | Rôle |
|---|---|---|
| `PAYMENT_PROVIDER` | `simulated` | Seule valeur acceptée : l'intégration MoMo/OM réelle demande des identifiants opérateur (`CLAUDE.md` § 8.2). |
| `PAYMENT_SIMULATED_DELAY_MS` | `3000` | Attente simulée de l'opérateur. |

---

## 4. Migrations

Elles sont appliquées **au démarrage**, avant que le serveur n'écoute :

1. les quatre extensions sont vérifiées — si l'une manque, le processus s'arrête en
   affichant les `CREATE EXTENSION` exacts à jouer ;
2. les migrations sont appliquées par le migrateur Drizzle, qui tient la liste de ce qui
   est déjà passé : **relancer le processus ne rejoue rien** ;
3. **si une migration échoue, l'API ne démarre pas.** Le déploiement est marqué en échec
   et l'instance précédente reste en place. C'est voulu : une base en retard sur le code
   sert des erreurs, pas des courses.

Pour appliquer les migrations sans démarrer l'API (rare) :

```bash
clever ssh
cd /home/bas/app_xxx/services/api && npm run db:migrate
```

---

## 5. Lancer le seed en production

**Le seed n'est jamais automatique.** Il écrit les repères de Yaoundé, les zones de
l'arrêté préfectoral, la grille tarifaire et les comptes de démonstration : aucun
redémarrage ne doit les réécrire.

```bash
clever ssh                      # depuis la racine du dépôt, application déjà liée
cd /home/bas/app_xxx            # le chemin exact est affiché à la connexion
npm run seed
```

Le seed est **idempotent** : il crée ce qui manque et laisse le reste tel quel. Sans lui,
`POST /v1/quotes` répond `TARIFF_NOT_FOUND` — aucune grille n'est publiée.

Alternative si `clever ssh` n'est pas disponible : lancez-le depuis votre poste contre la
base distante.

```bash
cd services/api
DATABASE_URL="$POSTGRESQL_ADDON_URI" DATABASE_SSL=true npm run seed
```

### Créer le compte ops

Aucun compte `ops` n'est semé — le rôle s'obtient en base, jamais par une API :

```bash
# 1. Créez le compte par la voie normale (POST /v1/auth/otp/request puis /verify)
# 2. Passez-le en ops
psql "$POSTGRESQL_ADDON_URI" -c \
  "update users set role = 'ops' where phone = '+237XXXXXXXXX';"
```

### Ce qu'il ne faut PAS lancer en production

`npm run demo` **efface toutes les courses**. Il refuse de tourner avec
`NODE_ENV=production` ou `DEMO_MODE=false`, mais ne le lancez pas par curiosité sur une
base qui porte de vraies courses.

---

## 6. Journaux

- **Console Clever Cloud** → application → onglet **Logs**, en direct.
- **En ligne de commande** : `clever logs` (suivi continu), `clever logs --since 10m`.

Les journaux sont du **JSON structuré** (`pino`), une ligne par événement. Les champs
utiles : `level`, `msg`, `reqId`, `req.method`, `req.url`, `res.statusCode`,
`responseTime`.

```bash
clever logs | grep '"level":50'                      # erreurs
clever logs | grep 'SOS déclenché'                   # alertes SOS
clever logs | grep 'Migrations à jour'               # confirmation de démarrage
```

**Ce que vous n'y trouverez jamais** : un numéro de téléphone ou un e-mail complet. Ils
sont masqués par `pino` avant écriture (`lib/logger.ts`), et c'est la règle `CLAUDE.md`
§ 5.6 — elle vaut aussi pour les journaux.

---

## 7. Si le health check échoue

`GET /health` renvoie **503** dès que la base ne répond plus. Le tableau va du plus
fréquent au plus rare.

### L'application ne démarre pas du tout

Lisez les dernières lignes de `clever logs` : le processus dit **pourquoi** il refuse.

| Message | Cause | Correction |
|---|---|---|
| `Extensions PostgreSQL manquantes : ...` | L'add-on n'a pas les quatre extensions | § 2.1. Le message liste les `CREATE EXTENSION` à jouer. |
| `PostgreSQL ne répond pas` | Add-on non lié, ou TLS refusé | Liez l'add-on (§ 2.2), puis `DATABASE_SSL=true`. |
| `Migration échouée : ...` | Migration en conflit avec l'état de la base | Le message SQL est au-dessus. Corrigez la base ou la migration, redéployez. |
| `HOST=127.0.0.1 en production` | `HOST` posée à tort | Retirez la variable. |
| `JWT_SECRET porte encore la valeur d'exemple` | Valeur de `.env.example` recopiée | `openssl rand -hex 32`. |
| `DEMO_MODE=true avec NODE_ENV=production` | Combinaison interdite | Voir l'encadré du § 3. |
| `Cannot find module '.../dist/index.js'` | Le build n'a pas tourné | `CC_PRE_BUILD_HOOK=npm run build` (§ 2.3). |

### L'application démarre mais `/health` répond 503

`{"status":"degraded","db":"down"}` : le processus est vivant, la base non.

1. **L'add-on est-il debout ?** Console → add-on → état. Une restauration ou une montée
   de version le rend indisponible quelques minutes.
2. **La connexion passe-t-elle depuis ailleurs ?**
   `psql "$POSTGRESQL_ADDON_URI" -c 'select 1;'`
3. **TLS** : si `psql` passe mais pas l'API, posez `DATABASE_SSL=true` et redéployez.
4. **Nombre de connexions** : les petits add-ons plafonnent bas. L'API ouvre jusqu'à
   10 connexions ; un `npm run seed` lancé en parallèle en prend d'autres.
   `select count(*) from pg_stat_activity;`

Le contrôle passe volontairement à 503 au bout de **2 secondes** sans réponse plutôt que
d'attendre : une instance qui pend est retirée de la rotation au lieu de distribuer des
erreurs 500.

### `/health` répond 200 mais l'application ne marche pas

`/health` ne teste que la base. Les autres causes courantes :

| Symptôme | Cause probable | Vérification |
|---|---|---|
| `TARIFF_NOT_FOUND` sur `POST /v1/quotes` | Seed non lancé | § 5 |
| `FeatureCollection` vide, moto jamais refusée | Zones non semées | § 5 — **le géorepérage ne refuse rien s'il n'y a pas de zone** |
| Tous les devis en `routing: "fallback"` | OSRM public injoignable | Normal et prévu (`CLAUDE.md` § 3). Le prix reste ferme. |
| Le back-office est refusé par le navigateur | `CORS_ORIGINS` | Doit contenir l'origine exacte, schéma compris. |
| Le lien de partage mène nulle part | `PUBLIC_BASE_URL` | Doit être l'URL publique, pas `localhost`. |

### Socket.IO ne se connecte pas

La passerelle accepte **`polling` puis `websocket`**, dans cet ordre : la session
s'établit en HTTP ordinaire, qui passe partout, puis monte en WebSocket si le réseau le
permet.

- **Test rapide** — cette requête doit répondre `200` et un corps commençant par `0{` :
  ```bash
  curl -i "https://<votre-app>.cleverapps.io/socket.io/?EIO=4&transport=polling"
  ```
- **`connect_error: unauthorized`** : le client n'a pas passé de jeton. Il doit fournir
  `auth: { token: '<JWT>' }` dans le handshake.
- **Refus CORS depuis un navigateur** : ajoutez l'origine à `CORS_ORIGINS`. Socket.IO
  n'hérite pas du plugin CORS de Fastify, mais il lit la même variable.
- **Le mobile fonctionne, le navigateur non** : une application mobile n'envoie pas
  d'en-tête `Origin` et n'est donc jamais concernée par CORS. C'est bien CORS.

> **Avant de passer à plus d'une instance.** Le transport `polling` répartit une session
> sur plusieurs requêtes : sans sessions persistantes, une requête sur deux tomberait sur
> l'instance qui ne connaît pas la session. Et surtout, **les positions des chauffeurs,
> les minuteries de dispatch et le tampon de rejeu vivent dans le processus**
> (`CLAUDE.md` § 3) : deux instances proposeraient chacune leur offre sur la même course.
> Restez à **une seule instance** tant que Redis n'est pas branché.

---

## 8. Ce que ce déploiement ne fait pas

Écarts assumés, à dire au jury s'il pose la question :

- **une seule instance**, pour la raison ci-dessus — la voie de sortie est Redis
  (`GEOADD`/`GEOSEARCH` pour les positions, adaptateur Socket.IO pour les salles, file
  différée pour les minuteries de dispatch) ;
- **pas de sauvegarde applicative** : celle de l'add-on PostgreSQL fait foi ;
- **pas de CDN, pas de mise en cache** : l'API sert du JSON, la carte vient d'OSM ;
- **pas de supervision** au-delà de `/health` — OpenTelemetry, Grafana et Sentry sont
  hors budget temps (`CLAUDE.md` § 3).
