#!/usr/bin/env python3
"""Build the immutable local inference runtime for Stable/MVP USB.

Network access is permitted only while building pinned upstream inputs.
The resulting EROFS is offline, non-activating, and has no physical-write authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = ROOT / "system/services/local-ai/source-lock.json"
CONTRACT = ROOT / "docs/contracts/local-ai.json"
UUID_NAMESPACE = uuid.UUID("5e80a621-8a05-5d58-8b70-4403ec424b51")
VOLUME_LABEL = "ORDAX-AI"
DEFAULT_PORT = 17865
MAX_LICENSE_BYTES = 2 << 20

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
REVISION_RE = re.compile(r"^[0-9a-f]{7,64}$")
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$")


class RuntimeBuildError(RuntimeError):
    pass


def run(argv, *, cwd=None, env=None, capture=False):
    try:
        return subprocess.run(
            argv,
            cwd=cwd,
            env=env,
            check=True,
            text=True,
            capture_output=capture,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeBuildError("command failed: " + " ".join(map(str, argv))) from exc


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path, label):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeBuildError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeBuildError(f"{label} must be a JSON object")
    return value


def load_source_lock(path=SOURCE_LOCK):
    lock = load_json(path, "local AI source lock")
    if lock.get("$schema") != "prototype-ordax.local-ai-source-lock/1":
        raise RuntimeBuildError("unexpected local AI source lock schema")
    engine = lock.get("engine")
    model = lock.get("model")
    distribution = lock.get("distribution")
    runtime = lock.get("runtime_security")
    defaults = lock.get("runtime_defaults")
    if not all(isinstance(v, dict) for v in (engine, model, distribution, runtime, defaults)):
        raise RuntimeBuildError("local AI source lock is missing required sections")

    if engine.get("id") != "llama.cpp":
        raise RuntimeBuildError("initial builder only accepts llama.cpp")
    if engine.get("repository") != "https://github.com/ggml-org/llama.cpp":
        raise RuntimeBuildError("unexpected llama.cpp repository")
    if not COMMIT_RE.fullmatch(str(engine.get("commit", ""))):
        raise RuntimeBuildError("llama.cpp source commit is not exact 40-hex")
    if engine.get("license") != "MIT" or engine.get("build_targets") != ["llama-server"]:
        raise RuntimeBuildError("unexpected llama.cpp build identity")
    engine_artifact = engine.get("artifact")
    if not isinstance(engine_artifact, dict) or set(engine_artifact) != {
        "platform",
        "binary_format",
        "linkage",
        "sha256",
        "size_bytes",
    }:
        raise RuntimeBuildError("engine artifact pin is missing or malformed")
    if (
        engine_artifact.get("platform") != "linux-x86_64"
        or engine_artifact.get("binary_format") != "ELF"
        or engine_artifact.get("linkage") != "static"
        or not SHA256_RE.fullmatch(str(engine_artifact.get("sha256", "")))
        or not isinstance(engine_artifact.get("size_bytes"), int)
        or not 0 < engine_artifact["size_bytes"] <= 512 << 20
    ):
        raise RuntimeBuildError("engine artifact pin is invalid")

    if not SAFE_ID_RE.fullmatch(str(model.get("id", ""))):
        raise RuntimeBuildError("model id is unsafe")
    if not isinstance(model.get("repository"), str) or "/" not in model["repository"]:
        raise RuntimeBuildError("model repository is invalid")
    if not isinstance(model.get("filename"), str) or Path(model["filename"]).name != model["filename"]:
        raise RuntimeBuildError("model filename is unsafe")
    if model.get("format") != "GGUF" or model.get("quantization") != "Q4_0":
        raise RuntimeBuildError("unexpected model format or quantization")
    if not SHA256_RE.fullmatch(str(model.get("sha256", ""))):
        raise RuntimeBuildError("model SHA-256 is invalid")
    if not isinstance(model.get("size_bytes"), int) or not 0 < model["size_bytes"] <= 4 << 30:
        raise RuntimeBuildError("model size is outside bounds")
    if not REVISION_RE.fullmatch(str(model.get("upstream_revision", ""))):
        raise RuntimeBuildError("model revision is not pinned")
    if model.get("download_at_build_time_only") is not True:
        raise RuntimeBuildError("model must be a build-time-only network input")
    # A distributable model must have the reviewed license identity as well
    # as the corresponding vendored legal text. A changed upstream model/license
    # requires a new reviewed source-lock, not a mislabeled release artifact.
    if model.get("license") != "Apache-2.0":
        raise RuntimeBuildError("model license is not approved for the pinned MVP candidate")
    license_path = model.get("license_text_path")
    if license_path != "third_party/licenses/Apache-2.0.txt":
        raise RuntimeBuildError("model license text must be vendored at the canonical path")

    if distribution.get("network_download_required_at_runtime") is not False:
        raise RuntimeBuildError("runtime network download must remain forbidden")
    if distribution.get("signed_release_artifact_required") is not True:
        raise RuntimeBuildError("signed release gate is required")
    if distribution.get("initial_release_schema_target") != "prototype-ordax.release-manifest/4":
        raise RuntimeBuildError("local AI runtime must target release-manifest/4")

    required_security = {
        "listen_host": "127.0.0.1",
        "listen_port": DEFAULT_PORT,
        "web_ui_enabled": False,
        "built_in_tools_enabled": False,
        "agent_mode_enabled": False,
        "mcp_proxy_enabled": False,
        "runtime_model_download_allowed": False,
    }
    if runtime != required_security:
        raise RuntimeBuildError("local AI runtime security policy drifted")
    if defaults != {"reasoning": "off"}:
        raise RuntimeBuildError("initial local AI runtime defaults drifted")

    contract = load_json(CONTRACT, "local AI contract")
    if contract.get("$schema") != "prototype-ordax.local-ai/1":
        raise RuntimeBuildError("unexpected local AI contract schema")
    if contract.get("required_for_boot") is not False:
        raise RuntimeBuildError("local AI must remain non-boot-critical")
    if contract.get("required_for_stable_mvp_distribution") is not True:
        raise RuntimeBuildError("local AI distribution requirement was lost")
    if contract.get("runtime", {}).get("listen_scope") != "127.0.0.1-only":
        raise RuntimeBuildError("loopback-only contract was lost")
    if contract.get("runtime", {}).get("exact_engine_artifact_pinned") is not True:
        raise RuntimeBuildError("local AI contract must require an exact engine artifact pin")
    return lock


def source_commit():
    value = os.environ.get("ORDAX_SOURCE_COMMIT", "").strip().lower()
    if not value:
        value = run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture=True).stdout.strip().lower()
    if not COMMIT_RE.fullmatch(value):
        raise RuntimeBuildError("OrdaX source commit must be lowercase 40-hex")
    return value


def model_url(lock):
    model = lock["model"]
    return (
        f"https://huggingface.co/{model['repository']}/resolve/"
        f"{model['upstream_revision']}/{model['filename']}?download=true"
    )


def download_exact(url, destination, expected_sha256, expected_size):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if (
        destination.is_file()
        and destination.stat().st_size == expected_size
        and sha256_file(destination) == expected_sha256
    ):
        return destination
    if destination.exists() or destination.is_symlink():
        destination.unlink()
    part = destination.with_name(destination.name + ".part")
    part.unlink(missing_ok=True)
    digest = hashlib.sha256()
    total = 0
    request = urllib.request.Request(url, headers={"User-Agent": "OrdaX-local-ai-builder/1"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response, part.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > expected_size:
                    raise RuntimeBuildError("download exceeded exact pinned size")
                digest.update(chunk)
                output.write(chunk)
    except Exception as exc:
        part.unlink(missing_ok=True)
        if isinstance(exc, RuntimeBuildError):
            raise
        raise RuntimeBuildError(f"download failed: {url}: {exc}") from exc
    if total != expected_size:
        part.unlink(missing_ok=True)
        raise RuntimeBuildError(f"download size mismatch: expected={expected_size} actual={total}")
    actual = digest.hexdigest()
    if actual != expected_sha256:
        part.unlink(missing_ok=True)
        raise RuntimeBuildError(f"download digest mismatch: expected={expected_sha256} actual={actual}")
    part.replace(destination)
    return destination


def download_bounded(url, destination, max_bytes=MAX_LICENSE_BYTES):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "OrdaX-local-ai-builder/1"})
    data = bytearray()
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > max_bytes:
                    raise RuntimeBuildError("bounded download exceeded maximum size")
    except Exception as exc:
        if isinstance(exc, RuntimeBuildError):
            raise
        raise RuntimeBuildError(f"bounded download failed: {url}: {exc}") from exc
    if not data:
        raise RuntimeBuildError("bounded download returned empty content")
    destination.write_bytes(bytes(data))
    return destination


def prepare_engine_mirror(lock, cache_dir):
    mirror = Path(cache_dir) / "llama.cpp.git"
    repository = lock["engine"]["repository"]
    commit = lock["engine"]["commit"]
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    if mirror.exists() and not (mirror / "HEAD").is_file():
        raise RuntimeBuildError("llama.cpp mirror cache is unsafe")
    if not mirror.exists():
        run(["git", "init", "--bare", str(mirror)])
        run(["git", "-C", str(mirror), "remote", "add", "origin", repository])
    remote = run(["git", "-C", str(mirror), "remote", "get-url", "origin"], capture=True).stdout.strip()
    if remote != repository:
        raise RuntimeBuildError("llama.cpp mirror remote differs from source lock")
    run([
        "git", "-C", str(mirror), "fetch", "--depth=1", "--no-tags",
        "origin", commit + ":refs/ordax/pinned",
    ])
    actual = run(
        ["git", "-C", str(mirror), "rev-parse", "refs/ordax/pinned^{commit}"],
        capture=True,
    ).stdout.strip().lower()
    if actual != commit:
        raise RuntimeBuildError("llama.cpp mirror resolved wrong commit")
    run(["git", "-C", str(mirror), "fsck", "--strict", "--no-dangling"])
    return mirror


def checkout_engine(lock, mirror, destination):
    commit = lock["engine"]["commit"]
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    archive = destination.parent / "llama.cpp-source.tar"
    run([
        "git",
        "--git-dir", str(mirror),
        "archive",
        "--format=tar",
        "--output", str(archive),
        "refs/ordax/pinned",
    ])
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size <= 0:
        raise RuntimeBuildError("llama.cpp source archive was not created safely")
    with tarfile.open(archive, "r") as tar:
        members = []
        for member in tar.getmembers():
            name = member.name
            if not name or name.startswith("/") or ".." in Path(name).parts:
                raise RuntimeBuildError(f"unsafe llama.cpp archive path: {name}")
            if member.isdev() or member.isfifo():
                raise RuntimeBuildError(f"unsupported llama.cpp archive object: {name}")
            members.append(member)
        tar.extractall(destination, members=members, filter="data")
    archive.unlink()
    if (destination / ".git").exists():
        raise RuntimeBuildError("llama.cpp source export unexpectedly contains Git metadata")
    gitmodules = destination / ".gitmodules"
    if gitmodules.exists():
        if gitmodules.is_symlink() or not gitmodules.is_file():
            raise RuntimeBuildError("llama.cpp .gitmodules path is unsafe")
        if gitmodules.read_text(encoding="utf-8").strip():
            raise RuntimeBuildError("unreviewed llama.cpp submodules are forbidden")
    if not (destination / "CMakeLists.txt").is_file() or not (destination / "tools/server/CMakeLists.txt").is_file():
        raise RuntimeBuildError("llama.cpp source export is incomplete")
    actual = run(
        ["git", "--git-dir", str(mirror), "rev-parse", "refs/ordax/pinned^{commit}"],
        capture=True,
    ).stdout.strip().lower()
    if actual != commit:
        raise RuntimeBuildError("llama.cpp exported source differs from pin")


def deterministic_env():
    env = dict(os.environ)
    env.update({"SOURCE_DATE_EPOCH": "0", "TZ": "UTC", "LC_ALL": "C", "LANG": "C"})
    return env


def build_engine(lock, source, work):
    build_dir = Path(work) / "build"
    commit = lock["engine"]["commit"]
    prefix = (
        f"-ffile-prefix-map={work}=/usr/src/ordax-local-ai "
        f"-fdebug-prefix-map={work}=/usr/src/ordax-local-ai"
    )
    run(
        [
            "cmake",
            "-S", str(source),
            "-B", str(build_dir),
            "-G", "Ninja",
            "-DCMAKE_BUILD_TYPE=Release",
            "-DBUILD_SHARED_LIBS=OFF",
            "-DLLAMA_BUILD_TESTS=OFF",
            "-DLLAMA_BUILD_EXAMPLES=OFF",
            "-DLLAMA_BUILD_TOOLS=ON",
            "-DLLAMA_BUILD_SERVER=ON",
            "-DLLAMA_BUILD_APP=OFF",
            "-DLLAMA_BUILD_UI=OFF",
            "-DLLAMA_USE_PREBUILT_UI=OFF",
            "-DLLAMA_OPENSSL=OFF",
            "-DLLAMA_SUBPROCESS=OFF",
            "-DGGML_NATIVE=OFF",
            "-DGGML_CCACHE=OFF",
            "-DGGML_OPENMP=OFF",
            "-DGGML_BLAS=OFF",
            "-DGGML_LLAMAFILE=OFF",
            "-DGGML_BACKEND_DL=OFF",
            "-DGGML_BUILD_TESTS=OFF",
            "-DGGML_BUILD_EXAMPLES=OFF",
            "-DLLAMA_BUILD_NUMBER=0",
            f"-DLLAMA_BUILD_COMMIT={commit}",
            f"-DGGML_BUILD_COMMIT={commit}",
            "-DCMAKE_EXE_LINKER_FLAGS=-static",
            f"-DCMAKE_C_FLAGS_RELEASE=-O3 -DNDEBUG {prefix}",
            f"-DCMAKE_CXX_FLAGS_RELEASE=-O3 -DNDEBUG {prefix}",
        ],
        env=deterministic_env(),
    )
    run(
        ["cmake", "--build", str(build_dir), "--target", "llama-server", "--parallel", "2"],
        env=deterministic_env(),
    )
    binary = build_dir / "bin/llama-server"
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise RuntimeBuildError("llama-server build did not produce executable")
    return binary


def verify_static_engine(binary, lock):
    program_headers = run(["readelf", "-l", str(binary)], capture=True).stdout
    if "INTERP" in program_headers:
        raise RuntimeBuildError("llama-server must not depend on a host dynamic loader")
    version_result = subprocess.run(
        [str(binary), "--version"],
        check=False,
        text=True,
        capture_output=True,
    )
    version = (version_result.stdout + version_result.stderr).strip()
    if version_result.returncode != 0 or "llama" not in version.lower():
        raise RuntimeBuildError("llama-server version probe failed")
    if lock["engine"]["commit"][:7] not in version and lock["engine"]["commit"][:8] not in version:
        raise RuntimeBuildError("llama-server version does not identify pinned commit")
    return {
        "sha256": sha256_file(binary),
        "size": binary.stat().st_size,
        "static": True,
        "version_output": version[:512],
    }


def launcher_text(lock):
    model = lock["model"]
    return f"""#!/bin/sh
