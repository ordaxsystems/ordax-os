"""Guarantee Surface/Internet lifecycle ownership and persistence boundaries."""
import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system/surface/runtime/ordax_browser_host.py"
STORE = ROOT / "system/surface/runtime/browser_session_store.py"
LIFECYCLE = ROOT / "system/surface/runtime/browser_session_runtime.py"
EXTERNAL = ROOT / "system/surface/runtime/external_web_content.py"


class BrowserSessionIntegrationContractTests(unittest.TestCase):
    def test_native_host_delegates_persistence_to_unprivileged_session_owner(self):
        host = HOST.read_text(encoding="utf-8")
        store = STORE.read_text(encoding="utf-8")
        lifecycle = LIFECYCLE.read_text(encoding="utf-8")
        external = EXTERNAL.read_text(encoding="utf-8")

        self.assertIn("from browser_session_runtime import InternetBrowserSession", host)
        self.assertIn("self.browser_session = InternetBrowserSession(", host)
        self.assertIn('os.path.join(self.profile_root, "session.json")', host)
        self.assertIn('parser.add_argument("--cache-root", default="/run/ordax/browser-cache")', host)
        self.assertIn('profile_cache = os.path.join(self.cache_root, "default")', external)
        self.assertIn("self.external_content = ExternalWebContent(", host)
        self.assertNotIn("from browser_session_store import", host)
        self.assertNotIn("load_browser_session(", host)
        self.assertNotIn("save_browser_session(", host)
        self.assertIn("self.browser_session.begin_restore()", host)
        self.assertIn("self.browser_session.abort_restore()", host)
        self.assertIn("self.browser_session.finish_restore()", host)
        self.assertIn("self.browser_session.persist(", host)
        self.assertIn("load_browser_session(", lifecycle)
        self.assertIn("save_browser_session(", lifecycle)
        self.assertIn("self._last_persisted", lifecycle)
        self.assertIn("if key == self._last_persisted:", lifecycle)
        self.assertIn("if not self.activated or self.restoring:", lifecycle)
        self.assertIn("allow_url=self.allow_url", lifecycle)
        self.assertIn("max_tabs=self.max_tabs", lifecycle)
        self.assertIn("self.persist_session()", host)
        self.assertIn("if event == WebKit2.LoadEvent.FINISHED", host)
        self.assertIn('self.window.connect("destroy", self.on_window_destroy)', host)

        self.assertIn("SESSION_VERSION = 1", store)
        self.assertIn("MAX_SESSION_BYTES", store)
        self.assertIn("tempfile.mkstemp", store)
        self.assertIn("os.fchmod(descriptor, 0o600)", store)
        self.assertIn("os.replace(temporary, path)", store)
        self.assertIn('getattr(os, "O_NOFOLLOW", 0)', store)

    def test_persisted_state_never_contains_privileged_surface_or_page_content(self):
        store = STORE.read_text(encoding="utf-8")
        host = HOST.read_text(encoding="utf-8")
        lifecycle = LIFECYCLE.read_text(encoding="utf-8")
        self.assertIn('"urls": list(session.urls)', store)
        self.assertIn('"activeIndex": session.active_index', store)
        for text in (store, lifecycle):
            self.assertNotIn("pageSource", text)
            self.assertNotIn("localStorage", text)
            self.assertNotIn("sessionStorage", text)
            self.assertNotIn("surface_view.get_uri", text)
        self.assertNotIn("surface_view.get_uri", host)

    def test_surface_does_not_start_external_context_or_restore_on_boot(self):
        host = HOST.read_text(encoding="utf-8")
        external = EXTERNAL.read_text(encoding="utf-8")
        syntax = ast.parse(host)
        native_host = next(
            node for node in syntax.body
            if isinstance(node, ast.ClassDef) and node.name == "OrdaXBrowserHost"
        )
        initializer = next(
            node for node in native_host.body
            if isinstance(node, ast.FunctionDef) and node.name == "__init__"
        )
        startup = ast.get_source_segment(host, initializer)
        self.assertIsNotNone(startup)
        self.assertNotIn("self.restore_session()", startup)
        self.assertNotIn("self.external_context =", startup)
        self.assertNotIn("WebKit2.WebView.new_with_context(self.external_context)", startup)
        self.assertIn("self.external_content = ExternalWebContent(", startup)
        self.assertIn("return self.external_content.context()", host)
        self.assertIn("if value[\"visible\"]:", host)
        self.assertIn("self.activate_browser_session()", host)
        self.assertIn('context.connect("download-started", self.download_started)', external)
        self.assertNotIn("register_script_message_handler", external)
        self.assertNotIn("get_user_content_manager", external)

    def test_browser_restore_has_failure_rollback_before_any_session_write(self):
        host = HOST.read_text(encoding="utf-8")
        restore = host.split("    def restore_session(self) -> None:", 1)[1].split("    def create_external_view(", 1)[0]
        self.assertLess(restore.index("self.browser_session.begin_restore()"), restore.index("self.open_tab("))
        self.assertIn("self.browser_session.abort_restore()", restore)
        self.assertIn("self.tabs.pop(tab_id)", restore)
        self.assertIn("self.overlay.remove(tab.view)", restore)
        self.assertIn("self.active_tab_id = previous_active", restore)
        self.assertLess(restore.index("self.browser_session.finish_restore()"), restore.index("self.persist_session()"))


if __name__ == "__main__":
    unittest.main()
