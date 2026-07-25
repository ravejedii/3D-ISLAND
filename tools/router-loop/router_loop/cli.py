"""Command-line entry point for the router loop.

    # scaffold a spec for the current project (auto-detects the gate)
    python -m router_loop init --goal "All tests pass"

    # run a loop from a spec file
    python -m router_loop run --spec examples/fix_tests_spec.json

    # run an ad-hoc loop with a command gate (the strongest kind)
    python -m router_loop run --goal "all tests pass" --gate-command "pytest -q" \
        --workdir . --worker-tool Read --worker-tool Edit --worker-tool Bash \
        --worker-permission-mode acceptEdits --max-iters 6

    # resume a loop that was interrupted
    python -m router_loop resume --state .router/state.json --spec examples/fix_tests_spec.json

    # inspect a loop's state
    python -m router_loop status --state .router/state.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import List, Optional

from .config import CommandGate, HumanGate, LoopSpec, ModelConfig, RubricGate
from .loop import RouterLoop
from .scaffold import detect_project, scaffold_spec
from .state import LoopState


def _print(msg: str) -> None:
    print(msg, flush=True)


def _spec_from_args(args: argparse.Namespace) -> LoopSpec:
    if args.spec:
        spec = LoopSpec.from_json_file(args.spec)
        # allow a couple of ergonomic overrides
        if args.max_iters is not None:
            spec.max_iterations = args.max_iters
        if args.workdir is not None:
            spec.workdir = args.workdir
        return spec

    if not args.goal:
        raise SystemExit("Provide either --spec <file> or --goal <text>.")

    command_gate = CommandGate(command=args.gate_command) if args.gate_command else None
    rubric_gate = None
    if args.gate_criterion:
        rubric_gate = RubricGate(
            criteria=list(args.gate_criterion),
            threshold=args.gate_threshold,
            model=args.checker_model,
        )
    human_gate = None
    if args.human_gate:
        human_gate = HumanGate(evidence_hint=args.evidence_hint)

    spec = LoopSpec(
        goal=args.goal,
        workdir=args.workdir or ".",
        router=ModelConfig(model=args.router_model),
        worker=ModelConfig(
            model=args.worker_model,
            allowed_tools=list(args.worker_tool or []),
            permission_mode=args.worker_permission_mode,
        ),
        command_gate=command_gate,
        rubric_gate=rubric_gate,
        human_gate=human_gate,
        max_iterations=args.max_iters if args.max_iters is not None else 8,
        max_cost_usd=args.max_cost,
    )
    spec.validate()
    return spec


def _cmd_run(args: argparse.Namespace, resume: bool = False) -> int:
    spec = _spec_from_args(args)
    loop = RouterLoop(spec, on_progress=_print)

    state: Optional[LoopState] = None
    if resume:
        if not args.state:
            raise SystemExit("resume requires --state <file>.")
        state = LoopState.load(args.state)
        _print(f"Resuming from {args.state} at iteration {state.iteration_count}.")

    report = loop.run(state=state)
    _print("\n" + "=" * 48)
    _print(report.summary())
    return 0 if report.succeeded else 1


def _cmd_init(args: argparse.Namespace) -> int:
    workdir = args.workdir or "."
    out = args.out or os.path.join(workdir, "router.spec.json")
    if os.path.exists(out) and not args.force:
        raise SystemExit(f"{out} already exists. Pass --force to overwrite.")

    det = detect_project(workdir)
    spec = scaffold_spec(workdir, goal=args.goal)

    if args.human:
        # Taste/visual work: swap the command gate for a human gate.
        spec.pop("command_gate", None)
        spec["human_gate"] = {
            "prompt": "Approve this result, or say exactly what to change.",
            "evidence_hint": "e.g. open ./screenshot.png",
        }
        spec["_note"] = ("Human gate: you are the verifier (zero tokens). For taste/"
                         "visual work. Requires an interactive terminal. See docs/GATES.md.")

    with open(out, "w", encoding="utf-8") as fh:
        json.dump(spec, fh, indent=2)
        fh.write("\n")

    _print(f"Detected project: {det.kind}")
    _print(f"Wrote starter spec: {out}")
    _print("")
    _print("Next steps:")
    if args.human:
        _print(f"  1. Edit {out} -- set a real 'goal' and instruct the worker to "
                "produce evidence (e.g. a screenshot) each pass.")
        _print("     You will be asked to approve or give feedback each iteration.")
    else:
        _print(f"  1. Edit {out} -- set a real 'goal', and confirm the gate command:")
        _print(f"         command_gate.command = {det.gate_command!r}")
        if not det.confident:
            _print("     (heads up: I could not confirm this command -- double-check it "
                    "actually proves the goal)")
    _print(f"  2. Run it:      python -m router_loop run --spec {out}")
    _print(f"  3. Inspect:     python -m router_loop status --state "
            f"{os.path.join(workdir, '.router', 'state.json')}")
    return 0


def _cmd_status(args: argparse.Namespace) -> int:
    state = LoopState.load(args.state)
    _print(f"goal:        {state.goal}")
    _print(f"status:      {state.status}")
    _print(f"iterations:  {state.iteration_count}")
    _print(f"total cost:  ${state.total_cost_usd:.4f}")
    _print("\nledger:")
    _print(state.ledger_text())
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="router_loop", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    def add_common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--spec", help="Path to a JSON loop spec.")
        sp.add_argument("--goal", help="Goal text (for ad-hoc loops without a spec).")
        sp.add_argument("--workdir", help="Working directory for the loop.")
        sp.add_argument("--gate-command", help="Command gate: shell command that must exit 0.")
        sp.add_argument("--gate-criterion", action="append", help="Rubric criterion (repeatable).")
        sp.add_argument("--gate-threshold", type=int, default=8, help="Rubric pass threshold (1-10).")
        sp.add_argument("--human-gate", action="store_true",
                        help="You are the verifier (for taste/visual work). Zero tokens.")
        sp.add_argument("--evidence-hint", help="What to open when reviewing, e.g. './hero.png'.")
        sp.add_argument("--router-model", help="Model alias for the router role.")
        sp.add_argument("--worker-model", help="Model alias for the worker role.")
        sp.add_argument("--checker-model", help="Model alias for the rubric checker role.")
        sp.add_argument("--worker-tool", action="append", help="Tool the worker may use (repeatable).")
        sp.add_argument("--worker-permission-mode", help="Permission mode for the worker (e.g. acceptEdits).")
        sp.add_argument("--max-iters", type=int, help="Hard iteration cap.")
        sp.add_argument("--max-cost", type=float, help="Cost budget in USD.")

    run_p = sub.add_parser("run", help="Run a loop to completion or a stop condition.")
    add_common(run_p)

    resume_p = sub.add_parser("resume", help="Resume a previously saved loop.")
    add_common(resume_p)
    resume_p.add_argument("--state", required=True, help="Path to a saved state.json.")

    status_p = sub.add_parser("status", help="Print a saved loop's state.")
    status_p.add_argument("--state", required=True, help="Path to a saved state.json.")

    init_p = sub.add_parser(
        "init", help="Detect the project type and scaffold a starter router.spec.json."
    )
    init_p.add_argument("--workdir", help="Project directory to scan (default: cwd).")
    init_p.add_argument("--goal", help="Optional goal text to pre-fill.")
    init_p.add_argument("--out", help="Where to write the spec (default: <workdir>/router.spec.json).")
    init_p.add_argument("--force", action="store_true", help="Overwrite an existing spec.")
    init_p.add_argument("--human", action="store_true",
                        help="Scaffold a human-gated spec (taste/visual work) instead of a command gate.")

    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "run":
        return _cmd_run(args, resume=False)
    if args.command == "resume":
        return _cmd_run(args, resume=True)
    if args.command == "status":
        return _cmd_status(args)
    if args.command == "init":
        return _cmd_init(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
