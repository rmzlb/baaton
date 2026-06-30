import { defineConfig } from '@playwright/test';

// API-level e2e for the customizable workflow-status feature.
// Runs against a live backend (no Clerk UI login needed: API-key auth).
//   BAATON_API_URL   base url, default http://127.0.0.1:8899
//   BAATON_API_KEY   bearer token of a seeded API key
//   BAATON_PROJECT_ID seeded project id
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BAATON_API_URL || 'http://127.0.0.1:8899',
    extraHTTPHeaders: {
      Authorization: `Bearer ${process.env.BAATON_API_KEY || ''}`,
      'Content-Type': 'application/json',
    },
  },
});
