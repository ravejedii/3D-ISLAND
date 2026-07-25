"""RouterLoop -- the orchestrator that runs the five-phase cycle.

    DISCOVER -> PLAN   (router)
    EXECUTE            (worker)
    VERIFY             (verifier gate)
    ITERATE / STOP     (this class)

Stop conditions, in priority order:
  1. SUCCESS   -- the verifier gate passes. This is the *only* way to succeed.
  2. BUDGET    -- accumulated cost would exceed ``max_cost_usd``.
  3. MAX ITERS -- ``max_iterations`` reached without passing.

Note the asymmetry: the router may *believe* the job is done, but that never
ends the loop. Only the verifier can. That is what stops the loop from exiting
early on a half-finished job while still billing you.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Callable, Optional

from .config import LoopSpec
from .model import ClaudeSubscriptionModel
from .router import Router
from .state import (
    STATUS_FAILED_BUDGET,
    STATUS_FAILED_MAX_ITERS,
    STATUS_SUCCEEDED,
    IterationRecord,
    LoopState,
)
from .verifier import Verifier
from .worker import Worker

# A progress callback receives short human-readable status strings.
ProgressFn = Callable[[str], None]


@dataclass
class LoopReport:
    state: LoopState
    status: str
    iterations: int
    total_cost_usd: float

    @property
    def succeeded(self) -> bool:
        return self.status == STATUS_SUCCEEDED

    def summary(self) -> str:
        lines = [
            f"status:            {self.status}",
            f"iterations:        {self.iterations}",
            f"total cost (USD):  ${self.total_cost_usd:.4f}",
        ]
        if self.iterations:
            lines.append(f"cost / iteration:  ${self.total_cost_usd / self.iterations:.4f}")
        return "\n".join(lines)


class RouterLoop:
    """Runs a :class:`LoopSpec` to completion (or to a stop condition)."""

    def __init__(
        self,
        spec: LoopSpec,
        model: Optional[Any] = None,
        checker_model: Optional[Any] = None,
        on_progress: Optional[ProgressFn] = None,
        input_fn: Optional[Callable[[str], str]] = None,
    ) -> None:
        spec.validate()
        self.spec = spec
        self._log = on_progress or (lambda _msg: None)

        # One subscription-backed model by default; roles can override the
        # alias/chain. The logger surfaces model fallbacks (e.g. Fable -> Opus).
        base_model = model or ClaudeSubscriptionModel(logger=self._log)
        checker = checker_model or base_model

        self.router = Router(base_model, spec.router)
        self.worker = Worker(base_model, spec.worker, spec.workdir)
        verifier_kwargs: dict = {}
        if input_fn is not None:
            verifier_kwargs["input_fn"] = input_fn
        self.verifier = Verifier(
            workdir=spec.workdir,
            command_gate=spec.command_gate,
            rubric_gate=spec.rubric_gate,
            human_gate=spec.human_gate,
            checker_model=checker,
            **verifier_kwargs,
        )

    # ------------------------------------------------------------------ run

    def _state_path(self) -> str:
        return os.path.join(self.spec.workdir, self.spec.state_dir, "state.json")

    def run(self, state: Optional[LoopState] = None) -> LoopReport:
        if state is None:
            state = LoopState(goal=self.spec.goal, path=self._state_path())
        state.save()

        last_feedback = state.ledger[-1].notes if state.ledger else ""

        while True:
            # ---- stop conditions checked before spending on a new pass ------
            if state.iteration_count >= self.spec.max_iterations:
                state.status = STATUS_FAILED_MAX_ITERS
                self._log(f"STOP: reached max_iterations ({self.spec.max_iterations}).")
                break
            if (
                self.spec.max_cost_usd is not None
                and state.total_cost_usd >= self.spec.max_cost_usd
            ):
                state.status = STATUS_FAILED_BUDGET
                self._log(f"STOP: cost budget ${self.spec.max_cost_usd} reached.")
                break

            n = state.iteration_count + 1
            self._log(f"\n=== iteration {n}/{self.spec.max_iterations} ===")

            # ---- DISCOVER + PLAN -------------------------------------------
            decision = self.router.decide(state, last_feedback)
            self._log(f"[plan] {decision.next_step}")

            # ---- EXECUTE ----------------------------------------------------
            work = self.worker.execute(state, decision)
            self._log(f"[work] {work.summary[:200]}")

            # ---- VERIFY (the gate -- authoritative) -------------------------
            verdict = self.verifier.verify(state, decision, work)
            self._log(f"[verify] {'PASS' if verdict.passed else 'FAIL'} :: {verdict.feedback[:200]}")

            if decision.believed_done and not verdict.passed:
                self._log("[guard] router believed the job was done, but the gate disagrees -- continuing.")

            iteration_cost = decision.cost_usd + work.cost_usd + verdict.cost_usd
            state.record_iteration(
                IterationRecord(
                    iteration=n,
                    assessment=decision.assessment,
                    plan=decision.next_step,
                    work_summary=work.summary,
                    verified=verdict.passed,
                    feedback=verdict.feedback,
                    scores=verdict.scores,
                    cost_usd=iteration_cost,
                )
            )
            state.save()
            last_feedback = verdict.feedback

            # ---- ITERATE / STOP --------------------------------------------
            if verdict.passed:
                state.status = STATUS_SUCCEEDED
                self._log(f"\nSUCCESS after {n} iteration(s).")
                break

        state.save()
        return LoopReport(
            state=state,
            status=state.status,
            iterations=state.iteration_count,
            total_cost_usd=state.total_cost_usd,
        )