set -eu
runtime_root=${{ORDAX_LOCAL_AI_RUNTIME_ROOT:-/run/ordax/runtime/local-ai}}
exec "$runtime_root/bin/llama-server" \
  --host 127.0.0.1 \
  --port {DEFAULT_PORT} \
  --model "$runtime_root/models/{model['filename']}" \
  --alias "{model['id']}" \
  --reasoning off \
  --no-ui \
  --no-slots
"""


def normalize_tree(root):
    root = Path(root)
    for path in [root] + sorted(root.rglob("*")):
        if path.is_symlink():
            raise RuntimeBuildError(f"runtime tree contains symlink: {path}")
        os.utime(path, (0, 0), follow_symlinks=False)


def write_tree_manifest(root, destination):
    root = Path(root)
    entries = []
    for path in sorted(root.rglob("*"), key=lambda p: p.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        info = path.lstat()
        mode = stat.S_IMODE(info.st_mode)
        if path.is_dir():
            entries.append({"path": relative, "type": "dir", "mode": mode})
        elif path.is_file():
            entries.append(
                {
                    "path": relative,
                    "type": "file",
                    "mode": mode,
                    "size": info.st_size,
                    "sha256": sha256_file(path),
                }
            )
        else:
            raise RuntimeBuildError(f"unsupported runtime object: {relative}")
    payload = {
        "$schema": "prototype-ordax.local-ai-runtime-tree/1",
        "entry_count": len(entries),
        "entries": entries,
    }
    Path(destination).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return sha256_file(destination)


def normalized_tar(root, destination):
    root = Path(root)
    entries = [root] + sorted(root.rglob("*"), key=lambda p: p.relative_to(root).as_posix())
    with tarfile.open(destination, "w", format=tarfile.USTAR_FORMAT, dereference=True) as archive:
        for path in entries:
            relative = "." if path == root else path.relative_to(root).as_posix()
            info = archive.gettarinfo(str(path), arcname=relative)
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            if info.isfile():
                with path.open("rb") as handle:
                    archive.addfile(info, handle)
            elif info.isdir():
                archive.addfile(info)
            else:
                raise RuntimeBuildError(f"unsupported tar object: {relative}")


def erofs_identity(path):
    result = run(["blkid", "-p", "-o", "export", str(path)], capture=True)
    values = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def build(out_dir, cache_dir):
    lock = load_source_lock()
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        raise RuntimeBuildError("local AI build requires x86_64 Linux")
    for program in ("git", "cmake", "ninja", "g++", "readelf", "mkfs.erofs", "fsck.erofs", "blkid"):
        if shutil.which(program) is None:
            raise RuntimeBuildError(f"required build tool missing: {program}")

    out_dir = Path(out_dir).resolve()
    cache_dir = Path(cache_dir).resolve()
    if out_dir.exists() and any(out_dir.iterdir()):
        raise RuntimeBuildError("output directory must be empty")
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    model = lock["model"]
    model_path = download_exact(
        model_url(lock),
        cache_dir / model["filename"],
        model["sha256"],
        model["size_bytes"],
    )
    model_license = ROOT / model["license_text_path"]
    if model_license.is_symlink() or not model_license.is_file() or not 0 < model_license.stat().st_size <= MAX_LICENSE_BYTES:
        raise RuntimeBuildError("vendored model license is missing or unsafe")
    mirror = prepare_engine_mirror(lock, cache_dir)

    work = Path(tempfile.mkdtemp(prefix="ordax-local-ai-runtime-"))
    try:
        source = work / "llama.cpp"
        checkout_engine(lock, mirror, source)
        engine = build_engine(lock, source, work)
        engine_identity = verify_static_engine(engine, lock)
        engine_pin = lock["engine"]["artifact"]
        if (
            engine_identity["sha256"] != engine_pin["sha256"]
            or engine_identity["size"] != engine_pin["size_bytes"]
        ):
            raise RuntimeBuildError(
                "built llama-server differs from exact pinned engine artifact: "
                f"actual_sha256={engine_identity['sha256']} "
                f"actual_size={engine_identity['size']} "
                f"expected_sha256={engine_pin['sha256']} "
                f"expected_size={engine_pin['size_bytes']}"
            )

        engine_license = source / "LICENSE"
        if (
            engine_license.is_symlink()
            or not engine_license.is_file()
            or not 0 < engine_license.stat().st_size <= MAX_LICENSE_BYTES
        ):
            raise RuntimeBuildError("llama.cpp license is missing or unsafe")

        runtime = work / "runtime"
        for directory in ("bin", "models", "metadata", "licenses"):
            (runtime / directory).mkdir(parents=True, exist_ok=True)
        shutil.copy2(engine, runtime / "bin/llama-server")
        (runtime / "bin/llama-server").chmod(0o755)
        (runtime / "bin/ordax-local-ai").write_text(launcher_text(lock), encoding="utf-8")
        (runtime / "bin/ordax-local-ai").chmod(0o755)
        shutil.copy2(model_path, runtime / "models" / model["filename"])
        shutil.copy2(SOURCE_LOCK, runtime / "metadata/source-lock.json")
        shutil.copy2(engine_license, runtime / "licenses/llama.cpp-MIT.txt")
        shutil.copy2(model_license, runtime / "licenses/model-Apache-2.0.txt")

        policy = {
            "$schema": "prototype-ordax.local-ai-runtime-policy/1",
            "contract": "ordax.local-ai/1",
            **lock["runtime_security"],
            "runtime_defaults": lock["runtime_defaults"],
            "model_id": model["id"],
            "model_filename": model["filename"],
        }
        (runtime / "metadata/runtime-policy.json").write_text(
            json.dumps(policy, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        normalize_tree(runtime)
        tree_manifest = out_dir / "local-ai-runtime-tree.json"
        tree_sha = write_tree_manifest(runtime, tree_manifest)

        tar_path = work / "local-ai-runtime.tar"
        normalized_tar(runtime, tar_path)
        tar_sha = sha256_file(tar_path)
        image_uuid = str(uuid.uuid5(UUID_NAMESPACE, tar_sha))
        image = out_dir / "local-ai-runtime.erofs"
        run(
            [
                "mkfs.erofs",
                "--tar=f",
                "-zlz4",
                "-T", "0",
                "-U", image_uuid,
                "-L", VOLUME_LABEL,
                "--all-root",
                str(image),
                str(tar_path),
            ]
        )
        run(["fsck.erofs", str(image)])
        identity = erofs_identity(image)
        if (
            identity.get("TYPE") != "erofs"
            or identity.get("LABEL") != VOLUME_LABEL
            or identity.get("UUID", "").lower() != image_uuid
        ):
            raise RuntimeBuildError("local AI EROFS identity mismatch")

        provenance = {
            "$schema": "prototype-ordax.local-ai-runtime-provenance/1",
            "status": "candidate-not-promotable",
            "source_commit": source_commit(),
            "source_lock_sha256": sha256_file(SOURCE_LOCK),
            "engine": {
                "id": lock["engine"]["id"],
                "source_commit": lock["engine"]["commit"],
                "license": lock["engine"]["license"],
                "platform": engine_pin["platform"],
                "binary_format": engine_pin["binary_format"],
                "linkage": engine_pin["linkage"],
                **engine_identity,
            },
            "model": {
                "id": model["id"],
                "repository": model["repository"],
                "upstream_revision": model["upstream_revision"],
                "filename": model["filename"],
                "sha256": sha256_file(model_path),
                "size": model_path.stat().st_size,
                "license": model["license"],
            },
            "licenses": {
                "engine_sha256": sha256_file(engine_license),
                "model_sha256": sha256_file(model_license),
            },
            "runtime_security": lock["runtime_security"],
            "runtime_defaults": lock["runtime_defaults"],
            "tree_manifest_sha256": tree_sha,
            "normalized_tar_sha256": tar_sha,
            "image": {
                "name": image.name,
                "filesystem": "erofs",
                "label": VOLUME_LABEL,
                "uuid": image_uuid,
                "sha256": sha256_file(image),
                "size": image.stat().st_size,
            },
            "release_schema_target": "prototype-ordax.release-manifest/4",
            "activation_performed": False,
            "physical_artifact_authorized": False,
            "physical_write_authorized": False,
        }
        (out_dir / "local-ai-runtime-provenance.json").write_text(
            json.dumps(provenance, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return provenance
    finally:
        shutil.rmtree(work, ignore_errors=True)


def verify(out_dir):
    lock = load_source_lock()
    out_dir = Path(out_dir).resolve()
    image = out_dir / "local-ai-runtime.erofs"
    provenance_path = out_dir / "local-ai-runtime-provenance.json"
    tree_path = out_dir / "local-ai-runtime-tree.json"
    for path, label in (
        (image, "local AI EROFS"),
        (provenance_path, "local AI provenance"),
        (tree_path, "local AI tree manifest"),
    ):
        if path.is_symlink() or not path.is_file():
            raise RuntimeBuildError(f"{label} is missing or unsafe")
    provenance = load_json(provenance_path, "local AI provenance")
    if provenance.get("$schema") != "prototype-ordax.local-ai-runtime-provenance/1":
        raise RuntimeBuildError("unexpected provenance schema")
    if provenance.get("status") != "candidate-not-promotable":
        raise RuntimeBuildError("candidate crossed promotion boundary")
    if provenance.get("source_lock_sha256") != sha256_file(SOURCE_LOCK):
        raise RuntimeBuildError("source-lock binding changed")
    if provenance.get("model", {}).get("sha256") != lock["model"]["sha256"]:
        raise RuntimeBuildError("model hash pin was lost")
    if provenance.get("model", {}).get("size") != lock["model"]["size_bytes"]:
        raise RuntimeBuildError("model size pin was lost")
    if provenance.get("engine", {}).get("source_commit") != lock["engine"]["commit"]:
        raise RuntimeBuildError("engine source pin was lost")
    engine_pin = lock["engine"]["artifact"]
    if provenance.get("engine", {}).get("sha256") != engine_pin["sha256"]:
        raise RuntimeBuildError("engine artifact hash pin was lost")
    if provenance.get("engine", {}).get("size") != engine_pin["size_bytes"]:
        raise RuntimeBuildError("engine artifact size pin was lost")
    if provenance.get("engine", {}).get("platform") != engine_pin["platform"]:
        raise RuntimeBuildError("engine artifact platform pin was lost")
    if provenance.get("engine", {}).get("binary_format") != engine_pin["binary_format"]:
        raise RuntimeBuildError("engine artifact format pin was lost")
    if provenance.get("engine", {}).get("linkage") != engine_pin["linkage"]:
        raise RuntimeBuildError("engine artifact linkage pin was lost")
    if provenance.get("engine", {}).get("static") is not True:
        raise RuntimeBuildError("engine is not recorded as static")
    if provenance.get("runtime_security") != lock["runtime_security"]:
        raise RuntimeBuildError("runtime security policy drifted")
    if provenance.get("runtime_defaults") != lock["runtime_defaults"]:
        raise RuntimeBuildError("runtime default policy drifted")
    if provenance.get("tree_manifest_sha256") != sha256_file(tree_path):
        raise RuntimeBuildError("tree manifest differs from provenance")
    if provenance.get("image", {}).get("sha256") != sha256_file(image):
        raise RuntimeBuildError("EROFS digest differs from provenance")
    if provenance.get("activation_performed") is not False:
        raise RuntimeBuildError("builder unexpectedly activated a release")
    if provenance.get("physical_write_authorized") is not False:
        raise RuntimeBuildError("builder unexpectedly authorized physical write")
    run(["fsck.erofs", str(image)])
    identity = erofs_identity(image)
    if identity.get("TYPE") != "erofs" or identity.get("LABEL") != VOLUME_LABEL:
        raise RuntimeBuildError("EROFS filesystem identity mismatch")
    return provenance


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--out-dir", type=Path, required=True)
    build_parser.add_argument("--cache-dir", type=Path, required=True)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = build(args.out_dir, args.cache_dir) if args.command == "build" else verify(args.out_dir)
    except (RuntimeBuildError, OSError, json.JSONDecodeError) as exc:
        print(f"local-ai-runtime-build: ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
