import importlib.util
from pathlib import Path, PurePosixPath
from unittest.mock import patch
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ordax_web_builder", ROOT / "tools/surface-web/build.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SurfaceWebBuilderTests(unittest.TestCase):
    def test_canonical_inputs_have_one_composition_lock_and_brand(self):
        graph = {str(path) for path in MODULE.discover_graph(ROOT)}
        for expected in (
            "system/composition/web/main.tsx", "system/surface/workspace/components/web/shell.tsx",
            "tools/surface-web/dependency-styles.mjs",
            "system/surface/workspace/components/web/window.tsx", "package-lock.json",
            "system/surface/ui/brand/ordax-symbol.png", "system/surface/ui/tokens.css",
            "system/surface/ui/fonts/inter-latin-wght-normal.woff2",
            "system/services/i18n/surface.mjs",
            "system/contracts/app-store.mjs", "system/contracts/component-manifest.mjs",
            "system/services/local-ai/model-candidate.generated.mjs",
            "system/services/local-ai/source-lock.json",
            "system/surface/ui/notification-center-controls.mjs",
            "system/surface/ui/notification-center.css",
            "system/contracts/notifications.mjs",
        ):
            self.assertIn(expected, graph)
        self.assertFalse((ROOT / "tools/web2-preview").exists())
        self.assertFalse((ROOT / "system/composition/web/main.mjs").exists())
        self.assertFalse((ROOT / "tools/surface-web/package-lock.json").exists())
        self.assertFalse((ROOT / "system/surface/workspace/assets/ordax-mark.png").exists())

    def test_local_source_graph_discovers_multiline_import_and_component_asset(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {
                "system/composition/test/index.html": '<script type="module" src="./main.mjs"></script>',
                "system/composition/test/main.mjs": 'import {\n value,\n} from "../../components/demo/runtime.mjs";',
                "system/components/demo/runtime.mjs": 'export const value = new URL("./demo.css", import.meta.url).href;',
                "system/components/demo/demo.css": ".demo {display:block}",
            }
            for name, text in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
            graph = MODULE.discover_source_graph(root, PurePosixPath("system/composition/test/index.html"), allowed_prefixes=("system",))
            self.assertIn(PurePosixPath("system/components/demo/demo.css"), graph)

    def test_shared_graph_tracks_commonjs_require_resolve_and_spaced_dynamic_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {
                "system/components/demo/entry.cjs": (
                    'const helper = require ("./helper.cjs");\\n'
                    'const meta = require.resolve("./meta.json");\\n'
                    'const module = import ("./extension.mjs");\\n'
                ),
                "system/components/demo/helper.cjs": "exports.ok = true;",
                "system/components/demo/meta.json": '{"schema":1}',
                "system/components/demo/extension.mjs": "export default true;",
            }
            for name, text in files.items():
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(text, encoding="utf-8")
            graph = MODULE.discover_source_graph(
                root, PurePosixPath("system/components/demo/entry.cjs"),
                allowed_prefixes=("system",),
            )
            self.assertEqual({path.as_posix() for path in graph}, set(files))
            (root / "system/components/demo/helper.cjs").unlink()
            with self.assertRaisesRegex(MODULE.SourceGraphError, "missing source dependency"):
                MODULE.discover_source_graph(
                    root, PurePosixPath("system/components/demo/entry.cjs"),
                    allowed_prefixes=("system",),
                )

    def test_html_responsive_images_are_in_self_contained_graph(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            entry = root / "system/composition/test/index.html"
            entry.parent.mkdir(parents=True)
            entry.write_text(
                '<picture><source srcset="./small.webp 1x, ./large.webp 2x">'
                '<img src="./small.webp"></picture>'
                '<link rel="preload" imagesrcset="./medium.webp 640w, ./large.webp 1280w">',
                encoding="utf-8",
            )
            for name in ("small.webp", "medium.webp", "large.webp"):
                (entry.parent / name).write_bytes(b"img")
            graph = MODULE.discover_source_graph(
                root, PurePosixPath("system/composition/test/index.html"),
                allowed_prefixes=("system",),
            )
            self.assertEqual(
                {path.as_posix() for path in graph},
                {
                    "system/composition/test/index.html",
                    "system/composition/test/small.webp",
                    "system/composition/test/medium.webp",
                    "system/composition/test/large.webp",
                },
            )

    def test_remote_and_escape_references_are_rejected_by_shared_source_policy(self):
        for source in ('<script src="https://example.invalid/app.js"></script>',
                       '<script src="../../../../outside.js"></script>',
                       '<img srcset="./local.webp 1x, https://example.invalid/remote.webp 2x">',
                       '<source srcset="data:image/png;base64,AAAA 1x, ./local.webp 2x">',
                       '<link imagesrcset="./local.webp 1x, ../../../../outside.webp 2x">'):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                entry = root / "system/composition/test/index.html"
                entry.parent.mkdir(parents=True)
                entry.write_text(source, encoding="utf-8")
                with self.assertRaises(MODULE.SourceGraphError):
                    MODULE.discover_source_graph(root, PurePosixPath("system/composition/test/index.html"), allowed_prefixes=("system",))

    def test_receipt_is_reproducible_and_detects_corruption(self):
        # Vite itself is built twice by the candidate CI; this test isolates receipt integrity.
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            compiled = base / "compiled"
            (compiled / "assets").mkdir(parents=True)
            (compiled / "index.html").write_text('<script src="./assets/app.js"></script>', encoding="utf-8")
            (compiled / "assets/app.js").write_text('console.log("candidate");', encoding="utf-8")
            with patch.object(MODULE, "compile_frontend", return_value=compiled):
                first = MODULE.build_bundle(base / "a", "1" * 40)
                second = MODULE.build_bundle(base / "b", "1" * 40)
            self.assertEqual(first, second)
            self.assertTrue(first["framework_runtime_dependency"])
            self.assertFalse(first["remote_runtime_dependencies"])
            self.assertFalse(first["node_required_at_client"])
            self.assertIn("package-lock.json", {item["path"] for item in first["source_inputs"]})
            MODULE.verify_bundle(base / "a")
            MODULE.verify_bundle(base / "b")
            (base / "a/assets/app.js").write_text("tampered", encoding="utf-8")
            with self.assertRaises(MODULE.BundleError):
                MODULE.verify_bundle(base / "a")

    def test_nonempty_output_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "bundle"
            out.mkdir()
            marker = out / "keep.txt"
            marker.write_text("keep", encoding="utf-8")
            with self.assertRaises(MODULE.BundleError):
                MODULE.build_bundle(out, "2" * 40)
            self.assertEqual(marker.read_text(encoding="utf-8"), "keep")

    def test_router_base_matches_vite_asset_base_for_relocatable_web_build(self):
        entry = (ROOT / "system/composition/web/main.tsx").read_text(encoding="utf-8")
        config = (ROOT / "tools/surface-web/vite.config.ts").read_text(encoding="utf-8")
        self.assertIn("base: './'", config)
        self.assertIn("const sourceCompositionBasepath = '/system/composition/web/';", entry)
        self.assertIn("const webBasepath = import.meta.env.BASE_URL === './'", entry)
        self.assertIn("window.location.pathname.startsWith(sourceCompositionBasepath)", entry)
        self.assertIn("? sourceCompositionBasepath", entry)
        self.assertIn(": import.meta.env.BASE_URL;", entry)
        self.assertIn("basepath: webBasepath", entry)
        self.assertNotIn("basepath: '/'", entry)
        # Vite's --base flag is the single build-time authority for both
        # static assets and the TanStack router mount path.

    def test_browser_smoke_serves_404_without_writing_success_headers_first(self):
        source = (ROOT / "tools/surface-web/browser-smoke.mjs").read_text(encoding="utf-8")
        self.assertIn("const bytes = await readFile(path);", source)
        self.assertLess(
            source.index("const bytes = await readFile(path);"),
            source.index("response.writeHead(200,"),
        )
        self.assertIn("if (!response.headersSent)", source)
        self.assertIn("response.writeHead(404);", source)

    def test_web_presentation_preserves_pending_apps_and_does_not_create_authority(self):
        main = (ROOT / "system/composition/web/main.tsx").read_text(encoding="utf-8")
        model = (ROOT / "system/surface/workspace/lib/web/model.ts").read_text(encoding="utf-8")
        shell = (ROOT / "system/surface/workspace/components/web/shell.tsx").read_text(encoding="utf-8")
        for app in ("studio", "files", "internet", "image-viewer", "notes",
                    "projects", "assistant", "spaces", "settings", "store", "activity"):
            self.assertIn(f"id: '{app}'", model)
        self.assertIn("RouterProvider", main)
        self.assertRegex(main, r"<Central(?:\s|/>)")
        self.assertNotIn("WebShell", main)
        self.assertIn("createUnavailableAppStoreCatalogPort", main)
        central = (ROOT / "system/surface/workspace/components/central/central.tsx").read_text(encoding="utf-8")
        # Preferences are composed once from the public service and Web adapter;
        # neither Central nor another Surface module owns browser storage.
        self.assertIn("useWebPreferences", central)
        self.assertNotIn("localStorage", central)
        self.assertIn("createPreferenceRuntime(createWebPreferenceStore(window))", main)
        self.assertIn("<WebPreferencesProvider port={preferences}>", main)
        self.assertNotIn("localStorage", main)
        self.assertIn('href="/conta/"', shell)
        self.assertIn('href="/"', shell)
        self.assertIn("Spaces não conectados", shell)
        for field in ("intelligence", "fileSpace", "projects", "spaces", "lifecycle", "sync"):
            self.assertIn(f"{field}: 'unavailable'", model)
        for path in (ROOT / "system/composition/web", ROOT / "system/surface/workspace"):
            for source in path.rglob("*"):
                if source.suffix not in (".ts", ".tsx", ".mjs"):
                    continue
                text = source.read_text(encoding="utf-8")
                for forbidden in ("adapters/native", "/__ordax/native/",
                                  "sessionStorage", "/auth/logout", "process.env",
                                  "node:child_process", "node:fs"):
                    self.assertNotIn(forbidden, text, str(source))
                self.assertNotIn("localStorage", text, str(source))


if __name__ == "__main__":
    unittest.main()
