import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "bootstrap/surface-runtime/source.json"
DISCOVERY = ROOT / "bootstrap/surface-runtime/discover_lock.py"
BUILDER = ROOT / "bootstrap/surface-runtime/build.py"
WORKFLOW = ROOT / ".github" / "workflows" / "surface-runtime-lock-discovery.yml"
SURFACE = ROOT / "system/surface/bin/ordax-surface"


class SurfaceRuntimeSourceContractTests(unittest.TestCase):
    def test_candidate_requires_offline_first_boot_and_remains_unpromotable(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["$schema"], "prototype-ordax.surface-runtime-source/1")
        self.assertEqual(contract["status"], "candidate-not-promotable")
        self.assertEqual(contract["product_scope"], "stable-mvp-usb-only")
        self.assertTrue(contract["first_boot_offline_required"])
        self.assertFalse(contract["network_package_install_during_stable_boot_allowed"])
        self.assertTrue(contract["apk_package_versions_pinned"])
        self.assertIsInstance(contract["apk_package_lock"], dict)
        self.assertEqual(contract["apk_package_lock_count"], len(contract["apk_package_lock"]))
        self.assertEqual(contract["apk_package_lock_count"], 253)
        self.assertFalse(contract["artifact"]["physical_artifact_authorized"])
        self.assertTrue(
            contract["artifact"]["portable_v3_boot_handoff_candidate_connected"]
        )
        self.assertFalse(contract["artifact"]["physical_boot_connected"])
        self.assertEqual(
            contract["artifact"]["release_manifest_schema"],
            "prototype-ordax.release-manifest/3",
        )
        self.assertIn(
            "prove-stable-first-surface-boot-with-network-disabled-on-current-head",
            contract["promotion_blockers"],
        )

    def test_current_lock_refresh_is_bound_to_ci_drift_evidence(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        lock = contract["apk_package_lock"]
        refresh = contract["lock_refresh"]
        discovery = contract["discovery_evidence"]
        proof = contract["reproducibility_proof"]
        self.assertEqual(refresh["resolved_package_count"], len(lock))
        self.assertEqual(refresh["previous_package_count"], len(lock))
        self.assertEqual(refresh["missing"], [])
        self.assertEqual(refresh["extra"], [])
        self.assertFalse(refresh["physical_artifact_created"])
        self.assertFalse(refresh["physical_write_authorized"])
        self.assertRegex(refresh["discovery_source_commit"], r"^[0-9a-f]{40}$")
        self.assertRegex(refresh["discovery_artifact_sha256"], r"^[0-9a-f]{64}$")
        self.assertGreater(refresh["discovery_artifact_id"], 0)
        self.assertGreater(refresh["discovery_run_id"], 0)
        self.assertGreater(refresh["detected_by_qemu_run_id"], 0)
        self.assertEqual(discovery["source_commit"], refresh["discovery_source_commit"])
        self.assertEqual(discovery["workflow_run_id"], refresh["discovery_run_id"])
        self.assertEqual(discovery["artifact_archive_sha256"], refresh["discovery_artifact_sha256"])
        self.assertEqual(discovery["resolved_package_count"], len(lock))
        self.assertFalse(discovery["physical_artifact_created"])
        self.assertFalse(discovery["physical_write_authorized"])
        changed = refresh["changed"]
        self.assertIsInstance(changed, list)
        self.assertTrue(changed)
        self.assertEqual(len(changed), len({item["name"] for item in changed}))
        for entry in changed:
            self.assertEqual(lock[entry["name"]], entry["to"])
            self.assertNotEqual(entry["from"], entry["to"])
        for field in ("tree_manifest_sha256", "normalized_tar_sha256", "erofs_sha256"):
            self.assertRegex(proof[field], r"^[0-9a-f]{64}$")
        self.assertGreater(proof["erofs_size"], 0)
        self.assertTrue(proof["repeat_digest_required"])
        self.assertTrue(proof["repeat_digest_passed"])

        if refresh["status"] == "reviewed-candidate-lock-refresh":
            self.assertFalse(refresh["reproducibility_reproof_required"])
            self.assertEqual(proof["status"], "pass-ci-repeat-digest")
            # The drift discovery ran against the OLD source; byte-repeat proof
            # is independently tied to the first commit containing the new lock.
            self.assertRegex(proof["source_commit"], r"^[0-9a-f]{40}$")
            self.assertIsInstance(proof["workflow_run_id"], int)
            self.assertGreater(proof["workflow_run_id"], 0)
            self.assertIn("byte-reproducible-erofs-runtime-ci", contract["closed_gates"])
        else:
            # New Alpine security revisions must fail closed until current
            # bytes are reproduced, without hardcoding every future package
            # or upgrading packages during an offline USB boot.
            self.assertTrue(refresh["status"].startswith("reproof-required-after-upstream-"))
            self.assertTrue(refresh["reproducibility_reproof_required"])
            drift = refresh["upstream_drift"]
            self.assertIn(
                {"name": drift["package"], "from": drift["from"], "to": drift["to"]},
                changed,
            )
            self.assertEqual(drift["detected_by_qemu_run_id"], refresh["detected_by_qemu_run_id"])
            self.assertEqual(lock[drift["package"]], drift["to"])
            self.assertEqual(proof["status"], "historical-pass-reproof-required")
            self.assertNotIn("byte-reproducible-erofs-runtime-ci", contract["closed_gates"])
            self.assertIn(
                "repeat-byte-reproducible-erofs-build-on-current-apk-lock",
                contract["promotion_blockers"],
            )

    def test_candidate_reuses_exact_stable_base_alpine_identity(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        stable = json.loads((ROOT / "bootstrap/stable-base/source.json").read_text(encoding="utf-8"))
        for field in ("version", "branch", "arch", "archive_sha256"):
            self.assertEqual(contract["alpine"][field], stable["alpine"][field])

    def test_discovery_is_lock_only_and_forbids_physical_promotion(self):
        text = DISCOVERY.read_text(encoding="utf-8")
        self.assertIn('"verified-pinned-lock"', text)
        self.assertIn('"discovered-not-promotable"', text)
        self.assertIn("resolved package lock differs from committed candidate lock", text)
        self.assertIn('"drift-detected-not-promotable"', text)
        self.assertIn('result["drift"] = drift', text)
        self.assertIn("full drift report was written before failing closed", text)
        self.assertIn('"physical_artifact_created": False', text)
        self.assertIn('"physical_write_authorized": False', text)
        self.assertIn('"portable_v3_boot_handoff_candidate_connected": True', text)
        self.assertIn('"physical_boot_connected": False', text)
        self.assertNotIn("/dev/sd", text)
        self.assertNotIn("/dev/nvme", text)


    def test_workflow_uploads_drift_report_even_when_revalidation_fails(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("- name: Upload proof metadata only\n        if: always()", text)
        self.assertIn("surface-runtime-lock.json", text)

    def test_builder_is_fail_closed_until_reviewed_lock_is_committed(self):
        text = BUILDER.read_text(encoding="utf-8")
        self.assertIn('status") != "candidate-not-promotable"', text)
        self.assertIn('apk_package_versions_pinned") is not True', text)
        self.assertIn("Surface runtime cannot build before reviewed APK lock is committed", text)
        self.assertIn('"physical_artifact_authorized": False', text)
        self.assertIn('"portable_v3_boot_handoff_candidate_connected": True', text)
        self.assertIn('"physical_boot_connected": False', text)


    def test_immutable_runtime_excludes_device_identity_and_derived_font_cache(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        generated = contract["runtime_generated_state"]
        self.assertFalse(generated["machine_identity_baked_into_image"])
        self.assertFalse(generated["fontconfig_cache_baked_into_image"])
        text = BUILDER.read_text(encoding="utf-8")
        self.assertIn('for relative in ("etc/machine-id", "var/lib/dbus/machine-id")', text)
        self.assertIn('cache = rootfs / "var/cache/fontconfig"', text)
        self.assertIn("prune_generated_runtime_state(rootfs)", text)

    def test_existing_owner_runtime_path_is_not_silently_removed(self):
        surface = SURFACE.read_text(encoding="utf-8")
        self.assertIn("install_runtime()", surface)
        self.assertIn("run_bounded_apk", surface)
        self.assertIn('if [ "$DISTRIBUTION_PROFILE" = "stable-mvp" ]', surface)


if __name__ == "__main__":
    unittest.main()
