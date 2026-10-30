from pathlib import Path
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]
BRANDING = ROOT / "docs" / "contracts" / "branding.json"
COVERAGE = ROOT / "docs" / "contracts" / "device-update-coverage.json"
BOOT_SCREEN = ROOT / "system" / "surface" / "ui" / "boot-screen.mjs"
BOOT_CSS = ROOT / "system" / "surface" / "ui" / "boot-screen.css"
WEB_HTML = ROOT / "system" / "composition" / "web" / "index.html"
NATIVE_HTML = ROOT / "system" / "composition" / "native" / "index.html"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.tsx"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
KERNEL = ROOT / "bootstrap" / "kernel" / "config" / "ordax.fragment"


class SurfaceBootScreenTests(unittest.TestCase):
    def test_branding_contract_distinguishes_surface_loading_from_early_splash(self):
        branding = json.loads(BRANDING.read_text(encoding="utf-8"))
        coverage = json.loads(COVERAGE.read_text(encoding="utf-8"))

        self.assertEqual(branding["$schema"], "prototype-ordax.branding/1")
        self.assertTrue(branding["surface_loading"]["implemented"])
        self.assertEqual(
            branding["surface_loading"]["delivery"],
            "runtime-git-checkout",
        )
        self.assertFalse(
            branding["surface_loading"]["usb_rewrite_required"]
        )
        self.assertFalse(
            branding["early_boot"]["graphical_splash_implemented"]
        )
        self.assertTrue(
            branding["failure_policy"]["branding_must_not_block_boot"]
        )

        self.assertTrue(coverage["branding"]["surface_loading_implemented"])
        self.assertFalse(coverage["branding"]["graphical_boot_splash_implemented"])
        self.assertTrue(coverage["branding"]["branding_source_must_remain_repository_owned"])

    def test_both_compositions_render_loading_before_javascript_mount(self):
        for path in (WEB_HTML, NATIVE_HTML):
            html = path.read_text(encoding="utf-8")
            if path == NATIVE_HTML:
                self.assertIn('href="../../surface/ui/boot-screen.css"', html)
                self.assertNotIn('data-ready-gate=', html)
            else:
                self.assertIn("../../surface/ui/boot-screen.css", WEB_MAIN.read_text(encoding="utf-8"))
                self.assertNotIn('data-ready-gate="next-stage"', html)
            self.assertIn('id="ordax-boot-screen"', html)
            self.assertIn('data-ordax-boot-status', html)
            self.assertIn('data-ordax-boot-status>OrdaX</span>', html)
            self.assertRegex(
                html,
                r'<html\b[^>]*\blang="und"[^>]*>' if path == NATIVE_HTML else r'<html\b[^>]*\blang="pt-BR"[^>]*>',
            )
            self.assertLess(
                html.index('id="ordax-boot-screen"'),
                html.index('id="ordax-root"'),
            )
            self.assertLess(
                html.index('id="ordax-boot-screen"'),
                html.index('src="./main.mjs"' if path == NATIVE_HTML else 'src="./main.tsx"'),
            )

    def test_loading_controller_reveals_ready_shell_without_legacy_wait(self):
        controller = BOOT_SCREEN.read_text(encoding="utf-8")
        css = BOOT_CSS.read_text(encoding="utf-8")

        self.assertIn("createSurfaceBootScreen", controller)
        self.assertIn("setStage", controller)
        self.assertIn("ready()", controller)
        self.assertIn("fail(", controller)
        self.assertNotIn("READY_GATE_NEXT_STAGE", controller)
        self.assertNotIn("readyPending", controller)
        self.assertNotIn("queueMicrotask", controller)
        self.assertNotIn("ready-pending", controller)
        self.assertIn('element.hidden = true', controller)
        self.assertIn('element.hidden = false', controller)
        self.assertIn('element.dataset.state = "error"', controller)
        self.assertIn(".ordax-boot-screen", css)
        self.assertIn(".ordax-boot-spinner", css)
        self.assertIn("prefers-reduced-motion", css)

    def test_native_reveals_home_or_first_run_only_after_that_initial_ui_is_ready(self):
        source = NATIVE_MAIN.read_text(encoding="utf-8")
        self.assertIn("createSurfaceBootScreen", source)
        self.assertIn('"surface.boot.loadingSurface"', source)
        self.assertIn("translateSurfaceMessage", source)
        self.assertEqual(source.count("bootScreen.ready()"), 1)
        self.assertEqual(source.count("revealInitialSurface();"), 2)
        self.assertIn("initialFirstRunState.completed", source)
        self.assertIn('"surface.boot.failed"', source)
        self.assertNotIn('componentId: "notes"', source)
        self.assertNotIn('componentId: "internet"', source)

        completed_branch = source.index("if (initialFirstRunState.completed)")
        completed_home_ready = source.index("revealInitialSurface();", completed_branch)
        healthy = source.index("void updateWatcher.markHealthy()")
        store = source.index("storeCatalogComposition = await storeCatalogCompositionPromise")
        first_run_mount = source.index("mountFirstRunExperience(root")
        first_run_ready = source.index("revealInitialSurface();", first_run_mount)
        external_apps = source.index("const externalAppMounts = await")

        self.assertNotIn('bootScreen.setStage(surface.localization.translate("surface.boot.preparingFirstRun"))', source)
        self.assertLess(healthy, completed_home_ready)
        self.assertLess(completed_home_ready, store)
        self.assertLess(healthy, store)
        self.assertLess(store, first_run_mount)
        self.assertLess(first_run_mount, first_run_ready)
        self.assertLess(first_run_ready, external_apps)

    def test_web_finishes_boot_after_workspace_mount_and_uses_shared_failure_copy(self):
        source = WEB_MAIN.read_text(encoding="utf-8")
        self.assertIn("createSurfaceBootScreen", source)
        self.assertIn("useEffect(() => { boot.ready(); }, [])", source)
        self.assertIn("boot.fail", source)
        self.assertIn("surface.boot.failed", source)
        self.assertIn("RouterProvider", source)
        self.assertIn("StoreCatalogProvider", source)
        self.assertIn("createUnavailableAppStoreCatalogPort", source)
        self.assertRegex(source, r"<Central(?:\s|/>)")
        self.assertNotIn("WebShell", source)

    def test_kernel_keeps_framebuffer_capability_for_future_early_graphics(self):
        config = KERNEL.read_text(encoding="utf-8")
        self.assertIn("CONFIG_FB=y", config)
        self.assertIn("CONFIG_FB_EFI=y", config)
        self.assertIn("CONFIG_DRM_SIMPLEDRM=y", config)
        self.assertIn("CONFIG_FRAMEBUFFER_CONSOLE=y", config)


if __name__ == "__main__":
    unittest.main()
