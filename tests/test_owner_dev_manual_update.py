#!/usr/bin/env python3
"""Native USB update requests go through the existing Supervisor."""
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
    names = {"manual_update_action", "manual_update_request_pending", "queue_manual_update_check"}
    nodes = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(nodes) == len(names)
    isolated = ast.Module(body=nodes, type_ignores=[])
    namespace = {"os": os, "tempfile": tempfile, "UPDATE_MANUAL_REQUEST_FILE": "/run/ordax-update/manual-check-request"}
    exec(compile(isolated, str(HOST), "exec"), namespace)
    return namespace


class OwnerDevManualUpdateTests(unittest.TestCase):
    def test_request_is_idempotent_and_private(self):
        api = queue_functions()
        with tempfile.TemporaryDirectory() as temp:
            request = str(Path(temp) / "manual-check-request")
            self.assertTrue(api["queue_manual_update_check"]("check-main", request))
            self.assertEqual(Path(request).read_text(), "check-main\n")
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(os.stat(request).st_mode), 0o600)
            self.assertTrue(api["manual_update_request_pending"](request))
            self.assertFalse(api["queue_manual_update_check"]("check-main", request))
            self.assertEqual(Path(request).read_text(), "check-main\n")

    def test_symlinked_request_is_rejected(self):
        api = queue_functions()
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            target = parent / "target"
            target.write_text("private data")
            marker = parent / "manual-check-request"
            try:
                marker.symlink_to(target)
            except (NotImplementedError, OSError) as exc:
                self.skipTest(f"symlink creation unavailable on this platform: {exc}")
            with self.assertRaises(OSError):
                api["queue_manual_update_check"]("check-main", str(marker))
            self.assertEqual(target.read_text(), "private data")
            self.assertFalse(api["manual_update_request_pending"](str(marker)))

    def test_missing_run_dir_fails_closed(self):
        api = queue_functions()
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            with self.assertRaises(OSError):
                api["queue_manual_update_check"]("check-main", str(parent / "missing" / "manual-check-request"))

    def test_profile_selects_the_internal_action(self):
        action = queue_functions()["manual_update_action"]
        self.assertEqual(action("usb", "owner-development", ""), "check-main")
        self.assertEqual(action("usb", "stable-mvp", "portable-v2"), "check-release")
        self.assertEqual(action("usb", "stable-mvp", "legacy-tree"), "")
        self.assertEqual(action("native-disk", "stable-mvp", "portable-v2"), "")
        self.assertEqual(action(None, "owner-development", ""), "")

    def test_portable_request_uses_the_same_queue(self):
        api = queue_functions()
        with tempfile.TemporaryDirectory() as temp:
            request = Path(temp) / "manual-check-request"
            self.assertTrue(api["queue_manual_update_check"]("check-release", str(request)))
            self.assertEqual(request.read_text(), "check-release\n")
            self.assertEqual(list(Path(temp).iterdir()), [request])

    def test_native_host_is_profile_and_token_bound(self):
        source = HOST.read_text(encoding="utf-8")
        handler = source.split("    def do_POST(self) -> None:", 1)[1]
        command = handler.split("if parsed_path == UPDATE_CHECK_PATH:", 1)[1].split(
            "if parsed_path == PRODUCT_CONNECTOR_SETTINGS_PATH:", 1
        )[0]
        self.assertIn('if not self.server.manual_update_action:', command)
        self.assertIn("hmac.compare_digest", command)
        self.assertIn("UPDATE_TOKEN_HEADER", command)
        self.assertIn('body.get("action") != "check"', command)
        self.assertIn("queue_manual_update_check(self.server.manual_update_action)", command)
        self.assertNotIn("subprocess", command)
        self.assertNotIn("git ", command)

    def test_supervisor_is_single_update_owner(self):
        source = SUPERVISOR.read_text(encoding="utf-8")
        loop = source.split("while :; do", 1)[1]
        self.assertIn('MANUAL_CHECK_REQUEST=$UPDATE_RUN_DIR/manual-check-request', source)
        self.assertIn('log "Manual update check requested: $MANUAL_CHECK_ACTION"', loop)
        self.assertIn('check_for_update', loop)
        self.assertNotIn('"$PULL_BIN" 2>&1', loop)
        self.assertIn('check_for_update() {', source)


if __name__ == "__main__":
    unittest.main()
