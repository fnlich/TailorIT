import { defineConfig, devices } from '@playwright/test';

// Browser tests. `e2e` runs the user flows; `shots` captures pages at the size of the user's Simplify screenshots
// (1567x889) for side-by-side comparison with e2e/reference/. Both expect the app at E2E_BASE_URL (default: dev ports).
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/artifacts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'e2e',
      testMatch: /specs\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'shots',
      testMatch: /visual\/.*\.spec\.ts/,
      use: { channel: 'chrome', viewport: { width: 1567, height: 889 }, deviceScaleFactor: 1 },
    },
  ],
});
