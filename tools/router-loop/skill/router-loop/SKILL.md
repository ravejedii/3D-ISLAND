---
name: router-loop
description: >-
  Run a gated, self-verifying autonomous loop over the current project until an
  objective goal is met. Use when the user wants to "keep iterating until the
  tests/build/lint pass", "run a loop on this", "grind on X until it's green",
  or otherwise wants Claude to work end-to-end against a hard verifier instead
  of one manual round-trip at a time. This is the heavy, verified loop (maker vs
  separate checker, memory ledger, stop conditions) — not the lightweight
  interval re-run of the built-in /loop.
---

# router-loop

This project ships `router-loop`, a five-phase autonomous loop
(DISCOVER → PLAN → EXECUTE → VERIFY → ITERATE) that runs against the user's
Claude subscription via `claude -p`. Use it to drive a task to an objective bar
without a human in every round. Source and full docs live in the router-loop
repo; this skill is how you invoke it inside any project.

## When to use it

Only when **all four** hold — otherwise a single good prompt is better, and you
should say so:

1. The task repeats (or will be re-run).
2. There is a command that can automatically reject bad output (test/build/lint/typecheck).
3. Claude can do the work end-to-end.
4. "Done" is objective, not a matter of taste.

If there is no automatic reject condition, do **not** fabricate one — tell the
user the loop has no real gate and stop.

## How to run it

1. **Confirm the CLI is available.** Run `router-loop --help` (or
   `python -m router_loop --help`). If missing, install it once:
   `pipx install git+<router-loop-repo-url>` (or `pip install -e <path>`).

2. **Get or create a spec.** If the project has a `router.spec.json`, use it.
   Otherwise scaffold one — it auto-detects the verifier:
   ```
   router-loop init --workdir . --goal "<the user's objective>"
   ```
   Then open the generated `router.spec.json` and:
   - Sharpen `goal` so it states exactly what "done" means.
   - **Verify `command_gate.command` actually proves that goal.** This is the
     single most important field. A weak gate makes the whole loop pointless.
   - Leave `model` fields out to use the defaults: the deciders (router +
     verifier) prefer Fable and fall back to Opus when Fable is unavailable or
     out of credits; the worker uses Sonnet. Only set `model` / `model_chain`
     per role if the user asks for something specific.

3. **Run the loop:**
   ```
   router-loop run --spec router.spec.json
   ```
   It prints each iteration's plan, work, and verify result, then a final
   status with total and per-iteration cost.

4. **Report back honestly.** State the outcome (`succeeded` /
   `failed_max_iterations` / `failed_budget`), the iteration count, and the
   cost. If it did not converge, summarize the ledger
   (`router-loop status --state .router/state.json`) — what was tried and why
   the gate kept failing — rather than claiming partial success.

## Guardrails

- **Never weaken the gate to make the loop pass.** Editing the test/build to go
  green defeats the entire purpose. If the goal turns out to be wrong, ask the
  user; do not quietly move the goalposts.
- The loop only succeeds when the verifier passes — a worker claiming "done" is
  not success. Trust the gate's verdict, not the work summary.
- Respect `max_iterations` and `max_cost_usd`; if the loop keeps failing, report
  and ask rather than raising the caps unprompted.
