import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // TOUS les tests, unitaires comme d'intégration : `npm test` monte vora_test, applique
    // les migrations et lance ceci. Un filtre `*.unit.test.ts` ici ferait passer les tests
    // sur base à la trappe SANS LE DIRE — la base serait créée, puis ignorée.
    // Les tests purs se lancent à part : `npm run test:unit` filtre sur « unit.test ».
    include: ['src/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
  },
});
