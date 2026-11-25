import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration. The app is served by the Angular dev server (`npm start`), which also
 * hosts the simulated `/api/v1` backend, so E2E runs need no external services.
 */
const PORT = Number(process.env['E2E_PORT'] ?? 4200);
const BASE_URL = `http://localhost:${PORT}`;
const isCI = process.env['CI'] !== undefined;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'en-GB',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npm start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
