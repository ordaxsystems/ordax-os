import hashlib
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
            "bootstrap/independent-base/post-image.sh": "#!/bin/sh\n",
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

    def owner_fixture(self, base: Path) -> Path:
        root = self.make_independent_root(base)
        (root / "bootstrap/kernel/config").mkdir(parents=True, exist_ok=True)
        (root / "bootstrap/kernel/build.py").write_text("kernel-build-v1\\n")
        (root / "bootstrap/kernel/verify_upstream_signature.py").write_text("kernel-auth-v1\\n")
        (root / "bootstrap/kernel/source.json").write_text(json.dumps({
            "version": "6.6.0",
            "configuration": {"fragment": "bootstrap/kernel/config/ordax.fragment"},
        }))
        (root / "bootstrap/kernel/config/ordax.fragment").write_text("CONFIG_TEST=y\\n")
        (root / "docs/contracts/kernel-build-environment.json").write_text('{"env":"v1"}\\n')
        for relative in CACHE.COMPONENTS["independent-base-owner"]["inputs"]:
            target = root / relative
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(f"fixture:{relative}\\n", encoding="utf-8")
        return root

    def owner_artifacts(self, out: Path, *, profile="owner-development") -> Path:
        out.mkdir(parents=True)
        names = ("rootfs.tar", "rootfs.cpio.gz", "independent-base.erofs")
        declared = {}
        for name in names:
            payload = f"verified:{name}".encode()
            (out / name).write_bytes(payload)
            declared[name] = hashlib.sha256(payload).hexdigest()
        (out / "provenance.json").write_text(json.dumps({
            "$schema": "prototype-ordax.independent-base-provenance/1",
            "source_commit": "1" * 40,
            "status": "candidate-build-only",
            "profile": profile,
            "owner_development_capabilities_verified": True,
            "physical_artifact_authorized": False,
            "signed_release_equivalence_proven": False,
            "artifacts": declared,
        }) + "\n", encoding="utf-8")
        return out

    def test_owner_base_cache_reuses_across_commits_without_rewriting_provenance(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.owner_fixture(temp / "repo")
            out = self.owner_artifacts(temp / "out")
            first = CACHE.component_fingerprint("independent-base-owner", root)
            minimal = CACHE.component_fingerprint("independent-base", root)
            self.assertNotEqual(first, minimal)
            CACHE.record_component("independent-base-owner", out, "1" * 40, root)
            original = (out / "provenance.json").read_bytes()
            receipt = CACHE.verify_component(
                "independent-base-owner", out, "2" * 40,
                temp / "reuse.json", cache_hit=True, root=root,
            )
            self.assertTrue(receipt["reused"])
            self.assertEqual(receipt["build_source_commit"], "1" * 40)
            self.assertEqual(receipt["integration_source_commit"], "2" * 40)
            self.assertEqual((out / "provenance.json").read_bytes(), original)
            # Verification or documentation alone cannot force rebuilding.
            (root / "bootstrap/independent-base/README.md").write_text("updated\\n")
            self.assertEqual(first, CACHE.component_fingerprint("independent-base-owner", root))
            # Installed Dev helpers and the exact kernel config MUST invalidate.
            (root / "bootstrap/dev-base/ordax-pull").write_text("changed\\n")
            self.assertNotEqual(first, CACHE.component_fingerprint("independent-base-owner", root))
            with self.assertRaisesRegex(CACHE.CacheError, "input fingerprint mismatch"):
                CACHE.verify_component(
                    "independent-base-owner", out, "2" * 40,
                    temp / "reuse.json", cache_hit=True, root=root,
                )

    def test_owner_base_cache_rejects_tampering_and_wrong_profile(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.owner_fixture(temp / "repo")
            out = self.owner_artifacts(temp / "out")
            CACHE.record_component("independent-base-owner", out, "1" * 40, root)
            (out / "rootfs.tar").write_bytes(b"tampered")
            with self.assertRaisesRegex(CACHE.CacheError, "provenance artifact mismatch"):
                CACHE.verify_component(
                    "independent-base-owner", out, "2" * 40,
                    temp / "receipt.json", cache_hit=True, root=root,
                )
            wrong = self.owner_artifacts(temp / "other", profile="minimal")
            with self.assertRaisesRegex(CACHE.CacheError, "profile or promotion policy mismatch"):
                CACHE.record_component("independent-base-owner", wrong, "1" * 40, root)

    def test_owner_base_kernel_module_input_invalidates_fingerprint(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.owner_fixture(Path(td))
            initial = CACHE.component_fingerprint("independent-base-owner", root)
            fragment = root / "bootstrap/kernel/config/ordax.fragment"
            fragment.write_text("CONFIG_TEST=n\\n", encoding="utf-8")
            self.assertNotEqual(initial, CACHE.component_fingerprint("independent-base-owner", root))

    def test_independent_base_post_image_change_invalidates_cache(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_independent_root(Path(td))
            initial = CACHE.component_fingerprint("independent-base", root)
            (root / "bootstrap/independent-base/post-image.sh").write_text(
                "#!/bin/sh\\necho changed\\n", encoding="utf-8"
            )
            self.assertNotEqual(initial, CACHE.component_fingerprint("independent-base", root))

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

    def test_surface_has_only_one_canonical_buildroot_cache_owner(self):
        # Portable/QEMU must consume the independent Surface component receipt.
        # It must not hash identical Surface sources with a second cache owner.
        self.assertNotIn("surface", CACHE.COMPONENTS)
        self.assertIn("independent-base", CACHE.COMPONENTS)
        self.assertIn("local-ai", CACHE.COMPONENTS)

    def test_local_ai_cache_tracks_exact_external_builder_revision(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for relative in CACHE.COMPONENTS["local-ai"]["inputs"]:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("pinned-v1\\n", encoding="utf-8")
            # The component cache resolves the OS-owned model license text.
            # Keep this fixture's existing runtime policy structurally valid.
            source_lock = root / "system/services/local-ai/source-lock.json"
            source_lock.write_text(json.dumps({
                "model": {"license_text_path": "third_party/licenses/Apache-2.0.txt"},
            }), encoding="utf-8")
            license_file = root / "third_party/licenses/Apache-2.0.txt"
            license_file.parent.mkdir(parents=True, exist_ok=True)
            license_file.write_text("reviewed license fixture\\n", encoding="utf-8")
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
