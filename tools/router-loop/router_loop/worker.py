"""The worker: EXECUTE.

The worker takes the router's single planned step and carries it out. If the
spec grants it tools (``allowed_tools`` such as ``Read``/``Write``/``Edit``/
``Bash``) it actually *acts* in the working directory -- edits files, runs
commands -- rather than only describing a fix. That is the difference between an
agent that suggests and a loop that does.

The worker is intended to be the fast/cheap half of the maker-checker split.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .config import WORKER_MODEL_CHAIN, ModelConfig
from .router import RouterDecision
from .state import LoopState

_SYSTEM = (
    "You are the WORKER in an autonomous work loop. You are given one concrete "
    "step to execute toward a larger goal. Do exactly that step, completely and "
    "concretely. If you have tools, use them to make real changes rather than "
    "describing them. Then report tersely what you actually did and any output "
    "another agent would need to verify the result."
)


@dataclass
class WorkResult:
    summary: str
    cost_usd: float = 0.0
    is_error: bool = False


class Worker:
    def __init__(self, model: Any, config: ModelConfig, workdir: str) -> None:
        self._model = model
        self._config = config
        self._workdir = workdir

    def execute(self, state: LoopState, decision: RouterDecision) -> WorkResult:
        prompt = (
            f"OVERALL GOAL:\n{state.goal}\n\n"
            f"YOUR SINGLE STEP FOR THIS ITERATION:\n{decision.next_step}\n\n"
            f"WHY (router's rationale):\n{decision.rationale}\n\n"
            "Execute this step now. When done, report what you changed and any "
            "output relevant to verifying it."
        )
        result = self._model.complete(
            prompt,
            system=_SYSTEM,
            model_chain=self._config.chain(WORKER_MODEL_CHAIN),
            cwd=self._workdir,
            allowed_tools=self._config.allowed_tools or None,
            permission_mode=self._config.permission_mode,
            max_turns=self._config.max_turns,
            timeout=self._config.timeout_seconds,
        )
        return WorkResult(
            summary=result.text.strip(),
            cost_usd=result.cost_usd,
            is_error=result.is_error,
        )
