"""Exercise real Native WebKit download callbacks with isolated fake downloads."""
import ast
import importlib.util
import os
from pathlib import Path
import re
import secrets
from types import SimpleNamespace
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
HOST=ROOT/"system/surface/runtime/ordax_browser_host.py"
POLICY=ROOT/"system/surface/runtime/browser_download_policy.py"
spec=importlib.util.spec_from_file_location("download_policy_under_test",POLICY)
policy=importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

class FakeDownload:
    def __init__(self,view,uri="https://example.org/file",bytes_expected=30):
        self.view=view
        self.uri=uri
        self.bytes_expected=bytes_expected
        self.received=0
        self.cancel_count=0
        self.callbacks={}
        self.destination=None
        self.overwrite=None

    def get_request(self):
        return SimpleNamespace(get_uri=lambda:self.uri)
    def get_web_view(self):
        return self.view
    def get_response(self):
        return SimpleNamespace(get_uri=lambda:self.uri,get_content_length=lambda:self.bytes_expected)
    def get_received_data_length(self):
        return self.received
    def set_allow_overwrite(self,allowed):
        self.overwrite=allowed
    def set_destination(self,path):
        self.destination=path
    def cancel(self):
        self.cancel_count+=1
    def connect(self,signal,callback,identifier):
        self.callbacks[signal]=(callback,identifier)
    def emit(self,signal,*arguments):
        callback,identifier=self.callbacks[signal]
        return callback(self,*arguments,identifier)

def fake_host(downloads_root):
    source=ast.parse(HOST.read_text(encoding="utf-8"))
    host=next(n for n in source.body if isinstance(n,ast.ClassDef) and n.name=="OrdaXBrowserHost")
    method_names={
        "emit_download_state","remove_download_timeout","cancel_download_item",
        "timeout_download","on_download_started","on_download_decide_destination",
        "handle_download_decision","on_download_destination_created",
        "on_download_received_data","on_download_failed","on_download_finished",
    }
    methods=[n for n in host.body if isinstance(n,ast.FunctionDef) and n.name in method_names]
    assert len(methods)==len(method_names), (len(methods),len(method_names))
    module=ast.Module(body=[ast.ClassDef(
        name="TestHost",bases=[],keywords=[],body=methods,decorator_list=[],
    )],type_ignores=[])
    for node in ast.walk(module):
        if isinstance(node,ast.FunctionDef):node.returns=None
        if isinstance(node,ast.arg):node.annotation=None
    ast.fix_missing_locations(module)
    glib=SimpleNamespace(
        timeout_add_seconds=lambda _seconds,*args:42,
        source_remove=lambda _source:True,
        filename_to_uri=lambda path,_a:Path(path).as_uri(),
    )
    namespace={
        "secrets":secrets,"os":os,"re":re,"GLib":glib,
        "MAX_DOWNLOAD_BYTES":policy.MAX_DOWNLOAD_BYTES,
        "download_destination":policy.download_destination,
        "safe_download_name":policy.safe_download_name,
        "verified_download":policy.verified_download,
        "allowed_external_uri":lambda url:url.startswith("https://example.org/"),
    }
    exec(compile(module,str(HOST),"exec"),namespace)
    obj=namespace["TestHost"]()
    obj.downloads={}
    obj.download_user_root=downloads_root
    obj.active_tab_id="tab-1"
    obj.view=object()
    obj.tabs={"tab-1":SimpleNamespace(
        tab_id="tab-1",view=obj.view,loading=False,
        url="https://example.org/page",
    )}
    obj.events=[]
    obj.emit_host_event=obj.events.append
    return obj

