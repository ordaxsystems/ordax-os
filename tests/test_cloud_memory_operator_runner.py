#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools/cloud-memory/run_operator_authenticated_proof.py"

spec = importlib.util.spec_from_file_location("cloud_memory_operator_runner", TOOL)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

USER = "123e4567-e89b-42d3-a456-426614174000"
GRANT = "123e4567-e89b-42d3-a456-426614174001"
SHA = "a" * 40


class CloudMemoryOperatorRunnerTests(unittest.TestCase):
    def test_issue_and_revoke_use_private_functions_and_never_service_role(self):
        calls = []
        def fake(sql):
            calls.append(sql)
            return GRANT
        with patch.object(module, "run_psql", side_effect=fake):
            self.assertEqual(module.issue_grant(USER, 600, "proof reason ok", SHA), GRANT)
            module.revoke_grant(GRANT, "proof revoke ok", SHA)
        joined = "\n".join(calls).lower()
        self.assertIn("private.ordax_issue_cloud_memory_proof_entitlement_v1", joined)
        self.assertIn("private.ordax_revoke_cloud_memory_proof_entitlement_v1", joined)
        self.assertNotIn("service_role", joined)

    def test_ttl_and_source_commit_fail_closed_before_psql(self):
        with patch.object(module, "run_psql") as psql:
            with self.assertRaises(ValueError):
                module.issue_grant(USER, 299, "proof reason ok", SHA)
            with self.assertRaises(ValueError):
                module.issue_grant(USER, 600, "proof reason ok", "bad")
            psql.assert_not_called()

    def test_psql_invocation_keeps_password_out_of_arguments(self):
        completed = subprocess.CompletedProcess([], 0, stdout=b"ok\n", stderr=b"")
        env = {"PGHOST":"db.example","PGDATABASE":"postgres","PGUSER":"postgres","PGPASSWORD":"secret","PGSSLMODE":"require"}
        with patch.dict(os.environ, env, clear=True), patch("shutil.which", return_value="/usr/bin/psql"), patch("subprocess.run", return_value=completed) as run:
            self.assertEqual(module.run_psql("select 1;"), "ok")
        argv = run.call_args.args[0]
        self.assertNotIn("secret", " ".join(argv))
        self.assertNotIn("PGPASSWORD", " ".join(argv))
        self.assertEqual(run.call_args.kwargs["input"], b"select 1;")

    def test_operator_environment_requires_tls_and_psql(self):
        base = {"PGHOST":"db.example","PGDATABASE":"postgres","PGUSER":"postgres","PGPASSWORD":"secret"}
        with patch.dict(os.environ, {**base, "PGSSLMODE":"disable"}, clear=True), patch("shutil.which", return_value="/usr/bin/psql"):
            with self.assertRaises(SystemExit):
                module.validate_operator_env()
        with patch.dict(os.environ, {**base, "PGSSLMODE":"require"}, clear=True), patch("shutil.which", return_value=None):
            with self.assertRaises(SystemExit):
                module.validate_operator_env()


if __name__ == "__main__":
    unittest.main()
