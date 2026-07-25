#!/usr/bin/env node
// Deterministic render gate for the router loop — NO vision model.
//
// The doctrine in tools/router-loop/docs/GATES.md: never let an LLM grade its
// own screenshots. Most "does it look right?" work hides objective facts that a
// command can check for free. This gate checks the ones this project actually
// shipped bugs against:
//
//   * iOS Safari white-screen  -> the frame was a flat fill, no world at all
//   * washed-out mobile render -> exposure tuned for a sky the phone never draws
//   * camera/terrain breakage  -> no ground in the lower frame
//
// It boots the real build on both render paths (desktop composer chain and the
// plain mobile path), screenshots a gameplay frame, and asserts pixel facts.
// Exit 0 = pass. Taste is NOT judged here; that is a human's job.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.GATE_PORT || 4219);
const URL = `http://localhost:${PORT}`;
const SHOT_DIR = process.env.GATE_SHOT_DIR || 'test-results/visual-gate';

// ---------- minimal PNG decoder (8-bit RGB/RGBA, filters 0-4) ----------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, colorType = 6, bitDepth = 8;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (bitDepth=${bitDepth} colorType=${colorType})`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

// ---------- frame statistics ----------
function analyze(png) {
  const { width, height, channels, data } = png;
  const lum = [];
  const colors = new Set();
  let greenish = 0, lowerGreen = 0, lowerCount = 0, nearWhite = 0, nearBlack = 0, total = 0;
  // ignore the bottom strip: the HUD control bar is UI chrome, not the world
  const yEnd = Math.floor(height * 0.88);
  for (let y = 0; y < yEnd; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum.push(l);
      colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)); // 5-bit quantized
      const isGreen = g > r + 12 && g > b + 12;
      if (isGreen) greenish++;
      if (y > height * 0.45) {
        lowerCount++;
        if (isGreen) lowerGreen++;
      }
      if (l > 245) nearWhite++;
      if (l < 8) nearBlack++;
      total++;
    }
  }
  const mean = lum.reduce((a, v) => a + v, 0) / lum.length;
  const variance = lum.reduce((a, v) => a + (v - mean) ** 2, 0) / lum.length;
  return {
    meanLum: mean,
    stdLum: Math.sqrt(variance),
    distinctColors: colors.size,
    greenFrac: greenish / total,
    lowerGreenFrac: lowerCount ? lowerGreen / lowerCount : 0,
    whiteFrac: nearWhite / total,
    blackFrac: nearBlack / total,
  };
}

// Thresholds are deliberately loose: this gate catches broken frames
// (blank / blown out / no world), not art-direction opinions.
const LIMITS = {
  distinctColors: 260,   // a flat or near-flat fill lands far below this
  meanLumMin: 28,
  meanLumMax: 224,
  stdLumMin: 12,         // a washed-out frame has almost no tonal spread
  lowerGreenFracMin: 0.12, // the island must occupy the lower frame
  whiteFracMax: 0.55,
  blackFracMax: 0.55,
};

function check(label, s) {
  const fails = [];
  if (s.distinctColors < LIMITS.distinctColors) fails.push(`only ${s.distinctColors} distinct colours (<${LIMITS.distinctColors}) — frame is blank or near-flat`);
  if (s.meanLum < LIMITS.meanLumMin) fails.push(`mean luminance ${s.meanLum.toFixed(1)} too dark (<${LIMITS.meanLumMin})`);
  if (s.meanLum > LIMITS.meanLumMax) fails.push(`mean luminance ${s.meanLum.toFixed(1)} blown out (>${LIMITS.meanLumMax})`);
  if (s.stdLum < LIMITS.stdLumMin) fails.push(`luminance spread ${s.stdLum.toFixed(1)} too flat (<${LIMITS.stdLumMin}) — washed out`);
  if (s.lowerGreenFrac < LIMITS.lowerGreenFracMin) fails.push(`lower frame only ${(s.lowerGreenFrac * 100).toFixed(1)}% green (<${LIMITS.lowerGreenFracMin * 100}%) — no ground rendered`);
  if (s.whiteFrac > LIMITS.whiteFracMax) fails.push(`${(s.whiteFrac * 100).toFixed(1)}% near-white — white-screen`);
  if (s.blackFrac > LIMITS.blackFracMax) fails.push(`${(s.blackFrac * 100).toFixed(1)}% near-black — nothing rendered`);
  const stat = `colours=${s.distinctColors} lum=${s.meanLum.toFixed(1)}±${s.stdLum.toFixed(1)} lowerGreen=${(s.lowerGreenFrac * 100).toFixed(1)}% white=${(s.whiteFrac * 100).toFixed(1)}%`;
  console.log(`  ${fails.length ? 'FAIL' : 'ok  '}  ${label.padEnd(9)} ${stat}`);
  for (const f of fails) console.log(`         - ${f}`);
  return fails.length === 0;
}

async function capture(browser, { label, query, viewport, touch }) {
  const page = await browser.newPage({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    userAgent: touch
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL + query, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game !== undefined, { timeout: 60000 });
  await page.evaluate(() => window.__game.start());
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 30000 });
  // let the world settle: player lands, first frames compile shaders
  await page.waitForFunction(() => window.__game.grounded, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const buf = await page.screenshot();
  mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(`${SHOT_DIR}/${label}.png`, buf);
  const stats = analyze(decodePNG(buf));
  await page.close();
  return { stats, errors };
}

const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: false,
});
let browser;
let ok = true;
try {
  await new Promise((r) => setTimeout(r, 2500));
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  console.log('visual gate — deterministic render checks (no vision model)');
  const paths = [
    { label: 'desktop', query: '/', viewport: { width: 1280, height: 720 }, touch: false },
    { label: 'mobile', query: '/?touch', viewport: { width: 390, height: 844 }, touch: true },
  ];
  for (const p of paths) {
    const { stats, errors } = await capture(browser, p);
    if (!check(p.label, stats)) ok = false;
    if (errors.length) {
      ok = false;
      console.log(`  FAIL  ${p.label.padEnd(9)} ${errors.length} console/page error(s):`);
      for (const e of errors.slice(0, 5)) console.log(`         - ${e}`);
    }
  }
} catch (err) {
  console.error('visual gate ERROR:', err.message);
  ok = false;
} finally {
  if (browser) await browser.close();
  server.kill();
}
console.log(ok ? 'visual gate: PASS' : 'visual gate: FAIL');
process.exit(ok ? 0 : 1);
