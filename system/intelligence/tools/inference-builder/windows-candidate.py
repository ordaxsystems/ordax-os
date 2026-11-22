#!/usr/bin/env python3
"""Non-promotable Windows x64 inference proof, sharing the canonical OS lock and builder helpers.

This is a build/CI target of the extracted Intelligence inference builder, NOT
a second source lock, installed service, updater or signed product release.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import build as canonical


def assert_windows_x64(system=None, machine=None):
    system = platform.system() if system is None else system
    machine = platform.machine() if machine is None else machine
    if system != "Windows" or machine.lower() not in ("amd64", "x86_64"):
        raise canonical.RuntimeBuildError("Windows inference proof requires native Windows x64")


def verify_built_files(folder: Path):
    folder = Path(folder)
    if folder.is_symlink() or not folder.is_dir():
        raise canonical.RuntimeBuildError("Windows engine output must be a real directory")
    binary = folder / "llama-server.exe"
    if binary.is_symlink() or not binary.is_file():
        raise canonical.RuntimeBuildError("Pinned Windows build did not produce llama-server.exe")
    selected = sorted([binary, *folder.glob("*.dll")], key=lambda p: p.name.lower())
    # The pinned source builds ggml CPU backends as separately loadable DLLs.
    # A baseline x64 build is required for older processors; the AVX and AVX2
    # variants provide verified runtime dispatch instead of forcing either
    # unsupported instructions or a permanently scalar release.
    required = {
        "llama-server.exe", "llama.dll", "llama-common.dll",
        "llama-server-impl.dll", "ggml.dll", "ggml-base.dll",
        "ggml-cpu-x64.dll", "ggml-cpu-sandybridge.dll",
        "ggml-cpu-haswell.dll",
    }
    if not required.issubset({part.name.lower() for part in selected}):
        raise canonical.RuntimeBuildError("Windows multi-ISA runtime libraries are missing")
    for part in selected:
        if part.is_symlink() or not part.is_file() or part.stat().st_size <= 0:
            raise canonical.RuntimeBuildError("Unsafe Windows inference binary")
    return selected


def build_windows_engine(lock, work, cache_dir):
    work = Path(work)
    # Source acquisition cache is independent of compiled objects. On Windows,
    # Git pack files may remain open briefly; never delete their mirror during
    # deterministic build workspace cleanup. Checkout is still a fresh tree.
    mirror = canonical.prepare_engine_mirror(lock, Path(cache_dir) / "source-cache")
    source = work / "llama-source"
    canonical.checkout_engine(lock, mirror, source)
    build_dir = work / "build"
    commit = lock["engine"]["commit"]
    canonical.run([
        "cmake", "-S", str(source), "-B", str(build_dir),
        "-G", "Visual Studio 17 2022", "-A", "x64",
        # The GGML multi-ISA CPU backends are separately loadable DLLs.
        # Sharing one MSVC CRT avoids allocator/CRT-object ownership conflicts
        # across DLL boundaries. The Desktop owner must supply a Microsoft-
        # approved and digest-verified runtime prerequisite before shipping
        # any candidate to a clean per-user Windows installation.
        # This builder alone NEVER authorizes an installer or release.
        "-DCMAKE_POLICY_DEFAULT_CMP0091=NEW",
        "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded$<$<CONFIG:Debug>:Debug>DLL",
        "-DLLAMA_BUILD_TESTS=OFF", "-DLLAMA_BUILD_EXAMPLES=OFF",
        "-DLLAMA_BUILD_TOOLS=ON", "-DLLAMA_BUILD_SERVER=ON",
        "-DLLAMA_BUILD_APP=OFF", "-DLLAMA_BUILD_UI=OFF",
        "-DLLAMA_USE_PREBUILT_UI=OFF", "-DLLAMA_OPENSSL=OFF",
        "-DLLAMA_SUBPROCESS=OFF", "-DGGML_NATIVE=OFF",
        "-DGGML_OPENMP=OFF", "-DGGML_BLAS=OFF",
        # SOURCE_DATE_EPOCH makes GGML_NATIVE_DEFAULT=OFF upstream and leaves
        # SSE4/AVX disabled when GGML_NATIVE=OFF. The previous one-DLL build
        # therefore ran scalar on the user's Intel Ivy Bridge CPU. Use the
        # upstream runtime-selected x64/SSE4/AVX/AVX2 CPU variants: one generic
        # fallback, no per-machine rebuild, no CPU-specific release fork.
        "-DBUILD_SHARED_LIBS=ON", "-DGGML_BACKEND_DL=ON",
        "-DGGML_CPU_ALL_VARIANTS=ON", "-DGGML_BUILD_TESTS=OFF",
        "-DGGML_BUILD_EXAMPLES=OFF",
        # Link timestamps alone are insufficient: all DLL digests diverged
        # between independent temp directories while the EXE digest matched.
        # Normalize MSVC source/debug path records at compile time as well.
        f"-DCMAKE_C_FLAGS=/experimental:deterministic /pathmap:{work}=C:/ordax-inference",
        f"-DCMAKE_CXX_FLAGS=/experimental:deterministic /pathmap:{work}=C:/ordax-inference",
        "-DLLAMA_BUILD_NUMBER=0",
        # MSVC otherwise stamps wall-clock link time into PE/COFF headers,
        # changing EXE/DLL digests for identical upstream source revisions.
        "-DCMAKE_EXE_LINKER_FLAGS=/Brepro",
        "-DCMAKE_SHARED_LINKER_FLAGS=/Brepro",
        "-DCMAKE_MODULE_LINKER_FLAGS=/Brepro",
        f"-DLLAMA_BUILD_COMMIT={commit}",
        f"-DGGML_BUILD_COMMIT={commit}",
    ], env=canonical.deterministic_env())
    canonical.run(["cmake", "--build", str(build_dir), "--config", "Release",
                   "--target", "llama-server", "--parallel", "2"],
                  env=canonical.deterministic_env())
    output = build_dir / "bin" / "Release"
    files = verify_built_files(output)
    version = subprocess.run([str(output / "llama-server.exe"), "--version"],
                             capture_output=True, text=True, timeout=30, check=False)
    version_text = (version.stdout + version.stderr).strip()
    if version.returncode != 0 or "llama" not in version_text.lower():
        raise canonical.RuntimeBuildError("Windows llama-server version probe failed")
    if commit[:7] not in version_text and commit[:8] not in version_text:
        raise canonical.RuntimeBuildError("Windows llama-server cannot attest pinned source revision")
    return output, files, version_text[:512]


def download_verified_model(lock, cache):
    model = lock["model"]
    return canonical.download_exact(
        canonical.model_url(lock),
        Path(cache) / model["filename"],
        model["sha256"], model["size_bytes"],
    )


def ephemeral_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request_json(port, route, token, payload=None, timeout=10):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    if data is not None and len(data) > 32768:
        raise canonical.RuntimeBuildError("Windows inference proof prompt exceeds bound")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{route}", data=data,
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json"},
        method="POST" if data is not None else "GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read(1048577)
    if len(data) > 1048576:
        raise canonical.RuntimeBuildError("Windows inference proof response exceeds bound")
    return json.loads(data)



def summarize_startup_failure(stderr_file, token, key_file, model_file, returncode):
    """Bounded, redacted pre-readiness diagnostics. Never print raw engine logs."""
    exit_hex = f"0x{(int(returncode) & 0xffffffff):08X}"
    ntstatus = {
        "0xC0000135": "missing-windows-dll",
        "0xC0000139": "missing-dll-entrypoint",
        "0xC000001D": "illegal-cpu-instruction",
        "0xC0000005": "access-violation",
    }.get(exit_hex, "process-exited")
    with Path(stderr_file).open("rb") as stream:
        stream.seek(0, os.SEEK_END)
        size = min(stream.tell(), 16384)
        stream.seek(-size, os.SEEK_END)
        lines = stream.read(size).decode("utf-8", errors="replace").splitlines()
    safe = []
    for line in lines:
        # Require the error at the start or a known engine logger prefix.
        # A random informational line merely mentioning "error" is not safe
        # to echo into public GitHub logs.
        if not re.search(
            r"(?i)^\s*(?:error[:\s]|fatal[:\s]|failed\s+to\s+|"
            r"unable\s+to\s+|could\s+not\s+|unknown\s+argument|"
            r"invalid\s+argument|"
            r"(?:llama|ggml)[\w:.-]{0,72}\s*:\s*.*\b(?:error|failed|fatal)\b)",
            line,
        ):
            continue
        line = line.replace(token, "[redacted]").replace(str(key_file), "[key-file]")
        line = line.replace(str(model_file), "[model-file]")
        line = re.sub(
            r"(?i)(?:bearer\s+|(?:api[_ -]?key|token)\s*[:=]\s*)\S+",
            "[redacted-secret]", line,
        )
        line = re.sub(r"(?i)\b[0-9a-f]{32,}\b", "[redacted-hex]", line)
        line = re.sub(r"[\x00-\x1f\x7f]", " ", line)
        safe.append(line.strip()[:240])
    return f"exit={exit_hex} ({ntstatus}); engine_errors={' | '.join(safe[-4:]) or 'none'}"

def prove_real_offline_inference(binary, model_file, model_id, work):
    port = ephemeral_port()
    key_file = Path(work) / "inference-ci-key"
    token = hashlib.sha256(os.urandom(64)).hexdigest()
    key_file.write_text(token + "\n", encoding="ascii")
    # No bearer in command arguments, no key exposed to the Surface.
    env = dict(os.environ, LLAMA_ARG_API_KEY_FILE=str(key_file))
    args = [str(binary), "--host", "127.0.0.1", "--port", str(port),
            "--model", str(model_file), "--alias", model_id, "--no-ui",
            "--no-slots", "--reasoning", "off", "-ngl", "0", "-t", "2",
            "--ctx-size", "2048", "--parallel", "1"]
    startup_stderr = Path(work) / "inference-startup.stderr"
    process = None
    try:
        with startup_stderr.open("wb") as stderr_stream:
            process = subprocess.Popen(args, cwd=str(binary.parent), env=env,
                                       stdout=subprocess.DEVNULL, stderr=stderr_stream)
            try:
                deadline = time.monotonic() + 180
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        stderr_stream.flush()
                        detail = summarize_startup_failure(
                            startup_stderr, token, key_file, model_file, process.returncode,
                        )
                        raise canonical.RuntimeBuildError(
                            "Pinned Windows inference engine exited before readiness: " + detail
                        )
                    try:
                        health = request_json(port, "/health", token, timeout=2)
                        if health.get("status") == "ok":
                            break
                    except (urllib.error.URLError, TimeoutError, ValueError):
                        pass
                    time.sleep(1)
                else:
                    raise canonical.RuntimeBuildError("Pinned Windows inference did not reach real health")
                listed = request_json(port, "/v1/models", token)
                data = listed.get("data")
                if not isinstance(data, list) or len(data) != 1 or data[0].get("id") != model_id:
                    raise canonical.RuntimeBuildError("Pinned Windows engine returned wrong model identity")
                completion = request_json(port, "/v1/chat/completions", token, {
                    "model": model_id,
                    "messages": [{"role": "user", "content": "Responda apenas: teste"}],
                    "max_tokens": 20, "temperature": 0, "stream": False,
                }, timeout=180)
                choices = completion.get("choices")
                if not isinstance(choices, list) or len(choices) != 1:
                    raise canonical.RuntimeBuildError("Windows inference returned invalid completion")
                answer = choices[0].get("message")
                if not isinstance(answer, dict) or not isinstance(answer.get("content"), str) or not answer["content"].strip():
                    raise canonical.RuntimeBuildError("Windows inference returned no actual generated text")
                if any(k in answer for k in ("tool_calls", "function_call")):
                    raise canonical.RuntimeBuildError("Windows consultative inference advertised tool authority")
                return {"real_model_loaded": True, "real_completion": True,
                        "model_id": model_id, "local_loopback": True}
            finally:
                if process is not None:
                    if process.poll() is None:
                        process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)
    finally:
        key_file.unlink(missing_ok=True)
        startup_stderr.unlink(missing_ok=True)


def validate_proof_paths(out_dir, cache_dir):
    """Validate proof destinations before downloads, native builds or cleanup."""
    requested_output = Path(out_dir).expanduser().absolute()
    requested_cache = Path(cache_dir).expanduser().absolute()

    def overlaps(first, second):
        return first == second or first in second.parents or second in first.parents

    def reject_overlap(output, cache):
        workspace = cache.parent / "ordax-windows-inference-native-build"
        if (
            overlaps(output, cache) or overlaps(output, workspace)
            or overlaps(cache, workspace)
        ):
            raise canonical.RuntimeBuildError(
                "Windows proof output, model cache and build workspace must not overlap"
            )
        return workspace

    # Catch literal parent/child paths before any directories are created.
    reject_overlap(requested_output, requested_cache)
    # Validate every existing component before resolving DOS 8.3 aliases.
    # Comparing mixed RUNNER~1 and runneradmin spellings would otherwise
    # miss equal/overlapping paths on Windows.
    output_parent = canonical.require_real_directory(
        requested_output.parent, "Windows proof output parent"
    )
    cache_parent = canonical.require_real_directory(
        requested_cache.parent, "Windows inference cache parent"
    )
    output = output_parent / requested_output.name
    cache = cache_parent / requested_cache.name
    workspace = reject_overlap(output, cache)
    if output.is_symlink() or output.exists():
        raise canonical.RuntimeBuildError("Windows proof output must be a new real directory")
    cache = canonical.require_real_directory(cache, "Windows inference cache", create=True)
    if workspace.is_symlink() or workspace.exists():
        raise canonical.RuntimeBuildError("Windows build workspace must start absent and clean")
    return output, cache

@contextmanager
def fixed_windows_workspace(cache_dir: Path):
    # Build path is an input to upstream __FILE__ assertions/log strings.
    # Reuse one stable absolute source location for each fully independent,
    # clean compilation, rather than a new randomized TemporaryDirectory.
    # The output of each build is copied to a separate, immutable receipt.
    cache_dir = canonical.require_real_directory(cache_dir, "Windows inference cache")
    workspace = cache_dir.parent / "ordax-windows-inference-native-build"
    if workspace.exists() or workspace.is_symlink():
        raise canonical.RuntimeBuildError("Windows build workspace must start absent and clean")
    workspace.mkdir(mode=0o700)
    try:
        yield workspace
    finally:
        shutil.rmtree(workspace)


def prove(os_source, out_dir, cache_dir):
    assert_windows_x64()
    canonical.configure_os_source(os_source)
    lock = canonical.load_source_lock()
    # Match the Linux builder: dirty OS policy/license bytes must fail BEFORE
    # the expensive model download and two independent native compilations.
    os_source_commit = canonical.attest_os_committed_inputs(lock)
    out_dir, cache_dir = validate_proof_paths(out_dir, cache_dir)
    with fixed_windows_workspace(cache_dir) as temp:
        folder, files, version = build_windows_engine(lock, temp, cache_dir)
        model = download_verified_model(lock, cache_dir)
        evidence = prove_real_offline_inference(folder / "llama-server.exe", model, lock["model"]["id"], temp)
        out_dir.mkdir(parents=True, exist_ok=False)
        destination = out_dir / "engine"
        destination.mkdir()
        records = []
        for file in files:
            target = destination / file.name
            shutil.copyfile(file, target)
            records.append({"name": file.name, "sha256": canonical.sha256_file(target),
                            "size_bytes": target.stat().st_size})
        receipt = {
            "$schema": "prototype-ordax.windows-inference-candidate/1",
            "platform": "windows-x86_64", "binary_format": "PE",
            "engine_source_commit": lock["engine"]["commit"],
            "os_source_commit": os_source_commit,
            "os_source_lock_sha256": canonical.sha256_file(canonical.SOURCE_LOCK),
            "model": {"id": lock["model"]["id"], "sha256": lock["model"]["sha256"],
                      "size_bytes": lock["model"]["size_bytes"]},
            "files": records, "version": version, "proof": evidence,
            "activation_authorized": False, "signed_release": False,
            "model_bytes_included": False,
        }
        (out_dir / "candidate-receipt.json").write_text(
            json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--os-source", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = prove(args.os_source, args.out_dir, args.cache_dir)
    except (canonical.RuntimeBuildError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f"windows-inference-candidate: ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
