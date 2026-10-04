#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(RUNTIME_DIR))

from native_app_data_port_bootstrap import (  # noqa: E402
    APP_DATA_PORT_BOOTSTRAP_SCHEMA,
    NativeAppDataPortBootstrapError,
    consume_app_data_port_bootstrap,
    publish_app_data_port_bootstrap,
)


def binding(app_id: str = "notes", token: str = "a" * 43):
    return SimpleNamespace(
        app_id=app_id,
        endpoint=f"/__ordax/native/app-data/{token}",
        publisher_id="ordax-official",
        owner_scope="device",
    )


class NativeAppDataPortBootstrapTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.session = Path(self.temporary.name) / "ordax-surface"
        self.session.mkdir(mode=0o700)
        os.chmod(self.session, 0o700)
        self.path = self.session / "app-data-port-bindings.json"
        self.uid = os.geteuid()

    def test_round_trip_is_sorted_one_shot_and_omits_receipt_sha(self):
        count = publish_app_data_port_bootstrap(
            [binding("notes", "b" * 43), binding("assistant", "a" * 43)],
            str(self.path),
            expected_uid=self.uid,
        )
        self.assertEqual(count, 2)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        stored = self.path.read_text(encoding="utf-8")
        self.assertNotIn("receiptSha", stored)
        payload = json.loads(stored)
        self.assertEqual(payload["$schema"], APP_DATA_PORT_BOOTSTRAP_SCHEMA)
        self.assertEqual(
            [entry["appId"] for entry in payload["bindings"]],
            ["assistant", "notes"],
        )

        consumed = consume_app_data_port_bootstrap(
            str(self.path),
            expected_uid=self.uid,
        )
        self.assertEqual([entry.app_id for entry in consumed], ["assistant", "notes"])
        self.assertFalse(self.path.exists())
        with self.assertRaises(NativeAppDataPortBootstrapError):
            consume_app_data_port_bootstrap(str(self.path), expected_uid=self.uid)

    def test_duplicate_durable_identity_is_rejected_before_publish(self):
        with self.assertRaises(NativeAppDataPortBootstrapError):
            publish_app_data_port_bootstrap(
                [binding("notes", "a" * 43), binding("notes", "b" * 43)],
                str(self.path),
                expected_uid=self.uid,
            )
        self.assertFalse(self.path.exists())

    def test_symlink_target_is_rejected(self):
        target = self.session / "target.json"
        target.write_text("{}", encoding="utf-8")
        self.path.symlink_to(target)
        with self.assertRaises(NativeAppDataPortBootstrapError):
            consume_app_data_port_bootstrap(str(self.path), expected_uid=self.uid)

    def test_hardlinked_bootstrap_is_rejected(self):
        publish_app_data_port_bootstrap(
            [binding()],
            str(self.path),
            expected_uid=self.uid,
        )
        os.link(self.path, self.session / "alias.json")
        with self.assertRaises(NativeAppDataPortBootstrapError):
            consume_app_data_port_bootstrap(str(self.path), expected_uid=self.uid)
        self.assertTrue(self.path.exists())

    def test_relaxed_file_mode_is_rejected(self):
        publish_app_data_port_bootstrap(
            [binding()],
            str(self.path),
            expected_uid=self.uid,
        )
        os.chmod(self.path, 0o644)
        with self.assertRaises(NativeAppDataPortBootstrapError):
            consume_app_data_port_bootstrap(str(self.path), expected_uid=self.uid)

    def test_relaxed_directory_mode_is_rejected(self):
        os.chmod(self.session, 0o755)
        with self.assertRaises(NativeAppDataPortBootstrapError):
            publish_app_data_port_bootstrap(
                [binding()],
                str(self.path),
                expected_uid=self.uid,
            )

    def test_invalid_endpoint_never_reaches_disk(self):
        with self.assertRaises(NativeAppDataPortBootstrapError):
            publish_app_data_port_bootstrap(
                [binding(token="notes")],
                str(self.path),
                expected_uid=self.uid,
            )
        self.assertFalse(self.path.exists())


if __name__ == "__main__":
    unittest.main()
