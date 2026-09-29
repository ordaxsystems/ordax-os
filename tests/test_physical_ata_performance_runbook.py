from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
RUNBOOK = ROOT / "docs" / "evidence" / "physical-ata-performance-runbook.md"
ATA_ENTRYPOINT = ROOT / "system" / "surface" / "bin" / "ordax-ata-evidence"
PERFORMANCE_ENTRYPOINT = ROOT / "system" / "surface" / "bin" / "ordax-performance-evidence"


class PhysicalAtaPerformanceRunbookTests(unittest.TestCase):
    def test_runbook_uses_canonical_physical_entrypoints(self):
        runbook = RUNBOOK.read_text(encoding="utf-8")
        self.assertIn("/system/surface/bin/ordax-ata-evidence", runbook)
        self.assertIn("/system/surface/bin/ordax-performance-evidence", runbook)
        self.assertIn("--samples 20 --interval-seconds 0.5", runbook)
        self.assertIn("mvp-surface-smoke-runbook.md", runbook)
        self.assertIn("FAIL=0", runbook)

    def test_runbook_keeps_diagnostics_non_authorizing(self):
        runbook = RUNBOOK.read_text(encoding="utf-8")
        for statement in (
            "diagnostic evidence only",
            "does not promote a candidate",
            "ATA/performance evidence is supplemental",
            "none of these commands records owner consent or permits destructive apply",
        ):
            self.assertIn(statement, runbook)

        self.assertIn("Do not trigger rescans", runbook)
        self.assertIn("Do not disable SATA/AHCI/libata/NVMe support", runbook)

    def test_physical_entrypoints_do_not_accept_fixture_roots(self):
        runbook = RUNBOOK.read_text(encoding="utf-8")
        ata = ATA_ENTRYPOINT.read_text(encoding="utf-8")
        performance = PERFORMANCE_ENTRYPOINT.read_text(encoding="utf-8")

        self.assertNotIn("--sys-class-root", runbook)
        self.assertNotIn("--proc-root", runbook)
        self.assertNotIn("--sys-class-root", ata)
        self.assertNotIn("--proc-root", performance)
        self.assertIn("unsupported physical entrypoint argument", ata)
        self.assertIn("unsupported physical entrypoint argument", performance)


if __name__ == "__main__":
    unittest.main()
