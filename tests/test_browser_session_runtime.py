"""Behavioral tests for lazy Internet session lifecycle, without WebKit or GTK."""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "system/surface/runtime"))

from browser_session_runtime import InternetBrowserSession  # noqa: E402
from browser_session_store import load_browser_session, save_browser_session  # noqa: E402


def public_url(uri: str) -> bool:
    return uri.startswith("https://example.org/") or uri.startswith("https://example.com/")


class InternetBrowserSessionTests(unittest.TestCase):
    def test_surface_only_boot_preserves_saved_state_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "session.json")
            save_browser_session(path, ("https://example.org/old",), 0, allow_url=public_url)
            before = Path(path).read_bytes()
            session = InternetBrowserSession(path, public_url, 16)
            session.persist((("new", "https://example.com/new"),), "new")
            self.assertEqual(Path(path).read_bytes(), before)
            state = session.begin_restore()
            self.assertEqual(state.urls, ("https://example.org/old",))
            session.persist((("new", "https://example.com/new"),), "new")
            self.assertEqual(Path(path).read_bytes(), before)
            session.finish_restore()
            session.persist((("old", "https://example.org/old"),), "old")
            self.assertEqual(Path(path).read_bytes(), before)

    def test_explicit_browser_activation_filters_urls_and_keeps_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "session.json")
            session = InternetBrowserSession(path, public_url, 16)
            self.assertFalse(Path(path).exists())
            self.assertEqual(session.begin_restore().urls, ())
            self.assertIsNone(session.begin_restore())
            session.finish_restore()
            session.persist(
                (
                    ("a", "https://example.org/a"),
                    ("private", "http://127.0.0.1/secret"),
                    ("b", "https://example.com/b"),
                ),
                "b",
            )
            restored = load_browser_session(path, allow_url=public_url)
            self.assertEqual(restored.urls, ("https://example.org/a", "https://example.com/b"))
            self.assertEqual(restored.active_index, 1)
            before = Path(path).read_bytes()
            session.persist(
                (("a", "https://example.org/a"), ("b", "https://example.com/b")),
                "b",
            )
            self.assertEqual(Path(path).read_bytes(), before)

    def test_failed_restore_never_clobbers_original_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "session.json")
            save_browser_session(path, ("https://example.org/a",), 0, allow_url=public_url)
            before = Path(path).read_bytes()
            session = InternetBrowserSession(path, public_url, 16)
            self.assertEqual(session.begin_restore().urls, ("https://example.org/a",))
            session.abort_restore()
            self.assertFalse(session.activated)
            session.persist((), None)
            self.assertEqual(Path(path).read_bytes(), before)
            self.assertEqual(session.begin_restore().urls, ("https://example.org/a",))
            session.finish_restore()

    def test_invalid_transition_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = InternetBrowserSession(str(Path(tmp) / "session.json"), public_url, 16)
            with self.assertRaises(RuntimeError):
                session.finish_restore()
            session.begin_restore()
            session.finish_restore()
            with self.assertRaises(RuntimeError):
                session.finish_restore()


if __name__ == "__main__":
    unittest.main()
