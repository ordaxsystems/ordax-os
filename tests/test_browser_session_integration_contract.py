from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"
STORE = ROOT / "system" / "surface" / "runtime" / "browser_session_store.py"
EXTERNAL = ROOT / "system" / "surface" / "runtime" / "external_web_content.py"


class BrowserSessionIntegrationContractTests(unittest.TestCase):
    def test_native_host_restores_only_through_isolated_session_store(self):
        host = HOST.read_text(encoding="utf-8")
        store = STORE.read_text(encoding="utf-8")

        self.assertIn("from browser_session_store import load_browser_session, save_browser_session", host)
        self.assertIn('self.session_path = os.path.join(self.profile_root, "session.json")', host)
        self.assertIn('parser.add_argument("--cache-root", default="/run/ordax/browser-cache")', host)
        external = EXTERNAL.read_text(encoding="utf-8")
        self.assertIn('profile_cache = os.path.join(self.cache_root, "default")', external)
        self.assertIn("self.external_content = ExternalWebContent(", host)
        self.assertNotIn('profile_cache = os.path.join(self.profile_root, "default", "cache")', host)
        self.assertIn("self.restore_session()", host)
        self.assertIn("self.browser_session_activated = False", host)
        self.assertIn("if self.restoring_session or not self.browser_session_activated:", host)
        self.assertIn("self.activate_browser_session()", host)
        self.assertIn("load_browser_session(", host)
        self.assertIn("allow_url=allowed_external_uri", host)
        self.assertIn("max_tabs=MAX_TABS", host)
        self.assertIn("save_browser_session(", host)
        self.assertIn("self.last_persisted_session", host)
        self.assertIn("if session_key == self.last_persisted_session:", host)
        self.assertIn("self.persist_session()", host)
        self.assertIn("if event == WebKit2.LoadEvent.FINISHED", host)
        self.assertIn("self.window.connect(\"destroy\", self.on_window_destroy)", host)

        self.assertIn("SESSION_VERSION = 1", store)
        self.assertIn("MAX_SESSION_BYTES", store)
        self.assertIn("tempfile.mkstemp", store)
        self.assertIn("os.fchmod(descriptor, 0o600)", store)
        self.assertIn("os.replace(temporary, path)", store)
        self.assertIn('getattr(os, "O_NOFOLLOW", 0)', store)

    def test_persisted_state_never_contains_privileged_surface_or_page_content(self):
        store = STORE.read_text(encoding="utf-8")
        host = HOST.read_text(encoding="utf-8")

        self.assertIn('"urls": list(session.urls)', store)
        self.assertIn('"activeIndex": session.active_index', store)
        self.assertNotIn("pageSource", store)
        self.assertNotIn("html", store.lower())
        self.assertNotIn("localStorage", store)
        self.assertNotIn("sessionStorage", store)
        self.assertNotIn("surface_view.get_uri", host)


    def test_surface_startup_does_not_instantiate_external_webviews(self):
        host = HOST.read_text(encoding="utf-8")
        external = EXTERNAL.read_text(encoding="utf-8")
        startup = host.split("class OrdaXBrowserHost:", 1)[1].split("    def start_profile_consent_listener", 1)[0]
        self.assertNotIn("self.restore_session()", startup)
        self.assertNotIn("self.external_context =", startup)
        self.assertNotIn("WebKit2.WebView.new_with_context(self.external_context)", startup)
        self.assertIn("self.external_content = ExternalWebContent(", startup)
        self.assertIn("return self.external_content.context()", startup)
        self.assertIn("if self.browser_session_activated:", host)
        self.assertIn("if value[\"visible\"]:", host)
        self.assertIn("self.activate_browser_session()", host)
        self.assertIn('context.connect("download-started", self.download_started)', external)
        self.assertNotIn("register_script_message_handler", external)
        self.assertNotIn("get_user_content_manager", external)

if __name__ == "__main__":
    unittest.main()
