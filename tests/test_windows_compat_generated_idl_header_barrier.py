import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/generated_idl_header_barrier.py"

spec = importlib.util.spec_from_file_location("generated_idl_header_barrier", MODULE_PATH)
assert spec is not None and spec.loader is not None
barrier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(barrier)


class GeneratedIdlHeaderBarrierTests(unittest.TestCase):
    def _valid_makefile(self):
        rules = [
            "include/unknwn.h: /src/include/unknwn.idl tools/widl/widl",
            "dlls/jscript/jsdisp.h: /src/dlls/jscript/jsdisp.idl tools/widl/widl",
        ]
        for index in range(1, 24):
            rules.append(f"include/generated{index}.h: /src/include/generated{index}.idl tools/widl/widl")
        rules.append("dlls/example/file.o: /src/dlls/example/file.c include/generated1.h")
        return "\n".join(rules) + "\n"

    def test_derives_only_idl_generated_headers(self):
        targets = barrier.derive_targets(self._valid_makefile())
        self.assertIn("include/unknwn.h", targets)
        self.assertIn("dlls/jscript/jsdisp.h", targets)
        self.assertNotIn("dlls/example/file.o", targets)
        self.assertEqual(targets, sorted(targets))
        self.assertEqual(len(targets), 25)

    def test_continuation_is_parsed_as_one_rule(self):
        text = self._valid_makefile() + "include/continued.h: \\\n /src/include/continued.idl tools/widl/widl\n"
        targets = barrier.derive_targets(text)
        self.assertIn("include/continued.h", targets)

    def test_required_regression_anchor_cannot_disappear(self):
        text = self._valid_makefile().replace(
            "dlls/jscript/jsdisp.h: /src/dlls/jscript/jsdisp.idl tools/widl/widl\n", ""
        )
        with self.assertRaises(barrier.GeneratedIdlHeaderBarrierError):
            barrier.derive_targets(text)

    def test_unsafe_target_is_rejected(self):
        text = self._valid_makefile() + "../escape.h: /src/escape.idl\n"
        with self.assertRaises(barrier.GeneratedIdlHeaderBarrierError):
            barrier.derive_targets(text)

    def test_plan_digest_and_materialization_are_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            makefile = root / "Makefile"
            makefile.write_text(self._valid_makefile(), encoding="utf-8")
            plan = barrier.plan(makefile)
            target_file = root / "targets.txt"
            barrier.write_target_file(plan, target_file)
            self.assertEqual(target_file.read_text(encoding="utf-8").splitlines(), plan["targets"])
            self.assertEqual(plan["targets_sha256"], barrier.canonical_digest(plan["targets"]))

            output = root / "out"
            for target in plan["targets"]:
                path = output / target
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("generated\n", encoding="utf-8")
            barrier.verify_materialized(output, plan)

            (output / plan["targets"][0]).unlink()
            with self.assertRaises(barrier.GeneratedIdlHeaderBarrierError):
                barrier.verify_materialized(output, plan)


if __name__ == "__main__":
    unittest.main()
