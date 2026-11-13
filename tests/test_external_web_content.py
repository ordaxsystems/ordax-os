"""Real lazy untrusted WebKit context behavior without GTK on the CI host."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system/surface/runtime/external_web_content.py"


class ExternalWebContentTests(unittest.TestCase):
    def test_context_is_lazy_isolated_and_singleton(self):
        created = {"managers": [], "contexts": [], "signals": []}

        class DataManager:
            def __init__(self, **kwargs):
                created["managers"].append(kwargs)

        class WebContext:
            @staticmethod
            def new_with_website_data_manager(manager):
                instance = types.SimpleNamespace()
                instance.manager = manager
                instance.set_preferred_languages = lambda languages: setattr(instance, "languages", languages)
                instance.connect = lambda name, callback: created["signals"].append((name, callback))
                created["contexts"].append(instance)
                return instance

        module = importlib.util.module_from_spec(
            importlib.util.spec_from_file_location("external_web_content", MODULE)
        )
        module.__spec__.loader.exec_module(module)
        webkit = types.SimpleNamespace(WebsiteDataManager=DataManager, WebContext=WebContext)
        gi = types.ModuleType("gi")
        repository = types.ModuleType("gi.repository")
        repository.WebKit2 = webkit
        gi.repository = repository
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(
            sys.modules, {"gi": gi, "gi.repository": repository}
        ):
            profile = os.path.join(folder, "browser")
            cache = os.path.join(folder, "cache")
            callback = lambda *_args: None
            external = module.ExternalWebContent(profile, cache, callback)
            self.assertEqual(created["contexts"], [])
            self.assertFalse(os.path.exists(os.path.join(profile, "default")))
            first = external.context()
            self.assertIs(first, external.context())
            self.assertEqual(len(created["contexts"]), 1)
            self.assertEqual(
                created["managers"],
                [{
                    "base_data_directory": os.path.join(profile, "default", "data"),
                    "base_cache_directory": os.path.join(cache, "default"),
                }],
            )
            self.assertEqual(created["signals"], [("download-started", callback)])
            self.assertEqual(first.languages, ["pt-BR", "en-US"])
            self.assertFalse(os.path.exists(os.path.join(profile, "surface", "data")))

    def test_external_module_does_not_import_surface_or_browser_product(self):
        text = MODULE.read_text(encoding="utf-8")
        self.assertNotIn("from ordax_browser_host import", text)
        self.assertNotIn("from browser_session_store import", text)
        self.assertNotIn("WebView.new_with", text)
        self.assertNotIn("register_script_message_handler", text)
        self.assertIn("from gi.repository import WebKit2", text)


if __name__ == "__main__":
    unittest.main()
