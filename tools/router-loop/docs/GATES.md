# Gates: what they are and how to choose one

**The gate is the single most important part of a loop, and the part most
people get wrong.** This page explains exactly what it is, the three kinds, and
— most importantly — what to do about **taste-based and visual work**, where a
naive gate wastes tokens and lies to you.

## What a gate *is*

> A gate is the check that decides whether the work is **done**. It is the only
> thing that can end the loop.

Each iteration the loop does: plan → work → **run the gate**. If the gate
passes, the loop stops and reports success. If it fails, the gate's feedback is
written into memory and the loop tries again.

That's it. The gate is a yes/no verdict on "is this good enough?" — and the
whole value of a loop comes from that verdict being **trustworthy** and
**independent of the agent that did the work**. The model that wrote the code is
far too generous a grader of its own code, so the gate is deliberately separate.

**No gate, no loop.** Without a real check, the agent just agrees with itself on
repeat and "converges" on nothing. A spec with no gate is rejected on purpose.

## The three kinds of gate

| Gate | What it is | Verdict source | Token cost | Trust |
|---|---|---|---|---|
| **Command** | A shell command; exit `0` = pass | The real system (tests, build, lint, types, a pixel-diff) | none | **Highest** — ground truth, can't be argued with |
| **Rubric** | A *separate* model scores your criteria 1–10 | A model's judgment | ~1 call/iter | Medium — strict, but it's still an opinion |
| **Human** | You look and approve / give feedback | You | none | Highest for *taste*; needs you present |

You can combine them. When you do, **all** configured gates must pass — and the
human is only asked once the automated ones pass, so you're never made to
eyeball work that already failed a test.

### 1. Command gate — use this whenever you possibly can

```json
"command_gate": { "command": "npm test && npm run typecheck" }
```

Anything that exits non-zero on failure is a gate: `pytest`, `npm test`,
`cargo test`, `go test ./...`, `tsc`, `ruff`, `eslint`, a build, or a script you
write. This is the strongest gate because it checks reality, not vibes, and it
costs zero tokens.

### 2. Rubric gate — only when nothing can be executed

```json
"rubric_gate": {
  "criteria": [
    "The function correctly reverses any string including unicode",
    "There is a docstring and a type signature"
  ],
  "threshold": 8
}
```

A separate checker model scores each criterion. It caught obviously-broken code
(scored it 1/10) in testing — but it is judgment, not proof. **Keep criteria
concrete and checkable** ("returns the reversed string, not the input"), never
vague ("is it good?"). A vague rubric is the fastest way to a loop that passes
garbage.

### 3. Human gate — the honest gate for taste

```json
"human_gate": {
  "prompt": "Approve if the hero looks premium, else say what's off.",
  "evidence_hint": "open ./hero.png"
}
```

You are the verifier. Zero tokens. Each iteration the loop shows you what the
worker did (and points you at any evidence it produced), then waits: type `y` to
finish, or type feedback to iterate — your feedback is remembered so the next
pass builds on it. Requires an interactive terminal, so it's not for scheduled
runs.

## The hard part: taste-based and visual work

**Read this if the gate has been your pain point.** Here is the honest position:

> **Pure taste cannot be gated by a machine. Full stop.** "Does this look
> premium / feel right / land emotionally?" has no exit code and no reliable
> rubric. If you point a loop at that with an LLM gate, you get exactly the
> failure you've been living: it burns tokens trying to "look at" its own
> output, the visual evidence half-materializes, and it grades itself far too
> kindly.

Don't do that. Do one of these instead.

### Option A — split the objective substrate from the taste

Most "visual" work is not *all* taste. Underneath the taste sits a pile of
things that **are** objectively checkable, cheaply, with no vision model at all:

- the page **builds** and has **no console errors**
- the element **exists** and has the **expected computed styles** (color, font,
  spacing) — assert them in Playwright
- **contrast ratio ≥ 4.5:1**, and other **accessibility** checks (`axe`)
- **nothing overflows** the viewport; layout doesn't break at target widths
- a **screenshot diff** against an approved baseline is **under N%**

All of those are **command gates**. Gate the substrate deterministically, and
leave only the genuine taste to a human. You stop paying an LLM to judge things a
`test` command judges better and for free.

```json
"command_gate": { "command": "node visual-check.mjs" }
```

A minimal deterministic visual gate (no vision model — a pixel diff vs a
committed baseline):

```js
// visual-check.mjs  — exit 0 if the render matches the approved baseline
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:3000');
const shot = await page.screenshot();          // deterministic evidence
await browser.close();
writeFileSync('current.png', shot);

if (!existsSync('baseline.png')) {              // first run: adopt a baseline
  writeFileSync('baseline.png', shot);
  console.log('baseline captured'); process.exit(0);
}
const a = PNG.sync.read(shot), b = PNG.sync.read(readFileSync('baseline.png'));
const diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
const ratio = diff / (a.width * a.height);
console.log(`diff ${(ratio * 100).toFixed(2)}%`);
process.exit(ratio < 0.01 ? 0 : 1);            // the gate's verdict
```

Now the loop can iterate on "match the approved design" with a hard, cheap,
honest gate — and you only get involved to approve a *new* baseline.

### Option B — human gate, evidence produced once

When the thing really is a judgment call, use a `human_gate` and make the
**worker** produce the evidence a single time per iteration (render the page,
write `hero.png`), then *you* look. This is the inversion of your current pain:
instead of an LLM looping to verify itself, the artifact is produced once,
deterministically, and the only judge is the one that can actually judge it —
you. No tokens spent on self-verification, and the loop still does all the
planning, editing, and remembering of your feedback.

See [`examples/visual_review_spec.json`](../examples/visual_review_spec.json).

### Option C — don't loop at all

If it's a one-off and purely a matter of taste, a loop is the wrong tool. Use a
single good prompt, look at the result, and move on. Loops earn their setup only
when the work **repeats** and **something can objectively reject bad output**.
Be honest about which case you're in — that honesty is the whole skill.

## A 30-second decision guide

1. Can a **command** prove it's done (test / build / lint / diff)? → **command gate.** Best case.
2. No command, but the quality is **objectively describable** in concrete criteria? → **rubric gate**, criteria kept sharp.
3. It's a **judgment / taste / visual** call? → **human gate**, and push everything objective about it down into a command gate underneath.
4. It's a **one-off** and purely taste? → **no loop.** One good prompt.
