"""A deterministic stand-in for ClaudeSubscriptionModel used by the tests.

It has the same ``complete(...)`` signature as the real backend but never
touches the network or the Claude CLI, so the loop's mechanics can be tested
for free and deterministically. It dispatches on the JSON schema it is handed:
a schema with a ``next_step`` field means the router is asking for a decision;
one with ``scores`` means the rubric checker is scoring; anything else is a
worker execution.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

from router_loop.model import ModelResult


class MockModel:
    def __init__(
        self,
        decisions: List[Dict[str, Any]],
        worker_fn: Callable[[Optional[str]], str],
        rubric_fn: Optional[Callable[[], Dict[str, Any]]] = None,
        cost_per_call: float = 0.001,
    ) -> None:
        self._decisions = decisions
        self._decision_i = 0
        self._worker_fn = worker_fn
        self._rubric_fn = rubric_fn
        self._cost = cost_per_call
        self.call_log: List[str] = []

    def complete(self, prompt: str, *, json_schema: Optional[Dict[str, Any]] = None,
                 cwd: Optional[str] = None, **_kw: Any) -> ModelResult:
        props = (json_schema or {}).get("properties", {})

        if "next_step" in props:  # router decision
            idx = min(self._decision_i, len(self._decisions) - 1)
            self._decision_i += 1
            self.call_log.append("router")
            return ModelResult(text=json.dumps(self._decisions[idx]), cost_usd=self._cost)

        if "scores" in props:  # rubric checker
            assert self._rubric_fn is not None, "rubric checker called without a rubric_fn"
            self.call_log.append("rubric")
            return ModelResult(text=json.dumps(self._rubric_fn()), cost_usd=self._cost)

        # worker execution
        self.call_log.append("worker")
        return ModelResult(text=self._worker_fn(cwd), cost_usd=self._cost)
