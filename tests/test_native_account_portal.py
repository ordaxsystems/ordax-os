"""Isolation and navigation safety tests for the Native hosted-signup window.

The GTK runtime is not required: policy methods are extracted from the actual
host AST and executed with controlled boundary fakes. Real QEMU/USB remains a
separate gate.
"""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from urllib.parse import urlsplit

HOST = Path(__file__).resolve().parents[1] / "system/surface/runtime/ordax_browser_host.py"


def load_policy():
    source = HOST.read_text(encoding="utf-8")
    tree = ast.parse(source)
    allowed = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "allowed_account_portal_uri")
    host = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "OrdaXBrowserHost")
    methods = [n for n in host.body if isinstance(n, ast.FunctionDef) and n.name in {
        "on_account_portal_policy", "on_account_portal_destroyed",
    }]
    namespace = {
        "urlsplit": urlsplit,
        "allowed_external_uri": lambda url: isinstance(url, str) and url.startswith(("https://", "http://")),
        "WebKit2": SimpleNamespace(PolicyDecisionType=SimpleNamespace(NAVIGATION_ACTION=1, NEW_WINDOW_ACTION=2)),
    }
    code = ast.Module(
        body=[allowed, ast.ClassDef(name="PolicyHost", bases=[], keywords=[], body=methods, decorator_list=[])],
        type_ignores=[],
    )
    exec(compile(ast.fix_missing_locations(code), str(HOST), "exec"), namespace)
    return namespace["allowed_account_portal_uri"], namespace["PolicyHost"], source


class FakeDecision:
    def __init__(self, uri, gesture=True):
        self.uri = uri
        self.gesture = gesture
        self.ignored = 0

    def get_navigation_action(self):
        return SimpleNamespace(
            get_request=lambda: SimpleNamespace(get_uri=lambda: self.uri),
            is_user_gesture=lambda: self.gesture,
        )

    def ignore(self):
        self.ignored += 1


class AccountPortalNativeTests(unittest.TestCase):
    def setUp(self):
        self.is_allowed, self.Host, self.source = load_policy()

    def test_official_signup_navigation_is_https_only_and_origin_bounded(self):
        for good in [
            "https://ordax.com.br/cadastro/",
            "https://ordax.com.br/login/?cadastro=verifique-email",
            "https://www.ordax.com.br/termos/",
        ]:
            self.assertTrue(self.is_allowed(good), good)
        for bad in [
            "http://ordax.com.br/cadastro/",
            "https://ordax.com.br.evil.test/cadastro/",
            "https://evil.test/cadastro/",
            "https://127.0.0.1/cadastro/",
            "https://ordax.com.br:444/cadastro/",
            "https://admin:pass@ordax.com.br/cadastro/",
            "file:///etc/passwd",
        ]:
            self.assertFalse(self.is_allowed(bad), bad)

    def test_policy_rejects_external_navigation_and_scripted_popups(self):
        host = self.Host()
        class View:
            opened = []
            def load_uri(self, uri):
                self.opened.append(uri)
        view = View()
        forbidden = FakeDecision("https://example.com/phishing")
        self.assertTrue(host.on_account_portal_policy(view, forbidden, 1))
        self.assertEqual(forbidden.ignored, 1)
        allowed = FakeDecision("https://ordax.com.br/privacidade/")
        self.assertFalse(host.on_account_portal_policy(view, allowed, 1))
        self.assertEqual(allowed.ignored, 0)
        scripted = FakeDecision("https://ordax.com.br/termos/", gesture=False)
        self.assertTrue(host.on_account_portal_policy(view, scripted, 2))
        self.assertEqual(scripted.ignored, 1)
        self.assertEqual(view.opened, [])
        gesture = FakeDecision("https://ordax.com.br/termos/")
        self.assertTrue(host.on_account_portal_policy(view, gesture, 2))
        self.assertEqual(gesture.ignored, 1)
        self.assertEqual(view.opened, ["https://ordax.com.br/termos/"])

    def test_privileged_surface_command_has_no_caller_url_and_external_context_only(self):
        self.assertIn('elif command == "account.signup.open":', self.source)
        self.assertIn('if set(payload) != {"type"}:', self.source)
        self.assertIn("self.open_official_account_portal()", self.source)
        self.assertIn("WebKit2.WebView.new_with_context(self.external_context)", self.source)
        self.assertIn('OFFICIAL_ACCOUNT_SIGNUP_URL = "https://ordax.com.br/cadastro/"', self.source)
        self.assertIn('view.connect("decide-policy", self.on_account_portal_policy)', self.source)
        tree = ast.parse(self.source)
        host = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "OrdaXBrowserHost")
        portal = next(node for node in host.body if isinstance(node, ast.FunctionDef) and node.name == "open_official_account_portal")
        portal_source = ast.get_source_segment(self.source, portal)
        self.assertNotIn("self.surface_context", portal_source)


if __name__ == "__main__":
    unittest.main()
