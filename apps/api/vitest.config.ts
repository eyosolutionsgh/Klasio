import { defineConfig } from 'vitest/config';

/**
 * Unit tests: pure functions, no database, no Nest.
 *
 * The include is pinned to `src/` so the integration suite under `test/` cannot be picked up by
 * accident — it needs a live PostgreSQL and would fail the moment `pnpm test` ran without one.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
