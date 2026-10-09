"""Behavioral source-isolated tests for the Native WebKit popup decision.

No GTK runtime is needed: the actual method AST is executed against fakes,
and the separate URI policy regression suite owns public-network filtering.
"""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

HOST = Path(__file__).resolve().parents[1] / "system/surface/runtime/ordax_browser_host.py"
MAX_TABS = 16


def load_native_popup_handler():
    tree = ast.parse(HOST.read_text(encoding="utf-8"))
    helper = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "allocate_popup_tab_id"
    )
    host = next(
        node for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == "OrdaXBrowserHost"
    )
    handler = next(
        node for node in host.body
        if isinstance(node, ast.FunctionDef) and node.name == "on_decide_policy"
    )
    code = ast.Module(
        body=[
            helper,
            ast.ClassDef(
                name="IsolatedHost",
                bases=[],
                keywords=[],
                body=[handler],
                decorator_list=[],
            ),
        ],
        type_ignores=[],
    )
    # The native module's GTK annotation types are intentionally unavailable.
    for node in ast.walk(code):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            node.returns = None
        if isinstance(node, ast.arg):
            node.annotation = None
    ast.fix_missing_locations(code)
    namespace = {
        "MAX_TABS": MAX_TABS,
        "WebKit2": SimpleNamespace(
            PolicyDecisionType=SimpleNamespace(
                NAVIGATION_ACTION=1,
                NEW_WINDOW_ACTION=2,
            ),
        ),
        "allowed_external_uri": lambda uri: isinstance(uri, str)
        and uri.startswith("https://example.org/"),
    }
    exec(compile(code, str(HOST), "exec"), namespace)
    return namespace["IsolatedHost"], namespace["allocate_popup_tab_id"]


class FakeDecision:
    def __init__(self, uri, gesture):
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


class InternetPopupPolicyTests(unittest.TestCase):
    def setUp(self):
        host_type, self.allocate_id = load_native_popup_handler()
        self.host = host_type()
        self.host.tabs = {"tab-1": object()}
        self.opened = []

        def open_tab(tab_id, uri):
            self.opened.append((tab_id, uri))
            self.host.tabs[tab_id] = object()

        self.host.open_tab = open_tab

    def decide(self, uri, gesture, kind=2, source="tab-1"):
        decision = FakeDecision(uri, gesture)
        handled = self.host.on_decide_policy(None, decision, kind, source)
        return handled, decision

    def test_user_clicked_new_window_opens_isolated_tab(self):
        handled, decision = self.decide("https://example.org/guide", True)
        self.assertTrue(handled)
        self.assertEqual(decision.ignored, 1)
        self.assertEqual(self.opened, [("popup-1", "https://example.org/guide")])
        self.decide("https://example.org/other", True)
        self.assertEqual(self.opened[-1][0], "popup-2")

    def test_scripted_or_disallowed_popup_cannot_open_tab(self):
        for url, gesture, source in [
            ("https://example.org/ad", False, "tab-1"),
            ("https://example.org/ad", True, "closed-tab"),
            ("http://127.0.0.1/private", True, "tab-1"),
            ("javascript:alert(1)", True, "tab-1"),
        ]:
            with self.subTest(url=url, gesture=gesture, source=source):
                handled, decision = self.decide(url, gesture, source=source)
                self.assertTrue(handled)
                self.assertEqual(decision.ignored, 1)
                self.assertEqual(self.opened, [])

    def test_tab_limit_fails_closed(self):
        self.host.tabs.update({f"tab-{i}": object() for i in range(2, MAX_TABS + 1)})
        handled, decision = self.decide("https://example.org/docs", True)
        self.assertTrue(handled)
        self.assertEqual(decision.ignored, 1)
        self.assertEqual(self.opened, [])
        with self.assertRaisesRegex(ValueError, "tab limit"):
            self.allocate_id({f"popup-{i}" for i in range(1, MAX_TABS + 1)})

    def test_normal_navigation_uses_existing_browser_engine(self):
        handled, decision = self.decide("https://example.org/docs", False, kind=1)
        self.assertFalse(handled)
        self.assertEqual(decision.ignored, 0)
        self.assertEqual(self.opened, [])
        handled, decision = self.decide("https://bad.example/", True, kind=1)
        self.assertTrue(handled)
        self.assertEqual(decision.ignored, 1)

    def test_unknown_policy_decisions_are_not_intercepted(self):
        handled, decision = self.decide("https://example.org/", True, kind=3)
        self.assertFalse(handled)
        self.assertEqual(decision.ignored, 0)


if __name__ == "__main__":
    unittest.main()
