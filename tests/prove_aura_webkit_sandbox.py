#!/usr/bin/env python3
"""Smoke the verified unsigned Aura package in a real opaque WebKitGTK frame.

This is a browser-engine compatibility proof, NOT an OS boot, signed release,
host session, active component installation or authorization to infer.
Run on Linux with python3-gi, WebKit2 4.1 and a virtual display.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "system/surface/runtime"))
from native_request_boundary import request_is_trusted  # noqa: E402


def run(*args: object, cwd: Path) -> str:
    result = subprocess.run(
        [str(arg) for arg in args], cwd=cwd, check=True,
        capture_output=True, text=True, timeout=75,
    )
    return result.stdout.strip()


def make_child_document(module_url: str, resource_root: str) -> str:
    nonce = os.urandom(18).hex()
    policy = "; ".join([
        "default-src 'none'",
        f"script-src 'nonce-{nonce}' {resource_root}",
        f"style-src 'unsafe-inline' {resource_root}",
        f"img-src data: blob: {resource_root}",
        f"font-src data: {resource_root}",
        f"connect-src {resource_root}",
        "form-action 'none'",
        "base-uri 'none'",
        "object-src 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
    ])
    # A single synthetic, read-only identity/space/intelligence projection.
    # Actual host data and inference are never used by this proof.
    js = r"""
const report = data => parent.postMessage({schema:"ordax.aura.webkit-proof/1", ...data}, "*");
const root = document.getElementById("ordax-app-root");
const profile = {schema:"ordax.locale-profile/1",locale:"pt-BR",language:"pt",region:"BR",script:"Latn",direction:"ltr"};
const lifecycle = {schema:"ordax.surface-render-lifecycle/5",
  localization:{schema:"ordax.localization/2",getLocale:()=>"pt-BR",getProfile:()=>profile,
    translate:id=>id,subscribe:()=>()=>{}},
  getAppTarget:()=>null,setAppTarget(){throw Error("blocked")},subscribeRender:()=>()=>{}};
const identity = {schema:"ordax.identity-session/1",getSnapshot:()=>({state:"unavailable"}),subscribe:()=>()=>{}};
const space = {schema:"ordax.space-selection/1",
  getSnapshot:()=>({schema:"ordax.space-selection/1",state:"unavailable"}),
  subscribe:()=>()=>{},select(){throw Error("blocked")},clear(){throw Error("blocked")}};
let calls = 0;
const intelligence = {schema:"ordax.intelligence/1",
  getSnapshot:()=>({schema:"ordax.intelligence/1",state:"degraded",inferenceAvailable:false,
    engineId:null,modelId:null,authority:"none",toolExecution:false}),
  subscribe:()=>()=>{},respond(){calls++;throw Error("inference disabled")}};