class BrowserDownloadNativeTests(unittest.TestCase):
    def test_requires_explicit_approval_and_saves_user_file_without_overwrite(self):
        with tempfile.TemporaryDirectory() as root:
            host=fake_host(root)
            d=FakeDownload(host.view)
            host.on_download_started(None,d)
            self.assertEqual(len(host.downloads),1)
            id=next(iter(host.downloads))
            self.assertEqual(host.events,[])
            self.assertTrue(d.emit("decide-destination","../report.pdf"))
            self.assertEqual(host.events[-1]["status"],"pending")
            self.assertIsNone(d.destination)
            host.handle_download_decision("download.approve",id)
            self.assertEqual(d.overwrite,False)
            self.assertEqual(host.events[-1]["status"],"downloading")
            item=host.downloads[id]
            self.assertTrue(item["path"].startswith(os.path.join(root,"Downloads")+"/"))
            Path(item["path"]).write_bytes(b"okay")
            d.emit("created-destination",d.destination)
            d.emit("finished")
            self.assertEqual(host.events[-1]["status"],"saved")
            self.assertEqual(Path(item["path"]).read_bytes(),b"okay")
            self.assertEqual(len(host.downloads),0)

    def test_reject_untrusted_download_sources_and_excess_count(self):
        with tempfile.TemporaryDirectory() as root:
            host=fake_host(root)
            d=FakeDownload(object())
            host.on_download_started(None,d)
            self.assertEqual(d.cancel_count,1)
            self.assertEqual(host.downloads,{})
            d2=FakeDownload(host.view,uri="http://127.0.0.1/private")
            host.on_download_started(None,d2)
            self.assertEqual(d2.cancel_count,1)

    def test_explicit_cancel_and_timeout_leave_no_file(self):
        with tempfile.TemporaryDirectory() as root:
            host=fake_host(root)
            d=FakeDownload(host.view)
            host.on_download_started(None,d)
            id=next(iter(host.downloads))
            d.emit("decide-destination","file.bin")
            host.handle_download_decision("download.cancel",id)
            self.assertEqual(d.cancel_count,1)
            self.assertEqual(host.events[-1]["status"],"cancelled")
            d.emit("finished")
            self.assertEqual(host.downloads,{})
            d2=FakeDownload(host.view)
            host.on_download_started(None,d2)
            id=next(iter(host.downloads))
            d2.emit("decide-destination","file.bin")
            self.assertFalse(host.timeout_download(id))
            self.assertEqual(d2.cancel_count,1)

    def test_oversize_denied_and_partial_download_cleaned(self):
        with tempfile.TemporaryDirectory() as root:
            host=fake_host(root)
            d=FakeDownload(host.view,bytes_expected=policy.MAX_DOWNLOAD_BYTES+1)
            host.on_download_started(None,d)
            d.emit("decide-destination","huge.iso")
            self.assertEqual(host.events[-1]["status"],"failed")
            self.assertEqual(d.cancel_count,1)
            d.emit("finished")
            d2=FakeDownload(host.view)
            host.on_download_started(None,d2)
            id=next(iter(host.downloads))
            d2.emit("decide-destination","file.bin")
            host.handle_download_decision("download.approve",id)
            path=host.downloads[id]["path"]
            Path(path).write_bytes(b"partial")
            d2.emit("created-destination",d2.destination)
            d2.received=policy.MAX_DOWNLOAD_BYTES+1
            d2.emit("received-data",1)
            self.assertEqual(host.events[-1]["status"],"failed")
            d2.emit("finished")
            self.assertFalse(Path(path).exists())

    def test_cancel_after_approval_cleans_partial_file(self):
        with tempfile.TemporaryDirectory() as root:
            host=fake_host(root)
            d=FakeDownload(host.view)
            host.on_download_started(None,d)
            id=next(iter(host.downloads))
            d.emit("decide-destination","large-file.bin")
            host.handle_download_decision("download.approve",id)
            path=host.downloads[id]["path"]
            Path(path).write_bytes(b"unfinished")
            d.emit("created-destination",d.destination)
            host.handle_download_decision("download.cancel",id)
            self.assertEqual(host.events[-1]["status"],"cancelled")
            self.assertEqual(d.cancel_count,1)
            d.emit("finished")
            self.assertFalse(Path(path).exists())
            self.assertEqual(host.downloads,{})

    def test_reject_malformed_or_replayed_approval(self):
        with tempfile.TemporaryDirectory() as root:
            host=fake_host(root)
            with self.assertRaisesRegex(ValueError,"identifier"):
                host.handle_download_decision("download.approve","../danger")
            with self.assertRaisesRegex(ValueError,"pending"):
                host.handle_download_decision("download.approve","download-0123456789abcdef")

if __name__=="__main__":
    unittest.main()
