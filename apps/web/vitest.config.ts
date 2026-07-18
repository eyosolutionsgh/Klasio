import { defineConfig } from 'vitest/config';

// `e2e/` holds Playwright specs, which vitest's default `**/*.spec.ts` glob would otherwise
// try (and fail) to collect. They run under `pnpm test:e2e`.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
  },
});
