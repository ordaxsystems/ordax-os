#!/usr/bin/env python3
"""Focused regressions for development postboot Base promotion."""

from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system/services/base-update/dev_postboot_promote.py"


def load_module():
    spec = spec_from_file_location("ordax_dev_postboot_promote_test", MODULE)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


promotion = load_module()


class DevelopmentPostbootPromotionTests(unittest.TestCase):
    def test_owner_proof_checks_actual_head_and_request(self):
        artifact, request, current = "a" * 40, "b" * 40, "c" * 40
        with patch.object(promotion._channel, "_git_bytes", return_value=current.encode()), \
             patch.object(promotion._channel, "prove_compatible_source", return_value=True) as check:
            proof = promotion._owner_source_proof(Path("."), artifact, request, current)
            self.assertTrue(proof(artifact, current))
            self.assertEqual([call.args[1:] for call in check.call_args_list],
                             [(artifact, request), (request, current), (artifact, current)])
        with patch.object(promotion._channel, "_git_bytes", return_value=artifact.encode()):
            with self.assertRaisesRegex(promotion.PostbootPromotionError, "checkout changed"):
                promotion._owner_source_proof(Path("."), artifact, request, current)
        with patch.object(promotion._channel, "_git_bytes", return_value=current.encode()), \
             patch.object(promotion._channel, "prove_compatible_source", return_value=False):
            with self.assertRaisesRegex(promotion.PostbootPromotionError, "no longer satisfies"):
                promotion._owner_source_proof(Path("."), artifact, request, current)

    def test_normal_boot_is_not_a_candidate(self):
        with self.assertRaises(promotion.NotCandidateBoot):
            promotion._candidate_identity(
                "quiet splash ordax.mode=normal ordax.base_slot=a"
                .replace(" ordax.base_slot=a", "")
            )

    def test_partial_candidate_identity_fails_closed(self):
        with self.assertRaisesRegex(
            promotion.PostbootPromotionError,
            "candidate boot identity is incomplete",
        ):
            promotion._candidate_identity(
                "quiet ordax.mode=normal ordax.base_candidate=" + "a" * 40
            )

    def test_legacy_candidate_requires_slot_b_and_preserves_a(self):
        layout = {
            "layout": "legacy",
            "stage_active_slot": "legacy",
            "active_slot": "legacy",
            "candidate_slot": "b",
        }
        self.assertEqual(promotion._derive_previous_slot(layout, "b"), "a")
        with self.assertRaisesRegex(
            promotion.PostbootPromotionError,
            "legacy migration candidate must boot from slot b",
        ):
            promotion._derive_previous_slot(layout, "a")

    def test_ab_candidate_preserves_current_slot(self):
        layout = {
            "layout": "ab",
            "stage_active_slot": "a",
            "active_slot": "a",
            "candidate_slot": "b",
        }
        self.assertEqual(promotion._derive_previous_slot(layout, "b"), "a")
        with self.assertRaisesRegex(
            promotion.PostbootPromotionError,
            "candidate slot already equals known-good slot",
        ):
            promotion._derive_previous_slot(layout, "a")


if __name__ == "__main__":
    unittest.main()
