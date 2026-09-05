// VORA — configuration drizzle-kit.
//
// ATTENTION : les migrations de ce projet sont ÉCRITES À LA MAIN
// (src/db/migrations/0000_socle.sql). drizzle-kit ne sait pas produire les colonnes
// geography(Point,4326), les index GiST ni les index trigrammes dont dépend le
// géorepérage moto. `npm run db:generate` ne sert donc qu'à INSPECTER l'écart entre
// le schéma TypeScript et la base (`drizzle-kit check`, `drizzle-kit up`) ; la vérité
// reste le fichier SQL, et src/db/schema.ts en est le miroir typé.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://vora:vora@localhost:5432/vora',
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
