# Regression adapted from ordaxsystems/ordax-os/tests/test_local_ai_runtime_builder.py @ 0c8b4a55cba2c6ae42fa0425706939568360e04e
import concurrent.futures
import importlib.util
import hashlib
import io
import json
import subprocess
import threading
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
OS_ROOT = ROOT.parents[1]
BUILDER_PATH = ROOT / "tools/inference-builder/build.py"
SOURCE_LOCK = OS_ROOT / "system/services/local-ai/source-lock.json"

spec = importlib.util.spec_from_file_location("ordax_local_ai_runtime_builder", BUILDER_PATH)
assert spec and spec.loader
BUILDER = importlib.util.module_from_spec(spec)
spec.loader.exec_module(BUILDER)
BUILDER.configure_os_source(OS_ROOT)


class LocalAiRuntimeBuilderTests(unittest.TestCase):
    def test_provenance_commit_must_match_real_os_checkout_even_if_env_is_set(self):
        import subprocess
        actual = subprocess.check_output(
            ["git", "-C", str(OS_ROOT), "rev-parse", "--verify", "HEAD"],
            text=True,
        ).strip().lower()
        self.assertRegex(actual, r"^[0-9a-f]{40}$")
        with mock.patch.dict(BUILDER.os.environ, {"ORDAX_SOURCE_COMMIT": ""}):
            self.assertEqual(BUILDER.source_commit(), actual)
        with mock.patch.dict(BUILDER.os.environ, {"ORDAX_SOURCE_COMMIT": actual}):
            self.assertEqual(BUILDER.source_commit(), actual)
        mismatched = "0" * 40 if actual != "0" * 40 else "f" * 40
        for declared in (mismatched, "HEAD", "not-a-sha"):
            with self.subTest(declared=declared):
                with mock.patch.dict(BUILDER.os.environ, {"ORDAX_SOURCE_COMMIT": declared}):
                    with self.assertRaisesRegex(
                        BUILDER.RuntimeBuildError,
                        "environment differs from checked-out HEAD",
                    ):
                        BUILDER.source_commit()

    def test_os_manifest_parents_cannot_be_symlinks_even_when_files_are_regular(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "os"
            external = root / "external-lock"
            source.mkdir()
            external.mkdir()
            services = source / "system/services"
            services.mkdir(parents=True)
            (source / "docs/contracts").mkdir(parents=True)
            (source / "docs/contracts/local-ai.json").write_bytes(
                (OS_ROOT / "docs/contracts/local-ai.json").read_bytes()
            )
            (external / "source-lock.json").write_bytes(SOURCE_LOCK.read_bytes())
            (services / "local-ai").symlink_to(external, target_is_directory=True)
            with self.assertRaisesRegex(
                BUILDER.RuntimeBuildError, "manifests.*symlink"
            ):
                BUILDER.configure_os_source(source)
            # Failed validation must not replace global OS authority pointers.
            self.assertEqual(BUILDER.SOURCE_LOCK, SOURCE_LOCK)
            self.assertEqual(BUILDER.ROOT, OS_ROOT.resolve())

    def test_os_source_parent_components_cannot_be_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real = root / "actual"
            real.mkdir()
            alias = root / "symlink"
            alias.symlink_to(real, target_is_directory=True)
            with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "symlink"):
                BUILDER.configure_os_source(alias / "checkout")

    def test_vendored_os_license_rejects_symlinked_ancestor_and_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outside = root / "outside"
            outside.mkdir()
            (outside / "Apache-2.0.txt").write_text("not trusted")
            (root / "third_party").mkdir()
            (root / "third_party/licenses").symlink_to(
                outside, target_is_directory=True
            )
            with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "symlink"):
                BUILDER.require_os_source_file(
                    root, "third_party/licenses/Apache-2.0.txt", "OS model license"
                )
            with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "unsafe"):
                BUILDER.require_os_source_file(
                    root, "../outside/Apache-2.0.txt", "OS model license"
                )

    def test_exact_download_refuses_symlinked_cache_parent_before_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outside = root / "outside"
            outside.mkdir()
            alias = root / "cache"
            alias.symlink_to(outside, target_is_directory=True)
            with mock.patch.object(
                BUILDER.urllib.request, "urlopen",
                side_effect=AssertionError("unexpected network access"),
            ):
                with self.assertRaisesRegex(
                    BUILDER.RuntimeBuildError, "model cache.*symlink"
                ):
                    BUILDER.download_exact(
                        "https://invalid.example/never-fetch",
                        alias / "model.gguf", "0" * 64, 12,
                    )
            self.assertEqual(list(outside.iterdir()), [])

    def test_os_checkout_attests_committed_manifest_contract_and_license(self):
        canonical_lock = BUILDER.load_source_lock()
        files = {
            "system/services/local-ai/source-lock.json": SOURCE_LOCK.read_bytes(),
            "docs/contracts/local-ai.json":
                (OS_ROOT / "docs/contracts/local-ai.json").read_bytes(),
            canonical_lock["model"]["license_text_path"]:
                (OS_ROOT / canonical_lock["model"]["license_text_path"]).read_bytes(),
        }
        with tempfile.TemporaryDirectory() as temporary:
            os_root = Path(temporary) / "canonical-os"
            os_root.mkdir()
            for relative, payload in files.items():
                target = os_root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
            subprocess.run(["git", "init", "-q", str(os_root)], check=True)
            subprocess.run(["git", "-C", str(os_root), "add", "."], check=True)
            subprocess.run([
                "git", "-C", str(os_root),
                "-c", "user.name=OrdaX CI",
                "-c", "user.email=ci@ordax.invalid",
                "commit", "-q", "-m", "pin OS-owned build inputs",
            ], check=True)
            paths = [
                "system/services/local-ai/source-lock.json",
                "docs/contracts/local-ai.json",
                canonical_lock["model"]["license_text_path"],
            ]
            with (
                mock.patch.object(BUILDER, "ROOT", os_root),
                mock.patch.object(BUILDER, "SOURCE_LOCK", os_root / paths[0]),
                mock.patch.object(BUILDER, "CONTRACT", os_root / paths[1]),
                mock.patch.dict(BUILDER.os.environ, {"ORDAX_SOURCE_COMMIT": ""}),
            ):
                lock = BUILDER.load_source_lock()
                commit = subprocess.check_output(
                    ["git", "-C", str(os_root), "rev-parse", "HEAD"], text=True,
                ).strip()
                self.assertEqual(BUILDER.attest_os_committed_inputs(lock), commit)
                self.assertEqual(BUILDER.source_commit(), commit)
                # No source-lock revalidation can bless a dirty JSON document,
                # a mutated contract, or a modified legal notice under old HEAD.
                for path in paths:
                    with self.subTest(uncommitted=path):
                        target = os_root / path
                        original = target.read_bytes()
                        target.write_bytes(original + b"\n")
                        try:
                            with self.assertRaisesRegex(
                                BUILDER.RuntimeBuildError,
                                "differs from committed HEAD",
                            ):
                                BUILDER.attest_os_committed_inputs(lock)
                        finally:
                            target.write_bytes(original)
                self.assertEqual(BUILDER.attest_os_committed_inputs(lock), commit)

    def test_nested_directory_cannot_impersonate_os_git_checkout_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "parent-repository"
            root.mkdir()
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            nested = root / "os-subdirectory"
            nested.mkdir()
            with (
                mock.patch.object(BUILDER, "ROOT", nested),
                mock.patch.dict(BUILDER.os.environ, {"ORDAX_SOURCE_COMMIT": ""}),
            ):
                # HEAD exists in the parent Git repo, not this OS checkout.
                subprocess.run([
                    "git", "-C", str(root), "-c", "user.name=OrdaX CI",
                    "-c", "user.email=ci@ordax.invalid",
                    "commit", "--allow-empty", "-q", "-m", "empty parent",
                ], check=True)
                with self.assertRaisesRegex(
                    BUILDER.RuntimeBuildError, "root of its own Git checkout"
                ):
                    BUILDER.attest_os_committed_inputs(
                        {"model": {"license_text_path":
                            "third_party/licenses/Apache-2.0.txt"}}
                    )

    def test_source_lock_is_exact_and_runtime_is_loopback_only(self):
        lock = BUILDER.load_source_lock()
        self.assertEqual(lock["engine"]["commit"], "7ab4ee7baad2d920464cbacfad4f4b07cf111fd2")
        self.assertEqual(lock["engine"]["build_targets"], ["llama-server"])
        self.assertEqual(
            lock["engine"]["artifact"],
            {
                "platform": "linux-x86_64",
                "binary_format": "ELF",
                "linkage": "static",
                "sha256": "4a974691b9905b88cb46d97c85c2b035b33592a16cd0239ae4c6687f68799afe",
                "size_bytes": 17039584,
            },
        )
        self.assertEqual(lock["model"]["sha256"], "57d1997790d1744fba5b40a7317df71ea5e2acee28c47e78f0cce39c0703f8cf")
        self.assertEqual(lock["model"]["size_bytes"], 563036064)
        self.assertEqual(lock["model"]["license_text_path"], "third_party/licenses/Apache-2.0.txt")
        self.assertEqual(lock["runtime_defaults"], {"reasoning": "off"})
        self.assertEqual(
            lock["runtime_security"],
            {
                "listen_host": "127.0.0.1",
                "listen_port": 17865,
                "web_ui_enabled": False,
                "built_in_tools_enabled": False,
                "agent_mode_enabled": False,
                "mcp_proxy_enabled": False,
                "runtime_model_download_allowed": False,
            },
        )

    def test_launcher_never_enables_provider_tools_or_network_model_fetch(self):
        lock = BUILDER.load_source_lock()
        launcher = BUILDER.launcher_text(lock)
        self.assertIn("--host 127.0.0.1", launcher)
        self.assertIn("--port 17865", launcher)
        self.assertIn("--reasoning off", launcher)
        self.assertIn("--no-ui", launcher)
        self.assertIn("--no-slots", launcher)
        self.assertIn(lock["model"]["filename"], launcher)
        self.assertIn(lock["model"]["id"], launcher)
        for forbidden in (
            "--tools",
            "--agent",
            "--mcp",
            "--hf-repo",
            "--model-url",
            "0.0.0.0",
        ):
            self.assertNotIn(forbidden, launcher)

    def test_builder_rejects_relaxed_runtime_security(self):
        lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        lock["runtime_security"]["listen_host"] = "0.0.0.0"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source-lock.json"
            path.write_text(json.dumps(lock), encoding="utf-8")
            with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "runtime security"):
                BUILDER.load_source_lock(path)

    def test_builder_rejects_malformed_engine_artifact_pin(self):
        lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        lock["engine"]["artifact"]["sha256"] = "0" * 63
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source-lock.json"
            path.write_text(json.dumps(lock), encoding="utf-8")
            with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "engine artifact pin"):
                BUILDER.load_source_lock(path)

    def test_builder_rejects_model_license_identity_drift(self):
        lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        for value in (None, "MIT", "Proprietary", "apache-2.0"):
            with self.subTest(license=value):
                altered = json.loads(json.dumps(lock))
                altered["model"]["license"] = value
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / "source-lock.json"
                    path.write_text(json.dumps(altered), encoding="utf-8")
                    with self.assertRaisesRegex(
                        BUILDER.RuntimeBuildError,
                        "model license is not approved",
                    ):
                        BUILDER.load_source_lock(path)

    def test_current_candidate_includes_exact_mit_and_apache_license_sources(self):
        lock = BUILDER.load_source_lock()
        self.assertEqual(lock["engine"]["license"], "MIT")
        self.assertEqual(lock["model"]["license"], "Apache-2.0")
        model_license = OS_ROOT / lock["model"]["license_text_path"]
        contents = model_license.read_text(encoding="utf-8")
        self.assertIn("Apache License", contents[:120])
        self.assertIn("Version 2.0, January 2004", contents[:160])
        builder = BUILDER_PATH.read_text(encoding="utf-8")
        self.assertIn('runtime / "licenses/llama.cpp-MIT.txt"', builder)
        self.assertIn('runtime / "licenses/model-Apache-2.0.txt"', builder)

    def test_model_filename_rejects_shell_metacharacters_and_url_fragments(self):
        original = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        forbidden = (
            "model$(touch injected).gguf",
            "model`echo injected`.gguf",
            'model" --host 0.0.0.0 ".gguf',
            "model\ninjected.gguf",
            "model?download=1.gguf",
            "model#fragment.gguf",
            "model%20space.gguf",
            "../../outside.gguf",
            "model\\outside.gguf",
            "model.gguf;command",
            "..",
            ".",
            "",
        )
        for filename in forbidden:
            with self.subTest(filename=filename):
                lock = json.loads(json.dumps(original))
                lock["model"]["filename"] = filename
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / "source-lock.json"
                    path.write_text(json.dumps(lock), encoding="utf-8")
                    with self.assertRaisesRegex(
                        BUILDER.RuntimeBuildError, "model filename is unsafe",
                    ):
                        BUILDER.load_source_lock(path)
                # The model URL and launch script share one validator, even
                # when invoked independently of the load_source_lock entry.
                with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "model filename is unsafe"):
                    BUILDER.model_url(lock)
                with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "model filename is unsafe"):
                    BUILDER.launcher_text(lock)

    def test_huggingface_repository_is_a_literal_owner_repo_pair(self):
        original = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        forbidden = (
            "owner",
            "owner/repo/extra",
            "owner/../repo",
            "owner/..",
            "owner/repo?download=true",
            "owner/repo#fragment",
            "owner/repo\nx",
            "owner/repo space",
            "owner\\other/repo",
            "https://other.example/repo",
            "/repo",
            "owner/",
            "owner/repo%2Fother",
        )
        for repository in forbidden:
            with self.subTest(repository=repository):
                lock = json.loads(json.dumps(original))
                lock["model"]["repository"] = repository
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / "source-lock.json"
                    path.write_text(json.dumps(lock), encoding="utf-8")
                    with self.assertRaisesRegex(
                        BUILDER.RuntimeBuildError, "model repository is invalid",
                    ):
                        BUILDER.load_source_lock(path)
                with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "model repository is invalid"):
                    BUILDER.model_url(lock)
                with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "model repository is invalid"):
                    BUILDER.launcher_text(lock)

    def test_reviewed_model_source_remains_safe_in_url_and_launcher(self):
        lock = BUILDER.load_source_lock()
        self.assertEqual(
            BUILDER.validate_model_source_path(lock["model"]),
            lock["model"]["filename"],
        )
        url = BUILDER.model_url(lock)
        self.assertTrue(url.startswith("https://huggingface.co/"))
        self.assertIn("/resolve/" + lock["model"]["upstream_revision"] + "/", url)
        launcher = BUILDER.launcher_text(lock)
        self.assertIn('--model "$runtime_root/models/' + lock["model"]["filename"] + '"', launcher)
        self.assertNotIn("$(", launcher)
        self.assertNotIn(chr(96), launcher)

    def test_model_url_is_revision_pinned(self):
        lock = BUILDER.load_source_lock()
        url = BUILDER.model_url(lock)
        self.assertIn("/resolve/9447f74/", url)
        self.assertTrue(url.endswith("Qwen3.5-0.8B-Q4_0.gguf?download=true"))


    def test_builder_rejects_symlinked_artifact_roots_before_download(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            outside = root / "outside"
            outside.mkdir()
            out_link = root / "out-link"
            cache_link = root / "cache-link"
            out_link.symlink_to(outside, target_is_directory=True)
            cache_link.symlink_to(outside, target_is_directory=True)
            with (
                mock.patch.object(BUILDER.platform, "system", return_value="Linux"),
                mock.patch.object(BUILDER.platform, "machine", return_value="x86_64"),
                mock.patch.object(BUILDER.shutil, "which", return_value="/usr/bin/true"),
                mock.patch.object(BUILDER, "download_exact", side_effect=AssertionError("unexpected network")),
            ):
                for out_dir, cache_dir in (
                    (out_link, root / "cache"),
                    (root / "out", cache_link),
                ):
                    with self.subTest(out_dir=out_dir, cache_dir=cache_dir):
                        with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "symlink"):
                            BUILDER.build(out_dir, cache_dir)
            self.assertEqual(list(outside.iterdir()), [], "no writes through symlink")

    def test_verifier_rejects_output_root_that_is_a_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            outside = root / "outside"
            outside.mkdir()
            output = root / "output"
            output.symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "symlink"):
                BUILDER.verify(output)

    def test_engine_mirror_refuses_a_link_to_an_outside_git_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / "cache"
            cache.mkdir()
            outside = root / "other-git"
            outside.mkdir()
            (outside / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
            (cache / "llama.cpp.git").symlink_to(outside, target_is_directory=True)
            lock = BUILDER.load_source_lock()
            with mock.patch.object(BUILDER, "run", side_effect=AssertionError("git must not run")):
                with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "mirror cache is unsafe"):
                    BUILDER.prepare_engine_mirror(lock, cache)

    def test_cached_model_and_partial_download_refuse_symlinks_without_clobbering_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            outside = root / "outside"
            data = b"verified model content"
            outside.write_bytes(data)
            model = root / "model.gguf"
            model.symlink_to(outside)
            digest = hashlib.sha256(data).hexdigest()
            with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "cached model.*symlink"):
                BUILDER.download_exact("https://invalid.example/model", model, digest, len(data))
            self.assertEqual(outside.read_bytes(), data)

            model.unlink()
            # A legacy fixed .part path may still be a symlink from an old
            # checkout. The new unique downloads never use or modify it.
            partial = root / "model.gguf.part"
            partial.symlink_to(outside)
            with mock.patch.object(
                BUILDER.urllib.request, "urlopen",
                return_value=io.BytesIO(data),
            ):
                self.assertEqual(
                    BUILDER.download_exact(
                        "https://invalid.example/model", model, digest, len(data)
                    ), model,
                )
            self.assertEqual(model.read_bytes(), data)
            self.assertEqual(outside.read_bytes(), data)
            self.assertTrue(partial.is_symlink())
            self.assertEqual(list(root.glob("model.gguf.part-*.tmp")), [])

    def test_parallel_model_downloads_use_independent_parts_and_share_verified_cache(self):
        class ConcurrentResponse(io.BytesIO):
            def __init__(self, content, barrier):
                super().__init__(content)
                self.barrier = barrier
                self.first_read = True

            def read(self, amount=-1):
                if self.first_read:
                    self.first_read = False
                    # Synchronize *after* both writers have opened their
                    # temporary files, exposing the original fixed .part race.
                    self.barrier.wait(timeout=10)
                return super().read(amount)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "shared.gguf"
            data = b"exact pinned offline GGUF fixture"
            digest = hashlib.sha256(data).hexdigest()
            barrier = threading.Barrier(2)
            with mock.patch.object(
                BUILDER.urllib.request, "urlopen",
                side_effect=lambda _request, timeout: ConcurrentResponse(data, barrier),
            ):
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
                    results = list(workers.map(
                        lambda _: BUILDER.download_exact(
                            "https://invalid.example/model", model, digest, len(data),
                        ), range(2),
                    ))
            self.assertEqual(results, [model, model])
            self.assertEqual(model.read_bytes(), data)
            self.assertEqual(list(root.glob("shared.gguf.part-*.tmp")), [])
            self.assertFalse((root / "shared.gguf.part").exists())

    def test_failed_model_download_preserves_existing_cache_and_cleans_unique_part(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "model.gguf"
            old = b"previous invalid cache candidate"
            expected = b"correct reviewed model content"
            model.write_bytes(old)
            wrong = b"x" * len(expected)
            digest = hashlib.sha256(expected).hexdigest()
            with mock.patch.object(
                BUILDER.urllib.request, "urlopen", return_value=io.BytesIO(wrong),
            ):
                with self.assertRaisesRegex(
                    BUILDER.RuntimeBuildError, "download digest mismatch"
                ):
                    BUILDER.download_exact(
                        "https://invalid.example/model", model, digest, len(expected)
                    )
            self.assertEqual(model.read_bytes(), old)
            self.assertEqual(list(root.glob("model.gguf.part-*.tmp")), [])

    def test_model_cache_directory_target_fails_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            directory_target = root / "unexpected.gguf"
            directory_target.mkdir()
            with mock.patch.object(
                BUILDER.urllib.request, "urlopen",
                side_effect=AssertionError("unexpected network"),
            ):
                with self.assertRaisesRegex(
                    BUILDER.RuntimeBuildError, "cached model path must be a regular file",
                ):
                    BUILDER.download_exact(
                        "https://invalid.example/model",
                        directory_target, "0" * 64, 123,
                    )

    def test_output_cache_overlaps_are_rejected_before_any_download(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                mock.patch.object(BUILDER.platform, "system", return_value="Linux"),
                mock.patch.object(BUILDER.platform, "machine", return_value="x86_64"),
                mock.patch.object(BUILDER.shutil, "which", return_value="/usr/bin/true"),
                mock.patch.object(BUILDER, "download_exact", side_effect=AssertionError("unexpected download")),
            ):
                for out_dir, cache_dir in (
                    (root / "same", root / "same"),
                    (root / "out", root / "out" / "cache"),
                    (root / "cache" / "out", root / "cache"),
                ):
                    with self.subTest(out_dir=out_dir, cache_dir=cache_dir):
                        with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "must not overlap"):
                            BUILDER.build(out_dir, cache_dir)

    def test_directory_helper_rejects_symlinked_parent_components(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            outside = root / "outside"
            outside.mkdir()
            linked_parent = root / "linked-parent"
            linked_parent.symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "symlink"):
                BUILDER.require_real_directory(linked_parent / "new-cache", "cache", create=True)
            self.assertFalse((outside / "new-cache").exists())


if __name__ == "__main__":
    unittest.main()
