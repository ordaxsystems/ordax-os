"""Owner USB must include the exact pinned Surface EROFS before boot/release."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools/creator/verify_owner_dev_offline_runtime.py"
SPEC = importlib.util.spec_from_file_location("owner_offline_gate", MODULE)
assert SPEC and SPEC.loader
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)
SOURCE = json.loads((ROOT / "bootstrap/surface-runtime/source.json").read_text())
ID = SOURCE["runtime_id"]


def fixture(stage: Path):
    base = stage / "ORDAX/dev-base"
    surface = base / "workspace/ordax/system/surface/bin/ordax-surface"
    surface.parent.mkdir(parents=True)
    surface.write_text("#!/bin/sh\nVERIFIED_RUNTIME_MODE=verified-erofs-overlay\n", encoding="utf-8")
    (stage / "ORDAX-ESP").mkdir()
    producer = stage / "producer"
    producer.mkdir()
    image = producer / SOURCE["artifact"]["name"]
    image.write_bytes(b"\0" * 1024 + bytes.fromhex("e2e1f5e0") + b"test-surface-erofs-content")
    sha = hashlib.sha256(image.read_bytes()).hexdigest()
    provenance = {
        "$schema": "prototype-ordax.surface-runtime-provenance/1",
        "status": "candidate-not-promotable",
        "runtime_id": ID,
        "physical_artifact_authorized": False,
        "physical_boot_connected": False,
        "image": {"name": image.name, "sha256": sha, "size": image.stat().st_size},
    }
    (producer / "surface-runtime-provenance.json").write_text(json.dumps(provenance))
    return base, producer


class OfflineOwnerWelcomeGateTests(unittest.TestCase):
    def test_release_workflow_builds_and_pins_runtime_before_media_materialization(self):
        workflow = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text()
        build = workflow.index("- name: Build and verify one canonical offline Surface runtime")
        overlay = workflow.index('sudo cp -a out/dev-base/rootfs/. "$stage/ORDAX/dev-base/"')
        seeded = workflow.index('--producer-out "$RUNNER_TEMP/owner-dev-surface-runtime"')
        capabilities = workflow.index("sudo python tools/ci/owner_rootfs_capabilities.py verify-owner-stage")
        media = workflow.index("- name: Materialize and verify RAW development seed")
        geometry = workflow.index('--geometry-out "$RUNNER_TEMP/owner-dev-physical-media.json"')
        self.assertLess(build, overlay)
        self.assertLess(overlay, seeded)
        self.assertLess(seeded, capabilities)
        self.assertLess(capabilities, geometry)
        self.assertLess(geometry, media)
        self.assertIn('--contract "$RUNNER_TEMP/owner-dev-physical-media.json"', workflow)
        self.assertIn("bootstrap/surface-runtime/build.py verify", workflow)
        self.assertIn(
            "ORDAX_OWNER_SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}",
            workflow,
        )
        self.assertIn('--seed-from-local "$GITHUB_WORKSPACE" "$ORDAX_OWNER_SOURCE_COMMIT"', workflow)
        self.assertIn("os.environ['ORDAX_OWNER_SOURCE_COMMIT']", workflow)
        self.assertNotIn('$GITHUB_SHA', workflow)
        self.assertIn("if: github.event_name == 'push' && github.ref == 'refs/heads/main'", workflow)

    def test_checkout_alone_is_not_a_bootable_desktop(self):
        with tempfile.TemporaryDirectory() as work:
            stage = Path(work)
            fixture(stage)
            with self.assertRaisesRegex(GATE.OfflineRuntimeError, "no verified offline graphical runtime"):
                GATE.verify(stage)

    def test_verified_producer_is_staged_without_duplicate_apk_lock(self):
        with tempfile.TemporaryDirectory() as work:
            stage = Path(work)
            base, producer = fixture(stage)
            GATE.stage_runtime(stage, producer)
            self.assertEqual(GATE.verify(stage), ID)
            image = base / GATE.RELATIVE_IMAGE
            self.assertEqual(image.read_bytes(), (producer / SOURCE["artifact"]["name"]).read_bytes())
            pin = base / GATE.RELATIVE_PIN
            self.assertEqual(
                pin.read_text(),
                f"{GATE.sha256(image)}  /ordax/dev-base/{GATE.RELATIVE_IMAGE.as_posix()}\n",
            )
            with self.assertRaisesRegex(GATE.OfflineRuntimeError, "already staged"):
                GATE.stage_runtime(stage, producer)

    def test_tampered_artifact_or_pin_fails_closed(self):
        for mutation in ("image", "pin", "receipt"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as work:
                stage = Path(work)
                base, producer = fixture(stage)
                GATE.stage_runtime(stage, producer)
                if mutation == "image":
                    (base / GATE.RELATIVE_IMAGE).write_bytes(b"tampered")
                elif mutation == "pin":
                    (base / GATE.RELATIVE_PIN).write_text("fake\n")
                else:
                    (base / GATE.RELATIVE_PROVENANCE).write_text('{"runtime_id":"unknown"}')
                with self.assertRaises(GATE.OfflineRuntimeError):
                    GATE.verify(stage)

    def test_candidate_cannot_claim_physical_authorization(self):
        with tempfile.TemporaryDirectory() as work:
            stage = Path(work)
            _, producer = fixture(stage)
            path = producer / "surface-runtime-provenance.json"
            data = json.loads(path.read_text())
            data["physical_artifact_authorized"] = True
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(GATE.OfflineRuntimeError, "verified candidate"):
                GATE.stage_runtime(stage, producer)

    def test_owner_seed_geometry_is_derived_only_for_dev_media(self):
        with tempfile.TemporaryDirectory() as work:
            stage = Path(work)
            _, producer = fixture(stage)
            GATE.stage_runtime(stage, producer)
            # the disposable output contract is generated outside staged media
            with tempfile.TemporaryDirectory() as result:
                path = Path(result) / "geometry.json"
                size = GATE.geometry(stage, path)
                media = json.loads(path.read_text())
                self.assertEqual(size, 2 * GATE.GIB)
                self.assertEqual(media["disposable_proof"]["image_bytes"], size)
                self.assertFalse(media["physical_write_allowed"])
                self.assertEqual(
                    json.loads(GATE.MEDIA.read_text())["disposable_proof"]["image_bytes"],
                    536870912,
                )
                with self.assertRaisesRegex(GATE.OfflineRuntimeError, "already exists"):
                    GATE.geometry(stage, path)

    def test_boot_uses_same_canonical_loop_mount_helper_not_apk(self):
        source = (ROOT / "bootstrap/dev/entrypoint").read_text()
        surface = (ROOT / "system/surface/bin/ordax-surface").read_text()
        self.assertIn("/bin/busybox sha256sum -c", source)
        self.assertIn("/sbin/ordax-portable-mount mount-surface-runtime", source)
        self.assertIn('mount -t tmpfs -o mode=0755 tmpfs "$DEV_ROOT/run"', source)
        self.assertIn("export ORDAX_SURFACE_RUNTIME_MODE ORDAX_SURFACE_RUNTIME_ROOT ORDAX_SURFACE_RUNTIME_SHA256", source)
        self.assertLess(source.index("mount-surface-runtime"), source.index("exec switch_root"))
        self.assertNotIn("ordax-pull", source)
        self.assertIn('[ "$VERIFIED_RUNTIME_MODE" = "verified-erofs-overlay" ]', surface)
        self.assertIn("Owner USB offline graphical runtime is invalid", surface)


if __name__ == "__main__":
    unittest.main()
