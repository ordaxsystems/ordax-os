import copy
import io
import hashlib
import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "bootstrap/windows-compat-runtime/build.py"
SOURCE_PATH = ROOT / "bootstrap/windows-compat-runtime/source.json"

spec = importlib.util.spec_from_file_location("ordax_windows_compat_runtime_builder", BUILDER_PATH)
builder = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(builder)


class WindowsCompatibilityRuntimeSourceTests(unittest.TestCase):
    def setUp(self):
        self.source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))

    def test_source_lock_is_fail_closed_and_non_activating(self):
        validated = builder.validate_source(copy.deepcopy(self.source))
        self.assertEqual(validated["engine"], "wine")
        self.assertEqual(validated["version"], "11.0")
        self.assertEqual(validated["build_intent"]["configure_flag"], "--enable-archs=x86_64,i386")
        self.assertFalse(validated["build_intent"]["build_recipe_validated"])
        self.assertFalse(validated["build_intent"]["binary_artifact_pinned"])
        self.assertFalse(validated["distribution"]["stable_base_inclusion_allowed"])
        self.assertFalse(validated["distribution"]["stable_mvp_activation_allowed"])
        self.assertFalse(validated["security"]["source_proof_grants_execution"])
        self.assertEqual(validated["security"]["host_authority"], "none")

    def test_source_identity_drift_is_rejected(self):
        tampered = copy.deepcopy(self.source)
        tampered["upstream"]["archive_sha256"] = "0" * 64
        with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "upstream identity drifted"):
            builder.validate_source(tampered)

    def test_unproven_build_cannot_be_marked_validated(self):
        tampered = copy.deepcopy(self.source)
        tampered["build_intent"]["build_recipe_validated"] = True
        with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "build intent drifted"):
            builder.validate_source(tampered)

    def test_stable_activation_cannot_be_enabled_by_contract_edit(self):
        tampered = copy.deepcopy(self.source)
        tampered["distribution"]["stable_mvp_activation_allowed"] = True
        with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "distribution safety policy drifted"):
            builder.validate_source(tampered)

    def test_archive_validator_rejects_unpinned_bytes_before_tar_parsing(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate = Path(tmp) / "wine-11.0.tar.xz"
            candidate.write_bytes(b"not-wine")
            with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "cached archive size changed"):
                builder.validate_archive(self.source, candidate)

    def make_synthetic_archive(self, directory: Path, *, extra_links=(), version_kind="regular", duplicate_version=False):
        archive = directory / "wine-11.0.tar.xz"
        with tarfile.open(archive, "w:xz") as tar:
            for index in range(1000):
                entry = tarfile.TarInfo(f"wine-11.0/src/filler-{index}")
                entry.size = 0
                tar.addfile(entry)
            version = tarfile.TarInfo("wine-11.0/VERSION")
            if version_kind == "symlink":
                version.type = tarfile.SYMTYPE
                version.linkname = "src/filler-0"
                tar.addfile(version)
            else:
                content = b"Wine version 11.0\n"
                version.size = len(content)
                tar.addfile(version, io.BytesIO(content))
            if duplicate_version:
                tar.addfile(version, io.BytesIO(content) if version_kind == "regular" else None)
            for name, kind, target in extra_links:
                member = tarfile.TarInfo(f"wine-11.0/{name}")
                member.type = tarfile.SYMTYPE if kind == "symlink" else tarfile.LNKTYPE
                member.linkname = target
                tar.addfile(member)
        source = copy.deepcopy(self.source)
        source["upstream"]["archive_size_bytes"] = archive.stat().st_size
        source["upstream"]["archive_sha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
        return source, archive

    def test_archive_links_remain_inside_pinned_source_root(self):
        for case, links in [
            ("safe-relative-symlink", [("src/safe", "symlink", "../VERSION")]),
            ("safe-root-hardlink", [("src/safe", "hardlink", "wine-11.0/VERSION")]),
        ]:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as tmp:
                source, archive = self.make_synthetic_archive(Path(tmp), extra_links=links)
                proof = builder.validate_archive(source, archive)
                self.assertTrue(proof["archive_link_targets_root_bounded"])
                self.assertGreaterEqual(proof["archive_member_count"], 1000)

        for case, links in [
            ("absolute-symlink", [("src/escape", "symlink", "/etc/passwd")]),
            ("traversal-symlink", [("src/escape", "symlink", "../../../etc/passwd")]),
            ("traversal-hardlink", [("src/escape", "hardlink", "../etc/passwd")]),
            ("wrong-root-hardlink", [("src/escape", "hardlink", "outside/VERSION")]),
        ]:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as tmp:
                source, archive = self.make_synthetic_archive(Path(tmp), extra_links=links)
                with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "unsafe archive link|archive link escapes"):
                    builder.validate_archive(source, archive)

    def test_archive_version_identity_cannot_be_redirected_or_duplicated(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, archive = self.make_synthetic_archive(Path(tmp), version_kind="symlink")
            with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "bounded regular file"):
                builder.validate_archive(source, archive)
        with tempfile.TemporaryDirectory() as tmp:
            source, archive = self.make_synthetic_archive(Path(tmp), duplicate_version=True)
            with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "duplicate Wine VERSION"):
                builder.validate_archive(source, archive)

    def test_archive_member_and_unpacked_size_limits_are_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, archive = self.make_synthetic_archive(Path(tmp))
            original = builder.MAX_ARCHIVE_MEMBERS
            try:
                builder.MAX_ARCHIVE_MEMBERS = 500
                with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "member count exceeded"):
                    builder.validate_archive(source, archive)
            finally:
                builder.MAX_ARCHIVE_MEMBERS = original
            original = builder.MAX_UNPACKED_BYTES
            try:
                builder.MAX_UNPACKED_BYTES = 8
                with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "unpacked size exceeded"):
                    builder.validate_archive(source, archive)
            finally:
                builder.MAX_UNPACKED_BYTES = original

    def test_builder_exposes_no_runtime_install_or_execute_operation(self):
        forbidden = {"install", "activate", "execute", "launch", "spawn", "run_wine"}
        self.assertTrue(forbidden.isdisjoint(set(vars(builder))))


if __name__ == "__main__":
    unittest.main()
