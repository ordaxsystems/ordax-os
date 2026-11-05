import importlib.util
import hashlib
import subprocess
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/ci/independent_surface_component_cache.py"
WORKFLOW = ROOT / ".github/workflows/independent-surface-runtime.yml"
R2_SCRIPT = ROOT / "tools/ci/independent_surface_r2.sh"


def load_module():
    name = "independent_surface_component_cache"
    spec = importlib.util.spec_from_file_location(name, SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class IndependentSurfaceComponentCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def setUp(self):
        self.old_env = os.environ.get("ORDAX_COMPONENT_CACHE_ENVIRONMENT")
        os.environ["ORDAX_COMPONENT_CACHE_ENVIRONMENT"] = "Linux/X64/ubuntu24/image-v1"

    def tearDown(self):
        if self.old_env is None:
            os.environ.pop("ORDAX_COMPONENT_CACHE_ENVIRONMENT", None)
        else:
            os.environ["ORDAX_COMPONENT_CACHE_ENVIRONMENT"] = self.old_env

    def make_root(self, base: Path) -> Path:
        for relative in self.mod.INPUTS:
            path = base / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(relative + "\n", encoding="utf-8")
        return base

    def make_output(self, base: Path, commit: str) -> Path:
        base.mkdir(parents=True)
        (base / "native-surface-runtime.erofs").write_bytes(b"erofs-bytes")
        (base / "provenance.json").write_text(json.dumps({
            "$schema": "prototype-ordax.surface-runtime-provenance/1",
            "source_commit": commit,
        }) + "\n", encoding="utf-8")
        return base

    def test_runner_cache_environment_requires_complete_image_identity(self):
        # A GitHub env.ImageOS/env.ImageVersion expression is empty unless
        # declared in the env context; shell ImageOS/ImageVersion are correct.
        invalid = (
            "Linux/X64//",
            "Linux/X64/ubuntu24/",
            "Linux/X64/ubuntu24",
            "Linux//ubuntu24/20261023.334.3",
            "Linux/X64//20261023.334.3",
        )
        for value in invalid:
            with self.subTest(value=value), self.assertRaisesRegex(
                self.mod.CacheError, "incomplete runner image identity"
            ):
                self.mod.validated_environment(value)
        self.assertEqual(
            self.mod.validated_environment("Linux/X64/ubuntu24/20261023.334.3"),
            "Linux/X64/ubuntu24/20261023.334.3",
        )

    def test_ci_rejects_non_runner_cache_environment_even_when_nonempty(self):
        # An environment bypassed the old Linux/X64// guard by declaring a
        # non-runner prefix. CI must never record or accept that identity.
        invalid = ("local-unpinned", "test/linux-x86_64/image-v1", "Other/X64/ubuntu24/version")
        for value in invalid:
            with self.subTest(value=value), mock.patch.dict(os.environ, {
                "GITHUB_ACTIONS": "true",
                "ORDAX_COMPONENT_CACHE_ENVIRONMENT": value,
            }), self.assertRaisesRegex(self.mod.CacheError, "incomplete runner image identity"):
                self.mod.environment()
        with mock.patch.dict(os.environ, {
            "GITHUB_ACTIONS": "true",
            "ORDAX_COMPONENT_CACHE_ENVIRONMENT": "Linux/X64/ubuntu24/20261023.334.3",
        }):
            self.assertEqual(
                self.mod.environment(), "Linux/X64/ubuntu24/20261023.334.3"
            )

    def test_pinned_persistent_surface_producer_identity_is_shared_across_runners(self):
        # A standalone producer can have its own image while QEMU/Creator use
        # GitHub-hosted runner versions. Consumers verify provenance and bytes
        # independently rather than pretending their runner built the EROFS.
        with mock.patch.dict(os.environ, {
            "RUNNER_OS": "Linux",
            "RUNNER_ARCH": "X64",
            "GITHUB_ACTIONS": "true",
            "ORDAX_COMPONENT_CACHE_ENVIRONMENT": "Linux/X64/ubuntu24/20261023.334.3",
            "ORDAX_SURFACE_PRODUCER_ENVIRONMENT": "Linux/X64/ordax-builder/v1",
        }):
            self.assertEqual(self.mod.environment(), "Linux/X64/ordax-builder/v1")
            with mock.patch.dict(os.environ, {
                "ORDAX_SURFACE_PRODUCER_ENVIRONMENT": "Windows/X64/ordax-builder/v1"
            }), self.assertRaisesRegex(self.mod.CacheError, "OS/architecture"):
                self.mod.environment()
            with mock.patch.dict(os.environ, {
                "ORDAX_SURFACE_PRODUCER_ENVIRONMENT": "Linux/X64//"
            }), self.assertRaisesRegex(self.mod.CacheError, "incomplete runner image"):
                self.mod.environment()

    def test_fingerprint_tracks_only_build_inputs(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_root(Path(td) / "repo")
            first = self.mod.fingerprint(root)
            (root / "README.md").write_text("docs\n", encoding="utf-8")
            self.assertEqual(first, self.mod.fingerprint(root))
            target = root / self.mod.INPUTS[0]
            target.write_text("changed\n", encoding="utf-8")
            self.assertNotEqual(first, self.mod.fingerprint(root))

    def test_reuse_preserves_original_provenance_and_binds_new_commit(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            out = self.make_output(temp / "out", "1" * 40)
            self.mod.record(out, "1" * 40, root)
            original = (out / "provenance.json").read_bytes()
            receipt = self.mod.verify(
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
            self.assertEqual((out / "provenance.json").read_bytes(), original)

    def test_linked_artifact_directory_fails_closed_before_resolve(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            actual = self.make_output(temp / "real-artifacts", "1" * 40)
            self.mod.record(actual, "1" * 40, root)
            manifest = (actual / self.mod.MANIFEST).read_bytes()
            alias = temp / "linked-artifacts"
            if os.name == "nt":
                # Directory junctions do not need Windows developer-mode
                # symlink privileges but redirect resolve() just the same.
                linked = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(alias), str(actual)],
                    capture_output=True, text=True,
                )
                self.assertEqual(linked.returncode, 0, linked.stderr)
                self.assertTrue(alias.is_junction())
            else:
                alias.symlink_to(actual, target_is_directory=True)
                self.assertTrue(alias.is_symlink())
            with self.assertRaisesRegex(self.mod.CacheError, "output directory is missing or unsafe"):
                self.mod.record(alias, "1" * 40, root)
            receipt = temp / "receipt.json"
            with self.assertRaisesRegex(self.mod.CacheError, "output directory is missing or unsafe"):
                self.mod.verify(
                    alias, "2" * 40, receipt, cache_hit=True, root=root
                )
            self.assertEqual((actual / self.mod.MANIFEST).read_bytes(), manifest)
            self.assertFalse(receipt.exists())

    def test_linked_parent_cannot_redirect_artifact_or_receipt(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            parent = temp / "real-parent"
            out = self.make_output(parent / "out", "1" * 40)
            self.mod.record(out, "1" * 40, root)
            linked_parent = temp / "linked-parent"
            if os.name == "nt":
                link = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(linked_parent), str(parent)],
                    capture_output=True, text=True,
                )
                self.assertEqual(link.returncode, 0, link.stderr)
                self.assertTrue(linked_parent.is_junction())
            else:
                linked_parent.symlink_to(parent, target_is_directory=True)
                self.assertTrue(linked_parent.is_symlink())
            with self.assertRaisesRegex(self.mod.CacheError, "output directory is missing or unsafe"):
                self.mod.verify(
                    linked_parent / "out", "2" * 40, temp / "blocked.json",
                    cache_hit=True, root=root,
                )
            receipt = linked_parent / "receipt.json"
            with self.assertRaisesRegex(self.mod.CacheError, "receipt destination is unsafe"):
                self.mod.verify(
                    out, "2" * 40, receipt, cache_hit=True, root=root,
                )
            self.assertFalse((parent / "receipt.json").exists())
            self.assertFalse((temp / "blocked.json").exists())

    @unittest.skipIf(os.name == "nt", "symlink creation needs Windows developer mode")
    def test_linked_receipt_cannot_overwrite_external_file(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            out = self.make_output(temp / "out", "1" * 40)
            self.mod.record(out, "1" * 40, root)
            outside = temp / "external.txt"
            outside.write_text("preserve-me\n", encoding="utf-8")
            linked = temp / "receipt-link.json"
            linked.symlink_to(outside)
            with self.assertRaisesRegex(self.mod.CacheError, "receipt destination is unsafe"):
                self.mod.verify(
                    out, "2" * 40, linked, cache_hit=True, root=root
                )
            self.assertEqual(outside.read_text(encoding="utf-8"), "preserve-me\n")

    def test_fresh_build_must_match_current_commit(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            out = self.make_output(temp / "out", "1" * 40)
            self.mod.record(out, "1" * 40, root)
            with self.assertRaisesRegex(self.mod.CacheError, "integration commit"):
                self.mod.verify(
                    out,
                    "2" * 40,
                    temp / "receipt.json",
                    cache_hit=False,
                    root=root,
                )

    def test_consumer_verifies_build_environment_without_requiring_same_runner(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            out = self.make_output(temp / "out", "1" * 40)
            self.mod.record(out, "1" * 40, root)
            os.environ["ORDAX_COMPONENT_CACHE_ENVIRONMENT"] = "Linux/X64/ubuntu24/image-v2"
            with self.assertRaisesRegex(self.mod.CacheError, "execution environment changed"):
                self.mod.verify(
                    out,
                    "2" * 40,
                    temp / "strict.json",
                    cache_hit=True,
                    root=root,
                )
            receipt = self.mod.verify(
                out,
                "2" * 40,
                temp / "consumer.json",
                cache_hit=True,
                consumer=True,
                root=root,
            )
            self.assertTrue(receipt["consumer_verification"])
            self.assertEqual(receipt["execution_environment"], "Linux/X64/ubuntu24/image-v1")
            self.assertEqual(receipt["verification_environment"], "Linux/X64/ubuntu24/image-v2")

    def test_retired_materialized_fingerprint_is_rejected_without_rewrite(self):
        # A rendered Kconfig must never substitute for the checked-in source
        # fingerprint. Cache misses require the canonical producer, not a
        # historical alternate hash of mutable build outputs.
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            out = self.make_output(temp / "out", "1" * 40)
            self.mod.record(out, "1" * 40, root)
            manifest_path = out / self.mod.MANIFEST
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["input_fingerprint"] = "f" * 64
            manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
            original = manifest_path.read_bytes()
            receipt = temp / "receipt.json"
            with self.assertRaisesRegex(self.mod.CacheError, "build inputs changed"):
                self.mod.verify(
                    out,
                    "2" * 40,
                    receipt,
                    cache_hit=True,
                    root=root,
                )
            self.assertEqual(manifest_path.read_bytes(), original)
            self.assertFalse(receipt.exists())
            self.assertFalse(hasattr(self.mod, "legacy_materialized_fingerprint"))

    def test_tampering_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            root = self.make_root(temp / "repo")
            out = self.make_output(temp / "out", "1" * 40)
            self.mod.record(out, "1" * 40, root)
            (out / "native-surface-runtime.erofs").write_bytes(b"tampered")
            with self.assertRaisesRegex(self.mod.CacheError, "bytes changed"):
                self.mod.verify(
                    out,
                    "2" * 40,
                    temp / "receipt.json",
                    cache_hit=True,
                    root=root,
                )

    def test_workflow_uses_one_durable_content_addressed_surface_store(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        script = R2_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("ORDAX_R2_BUCKET: 'ordax-device-artifacts'", workflow)
        self.assertIn("prefix='ci/surface-runtime/v1'", script)
        self.assertIn("/manifests/${ORDAX_SURFACE_FINGERPRINT}.json", script)
        self.assertIn("/blobs/sha256/${digest}", script)
        self.assertNotIn("r2.dev", script)

    def test_durable_surface_miss_fails_before_host_dependency_install(self):
        # Hosted workers must never enter a costly build without a resumable
        # producer. The failure is authoritative, not an upload-artifact error.
        workflow = WORKFLOW.read_text(encoding="utf-8")
        fingerprint = workflow.index("      - name: Resolve exact Surface artifact fingerprint")
        cache = workflow.index("      - name: Restore verified Independent Surface EROFS component")
        r2 = workflow.index("      - name: Restore verified Independent Surface EROFS from durable R2 store")
        guard = workflow.index("      - name: Require persistent producer on verified Surface artifact miss")
        install = workflow.index("      - name: Install Surface verification dependencies")
        build = workflow.index("      - name: Build Buildroot/musl Surface runtime on durable artifact miss")
        self.assertLess(fingerprint, cache)
        self.assertLess(cache, r2)
        self.assertLess(r2, guard)
        self.assertLess(guard, install)
        self.assertLess(install, build)
        guard_block = workflow[guard:install]
        self.assertIn("steps.surface-artifact-cache.outputs.cache-hit != 'true'", guard_block)
        self.assertIn("steps.surface-r2.outputs.hit != 'true'", guard_block)
        self.assertIn("ORDAX_SURFACE_PERSISTENT_WORK_ROOT", guard_block)
        self.assertIn("exit 1", guard_block)
        evidence = workflow[workflow.index("      - name: Upload candidate evidence"):]
        self.assertIn(
            "if: always() && steps.surface-reuse-state.outputs.source != ''",
            evidence.split("      - name: Create manual-only", 1)[0],
        )

    def test_durable_cache_root_rejects_runner_temp_descendants(self):
        # A nested path under RUNNER_TEMP is disposable even when absolute.
        # Accepting it as "persistent" discards build state across jobs.
        workflow = WORKFLOW.read_text(encoding="utf-8")
        resolver = workflow.split(
            "      - name: Resolve exact Surface artifact fingerprint", 1
        )[1].split("      - name: Restore verified Independent Surface", 1)[0]
        self.assertIn(
            '/|"$RUNNER_TEMP"|"$RUNNER_TEMP"/*|"$GITHUB_WORKSPACE"|"$GITHUB_WORKSPACE"/*)',
            resolver,
        )
        self.assertIn('cache_root="$(realpath -m -- "$ORDAX_SURFACE_PERSISTENT_WORK_ROOT")"', resolver)
        self.assertIn("Surface persistent cache must be outside workspace and runner temp", resolver)
        self.assertIn('if [ -L "$ORDAX_SURFACE_PERSISTENT_WORK_ROOT" ]; then', resolver)

    def test_workflow_keeps_github_cache_fast_but_r2_durable(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Restore verified Independent Surface EROFS component", workflow)
        self.assertIn("Restore verified Independent Surface EROFS from durable R2 store", workflow)
        self.assertIn("Save verified Independent Surface EROFS component in fast GitHub cache", workflow)
        self.assertIn("Ensure verified Surface exists in durable R2 store", workflow)
        self.assertIn("if: steps.surface-reuse-state.outputs.source != 'r2'", workflow)
        self.assertIn("artifact_reused: ${{ steps.surface-reuse-state.outputs.reused }}", workflow)
        self.assertIn("if: needs.buildroot-surface.result == 'success'", workflow)
        self.assertIn("Restore immutable Surface source defconfig before cache identity record", workflow)
        self.assertIn("git checkout -- bootstrap/surface-runtime/configs/ordax_surface_defconfig", workflow)
        self.assertIn("include-hidden-files: true", workflow)

    def test_expensive_surface_build_requires_both_fast_and_durable_miss(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        marker = "      - name: Build Buildroot/musl Surface runtime on durable artifact miss\n"
        start = workflow.index(marker)
        end = workflow.find("\n      - name: ", start + len(marker))
        block = workflow[start:end]
        self.assertIn("steps.surface-artifact-cache.outputs.cache-hit != 'true'", block)
        self.assertIn("steps.surface-r2.outputs.hit != 'true'", block)

    @unittest.skipIf(os.name == "nt", "R2 Bash curl mocks require POSIX execution")
    def test_r2_publish_rejects_corrupt_manifest_or_blobs_before_any_network_write(self):
        # Offline, mocked network: a bad manifest must not poison the immutable
        # content-addressed namespace even if a caller bypasses the producer.
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            out = temp / "ordax-independent-surface"
            out.mkdir()
            payloads = {
                "provenance.json": b'{"source_commit":"test"}',
                "native-surface-runtime.erofs": b"verified-image",
            }
            for name, data in payloads.items():
                (out / name).write_bytes(data)
            good = {
                "$schema": self.mod.SCHEMA,
                "fingerprint_version": self.mod.FINGERPRINT_VERSION,
                "input_fingerprint": "a" * 64,
                "artifacts": {
                    name: {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
                    for name, data in payloads.items()
                },
            }
            bin_dir = temp / "bin"
            bin_dir.mkdir()
            curl_log = temp / "curl-called"
            fake_curl = bin_dir / "curl"
            fake_curl.write_text(
                '''#!/bin/sh
echo called >> "$SURFACE_MOCK_CURL_LOG"
printf 404
''',
                encoding="utf-8",
            )
            fake_curl.chmod(0o755)
            env = dict(os.environ, **{
                "RUNNER_TEMP": str(temp),
                "ORDAX_R2_ACCOUNT_ID": "0" * 32,
                "ORDAX_R2_BUCKET": "test-bucket",
                "ORDAX_R2_ACCESS_KEY_ID": "test-only",
                "ORDAX_R2_SECRET_ACCESS_KEY": "test-only",
                "ORDAX_SURFACE_FINGERPRINT": "a" * 64,
                "SURFACE_MOCK_CURL_LOG": str(curl_log),
                "PATH": str(bin_dir) + os.pathsep + os.environ.get("PATH", ""),
            })
            variants = {
                "broken-schema": {"$schema": "wrong"},
                "wrong-fingerprint": {"input_fingerprint": "b" * 64},
                "bad-digest": {"artifacts": {
                    **good["artifacts"],
                    "provenance.json": {"sha256": "z" * 64, "size": len(payloads["provenance.json"])},
                }},
                "missing-artifact": {"artifacts": {
                    "provenance.json": good["artifacts"]["provenance.json"],
                }},
                "changed-bytes": {},
            }
            for case, fields in variants.items():
                with self.subTest(case=case):
                    manifest = dict(good, **fields)
                    (out / self.mod.MANIFEST).write_text(json.dumps(manifest), encoding="utf-8")
                    if case == "changed-bytes":
                        (out / "native-surface-runtime.erofs").write_bytes(b"tampered-image")
                    else:
                        (out / "native-surface-runtime.erofs").write_bytes(payloads["native-surface-runtime.erofs"])
                    curl_log.unlink(missing_ok=True)
                    proc = subprocess.run(
                        ["bash", str(R2_SCRIPT), "publish"],
                        cwd=ROOT, env=env, text=True, capture_output=True, check=False,
                    )
                    self.assertNotEqual(proc.returncode, 0, proc.stdout)
                    self.assertIn("Refusing durable Surface publication", proc.stderr)
                    self.assertFalse(curl_log.exists(), "invalid Surface reached R2 network")
            self.assertNotIn("mapfile -t artifact_rows < <(", R2_SCRIPT.read_text(encoding="utf-8"))

    @unittest.skipIf(os.name == "nt", "R2 Bash curl mocks require POSIX execution")
    def test_r2_restore_preserves_fail_closed_status_on_invalid_remote_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            bin_dir = temp / "bin"
            bin_dir.mkdir()
            fake_curl = bin_dir / "curl"
            # One mocked R2 GET returns HTTP 200 with an invalid manifest.
            # The operation must stop before it downloads any blob or marks a hit.
            fake_curl.write_text(
                '''#!/bin/sh
echo request >> "$SURFACE_MOCK_CURL_LOG"
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then
    shift
    printf '%s' '{"$schema":"invalid"}' > "$1"
    printf 200
    exit 0
  fi
  shift
done
exit 2
''',
                encoding="utf-8",
            )
            fake_curl.chmod(0o755)
            output = temp / "github-output"
            curl_log = temp / "curl-called"
            env = dict(os.environ, **{
                "RUNNER_TEMP": str(temp),
                "GITHUB_OUTPUT": str(output),
                "ORDAX_SOURCE_COMMIT": "1" * 40,
                "ORDAX_R2_ACCOUNT_ID": "0" * 32,
                "ORDAX_R2_BUCKET": "test-bucket",
                "ORDAX_R2_ACCESS_KEY_ID": "test-only",
                "ORDAX_R2_SECRET_ACCESS_KEY": "test-only",
                "ORDAX_SURFACE_FINGERPRINT": "a" * 64,
                "SURFACE_MOCK_CURL_LOG": str(curl_log),
                "PATH": str(bin_dir) + os.pathsep + os.environ.get("PATH", ""),
            })
            proc = subprocess.run(
                ["bash", str(R2_SCRIPT), "restore"],
                cwd=ROOT, env=env, text=True, capture_output=True, check=False,
            )
            self.assertNotEqual(proc.returncode, 0, proc.stdout)
            self.assertIn("Rejecting unverified durable Surface manifest", proc.stderr)
            self.assertEqual(output.read_text(encoding="utf-8"), "hit=false\n")
            self.assertEqual(curl_log.read_text(encoding="utf-8").count("request"), 1)

    @unittest.skipIf(os.name == "nt", "R2 Bash curl mocks require POSIX execution")
    def test_r2_immutable_manifest_race_requires_identical_winning_bytes(self):
        # An R2 412 on manifest PUT can hide a different already-published
        # manifest. Do not claim success unless a subsequent GET matches.
        with tempfile.TemporaryDirectory() as td:
            temp = Path(td)
            out = temp / "ordax-independent-surface"
            out.mkdir()
            files = {
                "provenance.json": b'{"source_commit":"test"}',
                "native-surface-runtime.erofs": b"verified-image",
            }
            for name, data in files.items():
                (out / name).write_bytes(data)
            manifest = {
                "$schema": self.mod.SCHEMA,
                "fingerprint_version": self.mod.FINGERPRINT_VERSION,
                "input_fingerprint": "a" * 64,
                "artifacts": {
                    name: {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
                    for name, data in files.items()
                },
            }
            (out / self.mod.MANIFEST).write_text(json.dumps(manifest), encoding="utf-8")
            bin_dir = temp / "bin"
            bin_dir.mkdir()
            fake_curl = bin_dir / "curl"
            fake_curl.write_text(
                '''#!/usr/bin/env python3
import os
import sys
from pathlib import Path
args = sys.argv[1:]
url = args[-1]
with Path(os.environ["SURFACE_MOCK_CURL_LOG"]).open("a") as log:
    if "--head" in args:
        log.write("HEAD\\n")
        sys.stdout.write("404")
    elif "--upload-file" in args:
        log.write("PUT\\n")
        sys.stdout.write("412" if "/manifests/" in url and os.environ.get("SURFACE_MOCK_RACE") == "1" else "201")
    elif "--output" in args:
        log.write("GET\\n")
        dest = Path(args[args.index("--output") + 1])
        dest.write_text('{"conflicting":"manifest"}')
        sys.stdout.write("200")
    else:
        raise SystemExit("unexpected mocked R2 call")
''',
                encoding="utf-8",
            )
            fake_curl.chmod(0o755)
            curl_log = temp / "curl-called"
            env = dict(os.environ, **{
                "RUNNER_TEMP": str(temp),
                "ORDAX_R2_ACCOUNT_ID": "0" * 32,
                "ORDAX_R2_BUCKET": "test-bucket",
                "ORDAX_R2_ACCESS_KEY_ID": "test-only",
                "ORDAX_R2_SECRET_ACCESS_KEY": "test-only",
                "ORDAX_SURFACE_FINGERPRINT": "a" * 64,
                "SURFACE_MOCK_CURL_LOG": str(curl_log),
                "PATH": str(bin_dir) + os.pathsep + os.environ.get("PATH", ""),
            })
            for race in ("0", "1"):
                with self.subTest(manifest_race=race):
                    curl_log.unlink(missing_ok=True)
                    env["SURFACE_MOCK_RACE"] = race
                    proc = subprocess.run(
                        ["bash", str(R2_SCRIPT), "publish"], cwd=ROOT,
                        env=env, text=True, capture_output=True, check=False,
                    )
                    requests = curl_log.read_text(encoding="utf-8").splitlines()
                    self.assertEqual(requests.count("PUT"), 3, requests)
                    if race == "0":
                        self.assertEqual(proc.returncode, 0, proc.stderr)
                        self.assertIn("Verified Surface ensured", proc.stdout)
                        self.assertNotIn("GET", requests)
                    else:
                        self.assertNotEqual(proc.returncode, 0)
                        self.assertIn("refusing overwrite", proc.stderr)
                        self.assertEqual(requests.count("GET"), 1)
                        self.assertNotIn("Verified Surface ensured", proc.stdout)

    def test_durable_publication_is_immutable_and_credentials_are_not_hardcoded(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("--header 'If-None-Match: *'", R2_SCRIPT.read_text(encoding="utf-8"))
        self.assertIn("secrets.ORDAX_R2_ACCESS_KEY_ID", workflow)
        self.assertIn("secrets.ORDAX_R2_SECRET_ACCESS_KEY", workflow)
        self.assertNotRegex(workflow, r"ORDAX_R2_(ACCESS_KEY_ID|SECRET_ACCESS_KEY): '[^']+'")
        self.assertIn("refusing overwrite", R2_SCRIPT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
