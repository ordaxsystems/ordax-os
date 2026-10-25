from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = ROOT / "bootstrap"

# Existing Alpine coupling at the start of the migration. This allowlist must
# shrink over time; adding a new production consumer is an architectural
# regression and requires an explicit migration decision.
ALLOWED_PYTHON_REFERENCES = {
    "bootstrap/stable-base/build.py",
    "bootstrap/surface-runtime/build.py",
    "bootstrap/surface-runtime/discover_lock.py",
    "bootstrap/windows-compat-runtime/configure_probe.py",
}


class AlpineRemovalBoundaryTests(unittest.TestCase):
    def test_no_new_python_consumer_of_alpine_core_is_introduced(self) -> None:
        references: set[str] = set()
        for path in BOOTSTRAP.rglob("*.py"):
            if path.name == "alpine_core.py":
                continue
            text = path.read_text(encoding="utf-8")
            if "alpine_core.py" in text:
                references.add(path.relative_to(ROOT).as_posix())

        unexpected = references - ALLOWED_PYTHON_REFERENCES
        self.assertEqual(
            unexpected,
            set(),
            "new Alpine core consumers are forbidden during removal: "
            + ", ".join(sorted(unexpected)),
        )

        stale = ALLOWED_PYTHON_REFERENCES - references
        self.assertEqual(
            stale,
            set(),
            "Alpine coupling was removed; shrink ALLOWED_PYTHON_REFERENCES: "
            + ", ".join(sorted(stale)),
        )

    def test_retired_dev_builder_is_absent(self) -> None:
        self.assertFalse((BOOTSTRAP / "dev-base/build.py").exists())
        self.assertTrue((BOOTSTRAP / "independent-base/post-build.sh").is_file())

    def test_independent_base_never_references_alpine_core(self) -> None:
        offenders: list[str] = []
        root = BOOTSTRAP / "independent-base"
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in {".py", ".sh", ".json", ".mk"}:
                continue
            if "alpine_core.py" in path.read_text(encoding="utf-8"):
                offenders.append(path.relative_to(ROOT).as_posix())
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
