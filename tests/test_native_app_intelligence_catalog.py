#!/usr/bin/env python3
"""Regression tests for Native verified app intelligence manifest discovery."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE = RUNTIME / "native_app_intelligence_catalog.py"
SERVER = RUNTIME / "native_host_server.py"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "app-intelligence-manifests.mjs"

if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

spec = importlib.util.spec_from_file_location("ordax_native_app_intelligence_test", MODULE)
catalog = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = catalog
spec.loader.exec_module(catalog)


def manifest(app_id: str, version: str) -> bytes:
    return (
        json.dumps(
            {
                "schema": "ordax.app-intelligence-manifest/1",
                "appId": app_id,
                "appVersion": version,
                "authority": "none",
                "execution": "declarative-only",
                "instructions": ["Use only declared capabilities."],
                "intents": [],
            },
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")


def resolution(
    component_id: str,
    *,
    source: str = "slot",
    repository: str | None = "washingtonmsdj/ordax-apps",
    version: str | None = "0.4.1",
):
    return catalog.ComponentSlotResolution(
        component_id=component_id,
        state="current",
        source=source,
        source_repository=repository,
        revision=3,
        version=version,
        source_commit=("a" * 40) if version else None,
        entrypoint=(f"system/apps/{component_id}/src/runtime.mjs" if version else None),
        slot=(f"/var/lib/ordax/components/{component_id}/versions/{version}/" + "a" * 40) if version else None,
        pending_health=None,
    )


class NativeAppIntelligenceCatalogTests(unittest.TestCase):
    def test_discovery_requires_real_component_directory_and_activation_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            notes = root / "notes"
            notes.mkdir()
            (notes / "activation-state.json").write_text("{}\n", encoding="utf-8")

            cache_only = root / "studio"
            cache_only.mkdir()
            (cache_only / "versions").mkdir()

            (root / "not a component").mkdir()

            self.assertEqual(
                catalog.discover_active_component_candidates(str(root)),
                ("notes",),
            )

    @unittest.skipIf(os.name == "nt", "symlink semantics are platform-dependent on Windows")
    def test_discovery_rejects_symlink_component_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target"
            target.mkdir()
            (target / "activation-state.json").write_text("{}\n", encoding="utf-8")
            (root / "notes").symlink_to(target, target_is_directory=True)

            with self.assertRaisesRegex(
                catalog.NativeAppIntelligenceVerificationError,
                "may not be a symlink",
            ):
                catalog.discover_active_component_candidates(str(root))

    def test_catalog_includes_only_active_ordax_apps_slot_manifests(self):
        resolutions = {
            "internet": resolution(
                "internet",
                repository="washingtonmsdj/prototipo-ordax-os",
                version="0.6.0",
            ),
            "notes": resolution("notes", version="0.4.1"),
            "studio": resolution(
                "studio",
                source="absent",
                repository=None,
                version=None,
            ),
        }

        with mock.patch.object(
            catalog,
            "discover_active_component_candidates",
            return_value=("internet", "notes", "studio"),
        ), mock.patch.object(
            catalog,
            "resolve_component_metadata_slot",
            side_effect=lambda **kwargs: resolutions[kwargs["component_id"]],
        ), mock.patch.object(
            catalog,
            "read_component_app_intelligence_manifest",
            return_value=manifest("notes", "0.4.1"),
        ) as read:
            value = catalog.read_native_app_intelligence_manifests(
                helper_path="/signed/bin/helper",
                trust_path="/signed/trust.json",
                slot_root="/var/lib/ordax/components",
            )

        self.assertEqual(value["schema"], "ordax.native-app-intelligence-manifests/1")
        self.assertEqual([item["appId"] for item in value["manifests"]], ["notes"])
        self.assertEqual(read.call_count, 1)
        self.assertEqual(read.call_args.kwargs["component_id"], "notes")
        self.assertEqual(read.call_args.kwargs["version"], "0.4.1")

    def test_active_external_app_manifest_identity_mismatch_fails_closed(self):
        with mock.patch.object(
            catalog,
            "discover_active_component_candidates",
            return_value=("notes",),
        ), mock.patch.object(
            catalog,
            "resolve_component_metadata_slot",
            return_value=resolution("notes", version="0.4.1"),
        ), mock.patch.object(
            catalog,
            "read_component_app_intelligence_manifest",
            return_value=manifest("notes", "0.4.0"),
        ):
            with self.assertRaisesRegex(
                catalog.NativeAppIntelligenceVerificationError,
                "version does not match",
            ):
                catalog.read_native_app_intelligence_manifests(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust.json",
                    slot_root="/var/lib/ordax/components",
                )

    def test_active_external_app_missing_verified_manifest_fails_closed(self):
        with mock.patch.object(
            catalog,
            "discover_active_component_candidates",
            return_value=("notes",),
        ), mock.patch.object(
            catalog,
            "resolve_component_metadata_slot",
            return_value=resolution("notes"),
        ), mock.patch.object(
            catalog,
            "read_component_app_intelligence_manifest",
            side_effect=catalog.ComponentSlotVerificationError("missing"),
        ):
            with self.assertRaisesRegex(
                catalog.NativeAppIntelligenceVerificationError,
                "has no verified intelligence manifest",
            ):
                catalog.read_native_app_intelligence_manifests(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust.json",
                    slot_root="/var/lib/ordax/components",
                )

    def test_manifest_authority_drift_fails_closed_before_surface(self):
        payload = json.loads(manifest("notes", "0.4.1"))
        payload["authority"] = "app"
        encoded = (json.dumps(payload) + "\n").encode("utf-8")

        with mock.patch.object(
            catalog,
            "discover_active_component_candidates",
            return_value=("notes",),
        ), mock.patch.object(
            catalog,
            "resolve_component_metadata_slot",
            return_value=resolution("notes"),
        ), mock.patch.object(
            catalog,
            "read_component_app_intelligence_manifest",
            return_value=encoded,
        ):
            with self.assertRaisesRegex(
                catalog.NativeAppIntelligenceVerificationError,
                "authority boundary",
            ):
                catalog.read_native_app_intelligence_manifests(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust.json",
                    slot_root="/var/lib/ordax/components",
                )


    def test_native_host_route_is_loopback_get_only_and_query_free(self):
        server = SERVER.read_text(encoding="utf-8")
        get_section = server.split("def do_GET", 1)[1].split("def do_POST", 1)[0]
        post_section = server.split("def do_POST", 1)[1]

        self.assertIn(
            'APP_INTELLIGENCE_CATALOG_PATH = "/__ordax/native/app-intelligence-catalog"',
            server,
        )
        self.assertIn("APP_INTELLIGENCE_CATALOG_PATH", get_section)
        self.assertIn("read_native_app_intelligence_manifests(", get_section)
        self.assertIn("self.server.component_slot_lock", get_section)
        self.assertIn("self.server.component_slot_read_available", get_section)
        self.assertIn("if urlsplit(self.path).query:", get_section)
        self.assertNotIn("APP_INTELLIGENCE_CATALOG_PATH", post_section)

    def test_native_composition_injects_verified_catalog_before_profile_and_memory_layers(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")

        self.assertIn("createNativeAppIntelligenceManifestSource", composition)
        self.assertIn("createAppIntelligenceCatalogRegistry", composition)
        self.assertIn("createAppAwareIntelligence", composition)
        self.assertIn("manifests: appIntelligenceManifestSource?.getManifests() ?? []", composition)
        self.assertIn("intelligencePort: appAwareIntelligence", composition)
        self.assertIn(": appAwareIntelligence;", composition)
        self.assertIn("appIntelligenceCatalog.dispose()", composition)
        self.assertIn("appIntelligenceManifestSource?.dispose()", composition)

        app_aware_index = composition.index("const appAwareIntelligence")
        profile_index = composition.index("const consumerIntelligence")
        memory_index = composition.index("const selectedSpaceIntelligence")
        self.assertLess(app_aware_index, profile_index)
        self.assertLess(profile_index, memory_index)

        self.assertIn('const ENDPOINT = "/__ordax/native/app-intelligence-catalog"', adapter)
        self.assertIn('method: "GET"', adapter)
        self.assertIn('cache: "no-store"', adapter)
        self.assertIn('credentials: "same-origin"', adapter)
        self.assertNotIn("POST", adapter)



if __name__ == "__main__":
    unittest.main()
