"""Loop state -- the memory that makes the loop *learn* instead of repeating.

Each pass appends to a ledger of what was tried and how it turned out. The
router reads this ledger every iteration so it does not re-attempt an approach
that already failed. State is persisted to JSON on every step, so a loop can be
killed and resumed instead of restarting from zero.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED_MAX_ITERS = "failed_max_iterations"
STATUS_FAILED_BUDGET = "failed_budget"
STATUS_ERROR = "error"


@dataclass
class LedgerEntry:
    """One compact record of an attempt -- the loop's working memory."""

    iteration: int
    action: str          # the single step the router planned
    outcome: str         # "passed" | "failed"
    notes: str           # what the verifier said / why it failed


@dataclass
class IterationRecord:
    """Full detail of a single pass through the five-phase cycle."""

    iteration: int
    assessment: str
    plan: str
    work_summary: str
    verified: bool
    feedback: str
    scores: Dict[str, int] = field(default_factory=dict)
    cost_usd: float = 0.0


@dataclass
class LoopState:
    goal: str
    status: str = STATUS_RUNNING
    iterations: List[IterationRecord] = field(default_factory=list)
    ledger: List[LedgerEntry] = field(default_factory=list)
    total_cost_usd: float = 0.0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    path: Optional[str] = None

    # ---- derived -----------------------------------------------------------

    @property
    def iteration_count(self) -> int:
        return len(self.iterations)

    @property
    def succeeded(self) -> bool:
        return self.status == STATUS_SUCCEEDED

    def cost_per_iteration(self) -> float:
        return self.total_cost_usd / self.iteration_count if self.iterations else 0.0

    # ---- mutation ----------------------------------------------------------

    def record_iteration(self, record: IterationRecord) -> None:
        self.iterations.append(record)
        self.ledger.append(
            LedgerEntry(
                iteration=record.iteration,
                action=record.plan,
                outcome="passed" if record.verified else "failed",
                notes=record.feedback,
            )
        )
        self.total_cost_usd += record.cost_usd
        self.updated_at = time.time()

    def ledger_text(self) -> str:
        """Render the ledger for the router prompt (memory of past attempts)."""
        if not self.ledger:
            return "(no attempts yet -- this is the first iteration)"
        lines = []
        for e in self.ledger:
            lines.append(f"  #{e.iteration} [{e.outcome}] tried: {e.action}\n      -> {e.notes}")
        return "\n".join(lines)

    # ---- persistence -------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        return {
            "goal": self.goal,
            "status": self.status,
            "iterations": [asdict(i) for i in self.iterations],
            "ledger": [asdict(e) for e in self.ledger],
            "total_cost_usd": self.total_cost_usd,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def save(self, path: Optional[str] = None) -> None:
        target = path or self.path
        if not target:
            raise ValueError("No path to save state to")
        os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
        tmp = f"{target}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self.to_dict(), fh, indent=2)
        os.replace(tmp, target)  # atomic write
        self.path = target

    @classmethod
    def from_dict(cls, data: Dict[str, Any], path: Optional[str] = None) -> "LoopState":
        state = cls(
            goal=data["goal"],
            status=data.get("status", STATUS_RUNNING),
            total_cost_usd=float(data.get("total_cost_usd", 0.0)),
            created_at=float(data.get("created_at", time.time())),
            updated_at=float(data.get("updated_at", time.time())),
            path=path,
        )
        state.iterations = [IterationRecord(**i) for i in data.get("iterations", [])]
        state.ledger = [LedgerEntry(**e) for e in data.get("ledger", [])]
        return state

    @classmethod
    def load(cls, path: str) -> "LoopState":
        with open(path, "r", encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh), path=path)
