"""Unsigned v3 manifest handoff: synthetic-data and fail-closed boundary regressions."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools/release-signing/prepare_creator_physical_v3.py"
spec = importlib.util.spec_from_file_location("unsigned_creator_v3", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UnsignedCreatorV3Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cli = self.root / "creator"
        self.cli.write_text("#!/bin/sh\nexit 2\n")
        self.cli.chmod(0o700)
        self.source = self.root / "sources"
        self.source.mkdir()
        self.manifest = self.root / "v2.json"
        self.auth = self.root / "authorization.json"
        self.bindings = self.root / "bindings.json"
        self.output = self.root / "v3.json"
        self.release = "a" * 40
        self.v2 = {"$schema": module.SCHEMA_V2, "purpose": module.PURPOSE,
                   "created_from_recipe": module.RECIPE, "source_repository": module.REPOSITORY,
                   "source_commit": "b" * 40, "files": [], "bundle": {}}
        self.authorization = {"$schema": module.AUTHORIZATION_SCHEMA,
                              "status": "blocked-explicit-physical-authorization-pending",
                              "physical_write_allowed": False, "explicit_owner_authorization": False,
                              "authorization_context_sha256": None, "source_repository": module.REPOSITORY,
                              "release_binding": {"source_commit": self.release,
                                  "canonical_envelope_url": f"https://github.com/{module.REPOSITORY}/releases/download/ordax-stable-v4-{self.release}/release-envelope.json"}}
        self.canonical = {"$schema": module.BINDINGS_SCHEMA,
                          "artifacts": [{"id": f"test-{i:02}", "sha256": f"{i:064x}", "size_bytes": i+1}
                                        for i in range(17)]}
        self.write()

    def write(self):
        for path, value in ((self.manifest, self.v2), (self.auth, self.authorization), (self.bindings, self.canonical)):
            path.write_text(json.dumps(value))

    def invoke(self, stdout="PORTABLE_SOURCES_VERIFIED=YES\nPORTABLE_SOURCE_COUNT=17\nPHYSICAL_DEVICE_TOUCHED=NO\nPHYSICAL_WRITE_AUTHORIZED=NO\n", status=0):
        with patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], status, stdout, "")) as mock:
            result = module.prepare(self.manifest, self.bindings, self.source, self.cli, self.auth, self.output)
            args = mock.call_args.args[0]
            self.assertEqual(args[1], "verify-portable-sources")
            self.assertEqual(args[2], "--bindings")
            return result

    def test_unsigned_v3_uses_exact_release_identity_and_independent_bindings(self):
        generated = self.invoke()
        payload = generated["portable_payload"]
        self.assertEqual(generated["$schema"], module.SCHEMA_V3)
        self.assertEqual(generated["source_commit"], "b" * 40)
        self.assertEqual(payload["release_source_commit"], self.release)
        self.assertEqual(len(payload["artifacts"]), 17)
        self.assertEqual(generated, json.loads(self.output.read_text()))
        self.assertEqual(self.v2, json.loads(self.manifest.read_text()))
        self.assertTrue(all(a["url"].endswith("/" + a["id"]) for a in payload["artifacts"]))
        with self.assertRaises(module.PreparationError):
            self.invoke()

    def test_bogus_manifests_never_emit_a_v3(self):
        for field, value in (("$schema", module.SCHEMA_V3), ("source_repository", "evil/repo"),
                             ("source_commit", "main"), ("portable_payload", {})):
            with self.subTest(field=field):
                original = dict(self.v2)
                self.v2[field] = value
                self.write()
                with self.assertRaises(module.PreparationError):
                    self.invoke()
                self.assertFalse(self.output.exists())
                self.v2 = original

    def test_bad_bindings_rejected_before_core_or_publication(self):
        corruptions = [lambda x: x["artifacts"].pop(),
                       lambda x: x["artifacts"][0].update(id="../outside"),
                       lambda x: x["artifacts"][0].update(id=x["artifacts"][1]["id"]),
                       lambda x: x["artifacts"][0].update(sha256="X" * 64),
                       lambda x: x["artifacts"][0].update(size_bytes=True),
                       lambda x: x["artifacts"][0].update(size_bytes=0)]
        for change in corruptions:
            with self.subTest(change=change):
                original = json.loads(json.dumps(self.canonical))
                change(self.canonical)
                self.write()
                with self.assertRaises(module.PreparationError):
                    self.invoke()
                self.assertFalse(self.output.exists())
                self.canonical = original

    def test_invalid_consent_or_publisher_identity_rejected(self):
        self.authorization["physical_write_allowed"] = True
        self.write()
        with self.assertRaises(module.PreparationError):
            self.invoke()
        self.authorization["physical_write_allowed"] = False
        self.authorization["release_binding"]["canonical_envelope_url"] = "https://wrong.invalid"
        self.write()
        with self.assertRaises(module.PreparationError):
            self.invoke()
        self.assertFalse(self.output.exists())

    def test_core_rejection_and_missing_safety_marker_fail_closed(self):
        for output, status in (("", 1), ("PORTABLE_SOURCES_VERIFIED=YES\nPORTABLE_SOURCE_COUNT=17", 0)):
            with self.subTest(status=status):
                with self.assertRaises(module.PreparationError):
                    self.invoke(stdout=output, status=status)
                self.assertFalse(self.output.exists())

    def test_duplicate_json_keys_or_symlinked_input_rejected(self):
        self.bindings.write_text('{"$schema":"%s","$schema":"%s","artifacts":[]}' %
                                 (module.BINDINGS_SCHEMA, module.BINDINGS_SCHEMA))
        with self.assertRaises(module.PreparationError):
            self.invoke()
        self.write()
        fake = self.root / "fake-bindings.json"
        fake.symlink_to(self.bindings)
        with self.assertRaises(module.PreparationError):
            module.prepare(self.manifest, fake, self.source, self.cli, self.auth, self.output)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
