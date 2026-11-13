"""Regression: independent Dev component orchestration never compiles a cache hit."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "tools/ci/dev_components.py"
spec = importlib.util.spec_from_file_location("ordax_dev_components", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class DevComponentsTests(unittest.TestCase):
    def test_plan_never_builds(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(mod, "fingerprint", return_value="a" * 64), \
                 patch.object(mod, "run") as run:
                result = mod.component("base", Path(temp), 2, False)
                self.assertEqual(result["status"], "needs-build")
                run.assert_not_called()

    def test_verified_hit_never_builds(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "surface" / ("b" * 64)
            target.mkdir(parents=True)
            (target / ".ordax-dev-component.json").write_text(
                json.dumps({"component": "surface", "fingerprint": "b" * 64}))
            with patch.object(mod, "fingerprint", return_value="b" * 64), \
                 patch.object(mod, "run") as run:
                result = mod.component("surface", root, 2, True)
                self.assertEqual(result["status"], "reused-verified")
                self.assertEqual(run.call_count, 1)
                self.assertIn("verify", run.call_args.args)

    def test_stale_fingerprint_not_reused(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "base" / ("c" * 64)
            target.mkdir(parents=True)
            (target / ".ordax-dev-component.json").write_text(
                json.dumps({"component": "base", "fingerprint": "d" * 64}))
            with patch.object(mod, "fingerprint", return_value="c" * 64), \
                 patch.object(mod, "run") as run:
                result = mod.component("base", root, 2, False)
                self.assertEqual(result["status"], "needs-build")
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
