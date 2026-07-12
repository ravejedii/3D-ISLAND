import { test, expect } from '@playwright/test';

const URL = 'http://localhost:4173';

// Headless SwiftShader renders in software, far slower than any real GPU.
// The bar here is a regression guard for the environment we run in;
// override with PERF_MIN_FPS for GPU-backed runs (real hardware holds 60).
const MIN_FPS = Number(process.env.PERF_MIN_FPS || 15);

test('waypoint tour holds a playable frame rate', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game !== undefined, { timeout: 20000 });
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(1000);

  const waypoints = [
    [0, 30], // spawn meadow
    [0, -8], // castle courtyard
    [-52, -20], // west bridge mouth
    [-95, -34], // west satellite
    [40, 30], // pond side
    [64, 74], // south-east satellite
  ];

  const results = [];
  for (const [x, z] of waypoints) {
    await page.evaluate(({ x, z }) => {
      window.__game.teleport(x, z);
      window.__game.resetFPS();
    }, { x, z });
    // walk around a bit so we measure real gameplay, not a static frame
    await page.keyboard.down('w');
    await page.waitForTimeout(2500);
    await page.keyboard.up('w');
    const fps = await page.evaluate(() => window.__game.avgFPS);
    results.push({ x, z, fps: Math.round(fps * 10) / 10 });
  }

  console.log('FPS per waypoint:', JSON.stringify(results));
  const overall = results.reduce((a, r) => a + r.fps, 0) / results.length;
  console.log('overall avg FPS:', Math.round(overall * 10) / 10,
    '| draw calls:', await page.evaluate(() => window.__game.drawCalls()),
    '| tris:', await page.evaluate(() => window.__game.triangles()));

  expect(overall).toBeGreaterThanOrEqual(MIN_FPS);
  for (const r of results) {
    expect(r.fps, `waypoint ${r.x},${r.z}`).toBeGreaterThanOrEqual(MIN_FPS * 0.6);
  }
});

test('scene stays within its rendering budget', async ({ page }) => {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game !== undefined, { timeout: 20000 });
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(1500);
  const calls = await page.evaluate(() => window.__game.drawCalls());
  const tris = await page.evaluate(() => window.__game.triangles());
  // low-poly budget: keep the whole world cheap enough for integrated GPUs
  expect(calls).toBeLessThan(60);
  expect(tris).toBeLessThan(150000);
});
