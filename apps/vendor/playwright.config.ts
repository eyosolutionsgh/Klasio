import { defineConfig } from '@playwright/test';

/**
 * The licensing portal's own suite, deliberately separate from the school portal's.
 *
 * They are two applications on two ports with two databases, and a single config would have to
 * carry a base URL that is wrong for half its tests. Keeping them apart also keeps the school's
 * suite runnable by someone who has never provisioned a vendor database.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_VENDOR_BASE_URL ?? 'http://localhost:3200',
    viewport: { width: 1360, height: 850 },
    screenshot: 'only-on-failure',
    video: process.env.E2E_VIDEO ? 'on' : 'off',
    launchOptions: {
      // Use the environment's Chromium when the pinned browser build is absent.
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      slowMo: Number(process.env.E2E_SLOW_MO ?? 0),
    },
  },
  reporter: [['list']],
});
