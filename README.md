# VORA

VTC et motos-taxis à Yaoundé. Prix ferme avant la commande, chauffeurs vérifiés,
et aucune course moto en zone interdite.

> Hackathon 48 h. **La mémoire du projet est dans [CLAUDE.md](CLAUDE.md)** : stack, écarts assumés avec
> le dossier de conception, règles métier non négociables, charte graphique, périmètre.
> Le README complet à 20 sections exigé par le manuel arrive en fin de parcours (P10).

## Prérequis

Node 20 (`nvm use`) · **PostgreSQL 16 avec PostGIS, installé localement** ·
Flutter 3.x avec le SDK Android (minSdk 24).

**Pas de Docker en développement** : l'espace disque des postes est limité. Les fichiers Docker
décrivent le déploiement cible et vivent dans [`infra/docker/`](infra/docker/README.md).
Installation de PostgreSQL par système (Ubuntu/Debian, macOS, Windows) : [CLAUDE.md § 4](CLAUDE.md).

## Démarrer

```bash
cp .env.example .env      # puis remplacer les secrets « changeme »
npm install               # workspaces Node (services/api)
npm run db:setup          # vérifie PostgreSQL, crée base + extensions, migre, sème
npm run dev               # API sur http://localhost:3000
```

`db:setup` s'arrête avec un message qui dit quoi taper si PostgreSQL n'est pas démarré, si le rôle
`vora` manque ou si PostGIS n'est pas installé. Repartir d'une base vierge : `npm run db:reset`.
Ouvrir un psql sur la base du projet : `npm run db:psql`.

En mode démo (`DEMO_MODE=true`), le code de vérification est toujours `123456` et il est
affiché dans les logs ; le simulateur de chauffeurs peuple la carte.

## Tests

```bash
npm test                  # crée vora_test, migre, lance vitest, supprime la base
npm run test:unit         # tests purs (tarification, machine à états) sans base
```

La base de test est créée et détruite par le script, y compris en cas d'échec ou de Ctrl-C.
Ni Docker ni Testcontainers. `VORA_KEEP_TEST_DB=1 npm test` la conserve pour inspection.

## Applications mobiles

```bash
cd apps/passager && flutter run     # appli passager
cd apps/chauffeur && flutter run    # appli chauffeur
```

Sur téléphone réel, remplacer `localhost` par l'IP de la machine sur le réseau du hackathon.

## Structure

```
services/api/    API Fastify + Socket.IO + Drizzle (modules : identity, geo, pricing, rides,
                 dispatch, payments, ops ; simulateur isolé dans src/demo/)
apps/passager    Flutter — commander, suivre, payer
apps/chauffeur   Flutter — se mettre en ligne, accepter, encaisser
apps/admin       React + Vite — une page ops : carte live, compteurs, validation, majoration pluie
packages/vora_ui    thème de la charte et composants partagés
packages/vora_core  modèles, client API, client temps réel
infra/postgres/  extensions SQL, appliquées en local par db:setup et par l'image de production
infra/docker/    déploiement cible (Dockerfile, compose) — pas utilisé pendant le hackathon
scripts/         outillage base de données (setup, reset, psql, base de test)
docs/            brief produit, vision UX, conception, charte, maquettes — source de vérité
```

## Règles que le code ne peut pas violer

Prix ferme figé à la commande · commission 15 % voiture / 50 F moto · retenue DGI 1 % ·
annulation gratuite 2 min ou moins de 300 m, sinon 300 F (100 F moto) reversés au chauffeur ·
offre 15 s par chauffeur, 3 vagues maximum · code de montée à 4 chiffres obligatoire ·
aucune course moto touchant une zone interdite · numéros de téléphone jamais exposés,
identification par ID VORA à 8 chiffres.

Détail et justifications : [CLAUDE.md § 5](CLAUDE.md).

## Équipe

Trois personnes : backend, mobile, design et web. Branches `feature/*`, intégration sur `develop`,
`main` protégée. Personne ne fusionne du code qu'il ne sait pas expliquer.
