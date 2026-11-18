"""Offline contract proofs for the deployed Supabase source parity release gate."""
from __future__ import annotations

import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from tools.account.prove_gateway_deployed_source_parity import (
    MODES, ParityFailure, canonical_import_graph, extract_files, prove,
    read_deployed_bundle,
)


def payload(files: dict[str, bytes]) -> bytes:
    return json.dumps({
        "files": [{"name": name, "content": content.decode("utf-8")}
                  for name, content in files.items()]
    }).encode("utf-8")


def zip_payload(files: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, content in files.items():
            archive.writestr("source/" + name, content)
    return out.getvalue()


class DeployedAccountSourceParityTests(unittest.TestCase):
    def test_import_graph_is_canonical_for_both_functions_without_duplicate_inventory(self):
        for name in MODES:
            graph = canonical_import_graph(name)
            self.assertIn(name + "/index.ts", graph)
            self.assertIn("_shared/account_transport_admission.mjs", graph)
            self.assertTrue(all(graph.values()))
            self.assertLessEqual(len(graph), 60)
            self.assertGreaterEqual(len(graph), 9)
            if name == "ordax-account-gateway":
                self.assertIn("_shared/account_local_signout.mjs", graph)
            else:
                self.assertNotIn("_shared/account_local_signout.mjs", graph)

    def test_exact_canonical_json_and_zip_bundles_pass(self):
        for name in MODES:
            graph = canonical_import_graph(name)
            for raw in (payload(graph), zip_payload(graph)):
                receipt = prove(name, raw, mode="verify")
                self.assertEqual(receipt["status"], "pass")
                self.assertEqual(receipt["files"], len(graph))
                self.assertEqual(len(receipt["source_sha256"]), 64)
                self.assertEqual(receipt["deployment_mutated"], False)
                self.assertEqual(receipt["subject_data_accessed"], False)

    def test_preflight_accepts_old_deployed_bundle_not_yet_on_main(self):
        for name in MODES:
            graph = canonical_import_graph(name)
            old = dict(graph)
            if name == "ordax-account-gateway":
                old.pop("_shared/account_local_signout.mjs")
            old[name + "/index.ts"] += b"\n// previous deployed version\n"
            self.assertEqual(prove(name, payload(old), mode="preflight")["status"], "pass")
            with self.assertRaises(ParityFailure):
                prove(name, payload(old), mode="verify")

    def test_changed_source_missing_or_extra_imports_fail_even_when_health_is_green(self):
        for name in MODES:
            graph = canonical_import_graph(name)
            bad = dict(graph)
            bad[name + "/index.ts"] += b"\n// altered body\n"
            with self.assertRaisesRegex(ParityFailure, "deployed-source-content-drift"):
                prove(name, payload(bad), mode="verify")
            bad = dict(graph)
            bad.pop("_shared/account_transport_admission.mjs")
            with self.assertRaisesRegex(ParityFailure, "deployed-import-missing"):
                prove(name, payload(bad), mode="verify")
            bad = dict(graph)
            bad["evil-extra.ts"] = b"export default 1;"
            with self.assertRaisesRegex(ParityFailure, "deployed-import-inventory-drift"):
                prove(name, payload(bad), mode="verify")

    def test_corrupt_or_path_traversal_archive_fails_closed(self):
        for raw in (
            b"", b"junk", b'{"files":[]}',
            payload({"../passwd.ts": b"evil"}),
            payload({"_shared\\escape.ts": b"evil"}),
            payload({"./escape.ts": b"evil"}),
            b'{"files":[{"name":"x.ts"}]}',
            b'{"files":[{"name":"x.ts","content":13}]}',
        ):
            with self.assertRaises(ParityFailure, msg=str(raw)[:80]):
                extract_files(raw)

    def test_management_url_is_fixed_and_no_source_or_bearer_is_echoed(self):
        class Remote:
            status = 200
            def __init__(self, req, data):
                self.request = req
                self.data = data
            def geturl(self):
                return self.request.full_url
            def read(self, n):
                return self.data[:n]
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return None

        requested = []
        source = zip_payload(canonical_import_graph(MODES[0]))
        def sender(req, timeout):
            requested.append((req, timeout))
            return Remote(req, source)
        result = read_deployed_bundle("jhfphsjptrpmtnzkpwud", MODES[0],
                                      "private-secret-test", sender)
        self.assertEqual(result, source)
        self.assertEqual(len(requested), 1)
        request, timeout = requested[0]
        self.assertEqual(request.full_url,
          "https://api.supabase.com/v1/projects/jhfphsjptrpmtnzkpwud/functions/ordax-account-gateway/body")
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.get_header("Authorization"), "Bearer private-secret-test")
        self.assertEqual(timeout, 15)
        for bad in ("../traversal", "example.com", "", "ordax-public-account-gateway/evil"):
            with self.assertRaises(ParityFailure):
                read_deployed_bundle(bad, MODES[0], "secret", sender)
        self.assertEqual(len(requested), 1)

    def test_no_supabase_write_or_owner_release_bypass_appears_in_workflow(self):
        root = Path(__file__).resolve().parents[1]
        for wf, name in (
            (".github/workflows/ordax-account-gateway-destination.yml", MODES[0]),
            (".github/workflows/ordax-public-account-gateway-destination.yml", MODES[1]),
        ):
            content = (root / wf).read_text(encoding="utf-8-sig")
            self.assertIn("workflow_dispatch:", content)
            self.assertIn("inputs.approved_sha == github.sha", content)
            self.assertIn("refs/heads/main", content)
            self.assertIn("cancel-in-progress: false", content)
            self.assertIn("--mode preflight", content)
            self.assertIn("--mode verify", content)
            self.assertGreater(
                content.index("--mode verify"),
                content.index("supabase functions deploy " + name),
            )
            self.assertIn("tools/account/prove_gateway_deployed_source_parity.py", content)
            self.assertIn("SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}", content)
            self.assertIn("source parity", content.lower())


if __name__ == "__main__":
    unittest.main()
