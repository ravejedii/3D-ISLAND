#!/usr/bin/env node
// Deterministic UI-craft gate — NO vision model.
//
// scripts/visual-gate.mjs deliberately ignores the HUD strip: it gates the 3D
// frame. So nothing gated the interface at all, and the UI stayed a stack of
// identical glass rounded-rectangles — generic shapes.
//
// A machine cannot decide whether a UI "feels like Zelda". That is taste, and
// per tools/router-loop/docs/GATES.md it belongs to a human. What a machine CAN
// do is hold a craft FLOOR, so the loop cannot call generic default styling
// done. This checks:
//
//   A. every major surface carries a real frame treatment (ornament layer,
//      border-image, clip-path or mask) — not just border-radius + blur
//   B. the display face is actually used on headings, buttons and HUD labels
//   C. touch targets are >= 44px (Apple/WCAG floor)
//   D. nothing overflows horizontally at 320/390/768/1280
//   E. the interface uses real iconography, not only text
//   F. text on solid surfaces clears 4.5:1 contrast (WCAG AA)
//
// Exit 0 = the floor is met. It does NOT mean the UI is beautiful.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.UI_GATE_PORT || 4221);
const URL = `http://localhost:${PORT}`;

const fails = [];
const notes = [];
const fail = (rule, msg) => fails.push(`[${rule}] ${msg}`);

// ---------- helpers evaluated in-page ----------
const PAGE_HELPERS = () => {
  window.__ui = {
    // A decorative layer = a pseudo-element that paints, or a non-rectangular
    // / image-based frame. Plain border-radius + backdrop-filter is NOT one.
    hasFrameTreatment(el) {
      const s = getComputedStyle(el);
      if (s.borderImageSource && s.borderImageSource !== 'none') return 'border-image';
      if (s.clipPath && s.clipPath !== 'none') return 'clip-path';
      const mask = s.maskImage || s.webkitMaskImage;
      if (mask && mask !== 'none') return 'mask-image';
      for (const pseudo of ['::before', '::after']) {
        const p = getComputedStyle(el, pseudo);
        if (!p || p.content === 'none' || p.content === 'normal') continue;
        const paints =
          (p.backgroundImage && p.backgroundImage !== 'none') ||
          (p.borderImageSource && p.borderImageSource !== 'none') ||
          (p.backgroundColor && !/rgba?\(0, 0, 0, 0\)/.test(p.backgroundColor)) ||
          (p.boxShadow && p.boxShadow !== 'none') ||
          (parseFloat(p.borderTopWidth) || 0) > 0 ||
          (p.content && /"[^"]+"|url\(/.test(p.content));
        if (paints) return `${pseudo}`;
      }
      return null;
    },
    fontOf(el) { return getComputedStyle(el).fontFamily || ''; },
    // relative luminance / contrast per WCAG
    lum(c) {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    },
    parseRGB(s) {
      const m = String(s).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((v) => parseFloat(v));
      return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
    },
    contrast(fg, bg) {
      const L1 = this.lum(fg), L2 = this.lum(bg);
      const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
      return (hi + 0.05) / (lo + 0.05);
    },
  };
};

async function boot(page, { width, height, touch }) {
  await page.setViewportSize({ width, height });
  await page.goto(URL + (touch ? '/?touch' : '/'), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game !== undefined, { timeout: 60000 });
  await page.evaluate(PAGE_HELPERS);
}

