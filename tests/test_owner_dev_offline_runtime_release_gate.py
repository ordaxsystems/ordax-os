"""Release image must include the real offline graphical stack before publication."""
from __future__ import annotations

from pathlib import Path
import importlib.util
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools/creator/verify_owner_dev_offline_runtime.py"
SPEC = importlib.util.spec_from_file_location("owner_offline_gate", MODULE)
assert SPEC and SPEC.loader
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)

ID = "alpine-v3.22-cage-webkitgtk-v1"


def fixture(directory: Path) -> tuple[Path, Path]:
    base = directory / "ORDAX/dev-base"
    surface = base / "workspace/ordax/system/surface/bin/ordax-surface"
    surface.parent.mkdir(parents=True)
    surface.write_text(f"#!/bin/sh\nRUNTIME_ID={ID}\n", encoding="utf-8")
    return base, base / "state/ordax/runtime/native-surface" / ID


class OfflineOwnerWelcomeGateTests(unittest.TestCase):
    def test_release_workflow_requires_gate_before_media_materialization(self):
        workflow = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text()
        image_stage = workflow.index('sudo cp -a out/dev-base/rootfs/. "$stage/ORDAX/dev-base/"')
        gate = workflow.index("sudo python tools/creator/verify_owner_dev_offline_runtime.py")
        media = workflow.index("- name: Materialize and verify RAW development seed")
        self.assertLess(image_stage, gate)
        self.assertLess(gate, media)

    def test_checkout_alone_is_not_a_bootable_desktop(self):
        with tempfile.TemporaryDirectory() as work:
            stage = Path(work)
            fixture(stage)
            with self.assertRaisesRegex(GATE.OfflineRuntimeError, "no verified offline graphical runtime"):
                GATE.verify(stage)

    def test_partial_runtime_cannot_pass(self):
        with tempfile.TemporaryDirectory() as work:
            stage = Path(work)
            _, root = fixture(stage)
            root.mkdir(parents=True)
            (root / "ready").write_text(ID + "\n", encoding="utf-8")
            with self.assertRaisesRegex(GATE.OfflineRuntimeError, "missing required file"):
                GATE.verify(stage)

    def test_complete_stage_passes_and_missing_library_fails_closed(self):
        with tempfile.TemporaryDirectory() as work:
            stage = Path(work)
            _, root = fixture(stage)
            root.mkdir(parents=True)
            (root / "ready").write_text(ID + "\n", encoding="utf-8")
            fs = root / "rootfs"
            for rel in GATE.REQUIRED_FILES:
                p = fs / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b"known-verified-build-content")
                p.chmod(0o755)
            self.assertEqual(GATE.verify(stage), ID)
            (fs / "usr/lib/girepository-1.0/WebKit2-4.1.typelib").unlink()
            with self.assertRaisesRegex(GATE.OfflineRuntimeError, "WebKit2-4.1.typelib"):
                GATE.verify(stage)


if __name__ == "__main__":
    unittest.main()
