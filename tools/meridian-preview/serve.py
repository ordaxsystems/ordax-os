"""Loopback-only visual preview. No API, proxy, write operation or directory listing."""
from argparse import ArgumentParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import mimetypes

ROOT = Path(__file__).resolve().parents[2]
EXPERIMENT = ROOT / "system/surface/experiments/meridian"
ENTRY = ROOT / "tools/meridian-preview"
SHARED = frozenset({
    "system/surface/ui/tokens.css",
    "system/surface/ui/fonts/inter-latin-wght-normal.woff2",
    "system/surface/ui/brand/ordax-symbol.png",
    "system/surface/workspace/presentation.mjs",
})
CONTENT_TYPES = {".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml"}

class PreviewHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.serve(False)

    def do_HEAD(self):
        self.serve(True)

    def serve(self, head):
        path = unquote(urlsplit(self.path).path)
        if "\\" in path or "\x00" in path or ".." in path.split("/"):
            self.send_error(404)
            return
        relative = "tools/meridian-preview/index.html" if path == "/" else path.lstrip("/")
        requested = ROOT / relative
        allowed = relative in SHARED or relative in {"tools/meridian-preview/index.html", "tools/meridian-preview/main.mjs"}
        if not allowed:
            allowed = requested.is_relative_to(EXPERIMENT) and requested.suffix in {".mjs", ".css", ".svg"}
        if not allowed or not requested.resolve().is_relative_to(ROOT) or not requested.is_file():
            self.send_error(404)
            return
        body = requested.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(requested.suffix, mimetypes.guess_type(requested.name)[0] or "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), payment=()")
        self.end_headers()
        if not head:
            self.wfile.write(body)

if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4203)
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler) as server:
        print(f"OrdaX Meridian: http://127.0.0.1:{server.server_port}/", flush=True)
        server.serve_forever()
