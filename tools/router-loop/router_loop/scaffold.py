"""Project detection + spec scaffolding, so a loop can be dropped into any repo.

The one thing that changes per project is the *verifier* -- the command that
proves the work is actually done. ``detect_project`` guesses it from the files
in a directory (pytest, npm test, cargo test, ...), and ``scaffold_spec`` writes
a starter ``router.spec.json`` you can commit and reuse. That committed spec is
the reusable "skill" for that project: instructions saved once, read every run.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class Detected:
    kind: str                 # human label, e.g. "python (pytest)"
    gate_command: str         # the verifier command
    worker_tools: List[str]   # tools the worker needs to act
    confident: bool           # False -> the user should double-check the command


_DEFAULT_TOOLS = ["Read", "Edit", "Write", "Bash"]


def _read(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


def detect_project(workdir: str) -> Detected:
    """Best-effort guess of a project's verifier command."""
    def has(name: str) -> bool:
        return os.path.exists(os.path.join(workdir, name))

    # ---- Node / JS / TS -------------------------------------------------
    if has("package.json"):
        pkg = {}
        try:
            pkg = json.loads(_read(os.path.join(workdir, "package.json")) or "{}")
        except json.JSONDecodeError:
            pkg = {}
        scripts = pkg.get("scripts", {}) or {}
        if "test" in scripts:
            return Detected("node (npm test)", "npm test", _DEFAULT_TOOLS, True)
        if "build" in scripts:
            return Detected("node (npm run build)", "npm run build", _DEFAULT_TOOLS, True)
        if "lint" in scripts:
            return Detected("node (npm run lint)", "npm run lint", _DEFAULT_TOOLS, True)
        return Detected("node (no test script found)", "npm test", _DEFAULT_TOOLS, False)

    # ---- Rust -----------------------------------------------------------
    if has("Cargo.toml"):
        return Detected("rust (cargo test)", "cargo test", _DEFAULT_TOOLS, True)

    # ---- Go -------------------------------------------------------------
    if has("go.mod"):
        return Detected("go (go test ./...)", "go test ./...", _DEFAULT_TOOLS, True)

    # ---- Python ---------------------------------------------------------
    py_markers = ["pyproject.toml", "setup.py", "setup.cfg", "tox.ini", "requirements.txt"]
    has_tests_dir = os.path.isdir(os.path.join(workdir, "tests")) or os.path.isdir(
        os.path.join(workdir, "test")
    )
    if any(has(m) for m in py_markers) or has_tests_dir:
        return Detected("python (pytest)", "python -m pytest -q", _DEFAULT_TOOLS, has_tests_dir)

    # ---- Make -----------------------------------------------------------
    if has("Makefile"):
        return Detected("make (make test)", "make test", _DEFAULT_TOOLS, False)

    # ---- Fallback -------------------------------------------------------
    return Detected(
        "unknown",
        "echo 'TODO: replace with a real verifier command (test/build/lint)' && false",
        _DEFAULT_TOOLS,
        False,
    )


def scaffold_spec(workdir: str, goal: Optional[str] = None) -> dict:
    """Build a starter spec dict for the project in ``workdir``.

    Model fields are intentionally omitted so the built-in defaults apply: the
    deciders (router + verifier) prefer Fable and fall back to Opus, and the
    worker uses Sonnet. Override per role with `model` / `model_chain` if needed.
    """
    det = detect_project(workdir)
    if goal:
        default_goal = goal
    elif det.confident:
        # A confidently detected verifier means this can crank as-is.
        default_goal = (
            f"Make the project's checks pass: `{det.gate_command}` must exit 0. "
            "Fix the smallest, highest-impact failure each iteration. Do not "
            "weaken, skip, or delete checks to make them pass."
        )
    else:
        default_goal = (
            "Describe the objective here. The loop stops only when the command "
            "gate below passes, so make the gate prove exactly this goal."
        )
    return {
        "goal": default_goal,
        "workdir": ".",
        "_detected": det.kind,
        "worker": {
            "allowed_tools": det.worker_tools,
            "permission_mode": "acceptEdits",
            "max_turns": 40,
        },
        "command_gate": {"command": det.gate_command, "timeout_seconds": 600},
        "max_iterations": 8,
        "max_cost_usd": 5.0,
    }
