"""Owner USB must include the exact pinned Surface EROFS before boot/release."""
from __future__ import annotations

import hashlib
import os
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools/creator/verify_owner_dev_offline_runtime.py"
SPEC = importlib.util.spec_from_file_location("owner_offline_gate", MODULE)
assert SPEC and SPEC.loader
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)
SOURCE = json.loads((ROOT / "bootstrap/surface-runtime/source.json").read_text())
COMMIT = "1" * 40
ID = f"{SOURCE['build_profile']}@{COMMIT[:12]}"


def fixture(stage: Path):
    base = stage / "ORDAX/dev-base"
    surface = base / "workspace/ordax/system/surface/bin/ordax-surface"
    surface.parent.mkdir(parents=True)
    surface.write_text("#!/bin/sh\nVERIFIED_RUNTIME_MODE=verified-erofs-overlay\n", encoding="utf-8")
    commit = base / "state/ordax/current-commit"
    commit.parent.mkdir(parents=True, exist_ok=True)
    commit.write_text(COMMIT + "\n", encoding="ascii")
    (stage / "ORDAX-ESP").mkdir()
    producer = stage / "producer"
    producer.mkdir()
    image = producer / SOURCE["artifact"]["name"]
    image.write_bytes(b"\0" * 1024 + bytes.fromhex("e2e1f5e0") + b"test-surface-erofs-content")
    sha = hashlib.sha256(image.read_bytes()).hexdigest()
    provenance = {
        "$schema": "prototype-ordax.surface-runtime-provenance/1",
        "status": "candidate-not-promotable",
        "source_commit": COMMIT,
        "libc": "musl",
        "buildroot": {"source_contract": SOURCE["buildroot_source_contract"]},
        "runtime_inventory": {"apk_runtime_absent": True},
        "package_manager_present": False,
        "alpine_present": False,
        "physical_artifact_authorized": False,
        "stable_promotion_authorized": False,
        "image": {"name": image.name, "sha256": sha, "size": image.stat().st_size},
    }
    (producer / "provenance.json").write_text(json.dumps(provenance))
    return base, producer


