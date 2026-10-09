"""Behavioral tests of the actual Native WebKit user-selection handler AST."""
import ast
from pathlib import Path
import re
from types import SimpleNamespace
import unittest

HOST = Path(__file__).resolve().parents[1] / "system/surface/runtime/ordax_browser_host.py"


def load_capture_method():
    tree = ast.parse(HOST.read_text(encoding="utf-8"))
    host = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "OrdaXBrowserHost")
    method = next(n for n in host.body if isinstance(n, ast.FunctionDef) and n.name == "capture_page_selection")
    cls = ast.ClassDef(name="TestHost", bases=[], keywords=[], body=[method], decorator_list=[])
    code = ast.fix_missing_locations(ast.Module(body=[cls], type_ignores=[]))
    for n in ast.walk(code):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            n.returns = None
        if isinstance(n, ast.arg):
            n.annotation = None
    ns = {
        "PAGE_SELECTION_REQUEST_RE": re.compile(r"^selection-[1-9][0-9]{0,8}$"),
        "PAGE_SELECTION_MAX_CHARS": 4096,
        "allowed_external_uri": lambda url: url.startswith("https://example.org/"),
    }
    exec(compile(code, str(HOST), "exec"), ns)
    return ns["TestHost"]


class FakeView:
    def __init__(self):
        self.uri = "https://example.org/page"
        self.title = "External page"
        self.selection = "Selected words"
        self.scripts = []

    def get_uri(self):
        return self.uri

    def get_title(self):
        return self.title

    def run_javascript(self, script, _cancellable, callback, _data):
        self.scripts.append(script)
        self.callback = callback

    def run_javascript_finish(self, _result):
        return SimpleNamespace(get_js_value=lambda: SimpleNamespace(to_string=lambda: self.selection))

    def complete(self):
        self.callback(self, object())


class SelectionHandlerTests(unittest.TestCase):
    def setUp(self):
        self.host = load_capture_method()()
        self.view = FakeView()
        self.tab = SimpleNamespace(
            view=self.view, url=self.view.uri, loading=False,
        )
        self.host.tabs = {"tab-1": self.tab}
        self.host.active_tab_id = "tab-1"
        self.events = []
        self.host.emit_host_event = self.events.append
        self.host.valid_tab_id = lambda tab_id: tab_id if tab_id == "tab-1" else "unknown"

    def test_capture_selected_text_only_and_emit_bounded_untrusted_result(self):
        self.host.capture_page_selection("selection-1", "tab-1")
        self.assertEqual(len(self.view.scripts), 1)
        self.assertIn("window.getSelection()", self.view.scripts[0])
        self.assertNotIn("innerHTML", self.view.scripts[0])
        self.view.complete()
        result = self.events[0]["selection"]
        self.assertEqual(result["source"], "untrusted-web-content")
        self.assertEqual(result["kind"], "selection")
        self.assertEqual(result["text"], "Selected words")
        self.assertEqual(result["url"], "https://example.org/page")

    def test_capture_overflow_is_clipped_and_disclosed(self):
        self.view.selection = "a" * 4097
        self.host.capture_page_selection("selection-2", "tab-1")
        self.view.complete()
        result = self.events[0]["selection"]
        self.assertEqual(len(result["text"]), 4096)
        self.assertTrue(result["truncated"])

    def test_scope_changes_drop_late_page_content(self):
        self.host.capture_page_selection("selection-3", "tab-1")
        self.view.uri = "https://example.org/other"
        self.view.complete()
        self.assertEqual(self.events[0].get("error"), "unavailable")
        self.assertNotIn("selection", self.events[0])

    def test_capture_fails_closed_for_inactive_tab_or_empty_text(self):
        self.host.active_tab_id = None
        self.host.capture_page_selection("selection-4", "tab-1")
        self.assertEqual(self.events[0]["error"], "unavailable")
        self.assertEqual(self.view.scripts, [])
        self.host.active_tab_id = "tab-1"
        self.view.selection = ""
        self.host.capture_page_selection("selection-5", "tab-1")
        self.view.complete()
        self.assertEqual(self.events[-1]["error"], "unavailable")

    def test_capture_rejects_malformed_request_ids(self):
        for value in ("../../", "selection-0", "selection-01", "selection-9999999999"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "request id"):
                    self.host.capture_page_selection(value, "tab-1")


if __name__ == "__main__":
    unittest.main()
