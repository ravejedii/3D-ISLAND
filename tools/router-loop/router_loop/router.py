"""The router: DISCOVER + PLAN.

Each iteration the router looks at the goal, the memory ledger (what has already
been tried and how it went), and the last verifier feedback, then decides the
*single* highest-impact next step. It is deliberately cheap and fast -- it only
plans; the worker does the work and the verifier decides whether it counts.

The router may *believe* the goal is met, but that belief is never authoritative
-- only the verifier gate can end the loop. This is the guardrail against the
"Ralph Wiggum" failure where an agent declares victory on a half-finished job.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

from .config import ORCHESTRATOR_MODEL_CHAIN, ModelConfig
from .state import LoopState

_DECISION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "assessment": {
            "type": "string",
            "description": "DISCOVER: what is the current state and what remains to reach the goal.",
        },
        "next_step": {
            "type": "string",
            "description": "PLAN: the single, concrete, highest-impact next action to take now.",
        },
        "rationale": {
            "type": "string",
            "description": "Why this step, and how it avoids repeating past failed attempts.",
        },
        "believed_done": {
            "type": "boolean",
            "description": "Your best guess whether the goal is already met. Advisory only; the verifier decides.",
        },
    },
    "required": ["assessment", "next_step", "rationale", "believed_done"],
    "additionalProperties": False,
}

_SYSTEM = (
    "You are the ROUTER in an autonomous work loop. You do not do the work "
    "yourself; you decide the single next step for a worker agent. Be decisive "
    "and concrete. Study the ledger of previous attempts and never re-propose an "
    "approach that already failed -- adapt instead. Always attack the weakest, "
    "highest-impact gap first."
)


@dataclass
class RouterDecision:
    assessment: str
    next_step: str
    rationale: str
    believed_done: bool
    cost_usd: float = 0.0


class Router:
    def __init__(self, model: Any, config: ModelConfig) -> None:
        self._model = model
        self._config = config

    def decide(self, state: LoopState, last_feedback: str) -> RouterDecision:
        prompt = (
            f"GOAL:\n{state.goal}\n\n"
            f"LEDGER (previous attempts and outcomes):\n{state.ledger_text()}\n\n"
            f"MOST RECENT VERIFIER FEEDBACK:\n{last_feedback or '(none yet)'}\n\n"
            "Decide the single next step that best moves toward the goal. "
            "If the ledger shows an approach failed, do something meaningfully "
            "different. Respond as the required JSON object."
        )
        result = self._model.complete(
            prompt,
            system=_SYSTEM,
            json_schema=_DECISION_SCHEMA,
            model_chain=self._config.chain(ORCHESTRATOR_MODEL_CHAIN),
            timeout=self._config.timeout_seconds,
        )
        data = result.json()
        return RouterDecision(
            assessment=data["assessment"],
            next_step=data["next_step"],
            rationale=data["rationale"],
            believed_done=bool(data["believed_done"]),
            cost_usd=result.cost_usd,
        )
