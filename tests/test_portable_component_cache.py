import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "ci" / "portable_component_cache.py"
SPEC = importlib.util.spec_from_file_location("portable_component_cache", MODULE_PATH)
assert SPEC and SPEC.loader
CACHE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CACHE)


class PortableComponentCacheTests(unittest.TestCase):
    def setUp(self):
        self.old_environment = os.environ.get("ORDAX_COMPONENT_CACHE_ENVIRONMENT")
        os.environ["ORDAX_COMPONENT_CACHE_ENVIRONMENT"] = "unit-test/linux-x86_64/image-v1"

    def tearDown(self):
        if self.old_environment is None:
            os.environ.pop("ORDAX_COMPONENT_CACHE_ENVIRONMENT", None)
        else:
            os.environ["ORDAX_COMPONENT_CACHE_ENVIRONMENT"] = self.old_environment

    def make_kernel_root(self, base: Path) -> Path:
        (base / "bootstrap/kernel/config").mkdir(parents=True)
        (base / "bootstrap/kernel/candidates").mkdir(parents=True)
        (base / "docs/contracts").mkdir(parents=True)
        (base / "bootstrap/kernel/build.py").write_text("build-v1\n", encoding="utf-8")
        (base / "bootstrap/kernel/verify_upstream_signature.py").write_text("auth-v1\n", encoding="utf-8")
        (base / "bootstrap/kernel/source.json").write_text(
            json.dumps(
                {
                    "version": "1",
                    "configuration": {"fragment": "bootstrap/kernel/config/ordax.fragment"},
                }
            )
            + "\n",
            encoding="utf-8",
        )
        (base / "bootstrap/kernel/config/ordax.fragment").write_text("CONFIG_TEST=y\n", encoding="utf-8")
        (base / "docs/contracts/kernel-build-environment.json").write_text('{"env":"v1"}\n', encoding="utf-8")
        (base / "bootstrap/kernel/candidates/ignored.json").write_text("ignored-v1\n", encoding="utf-8")
        (base / "bootstrap/kernel/verify.py").write_text("verify-v1\n", encoding="utf-8")
        (base / "bootstrap/kernel/PROVENANCE.md").write_text("docs-v1\n", encoding="utf-8")
        return base

    def make_independent_root(self, base: Path) -> Path:
        files = {
            "bootstrap/independent-base/build.py": "build-v1\n",
            "bootstrap/independent-base/source.json": '{"buildroot":"v1"}\n',
            "bootstrap/independent-base/Config.in": "config ORDAX\n",
            "bootstrap/independent-base/external.desc": "name: ORDAX_MINIMAL\n",
            "bootstrap/independent-base/external.mk": "# external\n",
            "bootstrap/independent-base/configs/ordax_minimal_defconfig": "BR2_INIT_NONE=y\n",
            "bootstrap/independent-base/configs/portable-handoff.busybox.fragment": "CONFIG_TIMEOUT=y\n",
            "bootstrap/independent-base/overlay/sbin/ordax-independent-probe-init": "#!/bin/sh\n",
            "bootstrap/independent-base/patches/iproute2/7.1.0/0001.patch": "patch-v1\n",
            "bootstrap/independent-base/post-build.sh": "#!/bin/sh\n",
            "bootstrap/kernel/source.json": '{"version":"6.6.0"}\n',
            "bootstrap/stable-base/source.json": '{"rootfs":{"format":"erofs"}}\n',
            "bootstrap/network/source.json": '{"network":"v1"}\n',
            "bootstrap/network/bring-up": "#!/bin/sh\n",
            "bootstrap/network/udhcpc.script": "#!/bin/sh\n",
            "docs/contracts/portable-boot-handoff.json": '{"handoff":"v1"}\n',
        }
        for relative, content in files.items():
            path = base / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        (base / "bootstrap/independent-base/README.md").write_text("docs-v1\n", encoding="utf-8")
        (base / "bootstrap/independent-base/qemu_proof.py").write_text("proof-v1\n", encoding="utf-8")
        return base

    def test_fingerprint_tracks_only_build_affecting_kernel_inputs(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_kernel_root(Path(td))
            first = CACHE.component_fingerprint("kernel", root)
            self.assertRegex(first, r"^[0-9a-f]{64}$")

            (root / "bootstrap/kernel/candidates/ignored.json").write_text("ignored-v2\n", encoding="utf-8")
            (root / "bootstrap/kernel/verify.py").write_text("verify-v2\n", encoding="utf-8")
            (root / "bootstrap/kernel/PROVENANCE.md").write_text("docs-v2\n", encoding="utf-8")
            self.assertEqual(first, CACHE.component_fingerprint("kernel", root))

            (root / "bootstrap/kernel/config/ordax.fragment").write_text("CONFIG_TEST=n\n", encoding="utf-8")
            self.assertNotEqual(first, CACHE.component_fingerprint("kernel", root))

    def test_independent_base_fingerprint_tracks_build_inputs_not_proof_docs(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_independent_root(Path(td))
            first = CACHE.component_fingerprint("independent-base", root)
            self.assertRegex(first, r"^[0-9a-f]{64}$")

            (root / "bootstrap/independent-base/README.md").write_text("docs-v2\n", encoding="utf-8")
            (root / "bootstrap/independent-base/qemu_proof.py").write_text("proof-v2\n", encoding="utf-8")
            self.assertEqual(first, CACHE.component_fingerprint("independent-base", root))

            (root / "bootstrap/network/bring-up").write_text("#!/bin/sh\necho changed\n", encoding="utf-8")
            self.assertNotEqual(first, CACHE.component_fingerprint("independent-base", root))

    def test_independent_base_cache_keeps_original_provenance_on_reuse(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_independent_root(temp / "repo")
            out = temp / "out"
            out.mkdir()
            (out / "independent-base.erofs").write_bytes(b"rootfs-bytes")
            provenance = out / "provenance.json"
            provenance.write_text(json.dumps({"source_commit": "1" * 40}) + "\n", encoding="utf-8")

            CACHE.record_component("independent-base", out, "1" * 40, root)
            before = provenance.read_bytes()
            receipt = CACHE.verify_component(
                "independent-base",
                out,
                "2" * 40,
                temp / "independent-reuse.json",
                cache_hit=True,
                root=root,
            )
            self.assertTrue(receipt["reused"])
            self.assertEqual(receipt["component"], "independent-base")
            self.assertEqual(provenance.read_bytes(), before)

    def test_surface_cache_invalidates_for_package_selection_and_decoder_probe(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for relative in CACHE.COMPONENTS["surface"]["inputs"]:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("input-v1\n")
            initial = CACHE.component_fingerprint("surface", root)
            for relative in (
                "bootstrap/surface-runtime/package_config.py",
                "system/surface/runtime/packages.txt",
                "system/surface/runtime/media_runtime_probe.py",
            ):
                with self.subTest(input=relative):
                    path = root / relative
                    path.write_text("input-v2\n")
                    self.assertNotEqual(initial, CACHE.component_fingerprint("surface", root))
                    path.write_text("input-v1\n")
                    self.assertEqual(initial, CACHE.component_fingerprint("surface", root))

    def test_local_ai_cache_tracks_exact_external_builder_revision(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for relative in CACHE.COMPONENTS["local-ai"]["inputs"]:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("pinned-v1\\n", encoding="utf-8")
            lock = root / "docs/contracts/intelligence-source.json"
            first = CACHE.component_fingerprint("local-ai", root)
            lock.write_text("pinned-v2\\n", encoding="utf-8")
            self.assertNotEqual(first, CACHE.component_fingerprint("local-ai", root))
            lock.write_text("pinned-v1\\n", encoding="utf-8")
            self.assertEqual(first, CACHE.component_fingerprint("local-ai", root))
            action = root / ".github/actions/resolve-intelligence-builder/action.yml"
            action.write_text("different resolver\\n", encoding="utf-8")
            self.assertNotEqual(first, CACHE.component_fingerprint("local-ai", root))

    def test_runner_environment_is_part_of_fingerprint(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_kernel_root(Path(td))
            first = CACHE.component_fingerprint("kernel", root)
            os.environ["ORDAX_COMPONENT_CACHE_ENVIRONMENT"] = "unit-test/linux-x86_64/image-v2"
            self.assertNotEqual(first, CACHE.component_fingerprint("kernel", root))

    def test_record_and_reuse_preserve_original_provenance(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_kernel_root(temp / "repo")
            out = temp / "out"
            out.mkdir()
            artifact = out / "vmlinuz-test"
            provenance = out / "kernel-provenance.json"
            artifact.write_bytes(b"kernel-bytes")
            provenance.write_text(json.dumps({"source_commit": "1" * 40}) + "\n", encoding="utf-8")

            manifest = CACHE.record_component("kernel", out, "1" * 40, root)
            self.assertEqual(manifest["build_source_commit"], "1" * 40)
            original_provenance = provenance.read_bytes()

            receipt = CACHE.verify_component(
                "kernel",
                out,
                "2" * 40,
                temp / "receipt.json",
                cache_hit=True,
                root=root,
            )
            self.assertTrue(receipt["reused"])
            self.assertEqual(receipt["build_source_commit"], "1" * 40)
            self.assertEqual(receipt["integration_source_commit"], "2" * 40)
            self.assertFalse(receipt["provenance_rewritten"])
            self.assertEqual(provenance.read_bytes(), original_provenance)

    def test_fresh_build_must_match_exact_integration_commit(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_kernel_root(temp / "repo")
            out = temp / "out"
            out.mkdir()
            (out / "artifact.bin").write_bytes(b"payload")
            (out / "kernel-provenance.json").write_text(json.dumps({"source_commit": "1" * 40}) + "\n", encoding="utf-8")
            CACHE.record_component("kernel", out, "1" * 40, root)
            with self.assertRaisesRegex(CACHE.CacheError, "exact integration commit"):
                CACHE.verify_component(
                    "kernel",
                    out,
                    "2" * 40,
                    temp / "receipt.json",
                    cache_hit=False,
                    root=root,
                )

    def test_tampered_cached_artifact_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_kernel_root(temp / "repo")
            out = temp / "out"
            out.mkdir()
            artifact = out / "artifact.bin"
            artifact.write_bytes(b"trusted")
            (out / "kernel-provenance.json").write_text(json.dumps({"source_commit": "1" * 40}) + "\n", encoding="utf-8")
            CACHE.record_component("kernel", out, "1" * 40, root)
            artifact.write_bytes(b"tampered")
            with self.assertRaisesRegex(CACHE.CacheError, "bytes changed"):
                CACHE.verify_component(
                    "kernel",
                    out,
                    "2" * 40,
                    temp / "receipt.json",
                    cache_hit=True,
                    root=root,
                )

    def test_record_rejects_stale_component_provenance(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_kernel_root(temp / "repo")
            out = temp / "out"
            out.mkdir()
            (out / "artifact.bin").write_bytes(b"payload")
            (out / "kernel-provenance.json").write_text(
                json.dumps({"source_commit": "0" * 40}) + "\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(CACHE.CacheError, "exact source commit"):
                CACHE.record_component("kernel", out, "1" * 40, root)
    def test_direct_symlink_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_kernel_root(temp / "repo")
            target = temp / "foreign.py"
            target.write_text("foreign\n", encoding="utf-8")
            build = root / "bootstrap/kernel/build.py"
            build.unlink()
            try:
                build.symlink_to(target)
            except (OSError, NotImplementedError):
                self.skipTest("symlink creation unavailable on this platform")
            with self.assertRaisesRegex(CACHE.CacheError, "symlink"):
                CACHE.component_fingerprint("kernel", root)


if __name__ == "__main__":
    unittest.main()
