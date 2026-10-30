"""Public-key PostgREST private-schema probe, no private table data or sessions."""
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "tools/security/probe_private_data_api_exposure.py"
spec = importlib.util.spec_from_file_location("private_schema_data_api_probe", PATH)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class PrivateDataApiProbeTests(unittest.TestCase):
    def test_owner_is_canonical_and_endpoint_never_targets_real_records(self):
        self.assertEqual(probe.canonical_ref(), "jhfphsjptrpmtnzkpwud")
        self.assertTrue(probe.NONEXISTENT_RELATION.startswith("__ordax_"))
        self.assertIn("limit=0", probe.QUERY)
        self.assertIn("select=nonexistent", probe.QUERY)

    def test_exact_baseline_and_schema_denial_required(self):
        self.assertEqual(probe.validate_responses(probe.EXPECTED), [])
        for schema in ("public", "private"):
            bad = {key: dict(v) for key, v in probe.EXPECTED.items()}
            bad[schema]["http_status"] = 200
            self.assertIn(
                "postgrest-" + schema + "-profile-unexpected",
                probe.validate_responses(bad),
            )
            bad[schema]["postgrest_code"] = "PGRST200"
            self.assertIn(
                "postgrest-" + schema + "-profile-unexpected",
                probe.validate_responses(bad),
            )
        self.assertEqual(probe.validate_responses({}), ["postgrest-response-shape"])
        self.assertEqual(probe.validate_responses(None), ["postgrest-response-shape"])

    def test_live_transport_uses_publishable_key_and_never_follows_redirects(self):
        captured = []
        key = "sb_publishable_synthetic_unit_test"
        class FakeOpener:
            def open(self, request, timeout):
                captured.append(request)
                profile = request.get_header("Accept-profile")
                item = probe.EXPECTED[profile]
                payload = json.dumps({"code": item["postgrest_code"]}).encode()
                raise HTTPError(request.full_url, item["http_status"], "test", {}, io.BytesIO(payload))

        with patch.object(probe, "build_opener", return_value=FakeOpener()) as mocked:
            value = probe.check_live(probe.canonical_ref(), key)
        self.assertEqual(value, probe.EXPECTED)
        self.assertEqual(len(captured), 2)
        self.assertEqual({r.get_header("Accept-profile") for r in captured}, {"public", "private"})
        for request in captured:
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(request.get_header("Apikey"), key)
            self.assertNotIn(key, request.full_url)
            self.assertNotIn("service_role", request.full_url)
        self.assertIsInstance(mocked.call_args.args[0], probe.RejectRedirects)

    def test_fixture_results_never_become_live_account_release_proof(self):
        from contextlib import redirect_stdout
        from io import StringIO
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "probe.json"
            file.write_text(json.dumps(probe.EXPECTED), encoding="utf-8")
            stdout = StringIO()
            with redirect_stdout(stdout):
                self.assertEqual(probe.main(["--fixture-json", str(file)]), 0)
            result = json.loads(stdout.getvalue())
            self.assertEqual(result["scope"], "SYNTHETIC_NOT_LIVE")
            self.assertTrue(result["private_schema_data_api_exclusion"])
            self.assertFalse(result["authenticated_two_subject_isolation_verified"])
            self.assertFalse(result["public_account_release_approved"])
            self.assertFalse(result["production_mutation_performed"])

    def test_missing_public_key_fails_without_logging_secret(self):
        from contextlib import redirect_stderr
        from io import StringIO
        with patch.dict(os.environ, {"ORDAX_SUPABASE_PUBLISHABLE_KEY": ""}):
            err = StringIO()
            with redirect_stderr(err):
                self.assertEqual(probe.main(["--live"]), 2)
            self.assertIn("BLOCKED", err.getvalue())
            self.assertNotIn("jhfphsjptrpmtnzkpwud", err.getvalue())


if __name__ == "__main__":
    unittest.main()
