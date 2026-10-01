#!/usr/bin/env python3
"""Source contract for the first OrdaX Network Surface slice."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "system" / "apps" / "catalog.mjs"
COMPONENT_CATALOG = ROOT / "system" / "apps" / "component-catalog.mjs"
APP = ROOT / "system" / "apps" / "network" / "app.mjs"
RUNTIME = ROOT / "system" / "apps" / "network" / "runtime.mjs"
UI = ROOT / "system" / "apps" / "network" / "ui" / "workspace-controls.mjs"
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"
SURFACE_I18N = ROOT / "system" / "services" / "i18n" / "surface.mjs"
WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class NetworkAppSurfaceContractTests(unittest.TestCase):
    def test_network_is_canonical_first_party_optional_component(self):
        catalog = CATALOG.read_text(encoding="utf-8")
        components = COMPONENT_CATALOG.read_text(encoding="utf-8")
        app = APP.read_text(encoding="utf-8")
        self.assertIn('import { networkApp } from "./network/app.mjs"', catalog)
        self.assertIn("networkApp,", catalog)
        self.assertIn('import { networkAppComponent } from "./network/component.mjs"', components)
        self.assertIn("networkAppComponent,", components)
        self.assertIn('id: "network"', app)
        self.assertIn('extensionId: "network-workspace"', app)
        self.assertIn('requiredCapabilities: []', app)

    def test_native_mount_uses_real_space_selection_without_fake_backend(self):
        native = NATIVE.read_text(encoding="utf-8")
        section = native.split('componentId: "network"', 1)[1].split(
            'componentId: "notes"', 1
        )[0]
        self.assertIn('import("../../apps/network/runtime.mjs")', section)
        self.assertIn("spaceSelection,", section)
        self.assertIn("networkTransport: null", section)
        self.assertIn("readOnline:", section)
        self.assertIn('reportClientDiagnostic("network-runtime"', section)
        self.assertIn("networkComponent?.destroy()", native)

    def test_workspace_exposes_sender_and_explicit_rebind_without_direct_backend_mutation(self):
        runtime = RUNTIME.read_text(encoding="utf-8")
        ui = UI.read_text(encoding="utf-8")
        self.assertIn("createNetworkDraftRuntime", runtime)
        self.assertIn("networkTransport = null", runtime)
        self.assertIn("data-network-draft-body", ui)
        self.assertIn("data-network-rebind", ui)
        self.assertIn("rebindToActiveSpace", ui)
        self.assertIn("senderSpaceId", ui)
        self.assertNotIn("fetch(", ui)

    def test_surface_localization_includes_network_app_catalog(self):
        surface = SURFACE_I18N.read_text(encoding="utf-8")
        self.assertIn("NETWORK_APP_SOURCE_MESSAGES", surface)
        self.assertIn("NETWORK_APP_ENGLISH_MESSAGES", surface)

    def test_surface_candidate_executes_network_draft_regression(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("tests/test_network_draft_runtime.mjs"), 3)
        self.assertIn(
            "node --test tests/test_network_draft_runtime.mjs",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
