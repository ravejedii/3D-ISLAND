#!/usr/bin/env node
// Deterministic HERO + GROUNDING gate — no vision model.
//
// Two classes of shipped failure passed every existing gate because those
// gates looked at the whole frame or at the UI, never at the character or the
// ground contract:
//
//   * the knight rendered pure white (texture atlas dropped in a material
//     conversion) — frame-level stats barely moved
//   * the inverted-hull outline ballooned into black blobs on the sword and
//     shield — again invisible to frame-level stats
//   * the castle's corner towers hung over falling slope ("perched on the
//     hill") — a pure geometry fact no screenshot statistic sees
//
// This gate closes all three holes with mechanical checks:
//
//   H1  the hero occupies a sane fraction of a canonical close-up portrait
//       (catches missing / mis-scaled / invisible character)
//   H2  the hero region carries real colour variety — multiple distinct hues,
//       real tonal spread (catches the all-white and all-black failures)
//   H3  no large near-black mass inside the hero region (catches outline-blob
//       regressions; the plume/ink accents stay well under the ceiling)
//   H4  the hero region contains the heraldic crimson identity (catches
//       accidentally shipping an undressed / wrongly-tinted character)
//   G1  every placed structure's footprint stands on ground consistent with
//       its base — max corner drop bounded (catches perched buildings)
//
// Taste is still a human's job. This is the floor under it.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const UPDATE_BASELINE = process.argv.includes('--update-baseline');
const BASELINE = 'art-review/hero-baseline.png';
const PORT = Number(process.env.HERO_GATE_PORT || 4291);
const URL = `http://localhost:${PORT}`;
const OUT_DIR = process.env.HERO_GATE_DIR || 'test-results/hero-gate';

// ---------- minimal PNG decode (shared approach with visual-gate) ----------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, colorType = 6, bitDepth = 8;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error('unsupported PNG');
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, ch, data: out };
}

// Analyse the rect the game itself reports the hero occupies (projected from
// the player's world position through the live camera). The first version
// assumed the hero sat centred — he doesn't (camera smoothing + slope settle),
// so that window graded the background and passed a deliberately whitened
// knight. Never assume where the subject is; ask the renderer.
function analyzeHeroRegion(png, rect) {
  const { width, height, ch, data } = png;
  const x0 = Math.max(0, Math.floor(rect.cx - rect.rx)), x1 = Math.min(width, Math.ceil(rect.cx + rect.rx));
  const y0 = Math.max(0, Math.floor(rect.cy - rect.ry)), y1 = Math.min(height, Math.ceil(rect.cy + rect.ry));
  let total = 0, nearBlack = 0, nearWhite = 0, crimson = 0;
  const lum = [];
  const hueBins = new Set();
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      total++;
      lum.push(l);
      if (l < 14) nearBlack++;
      if (l > 243) nearWhite++;
      // heraldic crimson: strongly red, dark-to-mid value
      if (r > 90 && r > g * 1.8 && r > b * 1.8) crimson++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn > 24) { // chromatic pixel: bin its dominant hue
        const hue = mx === r ? (g >= b ? 0 : 5) : mx === g ? 2 : 4;
        hueBins.add(hue + (l > 128 ? 10 : 0));
      }
    }
  }
  const mean = lum.reduce((a, v) => a + v, 0) / lum.length;
  const std = Math.sqrt(lum.reduce((a, v) => a + (v - mean) ** 2, 0) / lum.length);
  return {
    meanLum: mean,
    stdLum: std,
    blackFrac: nearBlack / total,
    whiteFrac: nearWhite / total,
    crimsonFrac: crimson / total,
    hueGroups: hueBins.size,
  };
}

const LIMITS = {
  stdLumMin: 20,        // all-white knight measured ~run-flat; healthy portrait ~40+
  blackFracMax: 0.16,   // ink-blob bug painted large black masses; plume+shadows stay small
  whiteFracMax: 0.30,   // sky shows through the window; an all-white character pushes far past this
  crimsonFracMin: 0.005, // cape/crest/rosette must actually be present
  hueGroupsMin: 3,      // steel + crimson + skin/ground at minimum
  groundDropMax: 1.6,   // metres a structure footprint corner may sit above/below its base
};

