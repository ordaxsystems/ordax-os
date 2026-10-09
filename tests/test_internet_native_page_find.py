"""Exercise the real isolated Native FindController methods without a GUI."""
import ast
from pathlib import Path
import unittest
from types import SimpleNamespace

HOST = Path(__file__).resolve().parents[1] / "system/surface/runtime/ordax_browser_host.py"

class Controller:
    def __init__(self):
        self.calls = []
        self.query = ""

    def search(self, query, flags, max_matches):
        self.query = query
        self.calls.append(("search", query, flags, max_matches))

    def search_next(self):
        self.calls.append(("next",))

    def search_previous(self):
        self.calls.append(("previous",))

    def search_finish(self):
        self.calls.append(("finish",))

    def get_search_text(self):
        return self.query

class View:
    def __init__(self):
        self.controller=Controller()
        self.uri="https://example.org/docs"

    def get_find_controller(self):
        return self.controller

    def get_uri(self):
        return self.uri

def isolated_host():
    tree = ast.parse(HOST.read_text(encoding="utf-8"))
    host = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name=="OrdaXBrowserHost")
    names={"finish_page_find","handle_page_find","on_find_found","on_find_failed"}
    methods = [n for n in host.body if isinstance(n,ast.FunctionDef) and n.name in names]
    assert len(methods)==len(names)
    code=ast.Module(body=[ast.ClassDef(
        name="IsolatedHost",bases=[],keywords=[],body=methods,decorator_list=[],
    )],type_ignores=[])
    for n in ast.walk(code):
        if isinstance(n,ast.FunctionDef): n.returns=None
        if isinstance(n,ast.arg): n.annotation=None
    ast.fix_missing_locations(code)
    ns={
        "MAX_PAGE_FIND_CHARS":256, "MAX_PAGE_FIND_MATCHES":1000,
        "allowed_external_uri":lambda uri:uri.startswith("https://example.org/"),
        "WebKit2": SimpleNamespace(FindOptions=SimpleNamespace(
            CASE_INSENSITIVE=1,WRAP_AROUND=2,
        )),
    }
    exec(compile(code,str(HOST),"exec"),ns)
    test=ns["IsolatedHost"]()
    test.view=View()
    test.tabs={"tab-1":SimpleNamespace(view=test.view,url=test.view.uri,loading=False)}
    test.active_tab_id="tab-1"
    test.find_active_tab_id=None
    test.find_query=""
    test.valid_tab_id=lambda value:value if value=="tab-1" else "invalid"
    test.events=[]
    test.emit_host_event=test.events.append
    return test

class NativePageFindTests(unittest.TestCase):
    def test_valid_find_uses_native_controller_and_next_previous(self):
        host=isolated_host()
        host.handle_page_find("page-find.search","tab-1","Página")
        self.assertEqual(host.view.controller.calls[-1],("search","Página",3,1000))
        host.handle_page_find("page-find.next","tab-1")
        host.handle_page_find("page-find.previous","tab-1")
        self.assertEqual(host.view.controller.calls[-2:],[("next",),("previous",)])
        host.on_find_found(host.view.controller,4,"tab-1")
        self.assertEqual(host.events[-1],{
            "type":"page-find.result","tabId":"tab-1","query":"Página","state":"found","count":4,
        })
        host.handle_page_find("page-find.finish","tab-1")
        self.assertEqual(host.view.controller.calls[-1],("finish",))
        self.assertIsNone(host.find_active_tab_id)

    def test_empty_and_invalid_queries_fail_closed(self):
        host=isolated_host()
        host.handle_page_find("page-find.search","tab-1","")
        self.assertIsNone(host.find_active_tab_id)
        for query in ("\n","x"*257,None):
            with self.subTest(query=repr(query)):
                with self.assertRaisesRegex(ValueError,"query"):
                    host.handle_page_find("page-find.search","tab-1",query)
        host.active_tab_id=None
        with self.assertRaisesRegex(ValueError,"active loaded"):
            host.handle_page_find("page-find.search","tab-1","foo")

    def test_callback_ignores_stale_tab_query_and_loading_page(self):
        host=isolated_host()
        host.handle_page_find("page-find.search","tab-1","old")
        host.find_query="new"
        host.on_find_found(host.view.controller,5,"tab-1")
        self.assertEqual(host.events,[])
        host.find_query="old"
        host.tabs["tab-1"].loading=True
        host.on_find_found(host.view.controller,5,"tab-1")
        self.assertEqual(host.events,[])
        host.tabs["tab-1"].loading=False
        host.on_find_failed(host.view.controller,"tab-1")
        self.assertEqual(host.events[-1]["state"],"not-found")
        self.assertEqual(host.events[-1]["count"],0)

    def test_find_accelerator_only_intercepts_visible_internet_viewport(self):
        host_source = HOST.read_text(encoding="utf-8")
        controls_source = (
            HOST.parents[2] / "apps" / "internet" / "ui" / "browser-controls.mjs"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'if action == "focus-page-find" and not self.viewport["visible"]:',
            host_source,
        )
        self.assertIn("findSlot()?.contains(event.target)", controls_source)

    def test_find_command_never_extracts_page_text(self):
        host=isolated_host()
        host.handle_page_find("page-find.search","tab-1","private")
        self.assertTrue(all(entry[0]!="run_javascript" for entry in host.view.controller.calls))
        self.assertEqual(host.events,[])

if __name__=="__main__":
    unittest.main()
