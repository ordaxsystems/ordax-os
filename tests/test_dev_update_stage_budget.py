from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "bootstrap" / "dev-base" / "ordax-run"


class DevUpdateStageBudgetTests(unittest.TestCase):
    def test_owner_runtime_gives_removable_media_bounded_stage_budget(self):
        text = RUN.read_text(encoding="utf-8")

        self.assertIn(
            'OWNER_UPDATE_STAGE_TIMEOUT=${ORDAX_STAGE_TIMEOUT_SECONDS:-60}',
            text,
        )
        self.assertIn('[ "$OWNER_UPDATE_STAGE_TIMEOUT" -ge 15 ]', text)
        self.assertIn('[ "$OWNER_UPDATE_STAGE_TIMEOUT" -le 300 ]', text)
        self.assertIn(
            'ORDAX_STAGE_TIMEOUT_SECONDS="$OWNER_UPDATE_STAGE_TIMEOUT"',
            text,
        )


if __name__ == "__main__":
    unittest.main()