const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  await new Promise((r) => setTimeout(r, 2500));
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  console.log('ui gate — deterministic UI craft floor (no vision model)');

  // ---------- title screen surfaces ----------
  await boot(page, { width: 1280, height: 720, touch: false });

  // A. frame treatment on every major surface
  const surfaces = await page.evaluate(() => {
    const sel = ['.title-stack', '.btn-primary', '.panel', '.card.crystal-counter', '.card.compass', '.hints'];
    const out = [];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el) { out.push({ sel: s, missing: true }); continue; }
      out.push({ sel: s, treatment: window.__ui.hasFrameTreatment(el) });
    }
    return out;
  });
  for (const s of surfaces) {
    if (s.missing) { fail('A', `surface ${s.sel} not found`); continue; }
    if (!s.treatment) fail('A', `${s.sel} has no frame treatment — plain rounded rectangle (needs an ornament layer, border-image, clip-path or mask)`);
    else notes.push(`    ${s.sel} frame: ${s.treatment}`);
  }

  // B. display face on headings / buttons / HUD labels
  const fontChecks = await page.evaluate(() => {
    const want = /cinzel/i;
    const sel = ['h1', '.btn-primary', '.eyebrow'];
    return sel.map((s) => {
      const el = document.querySelector(s);
      return el ? { sel: s, font: window.__ui.fontOf(el), ok: want.test(window.__ui.fontOf(el)) } : { sel: s, missing: true };
    });
  });
  for (const f of fontChecks) {
    if (f.missing) { fail('B', `${f.sel} not found`); continue; }
    if (!f.ok) fail('B', `${f.sel} does not use the display face (got ${f.font})`);
  }

  // E. iconography present
  const icons = await page.evaluate(() => ({
    titleOrnament: !!document.querySelector('#title-screen .ornament'),
    hudSvg: document.querySelectorAll('#hud svg').length,
  }));
  if (!icons.titleOrnament) fail('E', 'title screen has no ornament/crest element');
  if (icons.hudSvg < 1) fail('E', 'HUD has no inline SVG iconography');

  // F. contrast on solid surfaces
  const contrast = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#hud *, .screen *')) {
      if (!el.textContent || !el.textContent.trim()) continue;
      if (el.children.length) continue; // leaf text only
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') continue;
      // Find the nearest ancestor with a mostly-opaque background COLOR. If we
      // hit a gradient/image background first, the effective backdrop is not
      // resolvable from computed style alone (a light gradient behind dark text
      // reads as a false failure), so skip rather than report a wrong number.
      let bg = null;
      let gradient = false;
      for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.backgroundImage && ps.backgroundImage !== 'none') { gradient = true; break; }
        const c = window.__ui.parseRGB(ps.backgroundColor);
        if (c && c.a >= 0.6) { bg = c.rgb; break; }
      }
      if (gradient || !bg) continue; // not deterministically checkable
      const fg = window.__ui.parseRGB(s.color);
      if (!fg) continue;
      const ratio = window.__ui.contrast(fg.rgb, bg);
      if (ratio < 4.5) {
        out.push({ text: el.textContent.trim().slice(0, 24), cls: el.className || el.tagName, ratio: Math.round(ratio * 100) / 100 });
      }
    }
    return out;
  });
  for (const c of contrast.slice(0, 6)) fail('F', `contrast ${c.ratio}:1 (<4.5) on "${c.text}" (${c.cls})`);

  // ---------- mobile: touch targets ----------
  await boot(page, { width: 390, height: 844, touch: true });
  await page.evaluate(() => window.__game.start());
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 30000 });
  await page.waitForTimeout(600);
  const targets = await page.evaluate(() => {
    const sel = ['#btn-jump', '#btn-pause-touch'];
    return sel.map((s) => {
      const el = document.querySelector(s);
      if (!el) return { sel: s, missing: true };
      const r = el.getBoundingClientRect();
      return { sel: s, w: Math.round(r.width), h: Math.round(r.height) };
    });
  });
  for (const t of targets) {
    if (t.missing) { fail('C', `${t.sel} not found`); continue; }
    if (t.w < 44 || t.h < 44) fail('C', `${t.sel} is ${t.w}x${t.h}px — below the 44px touch floor`);
  }

  // D. no horizontal overflow at any target width
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(250);
    const over = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    if (over.doc) fail('D', `horizontal overflow at ${width}px (scrollWidth ${over.sw} > ${over.cw})`);
  }
} catch (err) {
  fail('!', `gate error: ${err.message}`);
} finally {
  if (browser) await browser.close();
  server.kill();
}

for (const n of notes) console.log(n);
if (fails.length) {
  console.log(`\n  ${fails.length} UI floor violation(s):`);
  for (const f of fails) console.log(`   - ${f}`);
  console.log('\nui gate: FAIL');
  process.exit(1);
}
console.log('\nui gate: PASS (craft floor met — beauty is still a human call)');
process.exit(0);
