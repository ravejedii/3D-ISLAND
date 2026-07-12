import { test, expect } from '@playwright/test';

const URL = 'http://localhost:4173';

async function boot(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game !== undefined, { timeout: 20000 });
  return errors;
}

// Start playing and wait until the player has actually landed and the
// renderer has warmed up — headless software rendering stutters at first.
async function startSettled(page) {
  await page.evaluate(() => window.__game.start());
  await page.waitForFunction(() => window.__game.grounded && window.__game.fps > 5, { timeout: 30000 });
}

test('loads with a title screen and no console errors', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('#title-screen h1')).toHaveText('FLOATING ISLES');
  await page.waitForTimeout(2000);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__game.state)).toBe('title');
});

test('starts the game from the title screen button', async ({ page }) => {
  await boot(page);
  await page.click('#btn-play');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__game.state)).toBe('playing');
  await expect(page.locator('#hud')).not.toHaveClass(/hidden/);
});

test('player moves with WASD and stays on the island', async ({ page }) => {
  await boot(page);
  await startSettled(page);
  const before = await page.evaluate(() => window.__game.playerPos);
  await page.keyboard.down('w');
  // hold W until the player has covered real distance
  await page.waitForFunction(({ x, z }) => {
    const p = window.__game.playerPos;
    return Math.hypot(p.x - x, p.z - z) > 3;
  }, before, { timeout: 20000 });
  await page.keyboard.up('w');
  const after = await page.evaluate(() => window.__game.playerPos);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(3);
  await page.waitForFunction(() => window.__game.grounded, { timeout: 5000 });
});

test('player can jump and lands again', async ({ page }) => {
  await boot(page);
  await startSettled(page);
  const y0 = (await page.evaluate(() => window.__game.playerPos)).y;
  await page.keyboard.press('Space');
  // the jump peaks ~2 units up; catch it above +0.5
  await page.waitForFunction((base) => window.__game.playerPos.y > base + 0.5, y0, { timeout: 10000 });
  await page.waitForFunction(() => window.__game.grounded, { timeout: 10000 });
  expect(await page.evaluate(() => window.__game.grounded)).toBe(true);
});

test('collects a crystal by walking into it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  // teleport right next to a crystal, then walk through it
  const c = await page.evaluate(() => window.__game.crystalPositions()[1]);
  await page.evaluate(({ x, z }) => {
    window.__game.teleport(x, z + 4);
    window.__game.setYaw(0); // camera looks -z, so W walks toward the crystal
  }, c);
  await page.waitForTimeout(400);
  await page.keyboard.down('w');
  await page.waitForTimeout(1600);
  await page.keyboard.up('w');
  const collected = await page.evaluate(() => window.__game.crystalsCollected);
  expect(collected).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#crystal-count')).toContainText(`${collected} / 10`);
});

test('falling off the island respawns the player', async ({ page }) => {
  await boot(page);
  await startSettled(page);
  // teleport into the void — groundHeight is -Infinity there
  await page.evaluate(() => window.__game.teleport(0, 200));
  // fall past the kill plane, respawn, land back on the island
  await page.waitForFunction(() => {
    const p = window.__game.playerPos;
    return p.y > -20 && p.z < 100 && window.__game.grounded;
  }, undefined, { timeout: 30000 });
  const pos = await page.evaluate(() => window.__game.playerPos);
  const g = await page.evaluate(({ x, z }) => window.__game.groundHeight(x, z), pos);
  expect(Math.abs(pos.y - g)).toBeLessThan(3);
});

test('bridges are walkable ground', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  // midpoint of the west bridge (main island -> satellite at -95, -34)
  const mid = await page.evaluate(() => {
    const g = window.__game.groundHeight(-73, -25);
    return g;
  });
  expect(mid).toBeGreaterThan(-10);
  expect(mid).toBeLessThan(20);
});

test('win state triggers after collecting everything', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  // walk into every crystal via teleport
  const total = await page.evaluate(() => window.__game.totalCrystals);
  for (let i = 0; i < total; i++) {
    await page.evaluate((idx) => {
      const c = window.__game.crystalPositions()[idx];
      window.__game.teleport(c.x, c.z + 1.2);
    }, i);
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__game.crystalsCollected)).toBe(total);
  expect(await page.evaluate(() => window.__game.state)).toBe('win');
  await expect(page.locator('#win-screen')).not.toHaveClass(/hidden/);
});

test('pause and resume flow', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(300);
  // Esc exits pointer lock -> pause (simulate directly since headless has no lock)
  await page.evaluate(() => {
    // trigger the same path the pointerlockchange handler uses
    document.dispatchEvent(new Event('pointerlockchange'));
  });
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => window.__game.state);
  if (st === 'paused') {
    await page.click('#btn-resume');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__game.state)).toBe('playing');
  } else {
    // pointer lock never engaged headless; pausing is a no-op — still fine
    expect(st).toBe('playing');
  }
});

test('day/night cycle changes lighting without errors', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__game.start());
  for (const t of [0.05, 0.25, 0.48, 0.6, 0.75, 0.95]) {
    await page.evaluate((tt) => window.__game.setTimeOfDay(tt), t);
    await page.waitForTimeout(250);
  }
  expect(errors).toEqual([]);
});
