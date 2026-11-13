"""Canonical Surface Buildroot contract: no second package-based producer."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
OWNER = ROOT / "bootstrap/surface-runtime"
SRC = OWNER / "source.json"
BUILD = OWNER / "build.py"
PROFILE = OWNER / "configs/ordax_surface_defconfig"
PREPARE = OWNER / "prepare_config.py"
LAUNCHER = ROOT / "system/surface/bin/ordax-surface"

class SurfaceRuntimeSourceContractTests(unittest.TestCase):
    def test_one_canonical_buildroot_source(self):
        contract=json.loads(SRC.read_text())
        self.assertEqual(contract["$schema"], "prototype-ordax.surface-runtime-source/1")
        self.assertEqual(contract["status"], "candidate-not-promotable")
        self.assertEqual(contract["buildroot_source_contract"], "bootstrap/independent-base/source.json")
        self.assertEqual(contract["kernel_source_contract"], "bootstrap/kernel/source.json")
        self.assertEqual(contract["architecture"], "x86_64")
        self.assertEqual(contract["libc"], "musl")
        self.assertTrue(contract["first_boot_offline_required"])
        self.assertFalse(contract["network_package_install_during_boot_allowed"])
        self.assertFalse(contract["package_manager_in_runtime_allowed"])
        self.assertFalse(contract["artifact"]["physical_artifact_authorized"])
        self.assertFalse(contract["artifact"]["stable_promotion_authorized"])
        self.assertFalse((ROOT/"bootstrap/independent-surface-runtime").exists())

    def test_canonical_runtime_abi_is_one_immutable_erofs(self):
        contract=json.loads(SRC.read_text())
        self.assertEqual(contract["artifact"]["name"], "native-surface-runtime.erofs")
        self.assertEqual(contract["artifact"]["filesystem"], "erofs")
        self.assertEqual(contract["artifact"]["compression"], "lz4")
        self.assertEqual(contract["artifact"]["label"], "ORDAX-SURFACE")
        required=set(contract["required_runtime_paths"])
        self.assertTrue({"usr/bin/cage","usr/bin/python3","usr/bin/Xwayland","usr/bin/pipewire","usr/bin/wireplumber","usr/lib/gstreamer-1.0/libgstlibav.so"}.issubset(required))
        forbidden=set(contract["forbidden_runtime_paths"])
        self.assertTrue({"sbin/apk","lib/apk","etc/apk","etc/alpine-release"}.issubset(forbidden))
        self.assertFalse(required & forbidden)

    def test_old_alpine_producer_and_discovery_are_absent(self):
        self.assertTrue(BUILD.is_file())
        self.assertTrue(PREPARE.is_file())
        self.assertTrue(PROFILE.is_file())
        self.assertFalse((OWNER/"discover_lock.py").exists())
        self.assertFalse((OWNER/"package_config.py").exists())
        self.assertFalse((ROOT/".github/workflows/surface-runtime-lock-discovery.yml").exists())
        build=BUILD.read_text()
        self.assertIn("mkfs.erofs",build)
        self.assertIn("verify_build_config",build)
        self.assertNotIn("alpine_core",build)
        self.assertNotIn("apk add",build)
        self.assertNotIn("proot_rootfs",build)
        launcher=LAUNCHER.read_text()
        self.assertNotIn("run_bounded_apk",launcher)
        self.assertNotIn("/sbin/apk",launcher)

    def test_stable_and_dev_use_same_canonical_builder(self):
        creator=(ROOT/".github/workflows/creator-owner-dev-git.yml").read_text()
        proof=(ROOT/".github/workflows/portable-v2-qemu-boot-proof.yml").read_text()
        surface=(ROOT/".github/workflows/independent-surface-runtime.yml").read_text()
        self.assertNotIn("bootstrap/surface-runtime/build.py build", creator)
        self.assertIn("bootstrap/surface-runtime/build.py verify", creator)
        self.assertIn("Canonical Surface EROFS missing", creator)
        self.assertIn("uses: ./.github/actions/prepare-verified-surface", proof)
        self.assertIn("independent_surface_component_cache.py verify", proof)
        self.assertNotIn("bootstrap/surface-runtime/build.py build", proof)
        self.assertIn("bootstrap/surface-runtime/build.py build",surface)
        for text in (creator,proof,surface):
            self.assertNotIn("bootstrap/independent-surface-runtime/build.py",text)
            self.assertNotIn("bootstrap/surface-runtime/discover_lock.py",text)

if __name__=="__main__":
    unittest.main()
