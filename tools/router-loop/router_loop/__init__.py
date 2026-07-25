"""router-loop — a self-driving agentic loop backed by your Claude subscription.

The loop runs the classic five-phase cycle on its own until a goal is met:

    DISCOVER -> PLAN -> EXECUTE -> VERIFY -> ITERATE

A central *router* decides the single next step each pass (DISCOVER + PLAN),
a *worker* does the work (EXECUTE), and a *separate* verifier gate decides
whether the work is actually done (VERIFY). The loop only ever declares
success when the verifier gate passes -- never when the maker says so.

The model backend is the Claude Code CLI in headless mode (`claude -p`), so
every call runs against your Claude subscription rather than a metered API key.
"""

from .config import LoopSpec, ModelConfig, CommandGate, RubricGate
from .loop import RouterLoop, LoopReport
from .model import ClaudeSubscriptionModel, ModelResult
from .state import LoopState

__all__ = [
    "LoopSpec",
    "ModelConfig",
    "CommandGate",
    "RubricGate",
    "RouterLoop",
    "LoopReport",
    "ClaudeSubscriptionModel",
    "ModelResult",
    "LoopState",
]

__version__ = "0.1.0"
