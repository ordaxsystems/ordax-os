import copy
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROBE_PATH = ROOT / "bootstrap/windows-compat-runtime/configure_probe.py"
ENV_PATH = ROOT / "bootstrap/windows-compat-runtime/build-environment.json"

spec = importlib.util.spec_from_file_location("ordax_windows_compat_configure_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(probe)


class WindowsCompatibilityConfigureProofTests(unittest.TestCase):
    def setUp(self):
        self.environment = json.loads(ENV_PATH.read_text(encoding="utf-8"))

    def test_environment_is_discovery_only(self):
        value = probe.validate_environment(copy.deepcopy(self.environment))
        self.assertEqual(value["host"]["version"], "3.22.5")
        self.assertEqual(value["host"]["libc"], "musl")
        self.assertIn("i686-mingw-w64-gcc", value["wine_build_packages"])
        self.assertIn("mingw-w64-gcc", value["wine_build_packages"])
        self.assertIn("--enable-archs=x86_64,i386", value["configure"]["flags"])
        self.assertFalse(value["proof"]["package_versions_pinned"])
        self.assertFalse(value["proof"]["configure_proof_passed"])
        self.assertFalse(value["proof"]["full_build_proof_passed"])
        self.assertFalse(value["proof"]["activation_authorized"])
        self.assertFalse(value["proof"]["execution_authorized"])

    def test_host_hash_drift_is_rejected(self):
        value = copy.deepcopy(self.environment)
        value["host"]["rootfs_sha256"] = "0" * 64
        with self.assertRaisesRegex(probe.ConfigureProofError, "host identity drifted"):
            probe.validate_environment(value)

    def test_missing_cross_compiler_is_rejected(self):
        value = copy.deepcopy(self.environment)
        value["wine_build_packages"].remove("i686-mingw-w64-gcc")
        with self.assertRaisesRegex(probe.ConfigureProofError, "required build package missing"):
            probe.validate_environment(value)

    def test_unproven_environment_cannot_claim_configure_success(self):
        value = copy.deepcopy(self.environment)
        value["proof"]["configure_proof_passed"] = True
        with self.assertRaisesRegex(probe.ConfigureProofError, "claims readiness"):
            probe.validate_environment(value)

    def test_probe_has_no_compile_install_or_execute_entrypoint(self):
        forbidden = {"compile", "package", "install", "activate", "execute", "launch", "spawn"}
        self.assertTrue(forbidden.isdisjoint(set(vars(probe))))

    def test_foreign_source_extractor_rejects_absolute_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "foreign.tar.xz"
            destination = Path(tmp) / "out"
            with tarfile.open(archive, "w:xz") as tar:
                root = tarfile.TarInfo("wine-11.0")
                root.type = tarfile.DIRTYPE
                tar.addfile(root)
                link = tarfile.TarInfo("wine-11.0/bad-link")
                link.type = tarfile.SYMTYPE
                link.linkname = "/etc/passwd"
                tar.addfile(link)
            with self.assertRaisesRegex(probe.ConfigureProofError, "invalid foreign source archive member: (unsafe archive link|archive link escapes)"):
                probe.safe_extract_foreign_source(archive, destination, "wine-11.0")

    def test_foreign_source_extractor_rejects_parent_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "foreign.tar.xz"
            destination = Path(tmp) / "out"
            with tarfile.open(archive, "w:xz") as tar:
                root = tarfile.TarInfo("wine-11.0")
                root.type = tarfile.DIRTYPE
                tar.addfile(root)
                link = tarfile.TarInfo("wine-11.0/bad-link")
                link.type = tarfile.SYMTYPE
                link.linkname = "../../etc/passwd"
                tar.addfile(link)
            with self.assertRaisesRegex(probe.ConfigureProofError, "invalid foreign source archive member: (unsafe archive link|archive link escapes)"):
                probe.safe_extract_foreign_source(archive, destination, "wine-11.0")

    def test_foreign_source_extractor_accepts_bounded_regular_member(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "foreign.tar.xz"
            destination = Path(tmp) / "out"
            payload = b"Wine version 11.0\n"
            with tarfile.open(archive, "w:xz") as tar:
                root = tarfile.TarInfo("wine-11.0")
                root.type = tarfile.DIRTYPE
                tar.addfile(root)
                member = tarfile.TarInfo("wine-11.0/VERSION")
                member.size = len(payload)
                tar.addfile(member, io.BytesIO(payload))
            probe.safe_extract_foreign_source(archive, destination, "wine-11.0")
            self.assertEqual((destination / "wine-11.0/VERSION").read_bytes(), payload)

    def test_foreign_extractor_uses_canonical_member_policy_and_data_filter(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "foreign.tar.xz"
            dest = Path(tmp) / "out"
            with tarfile.open(archive, "w:xz") as tar:
                version = b"Wine version 11.0\n"
                root = tarfile.TarInfo("wine-11.0/VERSION")
                root.size = len(version)
                tar.addfile(root, io.BytesIO(version))
                internal = tarfile.TarInfo("wine-11.0/src/version-link")
                internal.type = tarfile.SYMTYPE
                internal.linkname = "../VERSION"
                tar.addfile(internal)
            probe.safe_extract_foreign_source(archive, dest, "wine-11.0")
            self.assertEqual((dest / "wine-11.0/src/version-link").read_bytes(), version)

    def test_foreign_extractor_rejects_hardlink_escape_before_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "foreign.tar.xz"
            dest = Path(tmp) / "out"
            with tarfile.open(archive, "w:xz") as tar:
                first = tarfile.TarInfo("wine-11.0/innocuous")
                first.size = 2
                tar.addfile(first, io.BytesIO(b"ok"))
                escaped = tarfile.TarInfo("wine-11.0/escape")
                escaped.type = tarfile.LNKTYPE
                escaped.linkname = "../etc/passwd"
                tar.addfile(escaped)
            with self.assertRaisesRegex(probe.ConfigureProofError, "archive link escapes"):
                probe.safe_extract_foreign_source(archive, dest, "wine-11.0")
            self.assertFalse((dest / "wine-11.0/innocuous").exists())

    def test_foreign_extractor_enforces_canonical_resource_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "foreign.tar.xz"
            dest = Path(tmp) / "out"
            with tarfile.open(archive, "w:xz") as tar:
                for name in ("a", "b"):
                    member = tarfile.TarInfo(f"wine-11.0/{name}")
                    member.size = 16
                    tar.addfile(member, io.BytesIO(b"x" * 16))
            original_count = probe.SOURCE.MAX_ARCHIVE_MEMBERS
            try:
                probe.SOURCE.MAX_ARCHIVE_MEMBERS = 1
                with self.assertRaisesRegex(probe.ConfigureProofError, "member count exceeded bound"):
                    probe.safe_extract_foreign_source(archive, dest, "wine-11.0")
            finally:
                probe.SOURCE.MAX_ARCHIVE_MEMBERS = original_count
            self.assertFalse((dest / "wine-11.0/a").exists())
            original_bytes = probe.SOURCE.MAX_UNPACKED_BYTES
            try:
                probe.SOURCE.MAX_UNPACKED_BYTES = 16
                with self.assertRaisesRegex(probe.ConfigureProofError, "unpacked size exceeded bound"):
                    probe.safe_extract_foreign_source(archive, dest, "wine-11.0")
            finally:
                probe.SOURCE.MAX_UNPACKED_BYTES = original_bytes
            self.assertFalse((dest / "wine-11.0/a").exists())

    def test_installed_package_versions_reads_exact_apk_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            rootfs = Path(tmp)
            database = rootfs / "lib/apk/db/installed"
            database.parent.mkdir(parents=True)
            database.write_text(
                "C:Q1example\nP:gcc\nV:14.2.0-r6\nA:x86_64\n\n"
                "C:Q1example2\nP:mingw-w64-gcc\nV:14.2.0-r1\nA:x86_64\n\n",
                encoding="utf-8",
            )
            self.assertEqual(
                probe.installed_package_versions(rootfs),
                {"gcc": "14.2.0-r6", "mingw-w64-gcc": "14.2.0-r1"},
            )

    def test_installed_package_versions_rejects_duplicate_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            rootfs = Path(tmp)
            database = rootfs / "lib/apk/db/installed"
            database.parent.mkdir(parents=True)
            database.write_text(
                "P:gcc\nV:14.2.0-r6\n\nP:gcc\nV:14.2.0-r7\n\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(probe.ConfigureProofError, "duplicate installed package identity"):
                probe.installed_package_versions(rootfs)

    def test_installed_package_versions_rejects_incomplete_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            rootfs = Path(tmp)
            database = rootfs / "lib/apk/db/installed"
            database.parent.mkdir(parents=True)
            database.write_text("P:gcc\n\n", encoding="utf-8")
            with self.assertRaisesRegex(probe.ConfigureProofError, "incomplete package identity"):
                probe.installed_package_versions(rootfs)


if __name__ == "__main__":
    unittest.main()
