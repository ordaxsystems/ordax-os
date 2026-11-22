"""Windows inference builder regression: no local toolchain or GGUF download required."""
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

BUILDER_DIR = pathlib.Path(__file__).resolve().parents[1] / "tools" / "inference-builder"
sys.path.insert(0, str(BUILDER_DIR))
spec = importlib.util.spec_from_file_location("windows_candidate", BUILDER_DIR / "windows-candidate.py")
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class WindowsInferenceCandidateTest(unittest.TestCase):
    def test_windows_x64_only_and_no_linux_cross_build(self):
        candidate.assert_windows_x64("Windows", "AMD64")
        candidate.assert_windows_x64("Windows", "x86_64")
        for system, machine in [("Linux", "x86_64"), ("Windows", "ARM64"), ("Darwin", "arm64")]:
            with self.subTest(system=system, machine=machine):
                with self.assertRaisesRegex(candidate.canonical.RuntimeBuildError, "native Windows x64"):
                    candidate.assert_windows_x64(system, machine)

    def test_windows_multi_dll_build_uses_shared_msvc_runtime(self):
        # Inspect the real CMake argv without downloading the model, fetching
        # the engine, or consuming a Visual Studio compilation slot.
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            revision = "7ab4ee7baad2d920464cbacfad4f4b07cf111fd2"
            mock_version = type("VersionResult", (), {
                "returncode": 0, "stdout": "llama.cpp " + revision[:8],
                "stderr": "",
            })()
            with (
                patch.object(candidate.canonical, "prepare_engine_mirror",
                             return_value=root / "mirror"),
                patch.object(candidate.canonical, "checkout_engine"),
                patch.object(candidate.canonical, "run") as run,
                patch.object(candidate.canonical, "deterministic_env",
                             return_value={"SOURCE_DATE_EPOCH": "1"}),
                patch.object(candidate, "verify_built_files", return_value=[]),
                patch.object(candidate.subprocess, "run", return_value=mock_version),
            ):
                candidate.build_windows_engine(
                    {"engine": {"commit": revision}}, root / "work", root / "cache"
                )
            self.assertEqual(run.call_count, 2)
            configure = run.call_args_list[0].args[0]
            self.assertEqual(configure[:2], ["cmake", "-S"])
            self.assertIn("-G", configure)
            self.assertIn("Visual Studio 17 2022", configure)
            self.assertIn("-DCMAKE_POLICY_DEFAULT_CMP0091=NEW", configure)
            self.assertIn(
                "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded$<$<CONFIG:Debug>:Debug>DLL",
                configure,
            )
            self.assertIn("-DBUILD_SHARED_LIBS=ON", configure)
            self.assertIn("-DGGML_BACKEND_DL=ON", configure)
            self.assertIn("-DGGML_CPU_ALL_VARIANTS=ON", configure)
            self.assertFalse(any(
                arg == "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded$<$<CONFIG:Debug>:Debug>"
                or "/MT" in arg for arg in configure
            ))
            build = run.call_args_list[1].args[0]
            self.assertIn("--config", build)
            self.assertIn("Release", build)
            self.assertIn("llama-server", build)

    def test_startup_exit_reports_bounded_redacted_error_and_cleans_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = pathlib.Path(temporary)
            secret = []
            model = work / "model.gguf"

            class Exited:
                returncode = 1
                def poll(self):
                    return 1
                def wait(self, timeout=None):
                    return 1
                def terminate(self):
                    raise AssertionError("Do not terminate an already exited process")

            def launch(_args, **options):
                key_path = pathlib.Path(options["env"]["LLAMA_ARG_API_KEY_FILE"])
                token = key_path.read_text(encoding="ascii").strip()
                secret.append(token)
                options["stderr"].write(
                    f"error: ggml backend failed model={model} token={token}\\n".encode()
                )
                options["stderr"].flush()
                return Exited()

            with patch.object(candidate.subprocess, "Popen", side_effect=launch):
                with self.assertRaisesRegex(
                    candidate.canonical.RuntimeBuildError, "exited before readiness"
                ) as error:
                    candidate.prove_real_offline_inference(
                        work / "llama-server.exe", model, "test-model", work
                    )
            message = str(error.exception)
            self.assertIn("exit=0x00000001", message)
            self.assertIn("ggml backend failed", message)
            self.assertNotIn(secret[0], message)
            self.assertNotIn(str(model), message)
            self.assertIn("[redacted-secret]", message)
            self.assertIn("[model-file]", message)
            self.assertFalse((work / "inference-ci-key").exists())
            self.assertFalse((work / "inference-startup.stderr").exists())

    def test_startup_status_recognizes_missing_dll_without_leaking_raw_log(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = pathlib.Path(temporary)
            log = work / "stderr"
            log.write_bytes(b"untrusted private details without error keyword")
            status = candidate.summarize_startup_failure(
                log, "secret", work / "key", work / "model", 0xC0000135
            )
            self.assertIn("missing-windows-dll", status)
            self.assertIn("0xC0000135", status)
            self.assertNotIn("untrusted private details", status)

    def test_success_keeps_real_health_and_completion_gates_and_cleans_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = pathlib.Path(temporary)
            active = []
            class Running:
                returncode = None
                def poll(self):
                    return None
                def terminate(self):
                    active.append("terminated")
                def wait(self, timeout=None):
                    active.append("waited")
                    return 0
            with (
                patch.object(candidate.subprocess, "Popen", return_value=Running()),
                patch.object(candidate, "request_json", side_effect=[
                    {"status": "ok"}, {"data": [{"id": "test-model"}]},
                    {"choices": [{"message": {"content": "teste"}}]},
                ]),
            ):
                proof = candidate.prove_real_offline_inference(
                    work / "llama-server.exe", work / "model.gguf", "test-model", work
                )
            self.assertTrue(proof["real_model_loaded"])
            self.assertTrue(proof["real_completion"])
            self.assertEqual(active, ["terminated", "waited"])
            self.assertFalse((work / "inference-ci-key").exists())
            self.assertFalse((work / "inference-startup.stderr").exists())

    def test_independent_builds_use_exact_clean_source_workspace(self):
        # Same absolute build path in each independent proof, no reused
        # objects, no stale sources, and failure rather than sharing a live dir.
        with tempfile.TemporaryDirectory() as root:
            cache = pathlib.Path(root) / "model-cache"
            cache.mkdir()
            expected = pathlib.Path(root).resolve() / "ordax-windows-inference-native-build"
            with candidate.fixed_windows_workspace(cache) as first:
                self.assertEqual(first, expected)
                self.assertTrue(first.is_dir())
                (first / "old.obj").write_bytes(b"stale")
                with self.assertRaisesRegex(candidate.canonical.RuntimeBuildError, "absent and clean"):
                    with candidate.fixed_windows_workspace(cache):
                        pass
            self.assertFalse(expected.exists(), "every independent build must clean all objects")
            with candidate.fixed_windows_workspace(cache) as second:
                self.assertEqual(second, expected)
                self.assertFalse((second / "old.obj").exists())

    def test_windows_proof_paths_are_isolated_without_creating_output_early(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            requested_output = root / "signed-evidence"
            requested_cache = root / "acquisition-cache"
            output, cache = candidate.validate_proof_paths(
                requested_output, requested_cache
            )
            # Windows CI may supply a DOS 8.3 alias for the tempfile
            # parent (RUNNER~1), while the canonical validator expands it.
            self.assertEqual(output, requested_output.parent.resolve() / requested_output.name)
            self.assertEqual(cache, requested_cache.resolve())
            self.assertTrue(cache.is_dir())
            self.assertFalse(output.exists(), "candidate output is created after proof only")
            with candidate.fixed_windows_workspace(cache) as workspace:
                self.assertEqual(workspace, root.resolve() / "ordax-windows-inference-native-build")
                self.assertTrue(workspace.is_dir())
            self.assertFalse(workspace.exists(), "workspace is always removed")

    def test_windows_proof_rejects_path_overlap_without_writing_anything(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            cache = root / "cache"
            workspace = root / "ordax-windows-inference-native-build"
            cases = (
                (cache, cache),
                (root, cache),
                (cache / "proof", cache),
                (root / "proof", root),
                (workspace, cache),
                (workspace / "proof", cache),
                (root / "proof", workspace),
            )
            for output_path, cache_path in cases:
                with self.subTest(output=output_path, cache=cache_path):
                    with self.assertRaisesRegex(
                        candidate.canonical.RuntimeBuildError, "must not overlap"
                    ):
                        candidate.validate_proof_paths(output_path, cache_path)
            self.assertFalse(cache.exists())
            self.assertFalse(workspace.exists())

    def test_windows_proof_refuses_output_and_cache_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            outside = root / "outside"
            outside.mkdir()
            output_alias = root / "output-alias"
            cache_alias = root / "cache-alias"
            try:
                output_alias.symlink_to(outside, target_is_directory=True)
                cache_alias.symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("host does not permit creating directory symlinks")
            with self.assertRaisesRegex(
                candidate.canonical.RuntimeBuildError, "new real directory"
            ):
                candidate.validate_proof_paths(output_alias, root / "cache")
            with self.assertRaisesRegex(
                candidate.canonical.RuntimeBuildError, "cache.*symlink"
            ):
                candidate.validate_proof_paths(root / "proof", cache_alias)
            with self.assertRaisesRegex(
                candidate.canonical.RuntimeBuildError, "cache.*symlink"
            ):
                with candidate.fixed_windows_workspace(cache_alias):
                    pass
            self.assertEqual(list(outside.iterdir()), [], "never write through symlinks")

    def test_windows_proof_rejects_symlinked_output_parent_and_existing_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            outside = root / "outside"
            outside.mkdir()
            alias = root / "alias"
            try:
                alias.symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("host does not permit creating directory symlinks")
            with self.assertRaisesRegex(
                candidate.canonical.RuntimeBuildError, "output parent.*symlink"
            ):
                candidate.validate_proof_paths(alias / "candidate", root / "cache")
            self.assertEqual(list(outside.iterdir()), [])

            workspace = root / "ordax-windows-inference-native-build"
            workspace.mkdir()
            sentinel = workspace / "existing.obj"
            sentinel.write_bytes(b"do not remove")
            with self.assertRaisesRegex(
                candidate.canonical.RuntimeBuildError, "absent and clean"
            ):
                candidate.validate_proof_paths(root / "proof", root / "cache")
            self.assertEqual(sentinel.read_bytes(), b"do not remove")

    def test_binary_inventory_rejects_missing_executable_or_dll(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            with self.assertRaisesRegex(candidate.canonical.RuntimeBuildError, "llama-server.exe"):
                candidate.verify_built_files(root)
            (root / "llama-server.exe").write_bytes(b"MZcandidate")
            with self.assertRaisesRegex(candidate.canonical.RuntimeBuildError, "runtime libraries"):
                candidate.verify_built_files(root)
            for name in (
                "llama.dll", "llama-common.dll", "llama-server-impl.dll",
                "ggml.dll", "ggml-base.dll", "ggml-cpu-x64.dll",
                "ggml-cpu-sandybridge.dll",
            ):
                (root / name).write_bytes(b"MZcandidate")
            with self.assertRaisesRegex(candidate.canonical.RuntimeBuildError, "multi-ISA"):
                candidate.verify_built_files(root)
            (root / "ggml-cpu-haswell.dll").write_bytes(b"MZcandidate")
            files = candidate.verify_built_files(root)
            self.assertEqual(len(files), 9)
            self.assertIn(root / "ggml-cpu-sandybridge.dll", files)
            self.assertIn(root / "ggml-cpu-haswell.dll", files)

    def test_independent_windows_ci_requires_complete_multivariant_hash_equivalence(self):
        workflow = (BUILDER_DIR.parents[1] / ".github" / "workflows"
                    / "windows-inference-candidate.yml").read_text(encoding="utf-8")
        # Prove that manual candidate generation uses one immutable OS lock
        # instead of a moving main or the older source-import fixture.
        self.assertRegex(workflow, r"(?m)^          ref: [0-9a-f]{40}$")
        self.assertIn("repository: ordaxsystems/ordax-os", workflow)
        self.assertNotIn("ref: main", workflow)
        self.assertIn("$firstHashes.Count -lt 9", workflow)
        self.assertIn("$firstHashes.Count -ne $secondHashes.Count", workflow)
        self.assertIn("($firstHashes -join ';') -cne ($secondHashes -join ';')", workflow)
        self.assertIn("throw 'Pinned Windows EXE/DLL outputs are not byte-reproducible'", workflow)
        self.assertNotIn("$firstHashes.Count -ne 8", workflow)
        # PRs enforce the source/path contract without consuming two Windows
        # compile slots. Actual GGUF and EXE/DLL proofs remain manual-only.
        for step in (
            "Compile exact llama.cpp and prove real offline GGUF inference",
            "Rebuild independent Windows PE files and reject nonreproducible digests",
        ):
            with self.subTest(step=step):
                header = workflow.split("- name: " + step, 1)[1].split("shell: pwsh", 1)[0]
                self.assertIn("if: github.event_name == 'workflow_dispatch'", header)
        upload = workflow.split(
            "- uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f", 1
        )[1].split("with:", 1)[0]
        self.assertIn("if: github.event_name == 'workflow_dispatch'", upload)

    def test_proven_windows_candidate_promotion_reuses_exact_artifact_without_rebuild(self):
        root = BUILDER_DIR.parents[1]
        promotion = json.loads(
            (root / "release" / "windows-inference-candidate.json").read_text(encoding="utf-8")
        )
        workflow = (
            root / ".github" / "workflows" / "windows-inference-promotion.yml"
        ).read_text(encoding="utf-8")
        self.assertEqual(promotion["$schema"], "ordax.intelligence-windows-engine-promotion/1")
        self.assertEqual(promotion["proof_run_id"], 43309006398)
        self.assertEqual(promotion["artifact_id"], 13985193466)
        self.assertEqual(
            promotion["artifact_sha256"],
            "21680ead38fbbd34848826badb1ec30ee489b5a8c25fca29deb9d1da74e2cc29",
        )
        self.assertEqual(promotion["proof_head_commit"], "20ffa79651401b2e03732f3878025bbd30b4b52e")
        self.assertEqual(promotion["builder_commit"], "70fc05715e1eb99a43d513caec9f4ac13fbcb1f3")
        self.assertFalse(promotion["activation_authorized"])
        self.assertFalse(promotion["signed_release"])
        self.assertIn("actions: read", workflow)
        self.assertIn("contents: write", workflow)
        self.assertIn("actions/artifacts/$ORDAX_ARTIFACT_ID/zip", workflow)
        self.assertIn("sha256sum --check --strict", workflow)
        self.assertIn("gh release create", workflow)
        self.assertIn("--prerelease", workflow)
        self.assertIn("candidate-receipt.json", workflow)
        self.assertNotIn("windows-candidate.py", workflow)
        self.assertNotIn("cmake", workflow.lower())
        self.assertNotIn("workflow_dispatch:", workflow)

    def test_real_proof_must_use_same_os_owned_model_lock_and_no_authority(self):
        source = (BUILDER_DIR / "windows-candidate.py").read_text(encoding="utf-8")
        self.assertIn("canonical.load_source_lock()", source)
        self.assertIn("canonical.download_exact(", source)
        self.assertIn('canonical.prepare_engine_mirror(lock, Path(cache_dir) / "source-cache")', source)
        self.assertIn("canonical.prepare_engine_mirror(", source)
        self.assertIn("canonical.checkout_engine(", source)
        self.assertIn("canonical.attest_os_committed_inputs(lock)", source)
        self.assertIn("out_dir, cache_dir = validate_proof_paths(out_dir, cache_dir)", source)
        self.assertNotIn('"os_source_commit": canonical.source_commit()', source)
        self.assertIn('"activation_authorized": False', source)
        self.assertIn('"signed_release": False', source)
        self.assertIn('"-DCMAKE_EXE_LINKER_FLAGS=/Brepro"', source)
        self.assertIn('"-DCMAKE_SHARED_LINKER_FLAGS=/Brepro"', source)
        self.assertIn('"-DBUILD_SHARED_LIBS=ON"', source)
        self.assertIn('"-DGGML_BACKEND_DL=ON"', source)
        self.assertIn('"-DGGML_CPU_ALL_VARIANTS=ON"', source)
        self.assertIn('"-DGGML_NATIVE=OFF"', source)
        self.assertNotIn('"-DGGML_BACKEND_DL=OFF"', source)
        self.assertIn('"--ctx-size", "2048", "--parallel", "1"', source)
        self.assertIn('"ggml-cpu-x64.dll"', source)
        self.assertIn('"ggml-cpu-sandybridge.dll"', source)
        self.assertIn('"ggml-cpu-haswell.dll"', source)
        self.assertIn('f"-DCMAKE_C_FLAGS=/experimental:deterministic /pathmap:{work}=C:/ordax-inference"', source)
        self.assertIn('f"-DCMAKE_CXX_FLAGS=/experimental:deterministic /pathmap:{work}=C:/ordax-inference"', source)
        self.assertIn('"model_bytes_included": False', source)
        self.assertNotIn("subprocess.run('powershell", source)
        self.assertNotIn("github.com/ggml-org/llama.cpp", source)


if __name__ == "__main__":
    unittest.main()
