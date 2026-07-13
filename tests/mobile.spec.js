import { test, expect } from '@playwright/test';

const URL = 'http://localhost:4173';

async function bootMobile(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game !== undefined, { timeout: 20000 });
  return errors;
}

test('detects touch device and shows touch controls in game', async ({ page }) => {
  const errors = await bootMobile(page);
  expect(await page.evaluate(() => document.body.classList.contains('touch-mode'))).toBe(true);
  // start via tap on the title button
  await page.tap('#btn-play');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__game.state)).toBe('playing');
  await expect(page.locator('#touch-ui')).toHaveClass(/active/);
  await expect(page.locator('#btn-jump')).toBeVisible();
  await expect(page.locator('#btn-pause-touch')).toBeVisible();
  expect(errors).toEqual([]);
});

test('virtual joystick moves the player', async ({ page }) => {
  await bootMobile(page);
  await page.tap('#btn-play');
  await page.waitForFunction(() => window.__game.grounded && window.__game.fps > 5, null, { timeout: 30000 });
  const before = await page.evaluate(() => window.__game.playerPos);

  // hold a forward drag on the left joystick zone
  const zone = page.locator('#joy-zone');
  const box = await zone.boundingBox();
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.7;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 70, id: 1 }] });
  await page.waitForTimeout(2500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  const after = await page.evaluate(() => window.__game.playerPos);
  const dist = Math.hypot(after.x - before.x, after.z - before.z);
  expect(dist).toBeGreaterThan(1.5);
});

test('jump button makes the player jump', async ({ page }) => {
  await bootMobile(page);
  await page.tap('#btn-play');
  await page.waitForFunction(() => window.__game.grounded && window.__game.fps > 5, null, { timeout: 30000 });
  const y0 = (await page.evaluate(() => window.__game.playerPos)).y;
  await page.tap('#btn-jump');
  await page.waitForFunction((base) => window.__game.playerPos.y > base + 0.5, y0, { timeout: 10000 });
  await page.waitForFunction(() => window.__game.grounded, { timeout: 10000 });
});

test('touch drag on the right side turns the camera', async ({ page }) => {
  await bootMobile(page);
  await page.tap('#btn-play');
  await page.waitForFunction(() => window.__game.grounded && window.__game.fps > 5, null, { timeout: 30000 });
  await page.evaluate(() => window.__game.setYaw(0.5));
  const yaw0 = 0.5;
  const zone = page.locator('#look-zone');
  const box = await zone.boundingBox();
  const sx = box.x + box.width * 0.5;
  const sy = box.y + box.height * 0.4;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx - i * 25, y: sy, id: 1 }] });
    await page.waitForTimeout(60);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const yaw1 = await page.evaluate(() => window.__game.cameraYaw);
  // camera yaw should have changed from the drag
  expect(Math.abs(yaw1 - yaw0)).toBeGreaterThan(0.15);
});

test('pause button pauses; resume returns to game', async ({ page }) => {
  await bootMobile(page);
  await page.tap('#btn-play');
  await page.waitForTimeout(600);
  await page.tap('#btn-pause-touch');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__game.state)).toBe('paused');
  await page.tap('#btn-resume');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__game.state)).toBe('playing');
});
