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
            "system/surface/workspace/components/web/window.tsx", "package-lock.json",
            "system/surface/ui/brand/ordax-symbol.png", "system/surface/ui/tokens.css",
            "system/surface/ui/fonts/inter-latin-wght-normal.woff2",
            "system/services/i18n/surface.mjs",
            "system/contracts/app-store.mjs", "system/contracts/component-manifest.mjs",
            "system/services/local-ai/model-candidate.generated.mjs",
            "system/services/local-ai/source-lock.json",
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

    def test_remote_and_escape_references_are_rejected_by_shared_source_policy(self):
        for source in ('<script src="https://example.invalid/app.js"></script>',
                       '<script src="../../../../outside.js"></script>'):
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

    def test_web_presentation_preserves_pending_apps_and_does_not_create_authority(self):
        main = (ROOT / "system/composition/web/main.tsx").read_text(encoding="utf-8")
        model = (ROOT / "system/surface/workspace/lib/web/model.ts").read_text(encoding="utf-8")
        shell = (ROOT / "system/surface/workspace/components/web/shell.tsx").read_text(encoding="utf-8")
        for app in ("studio", "files", "internet", "image-viewer", "notes",
                    "projects", "assistant", "spaces", "settings", "store", "activity"):
            self.assertIn(f"id: '{app}'", model)
        self.assertIn("RouterProvider", main)
        self.assertIn("<Central/>", main)
        self.assertNotIn("WebShell", main)
        self.assertIn("createUnavailableAppStoreCatalogPort", main)
        central = (ROOT / "system/surface/workspace/components/central/central.tsx").read_text(encoding="utf-8")
        # Only harmless presentation preferences, never identity or app authority,
        # are allowed in the new canonical Web entry's local storage.
        for key in ("ordax-theme", "ordax-view"):
            self.assertIn(f"localStorage.getItem('{key}')", central)
            self.assertIn(f"localStorage.setItem('{key}'", central)
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
                if source.name != "central.tsx" or source.parent.name != "central":
                    self.assertNotIn("localStorage", text, str(source))


if __name__ == "__main__":
    unittest.main()
