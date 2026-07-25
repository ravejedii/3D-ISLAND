"""Tests for the human gate -- the honest verifier for taste/visual work."""

from __future__ import annotations

import tempfile
import unittest

from router_loop.config import CommandGate, HumanGate, LoopSpec
from router_loop.loop import RouterLoop
from router_loop.router import RouterDecision
from router_loop.state import STATUS_SUCCEEDED, LoopState
from router_loop.verifier import Verifier
from router_loop.worker import WorkResult

from tests.mock_model import MockModel

DECISION_OBJ = RouterDecision("assess", "do the thing", "because", False)
DECISION = {
    "assessment": "a",
    "next_step": "produce a candidate",
    "rationale": "r",
    "believed_done": False,
}


class HumanGateUnitTest(unittest.TestCase):
    def _verify(self, answer):
        v = Verifier(
            workdir=".",
            human_gate=HumanGate(prompt="ok?"),
            input_fn=lambda _p: answer,
            output_fn=lambda _m: None,
        )
        return v.verify(LoopState(goal="g"), DECISION_OBJ, WorkResult(summary="a draft"))

    def test_approval_passes(self):
        self.assertTrue(self._verify("y").passed)
        self.assertTrue(self._verify("approve").passed)

    def test_feedback_fails_and_is_captured(self):
        r = self._verify("make the hero bolder and reduce the padding")
        self.assertFalse(r.passed)
        self.assertIn("make the hero bolder", r.feedback)

    def test_human_gate_costs_zero_tokens(self):
        self.assertEqual(self._verify("y").cost_usd, 0.0)

    def test_human_not_asked_when_command_gate_fails(self):
        asked = {"n": 0}

        def spy(_p):
            asked["n"] += 1
            return "y"

        v = Verifier(
            workdir=".",
            command_gate=CommandGate(command="false"),  # always fails
            human_gate=HumanGate(),
            input_fn=spy,
            output_fn=lambda _m: None,
        )
        r = v.verify(LoopState(goal="g"), DECISION_OBJ, WorkResult(summary="x"))
        self.assertFalse(r.passed)
        self.assertEqual(asked["n"], 0)  # human was spared the broken work
        self.assertIn("skipped", r.feedback)


class HumanGateLoopTest(unittest.TestCase):
    def test_loop_iterates_until_human_approves(self):
        answers = iter(["not premium enough, more contrast", "y"])

        with tempfile.TemporaryDirectory() as tmp:
            model = MockModel([DECISION], lambda cwd: "produced a design candidate")
            spec = LoopSpec(
                goal="make the hero look premium",
                workdir=tmp,
                human_gate=HumanGate(prompt="Approve?", evidence_hint="open hero.png"),
                max_iterations=5,
            )
            report = RouterLoop(
                spec, model=model, input_fn=lambda _p: next(answers)
            ).run()

            self.assertEqual(report.status, STATUS_SUCCEEDED)
            self.assertEqual(report.iterations, 2)  # rejected once, approved once
            # The human's rejection reason is remembered in the ledger.
            self.assertIn("more contrast", report.state.ledger[0].notes)


if __name__ == "__main__":
    unittest.main()
