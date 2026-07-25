"""The verifier: VERIFY -- the gate that makes this a loop and not a spin.

This is the one component that decides whether the loop helps you or just spends
money. Two kinds of gate are supported, and at least one is required:

* **Command gate** -- a shell command (test suite, build, lint, type check).
  Exit 0 is pass. This is the strongest gate: it cannot be argued with, and
  when present it is authoritative.

* **Rubric gate** -- a *separate* checker model scores each criterion 1-10 and
  must clear a threshold on all of them. The checker is a different role from
  the worker (ideally a stronger model, always a stricter, adversarial prompt)
  so the loop never grades its own homework.

When both gates are configured, both must pass.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .config import CHECKER_MODEL_CHAIN, CommandGate, HumanGate, RubricGate
from .router import RouterDecision
from .state import LoopState
from .worker import WorkResult

_APPROVALS = {"y", "yes", "approve", "approved", "ok", "lgtm", "ship"}

_RUBRIC_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "scores": {
            "type": "array",
            "description": "One score per criterion, in the same order given.",
            "items": {
                "type": "object",
                "properties": {
                    "criterion": {"type": "string"},
                    "score": {"type": "integer", "minimum": 1, "maximum": 10},
                    "justification": {"type": "string"},
                },
                "required": ["criterion", "score", "justification"],
                "additionalProperties": False,
            },
        },
        "weakest": {
            "type": "string",
            "description": "The single most important thing still missing or weak.",
        },
    },
    "required": ["scores", "weakest"],
    "additionalProperties": False,
}

_CHECKER_SYSTEM = (
    "You are the VERIFIER in an autonomous work loop, and you are adversarial by "
    "design. Your job is to find what is still wrong, not to be encouraging. The "
    "worker that produced this output is far too generous a grader of its own "
    "work, so you must be strict. Score conservatively: reserve high scores for "
    "output that genuinely and fully meets the criterion with no caveats."
)


@dataclass
class VerifyResult:
    passed: bool
    feedback: str
    scores: Dict[str, int] = field(default_factory=dict)
    cost_usd: float = 0.0


class Verifier:
    def __init__(
        self,
        workdir: str,
        command_gate: Optional[CommandGate] = None,
        rubric_gate: Optional[RubricGate] = None,
        human_gate: Optional[HumanGate] = None,
        checker_model: Any = None,
        input_fn: Callable[[str], str] = input,
        output_fn: Callable[[str], None] = print,
    ) -> None:
        if command_gate is None and rubric_gate is None and human_gate is None:
            raise ValueError("Verifier requires at least one gate")
        if rubric_gate is not None and checker_model is None:
            raise ValueError("A rubric_gate needs a checker_model to score it")
        self._workdir = workdir
        self._command_gate = command_gate
        self._rubric_gate = rubric_gate
        self._human_gate = human_gate
        self._checker = checker_model
        self._input_fn = input_fn
        self._output_fn = output_fn

    def verify(
        self,
        state: LoopState,
        decision: RouterDecision,
        work: WorkResult,
    ) -> VerifyResult:
        feedback_parts: List[str] = []
        scores: Dict[str, int] = {}
        cost = 0.0
        passed = True

        # ---- hard command gate (authoritative) -----------------------------
        if self._command_gate is not None:
            ok, detail = self._run_command_gate()
            feedback_parts.append(detail)
            if not ok:
                passed = False

        # ---- soft rubric gate (separate checker model) ---------------------
        if self._rubric_gate is not None:
            ok, detail, rubric_scores, rubric_cost = self._run_rubric_gate(state, decision, work)
            scores = rubric_scores
            cost += rubric_cost
            feedback_parts.append(detail)
            if not ok:
                passed = False

        # ---- human gate (the honest gate for taste/visual work) ------------
        # Only bother the human once the automated checks pass -- no point
        # asking someone to eyeball work that already failed a test.
        if self._human_gate is not None:
            if not passed:
                feedback_parts.append(
                    "[human gate] skipped -- automated checks failed first; fix those."
                )
            else:
                ok, detail = self._run_human_gate(state, decision, work)
                feedback_parts.append(detail)
                if not ok:
                    passed = False

        return VerifyResult(
            passed=passed,
            feedback="\n".join(p for p in feedback_parts if p),
            scores=scores,
            cost_usd=cost,
        )

    # ------------------------------------------------------------------ gates

    def _run_command_gate(self) -> "tuple[bool, str]":
        gate = self._command_gate
        assert gate is not None
        try:
            proc = subprocess.run(
                gate.command,
                shell=True,
                cwd=self._workdir,
                capture_output=True,
                text=True,
                timeout=gate.timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            return False, f"[command gate] TIMEOUT after {gate.timeout_seconds}s: {gate.command!r}"

        ok = proc.returncode == 0
        tail = (proc.stdout + proc.stderr).strip().splitlines()[-25:]
        detail = (
            f"[command gate] `{gate.command}` exited {proc.returncode} "
            f"({'PASS' if ok else 'FAIL'}).\n" + "\n".join(tail)
        )
        return ok, detail

    def _run_rubric_gate(
        self, state: LoopState, decision: RouterDecision, work: WorkResult
    ) -> "tuple[bool, str, Dict[str, int], float]":
        gate = self._rubric_gate
        assert gate is not None
        criteria_block = "\n".join(f"  {i+1}. {c}" for i, c in enumerate(gate.criteria))
        prompt = (
            f"GOAL:\n{state.goal}\n\n"
            f"STEP THE WORKER JUST EXECUTED:\n{decision.next_step}\n\n"
            f"WORKER'S REPORTED OUTPUT:\n{work.summary}\n\n"
            f"SUCCESS CRITERIA (score each 1-10, be strict):\n{criteria_block}\n\n"
            f"A criterion only counts as met at {gate.threshold}+/10. "
            "Return the required JSON."
        )
        checker_chain = [gate.model] if gate.model else list(CHECKER_MODEL_CHAIN)
        result = self._checker.complete(
            prompt,
            system=_CHECKER_SYSTEM,
            json_schema=_RUBRIC_SCHEMA,
            model_chain=checker_chain,
            timeout=gate.timeout_seconds,
        )
        data = result.json()
        scores = {s["criterion"]: int(s["score"]) for s in data["scores"]}
        below = {c: v for c, v in scores.items() if v < gate.threshold}
        ok = len(below) == 0
        score_line = ", ".join(f"{c}={v}" for c, v in scores.items())
        detail = (
            f"[rubric gate] {'PASS' if ok else 'FAIL'} "
            f"(threshold {gate.threshold}). Scores: {score_line}. "
            f"Weakest: {data['weakest']}"
        )
        return ok, detail, scores, result.cost_usd

    def _run_human_gate(
        self, state: LoopState, decision: RouterDecision, work: WorkResult
    ) -> "tuple[bool, str]":
        gate = self._human_gate
        assert gate is not None
        o = self._output_fn
        o("\n" + "=" * 64)
        o("HUMAN GATE -- you are the verifier. Review this iteration:")
        o(f"  goal:  {state.goal}")
        o(f"  step:  {decision.next_step}")
        o(f"  work:  {work.summary[:600]}")
        if gate.evidence_hint:
            o(f"  look:  {gate.evidence_hint}")
        o(gate.prompt)
        answer = self._input_fn(
            "  [ y / approve = done | anything else = feedback to iterate ]: "
        ).strip()
        if answer.lower() in _APPROVALS:
            return True, "[human gate] approved by human."
        feedback = answer or "(rejected with no specific feedback)"
        return False, f"[human gate] rejected. Human feedback: {feedback}"
