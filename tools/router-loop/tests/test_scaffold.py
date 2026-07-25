"""Tests for project detection and spec scaffolding used by `router-loop init`."""

from __future__ import annotations

import json
import os
import tempfile
import unittest

from router_loop.config import LoopSpec
from router_loop.scaffold import detect_project, scaffold_spec


class DetectTest(unittest.TestCase):
    def _dir(self, files):
        tmp = tempfile.mkdtemp()
        for name, content in files.items():
            path = os.path.join(tmp, name)
            os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(name) else None
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(content)
        return tmp

    def test_detects_node_test_script(self):
        d = self._dir({"package.json": json.dumps({"scripts": {"test": "jest"}})})
        det = detect_project(d)
        self.assertEqual(det.gate_command, "npm test")
        self.assertTrue(det.confident)

    def test_detects_node_build_when_no_test(self):
        d = self._dir({"package.json": json.dumps({"scripts": {"build": "tsc"}})})
        self.assertEqual(detect_project(d).gate_command, "npm run build")

    def test_detects_rust(self):
        d = self._dir({"Cargo.toml": ""})
        self.assertEqual(detect_project(d).gate_command, "cargo test")

    def test_detects_go(self):
        d = self._dir({"go.mod": "module x"})
        self.assertEqual(detect_project(d).gate_command, "go test ./...")

    def test_detects_python_pyproject(self):
        d = self._dir({"pyproject.toml": ""})
        self.assertIn("pytest", detect_project(d).gate_command)

    def test_unknown_is_not_confident(self):
        d = self._dir({"README.md": "hi"})
        det = detect_project(d)
        self.assertEqual(det.kind, "unknown")
        self.assertFalse(det.confident)

    def test_scaffolded_spec_is_valid(self):
        d = self._dir({"pyproject.toml": "", "tests/test_x.py": ""})
        spec_dict = scaffold_spec(d, goal="make tests pass")
        # Must round-trip through the real loader and validation.
        spec = LoopSpec.from_dict(spec_dict)
        self.assertEqual(spec.goal, "make tests pass")
        self.assertIsNotNone(spec.command_gate)


if __name__ == "__main__":
    unittest.main()
