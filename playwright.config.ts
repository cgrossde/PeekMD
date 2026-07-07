import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  projects: [
    {
      name: 'browser',
      use: { ...devices['Desktop Chrome'] },
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
