"""Tests for the model preference chain (Fable -> Opus fallback)."""

from __future__ import annotations

import unittest

from router_loop.config import ModelConfig
from router_loop.model import ModelResult, resolve_with_fallback


def _ok(model):
    return ModelResult(text="ok", is_error=False, model=model)


def _err(model):
    # This is how a credit/limit 429 surfaces: is_error True, not an exception.
    return ModelResult(text="You've reached your Fable 5 limit.", is_error=True, model=model)


class ChainResolutionTest(unittest.TestCase):
    def test_config_default_chain_used_when_unset(self):
        cfg = ModelConfig()
        self.assertEqual(cfg.chain(["a", "b"]), ["a", "b"])

    def test_single_model_takes_precedence_over_default(self):
        cfg = ModelConfig(model="only")
        self.assertEqual(cfg.chain(["a", "b"]), ["only"])

    def test_explicit_chain_takes_precedence(self):
        cfg = ModelConfig(model_chain=["x", "y"])
        self.assertEqual(cfg.chain(["a", "b"]), ["x", "y"])


class FallbackTest(unittest.TestCase):
    def test_falls_back_to_opus_when_fable_out_of_credits(self):
        calls = []

        def complete_once(model):
            calls.append(model)
            return _err(model) if model == "claude-fable-5" else _ok(model)

        result = resolve_with_fallback(
            complete_once, ["claude-fable-5", "claude-opus-4-8"]
        )
        self.assertEqual(calls, ["claude-fable-5", "claude-opus-4-8"])
        self.assertFalse(result.is_error)
        self.assertEqual(result.model, "claude-opus-4-8")

    def test_uses_fable_when_available(self):
        result = resolve_with_fallback(lambda m: _ok(m), ["claude-fable-5", "claude-opus-4-8"])
        self.assertEqual(result.model, "claude-fable-5")

    def test_returns_last_error_when_whole_chain_fails(self):
        result = resolve_with_fallback(lambda m: _err(m), ["a", "b"])
        self.assertTrue(result.is_error)
        self.assertEqual(result.model, "b")

    def test_logger_notified_on_fallback(self):
        notes = []
        resolve_with_fallback(
            lambda m: _err(m) if m == "a" else _ok(m),
            ["a", "b"],
            logger=notes.append,
        )
        self.assertTrue(any("falling back to 'b'" in n for n in notes))


if __name__ == "__main__":
    unittest.main()
