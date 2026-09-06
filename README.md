# VORA

VTC et motos-taxis à Yaoundé. Prix ferme avant la commande, chauffeurs vérifiés,
et aucune course moto en zone interdite.

> Hackathon 48 h. **La mémoire du projet** (non versionnée, propre à l'équipe) : stack, écarts assumés avec
> le dossier de conception, règles métier non négociables, charte graphique, périmètre.
> Le README complet à 20 sections exigé par le manuel arrive en fin de parcours (P10).

## Prérequis

Node 20 (`nvm use`) · **PostgreSQL 16 avec PostGIS, installé localement** ·
Flutter 3.x avec le SDK Android (minSdk 24).

**Pas de Docker en développement** : l'espace disque des postes est limité. Les fichiers Docker
décrivent le déploiement cible et vivent dans [`infra/docker/`](infra/docker/README.md).
Installation de PostgreSQL par système (Ubuntu/Debian, macOS, Windows) : voir la mémoire du projet, § 4.

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
                 dispatch, payments, ops, support ; simulateur isolé dans src/demo/)
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

## Inscription, connexion, onboarding

Il n'y a pas deux parcours : `POST /v1/auth/otp/request` puis `POST /v1/auth/otp/verify`
créent le compte ou ouvrent la session, et la réponse le dit dans `is_new_account`. Pas de
mot de passe, donc pas d'écran « Se connecter » séparé.

**Onboarding** — `POST /v1/me/onboarding`, en un seul appel : prénom et nom (exigés), sexe,
date de naissance, langue, et jusqu'à **3 contacts de confiance**. Un seul appel parce que sur
une 3G, quatre requêtes sont quatre occasions de laisser un compte à moitié rempli ; rejouable,
le dernier envoi fait foi. `GET /v1/me` porte `onboarding.completed` : c'est ce champ, et lui
seul, qui décide si l'application ouvre le parcours après la connexion.

> **Écart assumé avec `docs/`** : la vision UX (PA-05) ne demandait que le prénom — « elle ne
> veut pas remplir un formulaire ». On collecte aussi nom, sexe et date de naissance, pour
> l'affichage du profil et les statistiques ops. Ces trois données ne traversent **jamais** :
> ni vers le chauffeur, ni dans le lien public de partage, ni vers l'assistant de support.
> `src/tests/onboarding.test.ts` le vérifie sur une vraie course, pour les trois sorties.

**Contacts de confiance** — ils servent : le SOS les transmet à la salle `ops` avec leur numéro
entier, pour qu'une équipe humaine appelle. Partout ailleurs, y compris pour leur propriétaire,
le numéro est masqué (`+237 6·· ··· ·67`). VORA n'a pas d'agrégateur SMS en 48 h : on ne promet
donc pas au passager que son proche a été prévenu, on dit que l'équipe VORA les a.

**Photo de profil** — `POST /v1/me/photo` avec les **octets bruts** de l'image et son
`Content-Type` (`image/jpeg`, `image/png`, `image/webp`), 2 Mo maximum. Ni multipart ni base64.
`GET /v1/media/:id` la ressert, `DELETE /v1/me/photo` la retire.

Le type est **déduit des octets, jamais de l'en-tête** : un fichier HTML annoncé « image/jpeg »
serait resservi plus tard à un navigateur et son script s'exécuterait sur notre domaine. Les
octets vivent dans PostgreSQL — le disque de la plateforme de déploiement est éphémère, et un
stockage objet demande un compte et des secrets. C'est la cible, pas l'étape : le jour venu,
`photo_key` portera une URL et rien d'autre ne bougera.

> Sur téléphone réel, `PUBLIC_BASE_URL` doit pointer sur l'IP de la machine : c'est elle qui
> construit `photo_url`, comme les liens de partage. Laissée sur `localhost`, l'avatar ne
> s'affiche pas — et rien dans les logs ne le dira.

## Assistant de support

`POST /v1/support/ask` répond à une question d'un passager ou d'un chauffeur, en deux à quatre
phrases. **Il explique, il ne décide rien.**

> **La phrase à dire au jury** — « l'assistant ne décide rien, il explique ; les prix, les statuts
> et les règles viennent du serveur, jamais du modèle. »

**Quel fournisseur.** Aucun en particulier : l'adaptateur parle à n'importe quelle API **compatible
OpenAI** (`POST {LLM_BASE_URL}/chat/completions`), derrière l'interface `LlmProvider`. Trois
variables suffisent à en changer : `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`. Des offres gratuites
conviennent — **OpenRouter** (`https://openrouter.ai/api/v1`, modèles suffixés `:free`), **Groq**
(`https://api.groq.com/openai/v1`, palier gratuit), ou un `llama.cpp` / Ollama posé sur un portable
de l'équipe.

