#!/usr/bin/env node
// Repeatable hero-view capture for art review. Same camera, same time of day,
// every run — so before.png and after.png differ only by the art itself.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'art-review/before.png';
const PORT = Number(process.env.ART_PORT || 4233);
mkdirSync('art-review', { recursive: true });

const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(`http://localhost:${PORT}/?fx`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game !== undefined, { timeout: 60000 });
  await page.evaluate(() => window.__game.setQuality(0));
  await page.evaluate(() => window.__game.start());
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 30000 });
  // HERO VIEW: south of the castle looking north, low sun, wide boom
  await page.evaluate(() => {
    window.__game.setTimeOfDay(0.30);
    window.__game.teleport(6, 44);
    window.__game.setYaw(0);
    window.__game.setPitch(0.10);
    window.__game.setCamDistance(12);
  });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: OUT });
  console.log('captured', OUT);
  await browser.close();
} finally {
  server.kill();
}
process.exit(0);
