# VORA — image de l'API. Déploiement cible uniquement, jamais utilisée en développement.
# Contexte de build : la racine du dépôt.
#   docker build -f infra/docker/Dockerfile -t vora/api .

# ─── Étape 1 : dépendances et compilation ────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Le monorepo est un espace de travail npm : il faut les deux package.json pour installer.
COPY package.json package-lock.json* ./
COPY services/api/package.json ./services/api/
RUN npm ci --workspaces --include-workspace-root || npm install

COPY services/api ./services/api
RUN npm run build --workspace services/api

# ─── Étape 2 : image d'exécution ─────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production TZ=Africa/Douala

COPY package.json package-lock.json* ./
COPY services/api/package.json ./services/api/
RUN npm ci --omit=dev --workspaces --include-workspace-root || npm install --omit=dev

COPY --from=build /app/services/api/dist ./services/api/dist
# Les migrations SQL voyagent avec l'image : elles sont appliquées au démarrage du déploiement.
COPY services/api/src/db/migrations ./services/api/src/db/migrations

# Ne jamais tourner en root.
USER node
EXPOSE 3000
CMD ["node", "services/api/dist/index.js"]