try {
  const {componentRuntime} = await import(__MODULE_URL__);
  if (componentRuntime.componentId !== "assistant" || componentRuntime.version !== "0.1.3")
    throw Error("Unexpected Aura package identity");
  const mounted = await componentRuntime.mount({
    root,surfaceLifecycle:lifecycle,identitySessionPort:identity,spaceSelectionPort:space,intelligence,
  });
  const field = !!root.querySelector('[data-app-extension="assistant-conversation"] [data-assistant-input]');
  const css = !!document.head.querySelector('link[data-ordax-component-style="assistant"]');
  mounted.destroy();
  const clean = root.childElementCount === 0
    && !document.head.querySelector('link[data-ordax-component-style="assistant"]');
  report({stage:"complete",ok:field&&css&&clean&&calls===0,field,css,clean,inferenceCalls:calls});
} catch (error) {
  report({stage:"failed",ok:false,error:String(error?.message||error).slice(0,350)});
}
""".replace("__MODULE_URL__", json.dumps(module_url))
    # All markup is locally authored, and source files enter only via verified ZIP.
    import html
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta http-equiv="Content-Security-Policy" content="'
        + html.escape(policy, quote=True) + '">'
        '<meta name="referrer" content="no-referrer"></head>'
        '<body><main id="ordax-app-root"></main>'
        f'<script type="module" nonce="{nonce}">{js}</script></body></html>'
    )


def prove(apps: Path, expected_source_commit: str, expected_package_sha256: str) -> dict:
    if re.fullmatch(r"[0-9a-f]{40}", expected_source_commit) is None:
        raise ValueError("Expected source revision must be a pinned lowercase 40-hex commit")
    if re.fullmatch(r"[0-9a-f]{64}", expected_package_sha256) is None:
        raise ValueError("Expected package digest must be a pinned lowercase SHA-256")
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import GLib, Gtk, WebKit2

    commit = run("git", "rev-parse", "HEAD", cwd=apps)
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Aura checkout must identify an exact source commit")
    if commit != expected_source_commit:
        raise ValueError("Checked-out Aura source does not match the pinned revision")
    builder = apps / "tools/app-package/build.py"
    app = apps / "apps/assistant"
    with tempfile.TemporaryDirectory(prefix="ordax-aura-webkit-") as temporary:
        scratch = Path(temporary)
        package = scratch / "assistant.zip"
        run(sys.executable, builder, "build", "--app-root", app,
            "--source-commit", commit, "--compatibility", app / "compatibility.json",
            "--package-out", package, "--release-dir", scratch, cwd=apps)
        run(sys.executable, builder, "verify", "--package", package,
            "--release", scratch / "assistant.release.json",
            "--compatibility", scratch / "assistant.compatibility.json", cwd=apps)
        release = json.loads((scratch / "assistant.release.json").read_text(encoding="utf-8"))
        if release["source_commit"] != commit or release["activation"]["direct_activation_allowed"] is not False:
            raise ValueError("Aura source identity or unsigned activation gate differs")
        package_bytes = package.read_bytes()
        digest = hashlib.sha256(package_bytes).hexdigest()
        if digest != release["package"]["sha256"]:
            raise ValueError("Verified Aura package changed")
        if digest != expected_package_sha256:
            raise ValueError("Aura package SHA-256 differs from the operator-pinned digest")
        unpacked = scratch / "extracted"
        with zipfile.ZipFile(package) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                relative = PurePosixPath(info.filename)
                if relative.is_absolute() or ".." in relative.parts:
                    raise ValueError("Unsafe verified Aura package path")
                target = unpacked.joinpath(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(info))
        manifest = json.loads((unpacked / "system/apps/assistant/app.json").read_text(encoding="utf-8"))
        if manifest["id"] != "assistant" or manifest["version"] != "0.1.3":
            raise ValueError("Unexpected Aura version; update the bounded proof explicitly")
        prefix = f"/__ordax/native/component-module/assistant/pending/{manifest['version']}/{commit}/"
        seen: list[dict] = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:
                pass

            def do_GET(self) -> None:
                path = urlsplit(self.path).path
                trusted = request_is_trusted(
                    self.headers, self.server.server_address, self.path, "GET",
                )
                if path.startswith("/__ordax/native/"):
                    seen.append({"asset": path.split("/")[-1], "allowed": trusted,
                                 "destination": self.headers.get("Sec-Fetch-Dest"),
                                 "origin": self.headers.get("Origin"),
                                 "referer_present": self.headers.get("Referer") is not None})
                if not trusted:
                    self.send_response(403)
                    self.end_headers()
                    return
                if path == "/":
                    payload, mime = parent_html.encode("utf-8"), "text/html"
                elif path.startswith(prefix):
                    relative = PurePosixPath(path[len(prefix):])
                    if relative.is_absolute() or ".." in relative.parts:
                        self.send_error(403)
                        return
                    target = unpacked.joinpath(*relative.parts)
                    if not target.is_file():
                        self.send_error(404)
                        return
                    payload = target.read_bytes()
                    mime = {
                        ".js": "text/javascript", ".mjs": "text/javascript",
                        ".json": "application/json", ".css": "text/css",
                    }.get(target.suffix, "application/octet-stream")
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                if path.startswith(prefix):
                    self.send_header("Access-Control-Allow-Origin", "null")
                    self.send_header("Vary", "Origin")
                self.end_headers()
                self.wfile.write(payload)

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        origin = f"http://127.0.0.1:{httpd.server_address[1]}"
        resource_root = origin + prefix
        module_url = resource_root + "system/apps/assistant/src/runtime.mjs"
        child = make_child_document(module_url, resource_root)
        serialized = json.dumps(child).replace("</", "<\\/")
        parent_html = (
            '<!doctype html><html><body data-status="initial">'
            '<script>window.addEventListener("message", event=>{'
            'if(event.data?.schema!=="ordax.aura.webkit-proof/1" || '
            'event.source!==document.querySelector("iframe")?.contentWindow)return;'
            'document.body.dataset.status=event.data.ok?"pass":"fail";'
            'document.body.dataset.detail=JSON.stringify(event.data);'
            '});const frame=document.createElement("iframe");'
            'frame.setAttribute("sandbox","allow-scripts");'
            'frame.setAttribute("referrerpolicy","no-referrer");'
            'frame.srcdoc=' + serialized + ';document.body.append(frame);'
            '</script></body></html>'
        )
        worker = threading.Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        try:
            context = WebKit2.WebContext.new_ephemeral()
            view = WebKit2.WebView.new_with_context(context)
            window = Gtk.Window()
            window.set_default_size(900, 600)
            window.add(view)
            window.show_all()
            loop = GLib.MainLoop()
            state = {"status": "timeout", "detail": "", "busy": False}

            def on_eval(webview, response, _data) -> None:
                state["busy"] = False
                try:
                    outcome = webview.run_javascript_finish(response)
                    data = outcome.get_js_value().to_string()
                    payload = json.loads(data)
                    if payload.get("status") in ("pass", "fail"):
                        state.update(payload)
                        loop.quit()
                except Exception as exc:
                    state["status"] = "browser-evaluation-error"
                    state["detail"] = type(exc).__name__
                    loop.quit()

            def poll() -> bool:
                if state["busy"]:
                    return True
                state["busy"] = True
                view.run_javascript(
                    'JSON.stringify({status:document.body?.dataset.status,detail:document.body?.dataset.detail})',
                    None, on_eval, None,
                )
                return True

            def deadline() -> bool:
                if state["status"] == "timeout":
                    state["detail"] = "WebKit did not report a terminal Aura mount receipt"
                loop.quit()
                return False

            view.load_uri(origin + "/")
            GLib.timeout_add(250, poll)
            GLib.timeout_add_seconds(25, deadline)
            loop.run()
            window.destroy()
        finally:
            httpd.shutdown()
            httpd.server_close()
            worker.join(timeout=3)
        # Require real signed-package-shaped JSON imports, no privileged host reads.
        manifest_reads = [request for request in seen if request["asset"] == "app.json"]
        if state["status"] != "pass" or not manifest_reads or not all(x["allowed"] for x in seen):
            raise RuntimeError(
                "WebKit Aura mount did not pass: "
                + json.dumps({"status": state, "reads": seen[-22:]}, ensure_ascii=False)
            )
        detail = json.loads(state["detail"])
        if not (detail["field"] and detail["css"] and detail["clean"]
                and detail["inferenceCalls"] == 0):
            raise RuntimeError("WebKit Aura mount did not meet the full lifecycle contract")
        return {
            "schema": "ordax.aura.webkit-unsigned-package-smoke/1",
            "status": "pass",
            "source_commit": commit,
            "package_sha256": digest,
            "native_webkit_engine": WebKit2.get_major_version(),
            "opaque_json_imports_verified": True,
            "mount_render_css_teardown_verified": True,
            "private_inference_calls": 0,
            "signed_distribution_verified": False,
            "os_boot_verified": False,
            "native_installed_slot_verified": False,
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apps-root", type=Path, required=True)
    parser.add_argument("--expected-source-commit", required=True)
    parser.add_argument("--expected-package-sha256", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(prove(args.apps_root.resolve(), args.expected_source_commit, args.expected_package_sha256), sort_keys=True))
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print("AURA_NATIVE_WEBKIT_SMOKE_FAILED=" + str(exc)[:2500], file=sys.stderr)
        sys.exit(1)
