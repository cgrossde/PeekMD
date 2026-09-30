import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  projects: [
    {
      name: 'browser',
      fullyParallel: true,
      timeout: 10_000,
      use: { ...devices['Desktop Chrome'], actionTimeout: 4_000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
    },
    {
      name: 'tauri',
      use: { mode: 'tauri' } as never,
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
  },
});
