from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
ADAPTER = ROOT / "system" / "adapters" / "native" / "profile-content-context.mjs"
CAPABILITY_ADAPTER = ROOT / "system" / "adapters" / "native" / "profile-content-context-capability.mjs"
READER = ROOT / "system" / "surface" / "runtime" / "native_profile_content_context.py"


class NativeProfileContentContextContractTests(unittest.TestCase):
    def test_profile_content_context_is_read_only_loopback_and_available_in_native_profiles(self):
        host = HOST.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        reader = READER.read_text(encoding="utf-8")

        self.assertIn(
            'PROFILE_CONTENT_CONTEXT_PATH = "/__ordax/native/profile-content-context"',
            host,
        )
        self.assertIn("read_active_profile_content_context", host)
        self.assertIn(
            'self.server.distribution_profile not in {"owner-development", "stable-mvp"}',
            host,
        )
        self.assertIn("requested_profile_content_parameters", host)
        self.assertIn("PROFILE_CONTENT_CONTEXT_PATH", host)
        self.assertIn('set(query).issubset({"spaceId", "query"})', host)
        self.assertIn('len(query.get("spaceId", [])) != 1', host)
        self.assertIn('len(query.get("query", [])) > 1', host)
        self.assertIn("len(relevance_query) > 256", host)
        self.assertIn("read_active_profile_content_context(space_id, query=relevance_query)", host)
        self.assertIn('query.set("query", retrievalQuery.trim())', adapter)
        self.assertIn('ENDPOINT = "/__ordax/native/profile-content-context"', adapter)
        self.assertIn('method: "GET"', adapter)
        self.assertNotIn('method: "POST"', adapter)
        self.assertNotIn("urllib", reader)
        self.assertNotIn("requests.", reader)

    def test_capability_is_explicit_for_owner_and_stable_native_profiles(self):
        host = HOST.read_text(encoding="utf-8")
        adapter = CAPABILITY_ADAPTER.read_text(encoding="utf-8")

        self.assertIn(
            'PROFILE_CONTENT_CONTEXT_CAPABILITY_PATH = "/__ordax/native/profile-content-context-capability"',
            host,
        )
        self.assertIn(
            '"available": self.server.distribution_profile in {"owner-development", "stable-mvp"}',
            host,
        )
        self.assertIn(
            'ENDPOINT = "/__ordax/native/profile-content-context-capability"',
            adapter,
        )
        self.assertIn('method: "GET"', adapter)
        self.assertNotIn('method: "POST"', adapter)

    def test_reader_revalidates_active_component_and_exact_payload_hash(self):
        reader = READER.read_text(encoding="utf-8")
        self.assertIn("assert_activation_components_installed(", reader)
        self.assertIn("hashlib.sha256(raw).hexdigest()", reader)
        self.assertIn('component["sha256"]', reader)
        self.assertIn('entry.get("authority") != "none"', reader)
        self.assertIn('entry.get("toolIds") != []', reader)


if __name__ == "__main__":
    unittest.main()
