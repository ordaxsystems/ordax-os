import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = ROOT / "platform" / "compliance" / "declared-inputs.json"
KERNEL_SOURCE = ROOT / "bootstrap" / "kernel" / "source.json"
DEV_BUILD = ROOT / "bootstrap" / "dev-base" / "build.py"
STABLE_SOURCE = ROOT / "bootstrap" / "stable-base" / "source.json"
INDEPENDENT_SOURCE = ROOT / "bootstrap" / "independent-base" / "source.json"
INDEPENDENT_DEFCONFIG = ROOT / "bootstrap" / "independent-base" / "configs" / "ordax_minimal_defconfig"
SURFACE = ROOT / "system" / "surface" / "bin" / "ordax-surface"


class ThirdPartyInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
        cls.by_id = {item["id"]: item for item in cls.inventory["inputs"]}

    def test_inventory_is_explicitly_not_a_release_sbom(self):
        self.assertEqual(self.inventory["status"], "declared-inputs-not-sbom")
        self.assertFalse(self.inventory["limitations"]["full_transitive_dependency_inventory"])
        self.assertFalse(self.inventory["limitations"]["final_shipped_bytes_inventory"])
        self.assertFalse(self.inventory["limitations"]["usable_as_release_sbom"])

    def test_kernel_input_matches_canonical_source_file(self):
        source = json.loads(KERNEL_SOURCE.read_text(encoding="utf-8"))
        item = self.by_id["linux-kernel"]
        self.assertEqual(item["source_authority"], "bootstrap/kernel/source.json")
        self.assertEqual(source["$schema"], "prototype-ordax.kernel-source/1")
        self.assertRegex(source["version"], r"^[0-9]+[.][0-9]+[.][0-9]+$")
        self.assertRegex(source["archive_sha256"], r"^[0-9a-f]{64}$")
        for duplicated in ("version", "archive_url", "archive_sha256"):
            self.assertNotIn(duplicated, item)

    def test_alpine_inputs_are_retired_without_removing_buildroot_or_wine(self):
        self.assertNotIn("alpine-development-base", self.by_id)
        self.assertNotIn("alpine-stable-mvp-base", self.by_id)
        source = json.loads(STABLE_SOURCE.read_text(encoding="utf-8"))
        self.assertNotIn("alpine", source)
        self.assertNotIn("apk_package_lock", source)
        self.assertEqual(source["base_producer"]["profile"], "stable-mvp")
        self.assertEqual(source["base_producer"]["entrypoint"], "bootstrap/independent-base/build.py")
        self.assertIn("independent-buildroot-base-candidate", self.by_id)
        self.assertIn("wine-windows-compat-runtime-source-candidate", self.by_id)

    def test_independent_base_input_matches_pinned_buildroot_profile(self):
        source = json.loads(INDEPENDENT_SOURCE.read_text(encoding="utf-8"))
        profile = INDEPENDENT_DEFCONFIG.read_text(encoding="utf-8")
        item = self.by_id["independent-buildroot-base-candidate"]

        self.assertEqual(
            item["source_authority"],
            "bootstrap/independent-base/source.json",
        )
        self.assertEqual(source["$schema"], "prototype-ordax.independent-base-experiment/1")
        self.assertEqual(source["status"], "experimental-not-promotable")
        self.assertRegex(source["buildroot"]["version"], r"^[0-9]{4}[.][0-9]{2}$")
        self.assertRegex(source["buildroot"]["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(source["build_profile"], "ordax_minimal_defconfig")
        self.assertTrue(source["candidate_only"])
        self.assertFalse(source["physical_artifact_authorized"])
        self.assertFalse(source["stable_channel_authorized"])
        self.assertEqual(item["promotion_status"], source["status"])
        self.assertEqual(
            item["delivery_scope"],
            ["independent-base-experimental-candidate"],
        )
        self.assertIn("BR2_PACKAGE_IPROUTE2=y", profile)
        self.assertIn(
            'BR2_GLOBAL_PATCH_DIR="$(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/patches"',
            profile,
        )
        for duplicated in ("version", "url", "sha256", "packages"):
            self.assertNotIn(duplicated, item)

    def test_native_surface_runtime_matches_canonical_buildroot_source(self):
        item = self.by_id["buildroot-native-surface-runtime"]
        self.assertEqual(item["kind"], "immutable-runtime-erofs")
        self.assertEqual(item["source_authority"], "bootstrap/surface-runtime/source.json")
        self.assertNotIn("packages", item)
        self.assertNotIn("branch", item)
        source = json.loads((ROOT / item["source_authority"]).read_text(encoding="utf-8"))
        profile = (ROOT / "bootstrap/surface-runtime/configs/ordax_surface_defconfig").read_text()
        self.assertEqual(source["$schema"], "prototype-ordax.surface-runtime-source/1")
        self.assertEqual(item["promotion_status"], source["status"])
        self.assertEqual(source["libc"], "musl")
        self.assertFalse(source["package_manager_in_runtime_allowed"])
        self.assertEqual(source["buildroot_source_contract"], "bootstrap/independent-base/source.json")
        self.assertEqual(source["artifact"]["name"], "native-surface-runtime.erofs")
        self.assertFalse(source["artifact"]["physical_artifact_authorized"])
        self.assertFalse(source["artifact"]["stable_promotion_authorized"])
        self.assertIn("BR2_PACKAGE_WEBKITGTK=y", profile)
        self.assertIn("BR2_PACKAGE_CAGE=y", profile)
        self.assertIn("BR2_PACKAGE_PIPEWIRE=y", profile)
        self.assertIn("BR2_PACKAGE_GST1_LIBAV=y", profile)
        self.assertTrue({
            "usr/bin/cage", "usr/bin/pipewire", "usr/lib/gstreamer-1.0/libgstlibav.so",
        }.issubset(source["required_runtime_paths"]))
        text = SURFACE.read_text(encoding="utf-8")
        self.assertNotIn("runtime_packages() {", text)
        self.assertNotIn("packages=$(runtime_packages)", text)
        self.assertNotIn("/sbin/apk", text)
        self.assertIn("VERIFIED_RUNTIME_MODE", text)

    def test_unresolved_license_records_do_not_invent_spdx_ids(self):
        for item in self.inventory["inputs"]:
            with self.subTest(component=item["id"]):
                license_info = item["license"]
                self.assertEqual(license_info["status"], "unresolved-in-this-inventory")
                self.assertIsNone(license_info["spdx"])


if __name__ == "__main__":
    unittest.main()
