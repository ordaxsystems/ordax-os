import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/contracts/hardware-support-matrix.json"
KERNEL = ROOT / "bootstrap/kernel/config/ordax.fragment"
BASE = ROOT / "bootstrap/stable-base/source.json"
PHYSICAL = ROOT / "docs/evidence/physical-native-surface-2026-09-17.md"


class HardwareSupportMatrixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.matrix = json.loads(MATRIX.read_text(encoding="utf-8"))
        cls.kernel = KERNEL.read_text(encoding="utf-8")
        cls.base = json.loads(BASE.read_text(encoding="utf-8"))
        cls.physical = PHYSICAL.read_text(encoding="utf-8")

    def test_matrix_is_usb_x86_64_and_does_not_generalize_one_notebook(self):
        matrix = self.matrix
        self.assertEqual(matrix["$schema"], "prototype-ordax.hardware-support-matrix/1")
        self.assertEqual(matrix["product_scope"], "stable-mvp-usb-only")
        self.assertEqual(matrix["architecture"], "x86_64")
        policy = matrix["support_claim_policy"]
        self.assertFalse(policy["driver_present_is_supported_hardware_claim"])
        self.assertFalse(policy["development_physical_evidence_generalizes_to_other_models"])
        self.assertTrue(policy["stable_mvp_support_requires_target_physical_proof"])
        evidence = matrix["target_notebook_evidence"]
        self.assertFalse(evidence["exact_vendor_model_recorded"])
        self.assertIn("other-notebook-models", evidence["does_not_prove"])
        self.assertEqual(
            matrix["gate_semantics"]["BROAD_HARDWARE_COMPATIBILITY"],
            "NOT_CLAIMED",
        )

    def test_required_kernel_capabilities_are_actually_pinned(self):
        for capability in self.matrix["required_mvp_capabilities"]:
            for requirement in capability.get("kernel_requirements", []):
                self.assertIn(
                    requirement,
                    self.kernel,
                    f"{capability['id']} claims missing kernel requirement {requirement}",
                )

    def test_wifi_matrix_matches_stable_base_module_and_firmware_policy(self):
        wifi = next(
            item for item in self.matrix["required_mvp_capabilities"]
            if item["id"] == "wifi-after-base-start"
        )
        actual_modules = set(self.base["kernel_modules"]["required_basenames"])
        self.assertTrue(set(wifi["module_basenames"]).issubset(actual_modules))
        # Buildroot fragment is the sole firmware package SSOT; the Stable
        # release contract must not carry the retired Alpine package list.
        self.assertNotIn("firmware_packages", wifi)
        producer = self.base["base_producer"]
        independent = json.loads(
            (ROOT / producer["source_contract"]).read_text(encoding="utf-8")
        )
        fragment_path = independent["profiles"][producer["profile"]]["fragment"]
        self.assertEqual(
            fragment_path, "bootstrap/independent-base/configs/wifi-hardware.fragment"
        )
        fragment = (ROOT / fragment_path).read_text(encoding="utf-8")
        self.assertIn("BR2_PACKAGE_LINUX_FIRMWARE=y", fragment)
        self.assertEqual(
            self.base["build"]["shared_firmware_policy"],
            "bootstrap/base/firmware_policy.py",
        )
        self.assertIn("does not claim every adapter", wifi["claim_limit"])

    def test_first_acquisition_network_paths_are_built_in(self):
        network = next(
            item for item in self.matrix["required_mvp_capabilities"]
            if item["id"] == "network-release-acquisition"
        )
        self.assertEqual(network["source_status"], "implemented")
        for requirement in network["kernel_requirements"]:
            self.assertTrue(requirement.endswith("=y"), requirement)
            self.assertIn(requirement, self.kernel)

    def test_physical_claims_are_supported_by_recorded_evidence(self):
        evidence = self.matrix["target_notebook_evidence"]
        self.assertEqual(
            evidence["evidence"],
            "docs/evidence/physical-native-surface-2026-09-17.md",
        )
        for phrase in (
            "physical keyboard worked inside the Surface",
            "physical mouse/touchpad also worked inside the Surface",
            "Cage started through `seatd` on the physical DRM device",
            "rebooted the physical notebook successfully",
            "powered the notebook off completely",
        ):
            self.assertIn(phrase, self.physical)

    def test_unproven_launch_features_stay_explicit(self):
        not_claimed = {item["id"] for item in self.matrix["not_claimed_for_mvp"]}
        self.assertTrue({
            "audio",
            "suspend-resume",
            "touchscreen",
            "bluetooth",
            "webcam",
            "secure-boot",
            "amd-or-nvidia-accelerated-graphics",
            "arm64",
        }.issubset(not_claimed))
        internal = self.matrix["internal_storage_policy"]
        self.assertFalse(internal["mvp_install_to_internal_disk"])
        self.assertFalse(internal["mvp_resize_or_partition_internal_disk"])
        self.assertTrue(internal["kernel_storage_drivers_may_exist_without_product_install_support"])

    def test_source_matrix_pass_does_not_close_stable_physical_proof(self):
        gates = self.matrix["gate_semantics"]
        self.assertEqual(gates["SUPPORTED_HARDWARE_MATRIX"], "PASS_SOURCE")
        self.assertEqual(
            gates["CANONICAL_STABLE_TARGET_HARDWARE_PROOF"],
            "PENDING_PHYSICAL",
        )


if __name__ == "__main__":
    unittest.main()
