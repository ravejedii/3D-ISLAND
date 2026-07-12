import { defineConfig } from '@playwright/test';
import { existsSync } from 'fs';

// The remote dev environment pre-installs Chromium at /opt/pw-browsers/chromium;
// fall back to Playwright's own resolution elsewhere.
const preinstalled = '/opt/pw-browsers/chromium';
const executablePath = process.env.CHROMIUM_PATH
  || (existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: 'tests',
  timeout: 90000,
  retries: 0,
  // one worker: parallel SwiftShader instances starve each other of CPU and
  // make the perf measurements meaningless
  workers: 1,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      executablePath,
      args: ['--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'pnpm build && pnpm preview',
    port: 4173,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