class OfflineOwnerWelcomeGateTests(unittest.TestCase):
    def test_release_workflow_builds_and_pins_runtime_before_media_materialization(self):
        workflow = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text()
        consume = workflow.index("- name: Consume verified canonical offline Surface runtime")
        native = workflow.index("- name: Build boot initramfs and Git development base")
        overlay = workflow.index('sudo cp -aL out/dev-base/rootfs/. "$stage/ORDAX/dev-base/"')
        seeded = workflow.index('--producer-out "$RUNNER_TEMP/owner-dev-surface-runtime"')
        capabilities = workflow.index("sudo python tools/ci/owner_rootfs_capabilities.py verify-owner-stage")
        media = workflow.index("- name: Materialize and verify RAW development seed")
        geometry = workflow.index('--geometry-out "$RUNNER_TEMP/owner-dev-physical-media.json"')
        self.assertLess(consume, native)
        self.assertLess(native, overlay)
        self.assertLess(overlay, seeded)
        self.assertLess(seeded, capabilities)
        self.assertLess(capabilities, geometry)
        self.assertLess(geometry, media)
        self.assertIn('--contract "$RUNNER_TEMP/owner-dev-physical-media.json"', workflow)
        self.assertIn("bootstrap/surface-runtime/build.py verify", workflow)
        self.assertIn("bootstrap/independent-base/build.py build", workflow)
        self.assertNotIn("bootstrap/surface-runtime/build.py build", workflow)
        self.assertNotIn("bootstrap/dev-base/build.py", workflow)
        self.assertNotIn("bootstrap/independent-surface-runtime/build.py", workflow)
        self.assertIn(
            "ORDAX_OWNER_SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}",
            workflow,
        )
        self.assertIn('--seed-from-local "$GITHUB_WORKSPACE" "$ORDAX_OWNER_SOURCE_COMMIT"', workflow)
        self.assertIn("os.environ['ORDAX_OWNER_SOURCE_COMMIT']", workflow)
        self.assertNotIn('$GITHUB_SHA', workflow)
        self.assertIn("if: github.event_name == 'push' && github.ref == 'refs/heads/main'", workflow)
        growth = workflow.split("- name: Materialize and verify RAW development seed", 1)[1].split(
            "- name: Build split Windows Creator bundle", 1
        )[0]
        self.assertIn('export ORDAX_SOURCE_COMMIT="$ORDAX_OWNER_SOURCE_COMMIT"', growth)
        self.assertIn("assert prepared['source_commit'] == os.environ['ORDAX_OWNER_SOURCE_COMMIT']", growth)

    def test_creator_consumes_producer_verified_buildroot_without_rebuilding_webkit(self):
        workflow = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text()
        producer = (ROOT / ".github/workflows/independent-surface-runtime.yml").read_text()
        resolve = producer.index("- name: Bind Buildroot toolchain headers to canonical OrdaX kernel SSOT")
        configure = producer.index("- name: Resolve exact Kconfig before expensive graphical build")
        build = producer.index("- name: Build Buildroot/musl Surface runtime on durable artifact miss")
        verify = producer.index("- name: Verify exact Independent Surface EROFS bytes")
        self.assertLess(resolve, configure)
        self.assertLess(configure, build)
        self.assertLess(build, verify)
        self.assertIn("bootstrap/surface-runtime/prepare_config.py materialize", producer)
        self.assertIn("bootstrap/surface-runtime/build.py build", producer)
        self.assertIn("bootstrap/surface-runtime/build.py verify", producer)
        self.assertIn("Restore exact Surface compiler cache on durable artifact miss", producer)
        self.assertIn("Restore Surface Buildroot source downloads on durable artifact miss", producer)
        self.assertIn("Save exact Surface compiler cache", producer)
        self.assertIn("Save Surface Buildroot source download cache", producer)
        # The producer exports Buildroot caches via GITHUB_ENV, not YAML env
        # declarations. Both persistent and hosted paths must reach preflight
        # and build steps without losing the compiler/download cache.
        for name in ("BR2_CCACHE_DIR", "BR2_DL_DIR"):
            exports = [
                line.strip()
                for line in producer.splitlines()
                if line.strip().startswith(f'echo "{name}=$cache_root/')
            ]
            self.assertEqual(len(exports), 2, f"{name} must support both cache roots")
            self.assertTrue(
                all(line.endswith(' >> "$GITHUB_ENV"') for line in exports),
                f"{name} must persist through GITHUB_ENV",
            )
        self.assertNotIn("bootstrap/surface-runtime/build.py build", workflow)
        self.assertNotIn("bootstrap/surface-runtime/prepare_config.py materialize", workflow)
        self.assertIn("- name: Consume verified canonical offline Surface runtime", workflow)
        self.assertNotIn("native-surface-runtime.erofs' > ", workflow)

    def test_creator_reuses_verified_immutable_surface_inputs_across_commits(self):
        workflow = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text()
        independent = (ROOT / ".github/workflows/independent-surface-runtime.yml").read_text()
        restore = workflow.index("- name: Restore exact verified Surface EROFS for Owner")
        consume = workflow.index("- name: Consume verified canonical offline Surface runtime")
        native = workflow.index("- name: Build boot initramfs and Git development base")
        stage = workflow.index("- name: Assemble boot payload and overlay Git development base")
        self.assertLess(restore, consume)
        self.assertLess(consume, native)
        self.assertLess(native, stage)
        key = "ordax-independent-surface-artifact-v1-"
        self.assertIn(key, workflow)
        self.assertIn(key, independent)
        self.assertIn("independent_surface_component_cache.py fingerprint", workflow)
        self.assertIn("independent_surface_component_cache.py verify", workflow)
        self.assertIn("--cache-hit true --consumer", workflow)
        self.assertNotIn('if [ "$cached_commit" = "$ORDAX_OWNER_SOURCE_COMMIT" ]; then', workflow)
        self.assertIn("verified-content-addressed-cache", workflow)
        self.assertIn("independent_surface_r2.sh restore", workflow)
        self.assertIn("independent_surface_r2.sh publish", workflow)
        self.assertIn("Surface consumer", (ROOT / "tools/creator/verify_owner_dev_offline_runtime.py").read_text())
        self.assertIn('cp -a "$out/." "$RUNNER_TEMP/owner-dev-surface-runtime/"', workflow)
        self.assertIn("Canonical Surface EROFS missing", workflow)
        self.assertNotIn("bootstrap/surface-runtime/build.py build", workflow)
        self.assertIn("bootstrap/surface-runtime/build.py verify", workflow)
        self.assertIn("bootstrap/surface-runtime/build.py build", independent)

    def test_only_specialized_producer_handles_buildroot_compiler_and_download_cache(self):
        workflow = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text()
        producer = (ROOT / ".github/workflows/independent-surface-runtime.yml").read_text()
        self.assertNotIn("bootstrap/surface-runtime/build.py build", workflow)
        self.assertNotIn("owner-surface-ccache", workflow)
        self.assertNotIn("owner-surface-downloads", workflow)
        self.assertIn("python3 bootstrap/surface-runtime/build.py build", producer)
        self.assertIn("python3 bootstrap/surface-runtime/build.py verify", producer)
        self.assertNotIn("sudo -E python3 bootstrap/surface-runtime/", producer)
        self.assertIn("Restore exact Surface compiler cache on durable artifact miss", producer)
        self.assertIn("Restore Surface Buildroot source downloads on durable artifact miss", producer)
        self.assertIn("Sanitize reusable Surface download cache", producer)
        self.assertIn("Save Surface Buildroot source download cache", producer)
        self.assertIn("Save exact Surface compiler cache", producer)
        self.assertIn("if: always() &&", producer)
        self.assertNotIn("always() && steps.owner-surface-artifact-cache", workflow)

    def test_owner_visual_source_is_removed_before_expensive_buildroot(self):
        workflow = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text()
        owner = workflow.split("- name: Build boot initramfs and Git development base", 1)[1]
        owner = owner.split("- name: Create ephemeral prototype trust", 1)[0]
        removal = owner.index('rm -rf "$target"')
        clean_before = owner.index('OWNER_SOURCE_CHECKOUT_DIRTY_BEFORE_BUILDROOT')
        buildroot = owner.index("bootstrap/independent-base/build.py build")
        clean_after = owner.index('OWNER_SOURCE_CHECKOUT_DIRTY_AFTER_BUILDROOT')
        self.assertLess(removal, clean_before)
        self.assertLess(clean_before, buildroot)
        self.assertLess(buildroot, clean_after)
        self.assertIn("OWNER_ROOTFS_GIT_NOT_EXECUTABLE", owner)
        self.assertIn("OWNER_ROOTFS_APK_BINARY_PRESENT", owner)
        self.assertIn("OWNER_ROOTFS_BUILDROOT_BOOTSTRAP=VERIFIED", owner)
        self.assertNotIn("bootstrap/dev-base/build.py", owner)

    def test_checkout_alone_is_not_a_bootable_desktop(self):
        with tempfile.TemporaryDirectory() as work:
            stage = Path(work)
            fixture(stage)
            with self.assertRaisesRegex(GATE.OfflineRuntimeError, "no verified offline graphical runtime"):
                GATE.verify(stage)

    def test_verified_independent_producer_is_staged_without_alpine_or_apk(self):
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


    @mock.patch.dict(os.environ, {"ORDAX_COMPONENT_CACHE_ENVIRONMENT": "Linux/X64/ubuntu24/20261023.334.3"})
    def test_reused_cross_commit_cache_preserves_producer_and_binds_owner(self):
        from tools.ci import independent_surface_component_cache as cache
        with tempfile.TemporaryDirectory() as work:
            stage = Path(work)
            base, producer = fixture(stage)
            meta = producer / "provenance.json"
            original = json.loads(meta.read_text())
            original["source_commit"] = "2" * 40
            meta.write_text(json.dumps(original))
            cache.record(producer, "2" * 40)
            before = meta.read_bytes()
            GATE.stage_runtime(stage, producer)
            self.assertEqual(GATE.verify(stage), ID)
            self.assertEqual(meta.read_bytes(), before)
            receipt = json.loads((base / GATE.RELATIVE_BINDING).read_text())
            self.assertEqual(receipt["build_source_commit"], "2" * 40)
            self.assertEqual(receipt["integration_source_commit"], COMMIT)
            self.assertEqual(receipt["provenance_sha256"], GATE.sha256(base / GATE.RELATIVE_PROVENANCE))
            self.assertFalse(receipt["provenance_rewritten"])
            (base / GATE.RELATIVE_BINDING).write_text(json.dumps({**receipt, "input_fingerprint": "0" * 64}))
            with self.assertRaisesRegex(GATE.OfflineRuntimeError, "fingerprint changed"):
                GATE.verify(stage)

    @mock.patch.dict(os.environ, {"ORDAX_COMPONENT_CACHE_ENVIRONMENT": "Linux/X64/ubuntu24/20261023.334.3"})
    def test_cross_commit_cache_rejects_missing_or_tampered_manifest(self):
        from tools.ci import independent_surface_component_cache as cache
        for mutation in ("missing", "tamper"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as work:
                stage = Path(work)
                _, producer = fixture(stage)
                meta = producer / "provenance.json"
                original = json.loads(meta.read_text())
                original["source_commit"] = "2" * 40
                meta.write_text(json.dumps(original))
                if mutation == "tamper":
                    cache.record(producer, "2" * 40)
                    manifest = producer / cache.MANIFEST
                    data = json.loads(manifest.read_text())
                    data["artifacts"]["native-surface-runtime.erofs"]["sha256"] = "0" * 64
                    manifest.write_text(json.dumps(data))
                with self.assertRaisesRegex(GATE.OfflineRuntimeError, "cross-commit Surface cache was not verified"):
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
            path = producer / "provenance.json"
            data = json.loads(path.read_text())
            data["physical_artifact_authorized"] = True
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(GATE.OfflineRuntimeError, "verified Alpine-free candidate"):
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
        # Bind the new root before mounting its child tmpfs/overlay tree.
        # A later non-recursive bind shadows already-mounted children.
        self.assertLess(
            source.index('mount -o bind "$DEV_ROOT" "$DEV_ROOT"'),
            source.index('mount -t tmpfs -o mode=0755 tmpfs "$DEV_ROOT/run"'),
        )
        self.assertLess(
            source.index('mount -t tmpfs -o mode=0755 tmpfs "$DEV_ROOT/run"'),
            source.index("/sbin/ordax-portable-mount mount-surface-runtime"),
        )
        self.assertLess(source.index("mount-surface-runtime"), source.index("exec switch_root"))
        self.assertNotIn("ordax-pull", source)
        self.assertIn('[ "$VERIFIED_RUNTIME_MODE" = "verified-erofs-overlay" ]', surface)
        self.assertIn("verified offline EROFS graphical runtime is unavailable", surface)


if __name__ == "__main__":
    unittest.main()
