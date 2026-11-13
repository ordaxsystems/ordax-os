"""Behavioral tests of the OS-owned Internet tab state without GTK/WebKit."""
import re
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "system/surface/runtime"))
from browser_tab_registry import InternetTabRegistry  # noqa: E402


class InternetTabRegistryTests(unittest.TestCase):
    def setUp(self):
        self.registry = InternetTabRegistry(re.compile(r"^[a-z][a-z0-9-]{0,63}$"), 3)

    def test_order_and_active_selection_have_single_owner(self):
        a, b, c = object(), object(), object()
        for key, item in (("tab-a", a), ("tab-b", b), ("tab-c", c)):
            self.registry.attach(key, item)
        self.assertEqual(list(self.registry.tabs), ["tab-a", "tab-b", "tab-c"])
        self.assertEqual(self.registry.active_tab_id, "tab-c")
        self.registry.select("tab-a")
        self.assertIs(self.registry.detach("tab-a"), a)
        self.assertEqual(self.registry.active_tab_id, "tab-c")
        self.assertIs(self.registry.detach("tab-c"), c)
        self.assertEqual(self.registry.active_tab_id, "tab-b")
        self.assertIs(self.registry.detach("tab-b"), b)
        self.assertIsNone(self.registry.active_tab_id)

    def test_invalid_duplicate_and_capacity_limit_leave_registry_intact(self):
        a, b, c = object(), object(), object()
        for tab_id in ("../private", "Tab-1", "", "tab_1", "x" * 65, 5, None):
            with self.subTest(tab_id=tab_id), self.assertRaises(ValueError):
                self.registry.attach(tab_id, object())
        self.registry.attach("a", a)
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.registry.attach("a", b)
        self.registry.attach("b", b)
        self.registry.attach("c", c)
        before = tuple(self.registry.tabs.items())
        with self.assertRaisesRegex(ValueError, "limit"):
            self.registry.attach("d", object())
        self.assertEqual(tuple(self.registry.tabs.items()), before)
        self.assertEqual(self.registry.active_tab_id, "c")

    def test_failed_activation_and_rollback_cannot_create_ghost_selection(self):
        self.registry.attach("tab-1", object())
        with self.assertRaisesRegex(ValueError, "unknown tab"):
            self.registry.select("missing")
        self.assertEqual(self.registry.active_tab_id, "tab-1")
        self.registry.attach("tab-2", object())
        self.registry.detach("tab-2")
        self.assertEqual(self.registry.active_tab_id, "tab-1")
        self.registry.set_active(None)
        self.assertIsNone(self.registry.active_tab_id)
        self.registry.set_active("tab-1")
        self.assertEqual(self.registry.active_tab_id, "tab-1")
        self.assertIsNone(self.registry.detach("not-created"))
        self.assertEqual(self.registry.active_tab_id, "tab-1")

    def test_engine_and_surface_remain_outside_tab_registry(self):
        source = (ROOT / "system/surface/runtime/browser_tab_registry.py").read_text()
        for forbidden in ("import gi", "from gi.repository", "ordax_browser_host",
                          "WebKit2", "Gtk.", "get_user_content_manager",
                          "browser_session_store", "save_browser_session"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
