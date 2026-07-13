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
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.js/,
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.js/,
      use: {
        viewport: { width: 430, height: 932 },
        hasTouch: true,
        isMobile: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    port: 4173,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
