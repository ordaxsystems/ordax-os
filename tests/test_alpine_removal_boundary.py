"""Alpine retirement: no executable producer or package resolver may return."""
from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
RETIRED_FILES = (
    "bootstrap/base/alpine_core.py",
    "bootstrap/base/runtime_policy.py",
    "bootstrap/stable-base/build.py",
    "bootstrap/windows-compat-runtime/configure_probe.py",
    "bootstrap/windows-compat-runtime/discover_apk_content.py",
    "bootstrap/windows-compat-runtime/apk-content-lock.json",
    ".github/workflows/windows-compat-apk-content-discovery.yml",
    ".github/workflows/windows-compat-full-build-dependency-diagnostic.yml",
    ".github/workflows/windows-compat-wine-configure-proof.yml",
    ".github/workflows/windows-compat-wine-full-build-proof.yml",
)
FORBIDDEN_ACTIONS = ("apk add", "alpine-minirootfs", "dl-cdn.alpinelinux.org")


class AlpineRemovalBoundaryTests(unittest.TestCase):
    def test_retired_producers_and_apk_proofs_are_absent(self):
        for name in RETIRED_FILES:
            with self.subTest(name=name):
                self.assertFalse((ROOT / name).exists())

    def test_active_workflows_cannot_install_alpine_or_invoke_old_builder(self):
        for path in (ROOT / ".github/workflows").glob("*.yml"):
            text = path.read_text(encoding="utf-8")
            with self.subTest(workflow=path.name):
                self.assertFalse(any(action in text for action in FORBIDDEN_ACTIONS))
                self.assertNotIn("bootstrap/stable-base/build.py build", text)
                self.assertNotIn("bootstrap/stable-base/build.py verify", text)
                self.assertNotIn("bootstrap/windows-compat-runtime/configure_probe.py", text)

    def test_stable_rootfs_and_compliance_are_bound_only_to_buildroot(self):
        stable = json.loads((ROOT / "bootstrap/stable-base/source.json").read_text(encoding="utf-8"))
        self.assertNotIn("alpine", stable)
        self.assertNotIn("apk_package_lock", stable)
        self.assertEqual(stable["base_producer"]["profile"], "stable-mvp")
        self.assertEqual(stable["base_producer"]["entrypoint"], "bootstrap/independent-base/build.py")
        self.assertFalse(stable["base_producer"]["physical_artifact_authorized"])
        self.assertFalse(stable["base_producer"]["package_manager_in_runtime_allowed"])
        inputs = json.loads((ROOT / "platform/compliance/declared-inputs.json").read_text(encoding="utf-8"))["inputs"]
        self.assertFalse(any(item["id"].startswith("alpine-") for item in inputs))

    def test_creator_and_local_ai_do_not_restore_apk(self):
        creator = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text(encoding="utf-8")
        self.assertNotIn("bootstrap/dev-base/build.py", creator)
        self.assertNotIn("apk add", creator)
        runtime = (ROOT / "bootstrap/surface-runtime/source.json").read_text(encoding="utf-8")
        self.assertIn('"package_manager_in_runtime_allowed": false', runtime)
        self.assertNotIn('"apk_package_lock"', runtime)
        ai = (ROOT / ".github/workflows/local-ai-runtime-candidate.yml").read_text(encoding="utf-8")
        self.assertNotIn("sudo chroot", ai)
        self.assertIn("LOCAL_AI_REAL_INFERENCE=PASS", ai)
        self.assertIn("LOCAL_AI_UNAUTHENTICATED_COMPLETION=DENIED", ai)

    def test_physical_release_stable_cache_fails_before_kernel_build(self):
        # No expensive kernel/capsule build when the exact signed-release
        # Buildroot component is absent, invalid or belongs to another commit.
        workflow = (ROOT / ".github/workflows/first-physical-usb-payload.yml").read_text(encoding="utf-8")
        legacy = workflow.index("      - name: Block historical Alpine signed sources before any physical build")
        authorization = workflow.index("      - name: Validate authorization, commits and target geometry")
        kernel = workflow.index("      - name: Build and verify exact kernel")
        fingerprint = workflow.index("      - name: Resolve exact Stable component fingerprint from authorized release")
        restore = workflow.index("      - name: Restore exact signed-release Buildroot Stable component")
        verify = workflow.index("      - name: Verify exact authorized Buildroot Stable Base without rebuilding")
        capsule = workflow.index("      - name: Build and verify exact bootstrap capsule")
        self.assertLess(legacy, authorization)
        self.assertLess(authorization, fingerprint)
        self.assertLess(fingerprint, restore)
        self.assertLess(restore, verify)
        self.assertLess(verify, kernel)
        self.assertLess(kernel, capsule)
        cache_check = workflow[verify:kernel]
        self.assertIn('if [ "$ORDAX_STABLE_CACHE_HIT" != true ]; then', cache_check)
        self.assertIn('mkdir -p "$work/metadata"', cache_check)
        self.assertIn('bootstrap/independent-base/build.py verify', cache_check)
        self.assertIn('portable_component_cache.py verify', cache_check)
        self.assertIn('fsck.erofs "$work/stable-base/stable-base.erofs"', cache_check)
        self.assertNotIn("bootstrap/independent-base/build.py build", cache_check)

    def test_physical_legacy_release_is_blocked_before_build(self):
        workflow = (ROOT / ".github/workflows/first-physical-usb-payload.yml").read_text(encoding="utf-8")
        self.assertIn("Block historical Alpine signed sources before any physical build", workflow)
        self.assertLess(workflow.index("Block historical Alpine signed sources"), workflow.index("Build and verify exact kernel"))
        self.assertIn("Verify exact authorized Buildroot Stable Base without rebuilding", workflow)
        self.assertIn("--component independent-base-stable", workflow)
        self.assertIn("--integration-commit", workflow)
        self.assertNotIn("bootstrap/stable-base/build.py", workflow)


if __name__ == "__main__":
    unittest.main()