const fails = [];
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  await new Promise((r) => setTimeout(r, 2500));
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', (e) => fails.push(`page error: ${e.message}`));
  await page.goto(`${URL}/?fx`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game !== undefined, { timeout: 60000 });
  await page.evaluate(() => { window.__game.setQuality(0); window.__game.start(); });
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 30000 });

  console.log('hero gate — deterministic character + grounding checks');

  if (!(await page.evaluate(() => window.__game.usingModelPlayer))) {
    fails.push('[H0] model player did not load — portrait checks would grade the fallback');
  }

  // canonical portrait: hero facing the camera, sun behind the camera.
  // Teleport drops with zeroed velocity, but on a slope the hero immediately
  // starts sliding and the smoothed camera never catches him (measured: he
  // projected fully off-frame). So: settle first, then re-teleport to pin him,
  // then wait only for the camera lerp — and verify he actually settled.
  const settle = async () => {
    await page.evaluate(() => {
      window.__game.setTimeOfDay(0.34);
      window.__game.teleport(0, 30); // flat meadow (perf-tour waypoint)
      window.__game.setHeading(0);
      window.__game.setYaw(0);
      window.__game.setPitch(0.06);
      window.__game.setCamDistance(3.4);
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__game.teleport(0, 30)); // kill any slide
    await page.waitForTimeout(1500);
  };
  await settle();
  let rectProbe = await page.evaluate(() => window.__game.heroScreenRect());
  if (!(rectProbe.cx > 120 && rectProbe.cx < 780)) { // camera missed him — retry once
    await settle();
    rectProbe = await page.evaluate(() => window.__game.heroScreenRect());
  }
  if (!(rectProbe.cx > 60 && rectProbe.cx < 840 && rectProbe.cy > 60 && rectProbe.cy < 840)) {
    fails.push(`[H1] hero projects at (${Math.round(rectProbe.cx)},${Math.round(rectProbe.cy)}) — outside the frame; camera is not tracking the character`);
  }
  const rect = await page.evaluate(() => window.__game.heroScreenRect());
  console.log('  hero rect:', JSON.stringify(rect));
  if (!rect || !(rect.ry > 12)) fails.push('[H0] hero projects to a degenerate screen rect');
  const buf = await page.screenshot();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/portrait.png`, buf);
  const s = analyzeHeroRegion(decodePNG(buf), rect);
  console.log(`  portrait: lum=${s.meanLum.toFixed(1)}±${s.stdLum.toFixed(1)} black=${(s.blackFrac * 100).toFixed(1)}% white=${(s.whiteFrac * 100).toFixed(1)}% crimson=${(s.crimsonFrac * 100).toFixed(2)}% hueGroups=${s.hueGroups}`);

  // H5 — the strongest check: the hero region must match the APPROVED
  // baseline portrait. Fixed statistics cannot separate "styled differently"
  // from "broken" (the hero's own bbox contains background, and accents like
  // the plume satisfy naive colour floors), but a pixel diff against a
  // human-approved baseline catches every dramatic regression: whitened
  // atlas, black blobs, missing dressing, wrong palette. Intentional hero
  // changes re-approve with: node scripts/hero-gate.mjs --update-baseline
  if (UPDATE_BASELINE) {
    writeFileSync(BASELINE, buf);
    console.log(`  baseline updated: ${BASELINE}`);
  } else if (!existsSync(BASELINE)) {
    fails.push(`[H5] no approved baseline at ${BASELINE} — run with --update-baseline after a human approves the portrait`);
  } else {
    const base = decodePNG(readFileSync(BASELINE));
    const cur = decodePNG(buf);
    if (base.width === cur.width && base.height === cur.height) {
      const x0 = Math.max(0, Math.floor(rect.cx - rect.rx)), x1 = Math.min(cur.width, Math.ceil(rect.cx + rect.rx));
      const y0 = Math.max(0, Math.floor(rect.cy - rect.ry)), y1 = Math.min(cur.height, Math.ceil(rect.cy + rect.ry));
      let diff = 0, total = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * cur.width + x) * cur.ch;
          const j = (y * base.width + x) * base.ch;
          const d = Math.max(
            Math.abs(cur.data[i] - base.data[j]),
            Math.abs(cur.data[i + 1] - base.data[j + 1]),
            Math.abs(cur.data[i + 2] - base.data[j + 2]),
          );
          total++;
          if (d > 30) diff++;
        }
      }
      const frac = diff / total;
      console.log(`  baseline diff: ${(frac * 100).toFixed(1)}% of hero region changed`);
      if (frac > 0.15) fails.push(`[H5] hero region differs from approved baseline by ${(frac * 100).toFixed(1)}% (>15%) — if intentional, re-approve with --update-baseline`); // measured noise floor: 0.2%; whitened-knight sabotage: 26.3%
    } else {
      fails.push('[H5] baseline resolution mismatch — recapture with --update-baseline');
    }
  }

  if (s.stdLum < LIMITS.stdLumMin) fails.push(`[H2] hero region tonal spread ${s.stdLum.toFixed(1)} < ${LIMITS.stdLumMin} — flat/washed character (the all-white-knight class)`);
  if (s.blackFrac > LIMITS.blackFracMax) fails.push(`[H3] ${(s.blackFrac * 100).toFixed(1)}% near-black in hero region (>${LIMITS.blackFracMax * 100}%) — outline-blob class regression`);
  if (s.whiteFrac > LIMITS.whiteFracMax) fails.push(`[H2] ${(s.whiteFrac * 100).toFixed(1)}% near-white in hero region (>${LIMITS.whiteFracMax * 100}%) — blown or untextured character`);
  if (s.crimsonFrac < LIMITS.crimsonFracMin) fails.push(`[H4] heraldic crimson ${(s.crimsonFrac * 100).toFixed(2)}% < ${LIMITS.crimsonFracMin * 100}% — the hero's identity colours are missing`);
  if (s.hueGroups < LIMITS.hueGroupsMin) fails.push(`[H2] only ${s.hueGroups} hue groups in hero region (<${LIMITS.hueGroupsMin}) — monochrome character`);

  // grounding contract
  const grounding = await page.evaluate(() => window.__game.groundingReport());
  const worst = grounding.reduce((a, g) => (g.drop > a.drop ? g : a), { drop: 0, label: 'none' });
  console.log(`  grounding: ${grounding.length} footprints, worst drop ${worst.drop}m (${worst.label})`);
  for (const g of grounding) {
    if (g.drop > LIMITS.groundDropMax) fails.push(`[G1] ${g.label}: footprint sits ${g.drop}m off its base ground (>${LIMITS.groundDropMax}m) — floating/buried structure`);
  }
} catch (err) {
  fails.push(`gate error: ${err.message}`);
} finally {
  if (browser) await browser.close();
  server.kill();
}

if (fails.length) {
  console.log(`\n  ${fails.length} violation(s):`);
  for (const f of fails) console.log(`   - ${f}`);
  console.log('\nhero gate: FAIL');
  process.exit(1);
}
console.log('hero gate: PASS (mechanical floor — "cool" is still judged by a human)');
process.exit(0);
