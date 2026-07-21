import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { appUrl, ownerUrl } from './test/setup/env';

/**
 * Integration suite: the real API, wired to a real PostgreSQL, exercised over HTTP.
 *
 * Compiled with SWC rather than vitest's default esbuild because esbuild does not emit
 * `emitDecoratorMetadata`, and without that metadata Nest cannot resolve a single constructor
 * dependency — the app would not boot at all.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.int-spec.ts'],
    globalSetup: ['test/setup/global-setup.ts'],

    /**
     * The suite shares one database and mutates it — invoices generated in one file change the
     * counts another asserts on. Running files one at a time is the difference between a suite
     * that fails on real bugs and one that fails at random.
     */
    fileParallelism: false,

    /**
     * Booting Nest, applying migrations and seeding are all slow relative to a unit test, and a
     * cold CI service container is slower still.
     */
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,

    /**
     * Resolved here, in the one process that has already loaded the developer's environment, and
     * handed to the workers — `globalSetup` runs in a different process, so anything it set on
     * `process.env` would never reach a test file.
     *
     * DATABASE_URL is the owner (used by `prisma.system` and by the tests' own assertions);
     * APP_DATABASE_URL is the non-owner role the API actually serves requests on. Keeping them
     * different is what makes row-level security apply during the tests.
     */
    env: {
      DATABASE_URL: ownerUrl(),
      APP_DATABASE_URL: appUrl(),
      JWT_SECRET: process.env.JWT_SECRET ?? 'integration-test-secret',
      // Payment gateway credentials are per school and encrypted at rest; no school in the seed
      // has one connected, so the mock provider stands in and no real money can move.
      PAYMENTS_ENCRYPTION_KEY: process.env.PAYMENTS_ENCRYPTION_KEY ?? '0'.repeat(64),
      PUBLIC_BASE_URL: 'http://127.0.0.1:3000',
      /**
       * Blanked for the same reason as the payment credentials above, and it is the more urgent
       * of the two: vitest loads `.env` into `process.env`, so a developer with working Nalo
       * credentials — which is every developer, they are in `apps/api/.env` — had every spec that
       * touches an absence alert, a fee reminder or a gate notification firing **real** texts at
       * the seed's invented Ghanaian numbers, and debiting a real account to do it.
       *
       * Empty means `SmsService` falls back to MockSmsProvider, which records the message and
       * delivers nothing. Tests assert on the SmsMessage row, which is the part that matters.
       */
      NALO_SMS_ENDPOINT: '',
      NALO_SMS_USERNAME: '',
      NALO_SMS_PASSWORD: '',
      // Leave the BullMQ sweep off: it would re-query PENDING intents on a timer and settle
      // payments underneath the tests.
      REDIS_URL: '',
      NODE_ENV: 'test',
    },
  },
  plugins: [swc.vite()],
});
