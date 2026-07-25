"""Configuration objects for a router loop.

A :class:`LoopSpec` is the full definition of one loop: the goal, which model
plays which role, the verifier gate(s), and the stop conditions. Specs can be
built in Python or loaded from a JSON file (see ``examples/``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Default model preference chains, tried in order until one answers.
#
# The split follows the maker/checker principle: a fast, cheap *maker* and slow,
# strict *deciders*.
#   - The DECIDERS (the router that plans each step, and the verifier that
#     judges "done") prefer Fable and fall back to Opus when Fable is
#     unavailable or out of credits.
#   - The WORKER (the maker that does the grunt work) uses Sonnet -- cheaper,
#     and it doesn't need to be the smartest model in the room.
# Override any of these per role in a spec via `model` (single) or
# `model_chain` (list).
ORCHESTRATOR_MODEL_CHAIN: List[str] = ["claude-fable-5", "claude-opus-4-8"]
CHECKER_MODEL_CHAIN: List[str] = ["claude-fable-5", "claude-opus-4-8"]
WORKER_MODEL_CHAIN: List[str] = ["claude-sonnet-5"]


@dataclass
class ModelConfig:
    """How a single role (router / worker / checker) talks to Claude.

    A role can specify either a single ``model`` (CLI alias such as
    ``"claude-opus-4-8"`` or a full id) or a ``model_chain`` -- an ordered list
    of models tried in turn until one answers, so a preferred model can fall
    back to a reliable one when it is overloaded or out of credits. If neither
    is set, the role's default chain applies (see the constants above).

    ``allowed_tools`` and ``permission_mode`` let a role actually *act* (edit
    files, run commands) instead of only describing what it would do.
    """

    model: Optional[str] = None
    model_chain: List[str] = field(default_factory=list)
    allowed_tools: List[str] = field(default_factory=list)
    permission_mode: Optional[str] = None
    max_turns: Optional[int] = None
    timeout_seconds: int = 900

    def chain(self, default: Optional[List[str]] = None) -> List[Optional[str]]:
        """Resolve the effective, ordered model preference list for this role."""
        if self.model_chain:
            return list(self.model_chain)
        if self.model:
            return [self.model]
        if default:
            return list(default)
        return [None]  # None => let the CLI use its configured default model

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "ModelConfig":
        if not data:
            return cls()
        return cls(
            model=data.get("model"),
            model_chain=list(data.get("model_chain", [])),
            allowed_tools=list(data.get("allowed_tools", [])),
            permission_mode=data.get("permission_mode"),
            max_turns=data.get("max_turns"),
            timeout_seconds=int(data.get("timeout_seconds", 900)),
        )


@dataclass
class CommandGate:
    """A *hard* verifier: run a shell command, exit code 0 means pass.

    This is the strongest gate in the article's terms -- a test, build, lint or
    type check that cannot be argued with. When present it is authoritative.
    """

    command: str
    timeout_seconds: int = 600

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "Optional[CommandGate]":
        if not data:
            return None
        return cls(
            command=data["command"],
            timeout_seconds=int(data.get("timeout_seconds", 600)),
        )


@dataclass
class RubricGate:
    """A *soft* verifier: a separate checker model scores each criterion 1-10.

    The checker is deliberately a different role from the worker (ideally a
    stronger model, always a stricter prompt) so the loop does not grade its
    own homework. Passes only when every criterion is at least ``threshold``.
    """

    criteria: List[str]
    threshold: int = 8
    model: Optional[str] = None
    timeout_seconds: int = 900

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "Optional[RubricGate]":
        if not data:
            return None
        return cls(
            criteria=list(data["criteria"]),
            threshold=int(data.get("threshold", 8)),
            model=data.get("model"),
            timeout_seconds=int(data.get("timeout_seconds", 900)),
        )


@dataclass
class HumanGate:
    """A *human* is the verifier. Costs zero tokens.

    This is the honest gate for taste-based and visual work, where no command
    and no model can truthfully decide "good enough". The loop still does the
    tedious parts -- plan, execute, produce the artifact/evidence, remember your
    feedback -- and only re-runs when you explicitly reject with a reason. It
    does NOT try to make an LLM grade its own screenshots (unreliable and
    token-hungry); you look, you judge.

    Requires an interactive terminal, so it is incompatible with headless /
    scheduled runs. When automated gates are also present, the human is only
    asked once those pass, so you are never bothered about broken work.
    """

    prompt: str = "Approve this result, or give feedback to iterate."
    evidence_hint: Optional[str] = None  # e.g. "open ./screenshot.png"

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "Optional[HumanGate]":
        if not data:
            return None
        return cls(
            prompt=data.get("prompt", cls.prompt),
            evidence_hint=data.get("evidence_hint"),
        )


@dataclass
class LoopSpec:
    """The complete definition of one router loop."""

    goal: str
    workdir: str = "."

    router: ModelConfig = field(default_factory=ModelConfig)
    worker: ModelConfig = field(default_factory=ModelConfig)

    command_gate: Optional[CommandGate] = None
    rubric_gate: Optional[RubricGate] = None
    human_gate: Optional[HumanGate] = None

    # Stop conditions -- every serious loop has at least two ways out.
    max_iterations: int = 8
    max_cost_usd: Optional[float] = None

    state_dir: str = ".router"

    def validate(self) -> None:
        """Enforce the article's central rule: no gate, no loop."""
        if not self.goal or not self.goal.strip():
            raise ValueError("LoopSpec.goal must be a non-empty string")
        if self.command_gate is None and self.rubric_gate is None and self.human_gate is None:
            raise ValueError(
                "A loop needs a real verifier. Configure a command_gate "
                "(strongest), a rubric_gate, or a human_gate -- otherwise the "
                "agent just grades its own homework and the loop never truly "
                "converges. For taste/visual work, use a human_gate. See "
                "docs/GATES.md."
            )
        if self.max_iterations < 1:
            raise ValueError("max_iterations must be >= 1")

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LoopSpec":
        spec = cls(
            goal=data["goal"],
            workdir=data.get("workdir", "."),
            router=ModelConfig.from_dict(data.get("router")),
            worker=ModelConfig.from_dict(data.get("worker")),
            command_gate=CommandGate.from_dict(data.get("command_gate")),
            rubric_gate=RubricGate.from_dict(data.get("rubric_gate")),
            human_gate=HumanGate.from_dict(data.get("human_gate")),
            max_iterations=int(data.get("max_iterations", 8)),
            max_cost_usd=data.get("max_cost_usd"),
            state_dir=data.get("state_dir", ".router"),
        )
        spec.validate()
        return spec

    @classmethod
    def from_json_file(cls, path: str) -> "LoopSpec":
        with open(path, "r", encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))
