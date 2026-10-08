import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "public-site" / "vercel_identity_preflight.py"
CONTRACT = ROOT / "docs" / "contracts" / "public-site-deployment.json"


def load_module():
    spec = importlib.util.spec_from_file_location("vercel_identity_preflight", TOOL)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class VercelIdentityPreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_candidate_derives_all_claims_from_one_team_project_pair(self):
        candidate = self.module.build_candidate(self.contract, "https://ordax.com.br")
        self.assertEqual(candidate["team_slug"], "ordaxsystems")
        self.assertEqual(candidate["project"], "ordax-os-public")
        self.assertEqual(candidate["issuer"], "https://oidc.vercel.com/ordaxsystems")
        self.assertEqual(candidate["audience"], "https://vercel.com/ordaxsystems")
        self.assertEqual(
            candidate["subject"],
            "owner:ordaxsystems:project:ordax-os-public:environment:production",
        )
        self.assertEqual(candidate["origin"], "https://ordax.com.br")
        self.assertEqual(candidate["environment"], "production")

    def test_invalid_or_non_https_origin_fails_closed(self):
        for origin in (
            "http://ordax.com.br",
            "https://user@ordax.com.br",
            "https://ordax.com.br/path",
            "https://ordax.com.br?x=1",
        ):
            with self.assertRaises(ValueError):
                self.module.build_candidate(self.contract, origin)

    def test_legacy_team_cannot_be_target(self):
        contract = json.loads(json.dumps(self.contract))
        historical = contract["public_edge_gateway"]["oidc_issuer"].removeprefix(
            "https://oidc.vercel.com/"
        )
        self.assertNotEqual(historical, contract["vercel_migration"]["target_team_slug"])
        contract["vercel_migration"]["target_team_slug"] = historical
        contract["vercel_adapter"]["team"] = historical
        with self.assertRaisesRegex(ValueError, "target-team-must-not-equal-legacy-team"):
            self.module.build_candidate(contract, "https://ordax.com.br")

    def test_destination_adapter_must_match_migration_team(self):
        contract = json.loads(json.dumps(self.contract))
        contract["vercel_adapter"]["team"] = "other-team"
        with self.assertRaisesRegex(ValueError, "adapter-team-must-match-target-team"):
            self.module.build_candidate(contract, "https://ordax.com.br")

    def test_legacy_team_evidence_must_be_valid(self):
        for old_issuer in (None, "", "http://oidc.vercel.com/old-team",
                           "https://oidc.vercel.com/old/team"):
            contract = json.loads(json.dumps(self.contract))
            contract["public_edge_gateway"]["oidc_issuer"] = old_issuer
            with self.assertRaisesRegex(ValueError, "(issuer-evidence|invalid-legacy)"):
                self.module.build_candidate(contract, "https://ordax.com.br")

    def test_preview_or_shared_secret_fallback_cannot_be_enabled(self):
        for key in ("preview_identity_allowed", "shared_secret_fallback_allowed"):
            contract = json.loads(json.dumps(self.contract))
            contract["vercel_migration"][key] = True
            with self.assertRaises(ValueError):
                self.module.build_candidate(contract, "https://ordax.com.br")


if __name__ == "__main__":
    unittest.main()
