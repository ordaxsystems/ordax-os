import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "services" / "public-identity" / "supabase_account.py"

spec = importlib.util.spec_from_file_location("ordax_supabase_account", MODULE)
account_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = account_module
spec.loader.exec_module(account_module)


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, headers, body):
        self.calls.append((method, url, dict(headers), body))
        status, value = self.responses.pop(0)
        return status, json.dumps(value).encode("utf-8")


def valid_export():
    return {
        "$schema": "prototype-ordax.account-export/1",
        "subject": "00000000-0000-0000-0000-000000000001",
        "exported_at": "2026-09-25T00:00:00Z",
        "account": {},
        "spaces": [],
        "memberships": [],
        "space_profile_packs": [],
        "entitlements": [],
        "projects": [],
        "devices": [],
        "project_connections": [],
        "memory_items": [],
        "sync_objects": [],
    }


class SupabaseAccountProviderTests(unittest.TestCase):
    def provider(self, responses):
        transport = FakeTransport(responses)
        provider = account_module.SupabaseAccountProvider(
            "https://ordax-example.supabase.co",
            "sb_publishable_1234567890",
            transport=transport,
        )
        return provider, transport

    def test_rejects_secret_or_non_https_configuration(self):
        with self.assertRaises(ValueError):
            account_module.SupabaseAccountProvider(
                "http://ordax-example.supabase.co",
                "sb_publishable_1234567890",
            )
        for key in ("sb_secret_1234567890", "service_role", "legacy-anon-key"):
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    account_module.SupabaseAccountProvider(
                        "https://ordax-example.supabase.co",
                        key,
                    )

    def test_export_calls_rls_scoped_rpc_with_user_bearer_token(self):
        provider, transport = self.provider([(200, valid_export())])
        result = provider.export_account("user-access-token")
        self.assertEqual(result["$schema"], "prototype-ordax.account-export/1")
        method, url, headers, body = transport.calls[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/rest/v1/rpc/ordax_account_export_v1"))
        self.assertEqual(headers["Authorization"], "Bearer user-access-token")
        self.assertEqual(headers["apikey"], "sb_publishable_1234567890")
        self.assertEqual(body, b"{}")

    def test_export_rejects_invalid_schema_or_sections(self):
        invalid = valid_export()
        invalid["sync_objects"] = {}
        provider, _ = self.provider([(200, invalid)])
        with self.assertRaises(account_module.SupabaseAccountError):
            provider.export_account("user-access-token")

    def test_spaces_list_uses_user_bearer_rls_and_merges_profile_pack(self):
        spaces = [{
            "space_id": "space-1",
            "owner_user_id": "user-1",
            "name": "Developer",
            "kind": "professional",
            "state": "active",
            "domain": "development",
            "subtype": "software",
        }]
        packs = [{
            "space_id": "space-1",
            "pack_slug": "developer",
            "pack_version": 1,
        }]
        provider, transport = self.provider([(200, spaces), (200, packs)])

        result = provider.list_spaces("user-access-token")

        self.assertEqual(result, [{
            "id": "space-1",
            "ownerId": "user-1",
            "name": "Developer",
            "kind": "professional",
            "state": "active",
            "profilePack": "developer",
            "domain": "development",
            "subtype": "software",
        }])
        self.assertEqual(len(transport.calls), 2)
        for method, url, headers, body in transport.calls:
            self.assertEqual(method, "GET")
            self.assertEqual(headers["Authorization"], "Bearer user-access-token")
            self.assertEqual(headers["apikey"], "sb_publishable_1234567890")
            self.assertIsNone(body)
            self.assertIn("/rest/v1/ordax_", url)
        self.assertIn("domain,subtype", transport.calls[0][1])

    def test_spaces_list_preserves_legacy_null_semantics_without_inventing_type(self):
        spaces = [{
            "space_id": "space-legacy",
            "owner_user_id": "user-1",
            "name": "Legacy",
            "kind": "work",
            "state": "active",
            "domain": None,
            "subtype": None,
        }]
        provider, _ = self.provider([(200, spaces), (200, [])])
        result = provider.list_spaces("user-access-token")
        self.assertNotIn("domain", result[0])
        self.assertNotIn("subtype", result[0])

    def test_spaces_list_rejects_partial_or_invalid_semantics(self):
        base = {
            "space_id": "space-1",
            "owner_user_id": "user-1",
            "name": "Work",
            "kind": "work",
            "state": "active",
        }
        for semantic in (
            {"domain": "food", "subtype": None},
            {"domain": None, "subtype": "pizzeria"},
            {"domain": "Food", "subtype": "pizzeria"},
            {"domain": "fabrication", "subtype": "3d printing"},
        ):
            provider, _ = self.provider([(200, [{**base, **semantic}]), (200, [])])
            with self.assertRaises(account_module.SupabaseAccountError):
                provider.list_spaces("user-access-token")

    def test_spaces_list_fails_closed_on_duplicate_pack_mapping(self):
        spaces = [{
            "space_id": "space-1",
            "owner_user_id": "user-1",
            "name": "Work",
            "kind": "work",
            "state": "active",
        }]
        duplicate_packs = [
            {"space_id": "space-1", "pack_slug": "developer", "pack_version": 1},
            {"space_id": "space-1", "pack_slug": "creator", "pack_version": 1},
        ]
        provider, _ = self.provider([(200, spaces), (200, duplicate_packs)])
        with self.assertRaises(account_module.SupabaseAccountError):
            provider.list_spaces("user-access-token")

    def test_space_members_list_uses_user_bearer_rls_and_keyset_cursor(self):
        space_id = "11111111-1111-4111-8111-111111111111"
        cursor = "22222222-2222-4222-8222-222222222222"
        user_id = "33333333-3333-4333-8333-333333333333"
        provider, transport = self.provider([(200, [{
            "space_id": space_id,
            "user_id": user_id,
            "role": "admin",
            "state": "active",
        }])])

        result = provider.list_space_members("user-access-token", space_id, cursor)

        self.assertEqual(result, {
            "schema": "ordax.space-members-page/1",
            "spaceId": space_id,
            "members": [{
                "spaceId": space_id,
                "userId": user_id,
                "role": "admin",
                "state": "active",
            }],
            "nextCursor": None,
        })
        method, url, headers, body = transport.calls[0]
        self.assertEqual(method, "GET")
        self.assertIn("/rest/v1/ordax_space_members?", url)
        self.assertIn(f"space_id=eq.{space_id}", url)
        self.assertIn(f"user_id=gt.{cursor}", url)
        self.assertIn("order=user_id.asc", url)
        self.assertIn("limit=65", url)
        self.assertEqual(headers["Authorization"], "Bearer user-access-token")
        self.assertIsNone(body)

    def test_space_members_list_returns_bounded_next_cursor(self):
        space_id = "11111111-1111-4111-8111-111111111111"
        rows = []
        for index in range(65):
            rows.append({
                "space_id": space_id,
                "user_id": f"00000000-0000-4000-8000-{index + 1:012x}",
                "role": "owner" if index == 0 else "member",
                "state": "active",
            })
        provider, _ = self.provider([(200, rows)])
        result = provider.list_space_members("user-access-token", space_id)
        self.assertEqual(len(result["members"]), 64)
        self.assertEqual(result["nextCursor"], rows[63]["user_id"])

    def test_space_members_list_rejects_invalid_ids_and_provider_rows(self):
        provider, transport = self.provider([])
        with self.assertRaises(ValueError):
            provider.list_space_members("user-access-token", "space-1")
        self.assertEqual(transport.calls, [])

        space_id = "11111111-1111-4111-8111-111111111111"
        provider, _ = self.provider([(200, [{
            "space_id": space_id,
            "user_id": "33333333-3333-4333-8333-333333333333",
            "role": "manager",
            "state": "active",
        }])])
        with self.assertRaises(account_module.SupabaseAccountError):
            provider.list_space_members("user-access-token", space_id)
    def test_provider_error_does_not_echo_bearer_token(self):
        provider, _ = self.provider([(500, {"message": "failure"})])
        with self.assertRaises(account_module.SupabaseAccountError) as caught:
            provider.export_account("TOP-SECRET-TOKEN")
        self.assertNotIn("TOP-SECRET-TOKEN", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