**Pourquoi ce choix.** Le modèle ne fait que mettre en phrases un contexte que le serveur a déjà
écrit : un petit modèle gratuit suffit, et personne n'est enfermé chez un fournisseur. Le second
adaptateur, `StubLlmProvider`, répond **à partir de la FAQ seule, sans réseau** — c'est le mode par
défaut (`LLM_ENABLED=false`), et c'est lui qui répondra si la salle du hackathon n'a pas d'internet.
Le repli est **automatique** : clé absente, service en panne, 4 secondes dépassées ou JSON illisible,
la FAQ prend le relais et l'utilisateur ne voit jamais « service indisponible ».

**Ce qu'il sait, et rien d'autre.** Le contexte est construit **côté serveur** — jamais transmis par
le client — et passe par un schéma zod `.strict()` avant de partir : la FAQ de
`services/api/src/modules/support/knowledge.ts`, plus les faits de la course en cours (statut, prix,
décomposition, offre, distance, plaque). **Ni numéro, ni e-mail, ni position brute, ni identifiant
d'un autre utilisateur** ; `src/tests/support.test.ts` le vérifie sur une vraie course.

**Ses limites, assumées.**

- Il n'agit pas : ni annulation, ni remboursement, ni prix modifié. Il dit quel bouton le fait.
- Il n'invente pas : quand la réponse n'est pas dans le contexte, il répond qu'un humain reprend et
  renvoie `escalate: true`. Une réponse qui cite un **montant absent du contexte** est jetée et
  remplacée par ce repli — les francs viennent du serveur, au franc près.
- **Coût** : une seule tentative, délai de garde de 4 s, **10 questions par heure et par personne**,
  réponses mises en cache 24 h. La clé de cache inclut l'empreinte du contexte : la course d'un
  passager n'est jamais resservie à un autre.
- **Le module ne doit JAMAIS être appelé automatiquement** — pas de pré-chargement à l'ouverture d'un
  écran, pas de suggestion en arrière-plan, pas de reformulation d'une erreur d'API. Uniquement quand
  quelqu'un appuie sur « Poser ma question ».
- Rien du chemin critique n'en dépend : commander, dispatcher et encaisser fonctionnent à l'identique
  s'il tombe. Un test d'architecture interdit à tout module métier d'importer `support/`.
- Chaque appel est journalisé (question nettoyée, fournisseur, latence, escalade) — jamais une donnée
  personnelle : les numéros et e-mails tapés dans une question sont masqués avant l'écriture.

## Messages pendant la course

`GET` et `POST /v1/rides/{id}/messages` : **six codes prédéfinis**, aucun texte libre, aucun vocal,
aucun appel (périmètre défini au § 8.3 de la mémoire du projet).

| Passager | Chauffeur |
|---|---|
| `IM_HERE` « Je suis là » | `ARRIVING` « J'arrive » |
| `WHERE_ARE_YOU` « Où êtes-vous ? » | `IM_OUTSIDE` « Je suis devant » |
| `WAIT_2MIN` « 2 minutes svp » | `CANT_FIND` « Je ne vous trouve pas » |

Le serveur ne transporte **que le code** — libellé résolu par l'application, donc traduisible sans
toucher au serveur. Ouvert aux deux parties de la course seulement (403 sinon, l'ops compris), de
l'acceptation à 30 min après la fin, 10 messages par course et par personne. L'événement temps réel
`message.new` part dans la salle de la course. La table `ride_messages` n'a **pas de colonne de
texte** : rien à modérer, et aucun moyen d'échanger un numéro en contournant la règle du § 5.6.

## Règles que le code ne peut pas violer

Prix ferme figé à la commande · commission 15 % voiture / 50 F moto · retenue DGI 1 % ·
annulation gratuite 2 min ou moins de 300 m, sinon 300 F (100 F moto) reversés au chauffeur ·
offre 15 s par chauffeur, 3 vagues maximum · code de montée à 4 chiffres obligatoire ·
aucune course moto touchant une zone interdite · numéros de téléphone jamais exposés,
identification par ID VORA à 8 chiffres.

Détail et justifications : § 5 de la mémoire du projet.

## Équipe

Trois personnes : backend, mobile, design et web. Branches `feature/*`, intégration sur `develop`,
`main` protégée. Personne ne fusionne du code qu'il ne sait pas expliquer.
