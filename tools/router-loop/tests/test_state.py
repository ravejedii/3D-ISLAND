"""Tests for state persistence and resumability -- the loop's memory."""

from __future__ import annotations

import os
import tempfile
import unittest

from router_loop.state import IterationRecord, LoopState


class StateTest(unittest.TestCase):
    def test_ledger_accumulates_and_costs_sum(self) -> None:
        state = LoopState(goal="g")
        state.record_iteration(
            IterationRecord(1, "a", "plan-1", "did-1", False, "still wrong", {}, 0.01)
        )
        state.record_iteration(
            IterationRecord(2, "a", "plan-2", "did-2", True, "looks good", {}, 0.02)
        )
        self.assertEqual(state.iteration_count, 2)
        self.assertEqual(len(state.ledger), 2)
        self.assertAlmostEqual(state.total_cost_usd, 0.03)
        self.assertIn("plan-1", state.ledger_text())
        self.assertIn("failed", state.ledger_text())

    def test_save_and_load_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "nested", "state.json")
            state = LoopState(goal="round trip", path=path)
            state.record_iteration(
                IterationRecord(1, "assess", "plan", "work", False, "fb", {"c": 5}, 0.05)
            )
            state.save()
            self.assertTrue(os.path.exists(path))

            loaded = LoopState.load(path)
            self.assertEqual(loaded.goal, "round trip")
            self.assertEqual(loaded.iteration_count, 1)
            self.assertAlmostEqual(loaded.total_cost_usd, 0.05)
            self.assertEqual(loaded.iterations[0].scores, {"c": 5})

    def test_empty_ledger_message(self) -> None:
        state = LoopState(goal="g")
        self.assertIn("no attempts yet", state.ledger_text())


if __name__ == "__main__":
    unittest.main()
