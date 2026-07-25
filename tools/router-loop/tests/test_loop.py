"""End-to-end tests of the five-phase loop using the deterministic MockModel."""

from __future__ import annotations

import os
import tempfile
import unittest

from router_loop.config import CommandGate, LoopSpec, ModelConfig, RubricGate
from router_loop.loop import RouterLoop
from router_loop.state import (
    STATUS_FAILED_MAX_ITERS,
    STATUS_SUCCEEDED,
    LoopState,
)

from tests.mock_model import MockModel

DECISION = {
    "assessment": "not done yet",
    "next_step": "create the marker file",
    "rationale": "the command gate checks for it",
    "believed_done": False,
}


class CommandGateLoopTest(unittest.TestCase):
    def test_converges_when_worker_satisfies_command_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            marker = os.path.join(tmp, "done.txt")

            def worker(cwd):
                open(os.path.join(cwd, "done.txt"), "w").close()
                return "created done.txt"

            model = MockModel([DECISION], worker)
            spec = LoopSpec(
                goal="produce done.txt",
                workdir=tmp,
                command_gate=CommandGate(command="test -f done.txt"),
                max_iterations=5,
            )
            report = RouterLoop(spec, model=model).run()

            self.assertEqual(report.status, STATUS_SUCCEEDED)
            self.assertEqual(report.iterations, 1)
            self.assertTrue(os.path.exists(marker))
            self.assertGreater(report.total_cost_usd, 0.0)

    def test_takes_several_iterations_before_gate_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            calls = {"n": 0}

            def worker(cwd):
                calls["n"] += 1
                if calls["n"] >= 3:  # only succeeds on the 3rd attempt
                    open(os.path.join(cwd, "done.txt"), "w").close()
                    return "created done.txt"
                return "did not manage it this time"

            model = MockModel([DECISION], worker)
            spec = LoopSpec(
                goal="produce done.txt",
                workdir=tmp,
                command_gate=CommandGate(command="test -f done.txt"),
                max_iterations=5,
            )
            report = RouterLoop(spec, model=model).run()

            self.assertEqual(report.status, STATUS_SUCCEEDED)
            self.assertEqual(report.iterations, 3)

    def test_stops_at_max_iterations_when_gate_never_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            model = MockModel([DECISION], lambda cwd: "nothing useful")
            spec = LoopSpec(
                goal="impossible",
                workdir=tmp,
                command_gate=CommandGate(command="test -f never_created.txt"),
                max_iterations=4,
            )
            report = RouterLoop(spec, model=model).run()

            self.assertEqual(report.status, STATUS_FAILED_MAX_ITERS)
            self.assertEqual(report.iterations, 4)


class RubricGateLoopTest(unittest.TestCase):
    def test_rubric_gate_blocks_until_scores_clear_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            attempt = {"n": 0}

            def rubric():
                attempt["n"] += 1
                score = 5 if attempt["n"] < 2 else 9  # fails once, then passes
                return {
                    "scores": [
                        {"criterion": "clarity", "score": score, "justification": "x"},
                        {"criterion": "completeness", "score": score, "justification": "y"},
                    ],
                    "weakest": "clarity" if score < 8 else "none",
                }

            model = MockModel([DECISION], lambda cwd: "some draft", rubric_fn=rubric)
            spec = LoopSpec(
                goal="write a good thing",
                workdir=tmp,
                rubric_gate=RubricGate(criteria=["clarity", "completeness"], threshold=8),
                max_iterations=5,
            )
            report = RouterLoop(spec, model=model, checker_model=model).run()

            self.assertEqual(report.status, STATUS_SUCCEEDED)
            self.assertEqual(report.iterations, 2)


class GuardrailTest(unittest.TestCase):
    def test_router_believing_done_does_not_end_loop(self) -> None:
        # The router insists it is done every time, but the gate says otherwise.
        # The loop must NOT succeed -- only the gate can end it.
        with tempfile.TemporaryDirectory() as tmp:
            decision = dict(DECISION, believed_done=True)
            model = MockModel([decision], lambda cwd: "claims success falsely")
            spec = LoopSpec(
                goal="ralph wiggum trap",
                workdir=tmp,
                command_gate=CommandGate(command="false"),  # always fails
                max_iterations=3,
            )
            report = RouterLoop(spec, model=model).run()

            self.assertEqual(report.status, STATUS_FAILED_MAX_ITERS)
            self.assertFalse(report.succeeded)


class NoGateTest(unittest.TestCase):
    def test_spec_without_any_gate_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            LoopSpec(goal="no gate here").validate()


if __name__ == "__main__":
    unittest.main()
