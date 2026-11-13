from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CURRENT_STATE = (ROOT / "docs/CURRENT-STATE.md").read_text(encoding="utf-8")
SYSTEM_UI = (ROOT / "system/surface/ui/system-overview-controls.mjs").read_text(encoding="utf-8")
DIAGNOSTICS_UI = (ROOT / "system/surface/ui/system-diagnostics-review.mjs").read_text(encoding="utf-8")
FILE_SPACE = (ROOT / "system/contracts/file-space.mjs").read_text(encoding="utf-8")
PROMOTION = (ROOT / "docs/PROMOTION-GATES.md").read_text(encoding="utf-8")


def assignments(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        match = re.fullmatch(r"([A-Z0-9_]+)=([^\\s]+)", line.strip())
        if match:
            values[match.group(1)] = match.group(2)
    return values


class CurrentExecutionStateTests(unittest.TestCase):
    def test_current_state_is_parallel_owner_router_not_global_queue(self):
        self.assertIn("Execução operacional paralela por owner", CURRENT_STATE)
        self.assertIn("Não existe mais fila global", CURRENT_STATE)
        self.assertIn("execução causal, não lista de microtarefas", CURRENT_STATE.lower())
        self.assertIn("NÃO é autorização de lançamento nem prova física", CURRENT_STATE)

    def test_system_inventory_comes_from_source(self):
        for section in ("overview", "updates", "storage", "diagnostics", "about"):
            self.assertIn(f'id: "{section}"', SYSTEM_UI)
        self.assertIn('from "../../contracts/update-history.mjs"', SYSTEM_UI)
        self.assertIn('from "./system-diagnostics-review.mjs"', SYSTEM_UI)

    def test_diagnostic_review_source_has_real_prepare_copy_and_export_actions(self):
        for method in ('"prepare"', '"copyPreparedSummary"', '"exportPrepared"'):
            self.assertIn(method, DIAGNOSTICS_UI)

    def test_file_space_version_is_owned_by_contract(self):
        self.assertIn("ordax.file-space/11", FILE_SPACE)
        self.assertIn("ordax.file-space/11", CURRENT_STATE)

    def test_promotion_gates_remain_fail_closed(self):
        promotion = assignments(PROMOTION)
        expected = {
            "MVP_SURFACE_SMOKE_HARNESS": "PASS_SOURCE",
            "MVP_SURFACE_SMOKE_PHYSICAL": "PENDING",
            "CANONICAL_STABLE_GRAPHICAL_MODE": "PENDING",
            "CANONICAL_RELEASE_TRUST": "PASS_CANONICAL_PUBLIC_ANCHOR_PINNED",
            "PUBLIC_PHYSICAL_APPLY": "NO",
        }
        for key, value in expected.items():
            self.assertEqual(promotion.get(key), value)

    def test_source_integration_is_not_physical_proof(self):
        self.assertIn("integração Git não comprova", CURRENT_STATE)
        self.assertIn("gravação de USB", CURRENT_STATE)
        self.assertNotIn("MVP_SURFACE_SMOKE_PHYSICAL=PASS", CURRENT_STATE)
        self.assertNotIn("CANONICAL_STABLE_GRAPHICAL_MODE=PASS", CURRENT_STATE)


if __name__ == "__main__":
    unittest.main()
