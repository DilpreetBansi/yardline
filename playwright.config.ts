import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production demo build, where the API and Postgres
// (PGlite) run inside a SharedWorker in the browser.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173/yardline/',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run preview -w @yardline/web -- --port 4173 --strictPort',
    url: 'http://localhost:4173/yardline/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
