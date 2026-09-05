# infra/docker — déploiement cible, pas l'environnement de développement

Ce dossier contient `Dockerfile` (image de l'API : build TypeScript puis exécution en `node:20-alpine`,
sans root) et `docker-compose.prod.yml` (l'API plus PostgreSQL 16 + PostGIS, volume persistant,
base non exposée à l'extérieur, mode démo éteint). Il répond à la question « comment vous déployez ? »
et rien d'autre.

**Il n'est pas utilisé pendant le hackathon.** Les postes de l'équipe ont un espace disque limité :
une image Postgres plus une image Node coûtent plusieurs gigaoctets par machine, pour un service
qu'on a déjà installé nativement. Le développement passe donc par le **PostgreSQL local** de chaque
poste (installation et commandes exactes : `CLAUDE.md` § 4) et par `npm run dev` hors conteneur —
rechargement à chaud, logs lisibles, débogage immédiat, aucun démon à relancer devant le jury.

Les extensions (`postgis`, `pg_trgm`, `unaccent`, `pgcrypto`) sont décrites une seule fois dans
`infra/postgres/init/01-extensions.sql` : le conteneur le joue à la création du volume, et
`npm run db:setup` applique le même fichier sur la base locale. Les deux environnements ne divergent pas.

Pour l'essayer malgré tout, depuis la racine du dépôt :
`docker compose -f infra/docker/docker-compose.prod.yml --env-file .env up -d --build`.
