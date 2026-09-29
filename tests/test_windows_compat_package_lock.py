import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
PROBE_PATH = ROOT / "bootstrap/windows-compat-runtime/package_lock_probe.py"
SOURCE_PATH = ROOT / "bootstrap/windows-compat-runtime/source.json"
ENV_PATH = ROOT / "bootstrap/windows-compat-runtime/build-environment.json"

spec = importlib.util.spec_from_file_location("ordax_windows_compat_package_lock_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(probe)


class WindowsCompatibilityPackageLockTests(unittest.TestCase):
    def configure_proof(self):
        source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
        environment = json.loads(ENV_PATH.read_text(encoding="utf-8"))
        declared = environment["base_build_packages"] + environment["wine_build_packages"]
        requested = {name: "1-r0" for name in declared}
        installed = {"alpine-baselayout": "3.7.0-r0", **requested}
        return {
            "$schema": "prototype-ordax.windows-compat-configure-proof/1",
            "runtime_id": source["runtime_id"],
            "wine_version": source["version"],
            "host": environment["host"],
            "native_compiler_triplet": "x86_64-alpine-linux-musl",
            "toolchain": {
                "gcc": "gcc (Alpine 14.2.0) 14.2.0",
                "x86_64_mingw_gcc": "x86_64-w64-mingw32-gcc (GCC) 14.2.0",
                "i686_mingw_gcc": "i686-w64-mingw32-gcc (GCC) 14.2.0",
            },
            "resolved_build_packages": requested,
            "resolved_installed_packages": installed,
            "configure_flags": ["--prefix=/usr", "--enable-archs=x86_64,i386"],
            "configure_proof_passed": True,
            "package_versions_pinned": False,
            "full_build_proof_passed": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
        }

    def test_environment_declares_exact_alpine_repositories(self):
        environment = probe.validated_environment()
        self.assertEqual(tuple(environment["repositories"]), probe.EXPECTED_REPOSITORIES)

    def test_configure_proof_must_remain_non_activating(self):
        value = self.configure_proof()
        value["activation_authorized"] = True
        with self.assertRaisesRegex(probe.PackageLockError, "overclaims readiness"):
            probe.validate_configure_proof(value)

    def test_configure_proof_requested_package_must_match_installed_graph(self):
        value = self.configure_proof()
        value["resolved_installed_packages"]["build-base"] = "2-r0"
        with self.assertRaisesRegex(probe.PackageLockError, "requested package identity"):
            probe.validate_configure_proof(value)

    def test_configure_proof_must_contain_every_declared_build_package(self):
        value = self.configure_proof()
        value["resolved_build_packages"].pop("build-base")
        with self.assertRaisesRegex(probe.PackageLockError, "diverged from declaration"):
            probe.validate_configure_proof(value)

    def test_configure_proof_rejects_undeclared_build_package(self):
        value = self.configure_proof()
        value["resolved_build_packages"]["surprise-package"] = "1-r0"
        value["resolved_installed_packages"]["surprise-package"] = "1-r0"
        with self.assertRaisesRegex(probe.PackageLockError, "diverged from declaration"):
            probe.validate_configure_proof(value)

    def test_declared_build_package_count_is_exact(self):
        value = probe.validate_configure_proof(self.configure_proof())
        self.assertEqual(len(value["resolved_build_packages"]), 39)

    def test_changed_packages_tracks_added_and_upgraded_only(self):
        pristine = {"busybox": "1.37.0-r20", "libgcc": "14.2.0-r5"}
        resolved = {
            "busybox": "1.37.0-r20",
            "libgcc": "14.2.0-r6",
            "gcc": "14.2.0-r6",
        }
        self.assertEqual(
            probe.changed_packages(pristine, resolved),
            {"gcc": "14.2.0-r6", "libgcc": "14.2.0-r6"},
        )

    def test_changed_packages_rejects_base_removal(self):
        with self.assertRaisesRegex(probe.PackageLockError, "removed pinned base packages"):
            probe.changed_packages({"busybox": "1.37.0-r20"}, {"gcc": "14.2.0-r6"})

    def test_repository_index_refresh_preserves_installed_graph(self):
        with tempfile.TemporaryDirectory() as tmp:
            rootfs = Path(tmp)
            graph = {"busybox": "1.37.0-r20", "apk-tools": "2.14.10-r0"}
            with mock.patch.object(probe.CONFIGURE, "installed_package_versions", side_effect=[graph, dict(graph)]), mock.patch.object(
                probe.CONFIGURE, "proot"
            ) as proot:
                probe.refresh_repository_indexes(rootfs)
            proot.assert_called_once_with(rootfs, "apk update")

    def test_repository_index_refresh_rejects_installed_graph_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            rootfs = Path(tmp)
            before = {"busybox": "1.37.0-r20"}
            after = {"busybox": "1.37.0-r21"}
            with mock.patch.object(probe.CONFIGURE, "installed_package_versions", side_effect=[before, after]), mock.patch.object(
                probe.CONFIGURE, "proot"
            ):
                with self.assertRaisesRegex(probe.PackageLockError, "mutated installed package graph"):
                    probe.refresh_repository_indexes(rootfs)

    def test_expected_archive_names_bind_already_resolved_versions(self):
        expected = probe.expected_archive_names({"gcc": "14.2.0-r6", "build-base": "0.5-r3"})
        self.assertEqual(
            expected,
            {
                "gcc-14.2.0-r6.apk": ("gcc", "14.2.0-r6"),
                "build-base-0.5-r3.apk": ("build-base", "0.5-r3"),
            },
        )
        self.assertNotIn("gcc-14.2.0-r7.apk", expected)

    def test_package_set_digest_is_order_sensitive_to_canonical_records(self):
        records = [
            {"name": "a", "version": "1-r0", "sha256": "1" * 64, "size_bytes": 10},
            {"name": "b", "version": "2-r0", "sha256": "2" * 64, "size_bytes": 20},
        ]
        digest = probe.package_set_digest(records)
        self.assertRegex(digest, r"^[0-9a-f]{64}$")
        self.assertNotEqual(digest, probe.package_set_digest(list(reversed(records))))

    def test_candidate_manifest_never_authorizes_build_or_execution(self):
        proof = self.configure_proof()
        archives = [{
            "name": "build-base",
            "version": "1-r0",
            "filename": "build-base-1-r0.apk",
            "size_bytes": 12,
            "sha256": "a" * 64,
        }]
        manifest = probe.build_candidate_manifest(
            proof,
            {"alpine-baselayout": "3.7.0-r0"},
            {"build-base": "1-r0"},
            archives,
            "b" * 64,
        )
        self.assertEqual(tuple(manifest["repositories"]), probe.EXPECTED_REPOSITORIES)
        self.assertEqual(manifest["repository_index_status"], "mutable-discovery-input-not-build-authority")
        self.assertTrue(manifest["trust"]["alpine_apk_verify_passed"])
        self.assertTrue(manifest["promotion"]["package_archive_bytes_pinned"])
        self.assertFalse(manifest["promotion"]["committed_lock"])
        self.assertFalse(manifest["promotion"]["full_build_proof_passed"])
        self.assertFalse(manifest["promotion"]["activation_authorized"])
        self.assertFalse(manifest["promotion"]["execution_authorized"])

    def test_candidate_manifest_rejects_archive_identity_mismatch(self):
        proof = self.configure_proof()
        archives = [{
            "name": "other",
            "version": "1-r0",
            "filename": "other-1-r0.apk",
            "size_bytes": 12,
            "sha256": "a" * 64,
        }]
        with self.assertRaisesRegex(probe.PackageLockError, "archive identities"):
            probe.build_candidate_manifest(
                proof,
                {"alpine-baselayout": "3.7.0-r0"},
                {"build-base": "1-r0"},
                archives,
                "b" * 64,
            )

    def test_package_map_rejects_unsafe_version(self):
        with self.assertRaisesRegex(probe.PackageLockError, "unsafe package version"):
            probe.validate_package_map({"gcc": "14.2.0-r6;rm"}, "test")

    def test_probe_has_no_compile_or_runtime_activation_entrypoint(self):
        forbidden = {"compile", "install_runtime", "activate", "execute", "launch", "spawn"}
        self.assertTrue(forbidden.isdisjoint(set(vars(probe))))


if __name__ == "__main__":
    unittest.main()
