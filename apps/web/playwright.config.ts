import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    viewport: { width: 1360, height: 850 },
    screenshot: 'only-on-failure',
    /**
     * Record the run when asked. A headed run is watchable but gone the moment it ends, and
     * these specs finish in seconds — `E2E_VIDEO=1` leaves something to re-watch, and to show
     * someone who was not at the machine.
     */
    video: process.env.E2E_VIDEO ? 'on' : 'off',
    launchOptions: {
      // Use the environment's Chromium when the pinned browser build is absent.
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      /**
       * Pause between actions so a person can follow along. Playwright has no CLI flag for
       * this, and at full speed a headed run is a blur of six near-instant page loads.
       */
      slowMo: Number(process.env.E2E_SLOW_MO ?? 0),
    },
  },
  reporter: [['list']],
});
