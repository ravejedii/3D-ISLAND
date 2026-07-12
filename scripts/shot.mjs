// Dev helper: boot the game headless, run a small scenario, save screenshots.
// Usage: node scripts/shot.mjs [url]
import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://localhost:4173';
const outDir = process.env.SHOT_DIR || 'test-results/shots';
const { mkdirSync } = await import('fs');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game !== undefined, { timeout: 15000 });
// stills should show full quality even on a software renderer
await page.evaluate(() => window.__game.setQuality(0));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/01-title.png` });

await page.evaluate(() => window.__game.start());
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/02-spawn.png` });

// walk forward a bit
await page.keyboard.down('w');
await page.waitForTimeout(1800);
await page.keyboard.up('w');
await page.screenshot({ path: `${outDir}/03-walk.png` });

// look at the keep from inside the courtyard
await page.evaluate(() => { window.__game.teleport(0, -8); window.__game.setYaw(0); });
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/04-castle.png` });

// bridge view
await page.evaluate(() => { window.__game.teleport(-54, -20); window.__game.setYaw(Math.PI / 2 + 0.4); });
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/05-bridge.png` });

// sunset + night
await page.evaluate(() => window.__game.setTimeOfDay(0.48));
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/06-sunset.png` });
await page.evaluate(() => window.__game.setTimeOfDay(0.72));
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/07-night.png` });

const stats = await page.evaluate(() => ({
  fps: window.__game.fps,
  avg: window.__game.avgFPS,
  calls: window.__game.drawCalls(),
  tris: window.__game.triangles(),
  pos: window.__game.playerPos,
}));
console.log('stats:', JSON.stringify(stats, null, 2));
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
