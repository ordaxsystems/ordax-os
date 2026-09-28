#!/usr/bin/env python3
"""Keep canonical MVP planning aligned with the first Stable/MVP physical proof."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MVP = ROOT / "MVP.md"
PRE_USB = ROOT / "PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md"


class FirstStableUsbHistoryFreshnessTest(unittest.TestCase):
    def test_mvp_tracks_historical_first_usb_and_current_main_retest_separately(self):
        text = MVP.read_text(encoding="utf-8")

        self.assertIn(
            "FIRST_STABLE_MVP_USB_WRITE=PASS_AUTHORIZED_CONTROLLED_PROOF",
            text,
        )
        self.assertIn("FIRST_STABLE_MVP_USB_READBACK=PASS_17_OF_17", text)
        self.assertIn(
            "FIRST_STABLE_MVP_UEFI_BOOT=PASS_PHYSICAL_PRE_HARDENING",
            text,
        )
        self.assertIn(
            "CURRENT_MAIN_STABLE_MVP_PHYSICAL_RETEST=PENDING_SEPARATE_AUTHORIZATION",
            text,
        )
        self.assertIn("FRESH_DESTRUCTIVE_AUTHORIZATION=NO", text)
        self.assertNotIn(
            "FIRST_STABLE_MVP_USB_WRITE=HOLD_NO_PHYSICAL_TARGET_SELECTED",
            text,
        )

    def test_pre_usb_plan_no_longer_claims_first_usb_is_unwritten(self):
        text = PRE_USB.read_text(encoding="utf-8")

        self.assertIn(
            "O primeiro USB Stable/MVP físico já foi gerado em uma prova controlada.",
            text,
        )
        self.assertIn("readback de 17/17 artefatos", text)
        self.assertIn("PR #588", text)
        self.assertIn("a autorização usada no primeiro USB não é reutilizável", text)
        self.assertNotIn("Não gerar ainda o primeiro USB Stable/MVP físico.", text)
        self.assertNotIn("O HOLD do primeiro USB Stable/MVP continua", text)
        self.assertNotIn(
            "Permanecem pendentes a\nmaterialização/assinatura Stable v4 real",
            text,
        )


if __name__ == "__main__":
    unittest.main()
