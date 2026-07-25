"""The model backend: the Claude Code CLI driven in headless mode.

Every model call in the loop goes through ``claude -p`` (print / non-interactive
mode). That binary authenticates with whatever Claude Code is logged in as --
for a Pro/Max user that is the *subscription*, not a metered API key. So the
whole loop runs on the subscription with no ``ANTHROPIC_API_KEY`` involved.

The single entry point is :meth:`ClaudeSubscriptionModel.complete`. Any object
exposing the same ``complete(...)`` signature can stand in for it (the test
suite injects a deterministic fake), which is what keeps the loop testable
without spending tokens.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

# A logger receives short human-readable notices (e.g. model fallbacks).
LoggerFn = Callable[[str], None]


class ModelError(RuntimeError):
    """Raised when the CLI cannot be run or returns an unparseable result."""


@dataclass
class ModelResult:
    """The outcome of one model call."""

    text: str
    is_error: bool = False
    cost_usd: float = 0.0
    session_id: Optional[str] = None
    num_turns: int = 0
    model: Optional[str] = None  # the model that actually produced this result
    raw: Dict[str, Any] = field(default_factory=dict)

    def json(self) -> Any:
        """Parse ``text`` as JSON (used with structured / schema calls)."""
        return json.loads(self.text)


def resolve_with_fallback(
    complete_once: Callable[[Optional[str]], ModelResult],
    chain: List[Optional[str]],
    logger: Optional[LoggerFn] = None,
) -> ModelResult:
    """Try each model in ``chain`` until one answers without error.

    ``complete_once(model)`` runs a single call. If it errors (raises, or
    returns ``is_error`` -- which is how a credit/limit 429 surfaces), the next
    model in the chain is tried. The last model's result is returned even if it
    errors, so the caller always sees the final outcome.
    """
    chain = chain or [None]
    last: Optional[ModelResult] = None
    for i, model in enumerate(chain):
        is_last = i == len(chain) - 1
        try:
            result = complete_once(model)
        except ModelError as exc:
            if is_last:
                raise
            if logger:
                logger(f"[model] '{model}' errored ({exc}); falling back to '{chain[i + 1]}'.")
            continue
        if result.model is None:
            result.model = model
        if not result.is_error or is_last:
            return result
        last = result
        if logger:
            reason = (result.text or "error").strip().splitlines()[0][:80]
            logger(f"[model] '{model}' unavailable ({reason}); falling back to '{chain[i + 1]}'.")
    assert last is not None  # chain is never empty
    return last


class ClaudeSubscriptionModel:
    """Runs prompts through ``claude -p`` against your Claude subscription."""

    def __init__(
        self,
        binary: str = "claude",
        default_timeout: int = 900,
        logger: Optional[LoggerFn] = None,
    ) -> None:
        self.binary = binary
        self.default_timeout = default_timeout
        self._logger = logger
        if shutil.which(binary) is None:
            raise ModelError(
                f"Could not find the '{binary}' CLI on PATH. The router loop "
                "drives Claude Code in headless mode, so the CLI must be "
                "installed and logged in to your Claude subscription."
            )

    def complete(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        model_chain: Optional[List[Optional[str]]] = None,
        system: Optional[str] = None,
        json_schema: Optional[Dict[str, Any]] = None,
        cwd: Optional[str] = None,
        allowed_tools: Optional[List[str]] = None,
        permission_mode: Optional[str] = None,
        max_turns: Optional[int] = None,
        timeout: Optional[int] = None,
    ) -> ModelResult:
        """Send one prompt, trying the model chain until one answers.

        Pass ``model_chain`` for an ordered fallback list (preferred first), or
        a single ``model``. When a preferred model is out of credits or
        overloaded, the next in the chain is used automatically.
        """
        chain: List[Optional[str]] = list(model_chain) if model_chain else [model]

        def once(m: Optional[str]) -> ModelResult:
            return self._complete_once(
                prompt,
                model=m,
                system=system,
                json_schema=json_schema,
                cwd=cwd,
                allowed_tools=allowed_tools,
                permission_mode=permission_mode,
                max_turns=max_turns,
                timeout=timeout,
            )

        return resolve_with_fallback(once, chain, logger=self._logger)

    def _complete_once(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        system: Optional[str] = None,
        json_schema: Optional[Dict[str, Any]] = None,
        cwd: Optional[str] = None,
        allowed_tools: Optional[List[str]] = None,
        permission_mode: Optional[str] = None,
        max_turns: Optional[int] = None,
        timeout: Optional[int] = None,
    ) -> ModelResult:
        """One single call to the CLI (no fallback).

        The prompt is written to stdin (not argv) so it can grow arbitrarily
        large as the loop's memory ledger accumulates across iterations.
        """
        full_prompt = prompt if not system else f"{system}\n\n{prompt}"

        cmd: List[str] = [self.binary, "-p", "--output-format", "json"]
        if model:
            cmd += ["--model", model]
        if json_schema is not None:
            cmd += ["--json-schema", json.dumps(json_schema)]
        if allowed_tools:
            cmd += ["--allowed-tools", *allowed_tools]
        if permission_mode:
            cmd += ["--permission-mode", permission_mode]
        if max_turns is not None:
            cmd += ["--max-turns", str(max_turns)]

        try:
            proc = subprocess.run(
                cmd,
                input=full_prompt,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout or self.default_timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise ModelError(f"claude CLI timed out after {timeout or self.default_timeout}s") from exc

        if proc.returncode != 0 and not proc.stdout.strip():
            raise ModelError(
                f"claude CLI exited {proc.returncode}: {proc.stderr.strip() or '<no stderr>'}"
            )

        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise ModelError(
                f"Could not parse claude CLI output as JSON: {proc.stdout[:500]!r}"
            ) from exc

        used_model = next(iter(data.get("modelUsage", {})), None) or model
        return ModelResult(
            text=(data.get("result") or ""),
            is_error=bool(data.get("is_error")),
            cost_usd=float(data.get("total_cost_usd") or 0.0),
            session_id=data.get("session_id"),
            num_turns=int(data.get("num_turns") or 0),
            model=used_model,
            raw=data,
        )
