"""TPM2 candidate stays separate from the canonical shared Linux kernel."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "bootstrap/kernel"
OVERLAY = KERNEL / "config/overlays/tpm2.fragment"
SPEC = importlib.util.spec_from_file_location("ordax_kernel_stage", KERNEL / "build.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class TPM2StagedKernelTests(unittest.TestCase):
    def test_overlay_inactive_without_explicit_opt_in(self):
        baseline = BUILDER.check_contract()
        staged = BUILDER.check_contract(OVERLAY)
        self.assertFalse(baseline["candidate_config_only"])
        self.assertIsNone(baseline["overlay_fragment"])
        self.assertTrue(staged["candidate_config_only"])
        self.assertEqual(staged["overlay_fragment"], "bootstrap/kernel/config/overlays/tpm2.fragment")
        self.assertEqual(len(staged["overlay_fragment_sha256"]), 64)
        self.assertFalse(baseline["physical_artifact_authorized"])
        self.assertFalse(staged["physical_artifact_authorized"])
        self.assertTrue(baseline["pinned_environment_resolved"])
        self.assertFalse(staged["pinned_environment_resolved"])

    def test_tpm_options_additive_and_not_in_shipping_fragment(self):
        baseline = BUILDER.parse_fragment(KERNEL / "config/ordax.fragment")
        extra = BUILDER.parse_fragment(OVERLAY)
        self.assertFalse(set(baseline) & set(extra))
        expected = {
            "CONFIG_KEYS", "CONFIG_TCG_TPM", "CONFIG_TCG_TIS",
            "CONFIG_TCG_CRB", "CONFIG_TRUSTED_KEYS", "CONFIG_TRUSTED_KEYS_TPM",
        }
        self.assertEqual(set(extra), expected)
        self.assertEqual(set(extra.values()), {f"{name}=y" for name in expected})
        self.assertFalse(expected & baseline.keys())

    def test_overlay_not_accepted_from_arbitrary_path_or_symlink(self):
        baseline = KERNEL / "config/ordax.fragment"
        with tempfile.TemporaryDirectory() as tmp:
            outside = Path(tmp) / "tpm2.fragment"
            outside.write_bytes(OVERLAY.read_bytes())
            with self.assertRaisesRegex(BUILDER.BuildError, "config/overlays"):
                BUILDER.resolve_config_overlay(outside, baseline)
            link = Path(tmp) / "alias.fragment"
            link.symlink_to(OVERLAY)
            with self.assertRaisesRegex(BUILDER.BuildError, "linked"):
                BUILDER.resolve_config_overlay(link, baseline)

    def test_overlay_rejects_replacement_of_base_kconfig(self):
        with patch.object(BUILDER, "parse_fragment", side_effect=[
            {"CONFIG_EFI_STUB": "CONFIG_EFI_STUB=n"},
            {"CONFIG_EFI_STUB": "CONFIG_EFI_STUB=y"},
        ]):
            with self.assertRaisesRegex(BUILDER.BuildError, "override canonical selectors"):
                BUILDER.resolve_config_overlay(OVERLAY, KERNEL / "config/ordax.fragment")

    def test_effective_config_merges_using_existing_kernel_builder(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / ".config"
            config.write_text("CONFIG_KEYS=n\nCONFIG_TCG_TPM=n\nCONFIG_EFI_STUB=y\n")
            base = Path(tmp) / "base.fragment"
            base.write_text("CONFIG_EFI_STUB=y\n")
            requested = BUILDER.merge_fragment(config, base)
            requested.update(BUILDER.merge_fragment(config, OVERLAY))
            self.assertEqual(requested["CONFIG_TCG_TPM"], "CONFIG_TCG_TPM=y")
            self.assertIn("CONFIG_EFI_STUB=y", config.read_text())
            self.assertIn("CONFIG_TCG_TPM=y", config.read_text())
            BUILDER.verify_resolved_config(config, requested)

    def test_no_second_kernel_source_or_release_authority(self):
        current = (KERNEL / "source.json").read_text()
        builder = (KERNEL / "build.py").read_text()
        self.assertIn('"fragment": "bootstrap/kernel/config/ordax.fragment"', current)
        self.assertIn("candidate-config-overlay-unpromotable", builder)
        self.assertIn('"promotable_to_physical": False', builder)
        self.assertIn("and overlay is None", builder)


if __name__ == "__main__":
    unittest.main()
