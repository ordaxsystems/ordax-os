#!/usr/bin/env python3
"""Owner USB manual update command uses the canonical Supervisor, without Git duplication."""
import ast
import os
from pathlib import Path
import stat
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system/surface/runtime/native_host_server.py"
SUPERVISOR = ROOT / "system/supervisor"


def queue_functions():
    source = ast.parse(HOST.read_text(encoding="utf-8"))
    names = {"manual_update_request_pending", "queue_manual_update_check"}
    nodes = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(nodes) == 2
    isolated = ast.Module(body=nodes, type_ignores=[])
    namespace = {"os": os, "UPDATE_MANUAL_REQUEST_FILE": "/run/ordax-update/manual-check-request"}
    exec(compile(isolated, str(HOST), "exec"), namespace)
    return namespace


class OwnerDevManualUpdateTests(unittest.TestCase):
    def test_request_is_idempotent_and_private(self):
        api = queue_functions()
        with tempfile.TemporaryDirectory() as temp:
            request = str(Path(temp) / "manual-check-request")
            self.assertTrue(api["queue_manual_update_check"](request))
            self.assertEqual(Path(request).read_text(), "check-main\n")
            self.assertEqual(stat.S_IMODE(os.stat(request).st_mode), 0o600)
            self.assertTrue(api["manual_update_request_pending"](request))
            self.assertFalse(api["queue_manual_update_check"](request))
            self.assertEqual(Path(request).read_text(), "check-main\n")

    def test_unsafe_path_and_missing_run_dir_fail_closed(self):
        api = queue_functions()
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            target = parent / "target"
            target.write_text("private data")
            marker = parent / "manual-check-request"
            marker.symlink_to(target)
            with self.assertRaises(OSError):
                api["queue_manual_update_check"](str(marker))
            self.assertEqual(target.read_text(), "private data")
            self.assertFalse(api["manual_update_request_pending"](str(marker)))
            with self.assertRaises(OSError):
                api["queue_manual_update_check"](str(parent / "missing" / "manual-check-request"))

    def test_native_host_is_owner_usb_only_and_token_bound(self):
        source = HOST.read_text(encoding="utf-8")
        handler = source.split("    def do_POST(self) -> None:", 1)[1]
        command = handler.split("if parsed_path == UPDATE_CHECK_PATH:", 1)[1].split(
            "if parsed_path == PRODUCT_CONNECTOR_SETTINGS_PATH:", 1
        )[0]
        self.assertIn('self.server.distribution_profile != "owner-development"', command)
        self.assertIn('self.server.product_mode != "usb"', command)
        self.assertIn("hmac.compare_digest", command)
        self.assertIn("UPDATE_TOKEN_HEADER", command)
        self.assertIn('body.get("action") != "check-main"', command)
        self.assertIn("queue_manual_update_check()", command)
        self.assertNotIn("subprocess", command)
        self.assertNotIn("git ", command)

    def test_supervisor_is_single_update_owner(self):
        source = SUPERVISOR.read_text(encoding="utf-8")
        loop = source.split("while :; do", 1)[1]
        self.assertIn('OWNER_MANUAL_CHECK_REQUEST=$UPDATE_RUN_DIR/manual-check-request', source)
        self.assertIn('log "Owner/Development manual main check requested; using canonical Supervisor"', loop)
        self.assertIn('check_for_update', loop)
        self.assertNotIn('"$PULL_BIN" 2>&1', loop)
        self.assertIn('check_for_update() {', source)


if __name__ == "__main__":
    unittest.main()
