"""Cross-owner execution gates without treating the historical state log as truth."""
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


def source(path):
    file = ROOT / path
    if file.is_file():
        return file.read_text(encoding="utf-8")
    p = subprocess.run(["git", "-C", str(ROOT), "show", "HEAD:" + path],
                       capture_output=True, text=True, timeout=20)
    if p.returncode:
        raise AssertionError(f"missing tracked owner: {path}")
    return p.stdout


def assignments(text):
    return dict(re.findall(r"^([A-Z0-9_]+)=(\S+)$", text, re.M))


class CurrentExecutionStateTests(unittest.TestCase):
    def test_current_document_routes_to_code_without_global_queue(self):
        index = source("docs/CURRENT-STATE.md")
        self.assertIn("Comparar os SHAs", index)
        self.assertIn("Pontos de entrada canônicos", index)
        self.assertIn("Não copiar SHAs ou status antigos", index)
        self.assertNotIn("Execução operacional paralela por owner — 13/11/2026", index)

    def test_system_inventory_comes_from_source(self):
        ui = source("system/surface/ui/system-overview-controls.mjs")
        for section in ("overview", "updates", "storage", "diagnostics", "about"):
            self.assertIn(f'id: "{section}"', ui)
        self.assertIn('from "../../contracts/update-history.mjs"', ui)
        self.assertIn('from "./system-diagnostics-review.mjs"', ui)

    def test_diagnostic_review_exposes_actual_actions(self):
        ui = source("system/surface/ui/system-diagnostics-review.mjs")
        for method in ('"prepare"', '"copyPreparedSummary"', '"exportPrepared"'):
            self.assertIn(method, ui)

    def test_file_space_version_is_owned_by_code_not_historical_text(self):
        contract = source("system/contracts/file-space.mjs")
        self.assertIn("ordax.file-space/11", contract)
        self.assertNotIn("ordax.file-space/11", source("docs/CURRENT-STATE.md"))

    def test_promotion_gates_remain_fail_closed(self):
        flags = assignments(source("docs/PROMOTION-GATES.md"))
        for key, expected in {
            "MVP_SURFACE_SMOKE_HARNESS": "PASS_SOURCE",
            "MVP_SURFACE_SMOKE_PHYSICAL": "PENDING",
            "CANONICAL_STABLE_GRAPHICAL_MODE": "PENDING",
            "CANONICAL_RELEASE_TRUST": "PASS_CANONICAL_PUBLIC_ANCHOR_PINNED",
            "PUBLIC_PHYSICAL_APPLY": "NO",
        }.items():
            with self.subTest(gate=key):
                self.assertEqual(flags.get(key), expected)

    def test_ci_and_source_integration_cannot_claim_physical_success(self):
        index = source("docs/CURRENT-STATE.md")
        self.assertIn("Gates verdes não comprovam instalação", index)
        self.assertIn("Nenhum deles deve ser chamado de USB instalado", index)
        flags = assignments(source("docs/PROMOTION-GATES.md"))
        self.assertNotEqual(flags.get("MVP_SURFACE_SMOKE_PHYSICAL"), "PASS")
        self.assertNotEqual(flags.get("CANONICAL_STABLE_GRAPHICAL_MODE"), "PASS")


if __name__ == "__main__":
    unittest.main()
