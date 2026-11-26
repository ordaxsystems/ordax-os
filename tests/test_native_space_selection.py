from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch
import stat
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"


def load_host():
    spec = spec_from_file_location("native_host_space_selection_test", SOURCE)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NativeSpaceSelectionTests(unittest.TestCase):
    def test_strict_selection_wire_contract(self):
        host = load_host()
        empty = {"record": None}
        self.assertEqual(host.validate_native_space_selection(empty), empty)
        record = {"schema": "ordax.space-selection-record/1",
                  "subjectId": "user-1", "selectedSpaceId": "space-1"}
        self.assertEqual(host.validate_native_space_selection({"record": record}),
                         {"record": record})
        for invalid in ({}, {"record": []}, {"record": {"schema": "wrong"}},
                        {"record": {**record, "other": True}},
                        {"record": {**record, "subjectId": ""}},
                        {"record": {**record, "selectedSpaceId": "x" * 161}},
                        {"record": {**record, "subjectId": "bad\x00user"}}):
            with self.subTest(invalid=repr(invalid)[:60]):
                with self.assertRaises(ValueError):
                    host.validate_native_space_selection(invalid)

    def test_space_selection_is_atomic_and_survives_restart(self):
        host = load_host()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "space-selection.json"
            host.SPACE_SELECTION_FILE = str(path)
            self.assertEqual(host.read_space_selection(), {"record": None})
            record = {"record": {
                "schema": "ordax.space-selection-record/1",
                "subjectId": "user-1", "selectedSpaceId": "space-1"}}
            host.write_space_selection(record)
            self.assertEqual(host.read_space_selection(), record)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            reopened = load_host()
            reopened.SPACE_SELECTION_FILE = str(path)
            self.assertEqual(reopened.read_space_selection(), record)
            with patch.object(host.os, "replace", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    host.write_space_selection({"record": None})
            self.assertEqual(reopened.read_space_selection(), record)
            host.write_space_selection({"record": None})
            self.assertEqual(reopened.read_space_selection(), {"record": None})
            self.assertFalse(list(Path(folder).glob("*.tmp.*")))

    def test_invalid_file_and_symlink_do_not_become_selection(self):
        host = load_host()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "space-selection.json"
            host.SPACE_SELECTION_FILE = str(path)
            path.write_text('{"record":{"schema":"invalid"}}', encoding="utf-8")
            with self.assertRaises(ValueError):
                host.read_space_selection()
            path.unlink()
            outside = Path(folder) / "outside.json"
            outside.write_text('{"record":null}', encoding="utf-8")
            try:
                path.symlink_to(outside)
            except (OSError, NotImplementedError):
                self.skipTest("Symlink creation unavailable on this platform")
            with self.assertRaises(ValueError):
                host.read_space_selection()
            with self.assertRaises(ValueError):
                host.write_space_selection({"record": None})
            self.assertEqual(outside.read_text(encoding="utf-8"), '{"record":null}')

    def test_route_is_same_on_windows_and_native_os(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn('SPACE_SELECTION_PATH = "/__ordax/native/space-selection"', source)
        self.assertIn("write_space_selection(normalized)", source)
        self.assertIn("read_space_selection()", source)


if __name__ == "__main__":
    unittest.main()
