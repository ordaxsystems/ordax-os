from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261002232500_account_registration_legal_fk_indexes_v1.sql"
)


class AccountRegistrationLegalForeignKeyIndexTests(unittest.TestCase):
    def test_policy_foreign_keys_have_covering_indexes_without_authority_change(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn(
            "create index if not exists ordax_account_registration_intents_policy_idx",
            sql,
        )
        self.assertIn(
            "on private.ordax_account_registration_intents (policy_id)",
            sql,
        )
        self.assertIn(
            "create index if not exists ordax_account_legal_receipts_policy_idx",
            sql,
        )
        self.assertIn(
            "on private.ordax_account_legal_receipts (policy_id)",
            sql,
        )
        for forbidden in ("grant ", "insert ", "update ", "delete ", "alter role"):
            self.assertNotIn(forbidden, sql)


if __name__ == "__main__":
    unittest.main()
