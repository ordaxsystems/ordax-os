#!/usr/bin/env python3
"""Repository-owned deterministic OrdaX initramfs builder.

No legacy initramfs is imported. The fixed capsule contains a static BusyBox,
a minimal repository-owned ext4 growth helper, and the small PID 1 script owned
by this repository. Network/release acquisition lives on the ORDAX partition
and is intentionally outside this fixed archive.
"""

from __future__ import annotations

import argparse
import gzip
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / "bootstrap" / "initramfs"
CONTRACT = HERE / "source.json"
GROW_HELPER_SOURCE = HERE / "grow_ext4.c"
PORTABLE_STATE_HELPER_SOURCE = HERE / "portable_state.c"
PORTABLE_MOUNT_HELPER_SOURCE = HERE / "portable_mount.c"
PORTABLE_CAPSULE_VERIFY_SOURCE = HERE / "portable_capsule_verify.sh"
PORTABLE_BASE_VERIFY_SOURCE = HERE / "portable_base_verify.sh"
PORTABLE_INIT_SOURCE = HERE / "portable_init.sh"
KERNEL_BUILDER_PATH = ROOT / "bootstrap" / "kernel" / "build.py"


def _load_repo_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load repository module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


KERNEL_BUILD = _load_repo_module("ordax_kernel_build_for_initramfs", KERNEL_BUILDER_PATH)
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_SAFE_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
REQUIRED_APPLETS = {
    "blkid", "cat", "chmod", "cp", "echo", "findfs", "losetup", "mkdir", "mount",
    "poweroff", "reboot", "sh", "sha256sum", "sleep", "switch_root", "sync", "test",
    "[", "umount",
}
REQUESTED_CONFIG = {
    "CONFIG_BUSYBOX": "y",
    "CONFIG_STATIC": "y",
    "CONFIG_ASH": "y",
    "CONFIG_SH_IS_ASH": "y",
    "CONFIG_BLKID": "y",
    "CONFIG_CAT": "y",
    "CONFIG_CHMOD": "y",
    "CONFIG_CP": "y",
    "CONFIG_ECHO": "y",
    "CONFIG_FINDFS": "y",
    "CONFIG_LOSETUP": "y",
    "CONFIG_MKDIR": "y",
    "CONFIG_MOUNT": "y",
    "CONFIG_FEATURE_MOUNT_FLAGS": "y",
    "CONFIG_FEATURE_MOUNT_LOOP": "y",
    "CONFIG_POWEROFF": "y",
    "CONFIG_REBOOT": "y",
    "CONFIG_SHA256SUM": "y",
    "CONFIG_FEATURE_MD5_SHA1_SUM_CHECK": "y",
    "CONFIG_SLEEP": "y",
    "CONFIG_SWITCH_ROOT": "y",
    "CONFIG_SYNC": "y",
    "CONFIG_TEST": "y",
    "CONFIG_TEST1": "y",
    "CONFIG_FEATURE_TEST_64": "y",
    "CONFIG_UMOUNT": "y",
    "CONFIG_FEATURE_VOLUMEID_EXT": "y",
    "CONFIG_FEATURE_VOLUMEID_EXFAT": "y",
    "CONFIG_FEATURE_VOLUMEID_FAT": "y",
}
FIXED_ENV = {
    "SOURCE_DATE_EPOCH": "0",
    "KBUILD_BUILD_TIMESTAMP": "1970-01-01 00:00:00 UTC",
    "KBUILD_BUILD_USER": "ordax",
    "KBUILD_BUILD_HOST": "build",
    "TZ": "UTC",
    "LC_ALL": "C",
    "LANG": "C",
}


class BuildError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_contract() -> dict:
    try:
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"cannot read initramfs source contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.initramfs-source/1":
        raise BuildError("unexpected initramfs source contract schema")
    busybox = value.get("busybox", {})
    if not _SAFE_VERSION.fullmatch(str(busybox.get("version", ""))):
        raise BuildError("invalid BusyBox version")
    if not _SHA256.fullmatch(str(busybox.get("archive_sha256", ""))):
        raise BuildError("invalid BusyBox archive SHA-256")
    return value


def init_path(contract: dict) -> Path:
    relative = contract.get("root_init")
    if not isinstance(relative, str):
        raise BuildError("root_init is missing")
    path = (ROOT / relative).resolve()
    if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
        raise BuildError("root_init is missing or unsafe")
    return path


def growth_helper_source_path() -> Path:
    path = GROW_HELPER_SOURCE.resolve()
    if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
        raise BuildError("ext4 growth helper source is missing or unsafe")
    return path


def portable_state_helper_source_path() -> Path:
    path = PORTABLE_STATE_HELPER_SOURCE.resolve()
    if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
        raise BuildError("portable activation-state helper source is missing or unsafe")
    return path


def portable_mount_helper_source_path() -> Path:
    path = PORTABLE_MOUNT_HELPER_SOURCE.resolve()
    if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
        raise BuildError("portable mount helper source is missing or unsafe")
    return path


def portable_capsule_verify_source_path() -> Path:
    path = PORTABLE_CAPSULE_VERIFY_SOURCE.resolve()
    if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
        raise BuildError("portable capsule verifier source is missing or unsafe")
    return path


def portable_base_verify_source_path() -> Path:
    path = PORTABLE_BASE_VERIFY_SOURCE.resolve()
    if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
        raise BuildError("portable Stable Base verifier source is missing or unsafe")
    return path


def portable_init_source_path() -> Path:
    path = PORTABLE_INIT_SOURCE.resolve()
    if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
        raise BuildError("portable-v2 candidate PID1 source is missing or unsafe")
    return path


def check_contract() -> dict:
    contract = load_contract()
    init = init_path(contract)
    helper_source = growth_helper_source_path()
    portable_state_source = portable_state_helper_source_path()
    portable_mount_source = portable_mount_helper_source_path()
    portable_capsule_verify_source = portable_capsule_verify_source_path()
    portable_base_verify_source = portable_base_verify_source_path()
    portable_init_source = portable_init_source_path()
    text = init.read_text(encoding="utf-8")
    forbidden = ("ORDAX-HOME", "ORDAX-PLATFORM", "sshd", "remote-core", "control-plane", "codex")
    found = [value for value in forbidden if value.lower() in text.lower()]
    if found:
        raise BuildError(f"legacy/high-level responsibility leaked into fixed initramfs: {found}")
    if "findfs LABEL=ORDAX" not in text or "/ordax/bootstrap/entrypoint" not in text:
        raise BuildError("init must hand off through the canonical ORDAX bootstrap path")
    rw_mount = 'mount -t ext4 -o rw,errors=remount-ro "$ORDAX_DEVICE" /ordax'
    health_call = '/sbin/ordax-grow-ext4 --check "$ORDAX_DEVICE"'
    grow_call = '/sbin/ordax-grow-ext4 "$ORDAX_DEVICE" /ordax'
    recovery_mount = 'mount -t ext4 -o ro "$ORDAX_DEVICE" /ordax'
    if rw_mount not in text or health_call not in text or grow_call not in text:
        raise BuildError("normal boot must health-check ORDAX before writable mount and growth")
    if text.index(health_call) > text.index(rw_mount):
        raise BuildError("ext4 health check must run before the rw ORDAX mount")
    if text.index(grow_call) < text.index(rw_mount):
        raise BuildError("ext4 growth helper may run only after the rw ORDAX mount")
    if recovery_mount not in text or text.index(recovery_mount) > text.index(rw_mount):
        raise BuildError("recovery must remain a separate read-only path before normal rw boot")
    recovery_section = text[text.index(recovery_mount):text.index(rw_mount)]
    if grow_call in recovery_section:
        raise BuildError("recovery mode may never invoke online ext4 growth")
    if contract.get("network_inside_fixed_initramfs") is not False:
        raise BuildError("network must remain outside the fixed initramfs")
    kernel_source = KERNEL_BUILD.load_contract()
    expected_uapi_version = contract["portable_v2_prerequisites"]["kernel_uapi_version"]
    if kernel_source["version"] != expected_uapi_version:
        raise BuildError(
            "initramfs/kernel UAPI release drift: "
            f"kernel source={kernel_source['version']} initramfs={expected_uapi_version}"
        )
    return {
        "busybox_version": contract["busybox"]["version"],
        "busybox_archive_sha256": contract["busybox"]["archive_sha256"],
        "root_init": str(init.relative_to(ROOT)),
        "root_init_sha256": sha256_file(init),
        "ext4_growth_helper_source": str(helper_source.relative_to(ROOT)),
        "ext4_growth_helper_source_sha256": sha256_file(helper_source),
        "portable_state_helper_source": str(portable_state_source.relative_to(ROOT)),
        "portable_state_helper_source_sha256": sha256_file(portable_state_source),
        "portable_mount_helper_source": str(portable_mount_source.relative_to(ROOT)),
        "portable_mount_helper_source_sha256": sha256_file(portable_mount_source),
        "portable_capsule_verify_source": str(portable_capsule_verify_source.relative_to(ROOT)),
        "portable_capsule_verify_source_sha256": sha256_file(portable_capsule_verify_source),
        "portable_base_verify_source": str(portable_base_verify_source.relative_to(ROOT)),
        "portable_base_verify_source_sha256": sha256_file(portable_base_verify_source),
        "portable_init_source": str(portable_init_source.relative_to(ROOT)),
        "portable_init_source_sha256": sha256_file(portable_init_source),
        "main_partition_label": contract["main_partition_label"],
        "portable_v2_prerequisites": contract["portable_v2_prerequisites"],
    }


def resolve_program(name: str) -> str:
    value = shutil.which(name)
    if not value:
        raise BuildError(f"required build program not found: {name}")
    return value


def capture(argv: list[str], *, cwd: Path | None = None) -> str:
    try:
        return subprocess.run(
            argv,
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def musl_identity(musl_cc: str) -> dict:
    wrapper = Path(musl_cc).resolve()
    try:
        wrapper_text = wrapper.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise BuildError(f"musl-gcc wrapper is not inspectable: {wrapper}") from exc
    match = re.search(r'-specs(?:=|\s+)["\']([^"\']*musl-gcc\.specs)["\']', wrapper_text)
    if not match:
        raise BuildError("musl-gcc wrapper does not reference musl-gcc.specs")
    specs = Path(match.group(1))
    if not specs.is_absolute():
        specs = (wrapper.parent / specs).resolve()
    if not specs.is_file() or specs.is_symlink():
        raise BuildError(f"musl-gcc specs are missing or unsafe: {specs}")
    specs_text = specs.read_text(encoding="utf-8")
    if "linux-musl" not in specs_text or "ld-musl-" not in specs_text:
        raise BuildError("musl-gcc specs do not identify musl include/linker paths")
    return {
        "compiler": wrapper.name,
        "target": capture([musl_cc, "-dumpmachine"]),
        "wrapper_sha256": sha256_file(wrapper),
        "specs_sha256": sha256_file(specs),
        "musl_specs_verified": True,
    }


def sha256_tree(root: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(
        (path for path in root.rglob("*") if path.is_file() and not path.is_symlink()),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    if not files:
        raise BuildError("kernel UAPI header tree is empty")
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        data = path.read_bytes()
        digest.update(len(data).to_bytes(8, "big"))
        digest.update(data)
    return digest.hexdigest()


def prepare_kernel_uapi(work_dir: Path, env: dict[str, str]) -> dict:
    contract = KERNEL_BUILD.load_contract()
    cache_dir = work_dir / "kernel-uapi-cache"
    archive = KERNEL_BUILD.download_archive(contract, cache_dir)
    # Kernel UAPI headers are another extraction path for the same upstream
    # source. Authenticate *before* reading/extracting signed-source tarballs.
    upstream_authentication = KERNEL_BUILD.authenticate_upstream_archive(
        contract, archive, cache_dir
    )
    source = KERNEL_BUILD.extract_archive(
        archive,
        work_dir / "kernel-uapi-source",
        contract["version"],
    )
    install_root = work_dir / "kernel-uapi-install"
    shutil.rmtree(install_root, ignore_errors=True)
    install_root.mkdir(parents=True)

    run(
        [
            "make",
            "-C",
            str(source),
            "ARCH=x86",
            f"INSTALL_HDR_PATH={install_root}",
            "headers_install",
        ],
        cwd=ROOT,
        env=env,
    )

    include = install_root / "include"
    required = (
        include / "linux" / "version.h",
        include / "linux" / "loop.h",
        include / "linux" / "types.h",
        include / "asm" / "unistd.h",
    )
    for header in required:
        if not header.is_file() or header.is_symlink():
            raise BuildError(
                f"pinned kernel headers_install did not produce required UAPI header: {header}"
            )
    return {
        "include": include,
        "kernel_version": contract["version"],
        "kernel_archive_sha256": sha256_file(archive),
        "kernel_source_contract_sha256": sha256_file(KERNEL_BUILD.SOURCE_CONTRACT),
        "upstream_authentication": upstream_authentication,
        "headers_tree_sha256": sha256_tree(include),
        "linux_version_h_sha256": sha256_file(include / "linux" / "version.h"),
        "linux_loop_h_sha256": sha256_file(include / "linux" / "loop.h"),
    }


def download(contract: dict, destination: Path) -> Path:
    busybox = contract["busybox"]
    archive = destination / f"busybox-{busybox['version']}.tar.bz2"
    if archive.is_file() and sha256_file(archive) == busybox["archive_sha256"]:
        return archive
    destination.mkdir(parents=True, exist_ok=True)
    part = archive.with_suffix(archive.suffix + ".part")
    part.unlink(missing_ok=True)
    try:
        with urllib.request.urlopen(busybox["archive_url"], timeout=120) as response, part.open("wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
    except Exception as exc:
        part.unlink(missing_ok=True)
        raise BuildError(f"BusyBox download failed: {exc}") from exc
    actual = sha256_file(part)
    if actual != busybox["archive_sha256"]:
        part.unlink(missing_ok=True)
        raise BuildError(f"BusyBox digest mismatch: expected={busybox['archive_sha256']} actual={actual}")
    part.replace(archive)
    return archive


def safe_member(member: tarfile.TarInfo, top: str) -> None:
    path = PurePosixPath(member.name)
    if path.is_absolute() or not path.parts or path.parts[0] != top or ".." in path.parts:
        raise BuildError(f"unsafe BusyBox archive member: {member.name}")
    if member.isdev() or member.isfifo():
        raise BuildError(f"unsafe special BusyBox archive member: {member.name}")


def extract(archive: Path, destination: Path, version: str) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    top = f"busybox-{version}"
    try:
        with tarfile.open(archive, "r:bz2") as handle:
            for member in handle.getmembers():
                safe_member(member, top)
            handle.extractall(destination, filter="data")
    except (OSError, tarfile.TarError) as exc:
        raise BuildError(f"cannot extract BusyBox source: {exc}") from exc
    source = destination / top
    if not source.is_dir():
        raise BuildError("BusyBox archive did not produce expected source directory")
    return source


def run(argv: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    print("+", " ".join(argv), flush=True)
    try:
        subprocess.run(argv, cwd=cwd, env=env, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def set_config(config: Path, requested: dict[str, str]) -> None:
    lines = config.read_text(encoding="utf-8").splitlines()
    remaining = dict(requested)
    output: list[str] = []
    assignment = re.compile(r"^(CONFIG_[A-Za-z0-9_]+)=.*$")
    unset = re.compile(r"^# (CONFIG_[A-Za-z0-9_]+) is not set$")
    for line in lines:
        match = assignment.fullmatch(line) or unset.fullmatch(line)
        symbol = match.group(1) if match else None
        if symbol in remaining:
            output.append(f"{symbol}={remaining.pop(symbol)}")
        else:
            output.append(line)
    output.extend(f"{symbol}={value}" for symbol, value in remaining.items())
    config.write_text("\n".join(output) + "\n", encoding="utf-8")


def verify_config(config: Path) -> None:
    text = config.read_text(encoding="utf-8")
    for symbol, value in REQUESTED_CONFIG.items():
        if f"{symbol}={value}\n" not in text:
            raise BuildError(f"BusyBox Kconfig rejected required selector: {symbol}={value}")
    if "CONFIG_TC=y\n" in text or "CONFIG_TELNETD=y\n" in text or "CONFIG_HTTPD=y\n" in text:
        raise BuildError("unrelated network server/traffic-control applet leaked into fixed initramfs")


def cpio_pad(handle: io.BufferedWriter | gzip.GzipFile, length: int) -> None:
    padding = (-length) % 4
    if padding:
        handle.write(b"\0" * padding)


def write_newc_entry(handle, *, inode: int, name: str, mode: int, data: bytes, nlink: int) -> None:
    name_bytes = name.encode("utf-8") + b"\0"
    fields = [inode, mode, 0, 0, nlink, 0, len(data), 0, 0, 0, 0, len(name_bytes), 0]
    header = ("070701" + "".join(f"{value:08x}" for value in fields)).encode("ascii")
    handle.write(header)
    handle.write(name_bytes)
    cpio_pad(handle, len(header) + len(name_bytes))
    handle.write(data)
    cpio_pad(handle, len(data))


def build_cpio(root: Path, destination: Path) -> None:
    entries = [root] + sorted(root.rglob("*"), key=lambda p: p.relative_to(root).as_posix())
    raw = io.BytesIO()
    inode = 1
    for path in entries:
        name = "." if path == root else path.relative_to(root).as_posix()
        st = path.lstat()
        if path.is_symlink():
            mode = stat.S_IFLNK | 0o777
            data = os.readlink(path).encode("utf-8")
            nlink = 1
        elif path.is_dir():
            mode = stat.S_IFDIR | (st.st_mode & 0o7777)
            data = b""
            nlink = 2
        elif path.is_file():
            mode = stat.S_IFREG | (st.st_mode & 0o7777)
            data = path.read_bytes()
            nlink = 1
        else:
            raise BuildError(f"unsupported initramfs filesystem object: {name}")
        write_newc_entry(raw, inode=inode, name=name, mode=mode, data=data, nlink=nlink)
        inode += 1
    write_newc_entry(raw, inode=inode, name="TRAILER!!!", mode=0, data=b"", nlink=1)
    raw.write(b"\0" * ((512 - (raw.tell() % 512)) % 512))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0, compresslevel=9) as compressed:
            compressed.write(raw.getvalue())


def git_head() -> str:
    explicit = os.environ.get("ORDAX_SOURCE_COMMIT", "").strip()
    if explicit:
        if not re.fullmatch(r"[0-9a-fA-F]{40}", explicit):
            raise BuildError("ORDAX_SOURCE_COMMIT must be exactly 40 hexadecimal characters")
        return explicit.lower()

    try:
        checkout = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if re.fullmatch(r"[0-9a-fA-F]{40}", checkout):
            return checkout.lower()
    except Exception:
        pass

    fallback = os.environ.get("GITHUB_SHA", "").strip()
    if re.fullmatch(r"[0-9a-fA-F]{40}", fallback):
        return fallback.lower()
    return "unknown"


def portable_capsule_pin(capsule: Path | None) -> dict:
    if capsule is None:
        return {
            "provided": False,
            "expected_path": "/ordax-esp/ordax/bootstrap/bootstrap.erofs",
            "sha256": None,
            "pid1_enforced": False,
            "physical_boot_authorized": False,
        }
    path = capsule.resolve()
    try:
        info = path.lstat()
    except OSError as exc:
        raise BuildError(f"cannot stat portable bootstrap capsule: {exc}") from exc
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise BuildError("portable bootstrap capsule must be a regular non-symlink single-link file")
    if path.name != "bootstrap.erofs" or info.st_size < 4096:
        raise BuildError("portable bootstrap capsule must be a non-empty bootstrap.erofs")
    with path.open("rb") as handle:
        handle.seek(1024)
        magic = handle.read(4)
    if magic != bytes((0xe2, 0xe1, 0xf5, 0xe0)):
        raise BuildError("portable bootstrap capsule does not contain an EROFS superblock")
    return {
        "provided": True,
        "expected_path": "/ordax-esp/ordax/bootstrap/bootstrap.erofs",
        "sha256": sha256_file(path),
        "pid1_enforced": False,
        "physical_boot_authorized": False,
    }


def install_portable_capsule_pin(rootfs: Path, pin: dict) -> None:
    if pin.get("provided") is not True:
        return
    digest = str(pin.get("sha256", ""))
    if not _SHA256.fullmatch(digest):
        raise BuildError("portable bootstrap capsule pin digest is invalid")
    target = rootfs / "etc" / "ordax" / "portable-bootstrap-capsule.sha256"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        f"{digest}  /ordax-esp/ordax/bootstrap/bootstrap.erofs\n",
        encoding="ascii",
    )
    os.chmod(target, 0o644)


def portable_stable_base_pin(base: Path | None) -> dict:
    if base is None:
        return {
            "provided": False,
            "expected_path": "/ordax-data/.ordax/base/stable-base.erofs",
            "sha256": None,
            "pid1_enforced": False,
            "physical_boot_authorized": False,
        }
    path = base.resolve()
    try:
        info = path.lstat()
    except OSError as exc:
        raise BuildError(f"cannot stat portable Stable Base: {exc}") from exc
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise BuildError("portable Stable Base must be a regular non-symlink single-link file")
    if path.name != "stable-base.erofs" or info.st_size < 4096:
        raise BuildError("portable Stable Base must be a non-empty stable-base.erofs")
    with path.open("rb") as handle:
        handle.seek(1024)
        magic = handle.read(4)
    if magic != bytes((0xe2, 0xe1, 0xf5, 0xe0)):
        raise BuildError("portable Stable Base does not contain an EROFS superblock")
    return {
        "provided": True,
        "expected_path": "/ordax-data/.ordax/base/stable-base.erofs",
        "sha256": sha256_file(path),
        "pid1_enforced": False,
        "physical_boot_authorized": False,
    }


def install_portable_stable_base_pin(rootfs: Path, pin: dict) -> None:
    if pin.get("provided") is not True:
        return
    digest = str(pin.get("sha256", ""))
    if not _SHA256.fullmatch(digest):
        raise BuildError("portable Stable Base pin digest is invalid")
    target = rootfs / "etc" / "ordax" / "portable-stable-base.sha256"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        f"{digest}  /ordax-data/.ordax/base/stable-base.erofs\n",
        encoding="ascii",
    )
    os.chmod(target, 0o644)


def build_growth_helper(musl_cc: str, readelf: str, source: Path, destination: Path, env: dict[str, str]) -> None:
    command = [
        musl_cc,
        "-static",
        "-Os",
        "-s",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-Wl,--build-id=none",
        f"-ffile-prefix-map={ROOT}=.",
        "-o",
        str(destination),
        str(source),
    ]
    run(command, cwd=ROOT, env=env)
    elf = capture([readelf, "-l", str(destination)])
    if "Requesting program interpreter" in elf:
        raise BuildError("ext4 growth helper is dynamically linked; fixed initramfs requires static userspace")
    if not destination.is_file() or destination.is_symlink():
        raise BuildError("ext4 growth helper build did not produce a safe regular binary")


def build_portable_state_helper(
    musl_cc: str,
    readelf: str,
    source: Path,
    destination: Path,
    env: dict[str, str],
) -> None:
    command = [
        musl_cc,
        "-static",
        "-Os",
        "-s",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-Wl,--build-id=none",
        f"-ffile-prefix-map={ROOT}=.",
        "-o",
        str(destination),
        str(source),
    ]
    run(command, cwd=ROOT, env=env)
    elf = capture([readelf, "-l", str(destination)])
    if "Requesting program interpreter" in elf:
        raise BuildError("portable state helper is dynamically linked")
    if not destination.is_file() or destination.is_symlink():
        raise BuildError("portable state helper build did not produce a safe regular binary")


def build_portable_mount_helper(
    musl_cc: str,
    readelf: str,
    source: Path,
    destination: Path,
    uapi_include: Path,
    env: dict[str, str],
) -> None:
    command = [
        musl_cc,
        "-static",
        "-Os",
        "-s",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-Wl,--build-id=none",
        f"-I{uapi_include}",
        f"-ffile-prefix-map={ROOT}=.",
        "-o",
        str(destination),
        str(source),
    ]
    run(command, cwd=ROOT, env=env)
    elf = capture([readelf, "-l", str(destination)])
    if "Requesting program interpreter" in elf:
        raise BuildError("portable mount helper is dynamically linked")
    if not destination.is_file() or destination.is_symlink():
        raise BuildError("portable mount helper build did not produce a safe regular binary")


def build(
    work_dir: Path,
    out_dir: Path,
    jobs: int,
    portable_bootstrap_capsule: Path | None = None,
    portable_stable_base: Path | None = None,
) -> dict:
    contract = load_contract()
    init = init_path(contract)
    grow_source = growth_helper_source_path()
    capsule_pin = portable_capsule_pin(portable_bootstrap_capsule)
    stable_base_pin = portable_stable_base_pin(portable_stable_base)
    portable_state_source = portable_state_helper_source_path()
    portable_mount_source = portable_mount_helper_source_path()
    portable_capsule_verify_source = portable_capsule_verify_source_path()
    portable_base_verify_source = portable_base_verify_source_path()
    portable_init_source = portable_init_source_path()
    check_contract()
    for name in ("make", "musl-gcc", "readelf"):
        resolve_program(name)
    work_dir = work_dir.resolve()
    out_dir = out_dir.resolve()
    shutil.rmtree(work_dir, ignore_errors=True)
    shutil.rmtree(out_dir, ignore_errors=True)
    work_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)
    archive = download(contract, work_dir / "cache")
    source = extract(archive, work_dir / "source", contract["busybox"]["version"])
    env = dict(os.environ)
    env.update(FIXED_ENV)
    musl_cc = resolve_program("musl-gcc")
    readelf = resolve_program("readelf")
    toolchain = musl_identity(musl_cc)
    kernel_uapi = prepare_kernel_uapi(work_dir, env)
    uapi_include = kernel_uapi["include"]
    make = [
        "make",
        f"CC={musl_cc}",
        f"EXTRA_CFLAGS=-I{uapi_include}",
    ]
    run(make + ["allnoconfig"], cwd=source, env=env)
    set_config(source / ".config", REQUESTED_CONFIG)
    run(make + ["oldconfig"], cwd=source, env=env)
    verify_config(source / ".config")
    run(make + [f"-j{max(1, jobs)}"], cwd=source, env=env)
    busybox = source / "busybox"
    if not busybox.is_file():
        raise BuildError("BusyBox build did not produce busybox")
    elf = capture([readelf, "-l", str(busybox)])
    if "Requesting program interpreter" in elf:
        raise BuildError("BusyBox is dynamically linked; fixed initramfs requires static userspace")
    try:
        applet_result = subprocess.run(
            [str(busybox), "--list"],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        raise BuildError(f"built BusyBox cannot enumerate applets (exit={exc.returncode}): {stderr}") from exc
    applets = set(applet_result.stdout.splitlines())
    missing = sorted(REQUIRED_APPLETS - applets)
    if missing:
        raise BuildError(f"required BusyBox applets are missing: {missing}")
    rootfs = work_dir / "rootfs"
    run(make + [f"CONFIG_PREFIX={rootfs}", "install"], cwd=source, env=env)
    for directory in ("dev", "proc", "sys", "run", "ordax", "tmp"):
        (rootfs / directory).mkdir(parents=True, exist_ok=True)
    shutil.copy2(init, rootfs / "init")
    os.chmod(rootfs / "init", 0o755)
    install_portable_capsule_pin(rootfs, capsule_pin)
    install_portable_stable_base_pin(rootfs, stable_base_pin)
    grow_binary = work_dir / "ordax-grow-ext4"
    build_growth_helper(musl_cc, readelf, grow_source, grow_binary, env)
    grow_install = rootfs / "sbin" / "ordax-grow-ext4"
    grow_install.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(grow_binary, grow_install)
    os.chmod(grow_install, 0o755)

    portable_state_binary = work_dir / "ordax-portable-state"
    build_portable_state_helper(
        musl_cc,
        readelf,
        portable_state_source,
        portable_state_binary,
        env,
    )
    portable_state_install = rootfs / "sbin" / "ordax-portable-state"
    shutil.copy2(portable_state_binary, portable_state_install)
    os.chmod(portable_state_install, 0o755)

    portable_mount_binary = work_dir / "ordax-portable-mount"
    build_portable_mount_helper(
        musl_cc,
        readelf,
        portable_mount_source,
        portable_mount_binary,
        uapi_include,
        env,
    )
    portable_mount_install = rootfs / "sbin" / "ordax-portable-mount"
    shutil.copy2(portable_mount_binary, portable_mount_install)
    os.chmod(portable_mount_install, 0o755)

    portable_capsule_verify_install = rootfs / "sbin" / "ordax-portable-capsule-verify"
    shutil.copy2(portable_capsule_verify_source, portable_capsule_verify_install)
    os.chmod(portable_capsule_verify_install, 0o755)

    portable_base_verify_install = rootfs / "sbin" / "ordax-portable-base-verify"
    shutil.copy2(portable_base_verify_source, portable_base_verify_install)
    os.chmod(portable_base_verify_install, 0o755)

    portable_init_install = rootfs / "sbin" / "ordax-portable-init"
    shutil.copy2(portable_init_source, portable_init_install)
    os.chmod(portable_init_install, 0o755)

    final_config = out_dir / "busybox.config"
    shutil.copy2(source / ".config", final_config)
    archive_path = out_dir / "initramfs.cpio.gz"
    build_cpio(rootfs, archive_path)
    provenance = {
        "$schema": "prototype-ordax.initramfs-provenance/1",
        "status": "candidate",
        "promotable_to_physical": bool(contract["build"]["physical_artifact_authorized"]),
        "source_commit": git_head(),
        "busybox_version": contract["busybox"]["version"],
        "busybox_archive_sha256": sha256_file(archive),
        "busybox_applet_count": len(applets),
        "busybox_sha256": sha256_file(busybox),
        "toolchain": toolchain,
        "kernel_uapi": {
            key: str(value) if isinstance(value, Path) else value
            for key, value in kernel_uapi.items()
            if key != "include"
        },
        "root_init_sha256": sha256_file(init),
        "portable_bootstrap_capsule_pin": capsule_pin,
        "portable_stable_base_pin": stable_base_pin,
        "filesystem_health": {
            "pre_mount_check": True,
            "error_flag_policy": "read-only-recovery",
            "rw_mount_errors_policy": "remount-ro",
            "helper_path": "/sbin/ordax-grow-ext4",
        },
        "filesystem_growth": {
            "mode": "online-ext4-kernel-ioctl",
            "helper_path": "/sbin/ordax-grow-ext4",
            "source_sha256": sha256_file(grow_source),
            "binary_sha256": sha256_file(grow_binary),
            "normal_boot_best_effort": True,
            "recovery_mode_allowed": False,
        },
        "portable_mount_helper": {
            "installed": True,
            "helper_path": "/sbin/ordax-portable-mount",
            "source_sha256": sha256_file(portable_mount_source),
            "binary_sha256": sha256_file(portable_mount_binary),
            "state_filesystem": "ext4",
            "release_filesystem": "erofs",
            "runtime_system_view": "overlayfs",
            "release_mount_read_only": True,
            "selects_release": False,
            "verifies_signature": False,
            "writes_activation_state": False,
            "pid1_connected": False,
        },
        "portable_bootstrap_capsule_verifier": {
            "installed": True,
            "helper_path": "/sbin/ordax-portable-capsule-verify",
            "source_sha256": sha256_file(portable_capsule_verify_source),
            "pin_path": "/etc/ordax/portable-bootstrap-capsule.sha256",
            "capsule_path": "/ordax-esp/ordax/bootstrap/bootstrap.erofs",
            "user_supplied_path_allowed": False,
            "hash_algorithm": "sha256",
            "mounts_capsule": False,
            "network_access": False,
            "pid1_connected": False,
        },
        "portable_candidate_pid1": {
            "installed": True,
            "helper_path": "/sbin/ordax-portable-init",
            "source_sha256": sha256_file(portable_init_source),
            "default_init": False,
            "legacy_init_unchanged": True,
            "candidate_invocation": "rdinit=/sbin/ordax-portable-init",
            "requires_capsule_pin": True,
            "requires_stable_base_pin": True,
            "requires_bootstrap_owned_trust": True,
            "one_shot_candidate_then_current_known_good_exact_verification": True,
            "candidate_slot_boot_authority": True,
            "candidate_slot_boot_authority_policy": "armed-one-shot-transaction-only",
            "network_required": False,
            "physical_boot_authorized": False,
        },
        "portable_stable_base_verifier": {
            "installed": True,
            "helper_path": "/sbin/ordax-portable-base-verify",
            "source_sha256": sha256_file(portable_base_verify_source),
            "pin_path": "/etc/ordax/portable-stable-base.sha256",
            "base_path": "/ordax-data/.ordax/base/stable-base.erofs",
            "user_supplied_path_allowed": False,
            "hash_algorithm": "sha256",
            "mounts_base": False,
            "network_access": False,
            "pid1_connected": False,
        },
        "portable_activation_state_reader": {
            "installed": True,
            "helper_path": "/sbin/ordax-portable-state",
            "source_sha256": sha256_file(portable_state_source),
            "binary_sha256": sha256_file(portable_state_binary),
            "read_only": False,
            "accepted_slots": ["current", "known-good", "candidate", "rejected"],
            "identity": "lowercase-40-hex-source-commit",
            "symlink_traversal_allowed": False,
            "activation_performed": True,
            "operations": [
                "read-slot",
                "resolve",
                "select",
                "prepare",
                "select-boot",
                "commit",
                "rollback",
            ],
            "atomic_replace": True,
            "fsync_required": True,
            "directory_fsync_required": True,
            "runtime_copy_path": "/run/ordax/bootstrap-tools/ordax-portable-state",
        },
        "static_userspace": True,
        "network_inside_fixed_initramfs": False,
        "portable_v2_prerequisites": {
            "losetup_applet": True,
            "mount_loop_support": True,
            "mount_security_flags": True,
            "posix_test_applet": True,
            "posix_bracket_applet": True,
            "test_64_bit_comparisons": True,
            "exfat_volume_id": True,
            "boot_path_enabled": False,
            "handoff_helper_installed": True,
            "handoff_helper_pid1_connected": False,
            "activation_state_reader_installed": True,
        },
        "artifacts": {
            archive_path.name: sha256_file(archive_path),
            final_config.name: sha256_file(final_config),
        },
    }
    provenance_path = out_dir / "initramfs-provenance.json"
    provenance_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    artifacts = [archive_path, final_config, provenance_path]
    (out_dir / "SHA256SUMS").write_text(
        "".join(f"{sha256_file(path)}  {path.name}\n" for path in artifacts), encoding="utf-8"
    )
    return provenance


def verify(out_dir: Path) -> dict:
    out_dir = out_dir.resolve()
    manifest = out_dir / "SHA256SUMS"
    provenance_path = out_dir / "initramfs-provenance.json"
    if not manifest.is_file() or manifest.is_symlink() or not provenance_path.is_file() or provenance_path.is_symlink():
        raise BuildError("initramfs output manifest/provenance is missing or unsafe")
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"invalid initramfs provenance: {exc}") from exc
    if provenance.get("$schema") != "prototype-ordax.initramfs-provenance/1":
        raise BuildError("unexpected initramfs provenance schema")
    capsule_pin = provenance.get("portable_bootstrap_capsule_pin", {})
    if capsule_pin.get("provided") is True:
        if (
            capsule_pin.get("expected_path") != "/ordax-esp/ordax/bootstrap/bootstrap.erofs"
            or not _SHA256.fullmatch(str(capsule_pin.get("sha256", "")))
            or capsule_pin.get("pid1_enforced") is not False
            or capsule_pin.get("physical_boot_authorized") is not False
        ):
            raise BuildError("initramfs portable bootstrap capsule pin provenance is invalid")
    elif capsule_pin.get("provided") is not False:
        raise BuildError("initramfs portable bootstrap capsule pin state is invalid")

    stable_base_pin = provenance.get("portable_stable_base_pin", {})
    if stable_base_pin.get("provided") is True:
        if (
            stable_base_pin.get("expected_path") != "/ordax-data/.ordax/base/stable-base.erofs"
            or not _SHA256.fullmatch(str(stable_base_pin.get("sha256", "")))
            or stable_base_pin.get("pid1_enforced") is not False
            or stable_base_pin.get("physical_boot_authorized") is not False
        ):
            raise BuildError("initramfs portable Stable Base pin provenance is invalid")
    elif stable_base_pin.get("provided") is not False:
        raise BuildError("initramfs portable Stable Base pin state is invalid")

    health = provenance.get("filesystem_health", {})
    if (
        health.get("pre_mount_check") is not True
        or health.get("error_flag_policy") != "read-only-recovery"
        or health.get("rw_mount_errors_policy") != "remount-ro"
        or health.get("helper_path") != "/sbin/ordax-grow-ext4"
    ):
        raise BuildError("initramfs provenance is missing the canonical ext4 health policy")
    kernel_uapi = provenance.get("kernel_uapi", {})
    canonical_kernel = KERNEL_BUILD.load_contract()
    signature_policy = canonical_kernel.get("upstream_signature")
    upstream_auth = kernel_uapi.get("upstream_authentication")
    if signature_policy is not None:
        if (
            not isinstance(upstream_auth, dict)
            or upstream_auth.get("status") != "verified"
            or upstream_auth.get("trusted_primary_fingerprint")
            != signature_policy["trusted_primary_fingerprint"]
            or upstream_auth.get("kernel_version") != canonical_kernel["version"]
            or upstream_auth.get("archive_sha256") != canonical_kernel["archive_sha256"]
            or upstream_auth.get("source_contract_sha256")
            != sha256_file(KERNEL_BUILD.SOURCE_CONTRACT)
        ):
            raise BuildError("initramfs UAPI lacks authenticated upstream source provenance")
    elif upstream_auth is not None and upstream_auth != {
        "status": "legacy-unsigned-6.6.52-only",
        "verified": False,
    }:
        raise BuildError("initramfs UAPI historical source authentication state is invalid")
    if (
        kernel_uapi.get("kernel_version") != load_contract()["portable_v2_prerequisites"]["kernel_uapi_version"]
        or not _SHA256.fullmatch(str(kernel_uapi.get("kernel_archive_sha256", "")))
        or not _SHA256.fullmatch(str(kernel_uapi.get("kernel_source_contract_sha256", "")))
        or not _SHA256.fullmatch(str(kernel_uapi.get("headers_tree_sha256", "")))
        or not _SHA256.fullmatch(str(kernel_uapi.get("linux_version_h_sha256", "")))
        or not _SHA256.fullmatch(str(kernel_uapi.get("linux_loop_h_sha256", "")))
    ):
        raise BuildError("initramfs provenance is missing the pinned kernel UAPI identity")

    mount_helper = provenance.get("portable_mount_helper", {})
    if (
        mount_helper.get("installed") is not True
        or mount_helper.get("helper_path") != "/sbin/ordax-portable-mount"
        or mount_helper.get("state_filesystem") != "ext4"
        or mount_helper.get("release_filesystem") != "erofs"
        or mount_helper.get("runtime_system_view") != "overlayfs"
        or mount_helper.get("release_mount_read_only") is not True
        or mount_helper.get("selects_release") is not False
        or mount_helper.get("verifies_signature") is not False
        or mount_helper.get("writes_activation_state") is not False
        or mount_helper.get("pid1_connected") is not False
        or not _SHA256.fullmatch(str(mount_helper.get("source_sha256", "")))
        or not _SHA256.fullmatch(str(mount_helper.get("binary_sha256", "")))
    ):
        raise BuildError("initramfs provenance is missing the isolated portable mount helper")

    capsule_verifier = provenance.get("portable_bootstrap_capsule_verifier", {})
    if (
        capsule_verifier.get("installed") is not True
        or capsule_verifier.get("helper_path") != "/sbin/ordax-portable-capsule-verify"
        or capsule_verifier.get("pin_path") != "/etc/ordax/portable-bootstrap-capsule.sha256"
        or capsule_verifier.get("capsule_path") != "/ordax-esp/ordax/bootstrap/bootstrap.erofs"
        or capsule_verifier.get("user_supplied_path_allowed") is not False
        or capsule_verifier.get("hash_algorithm") != "sha256"
        or capsule_verifier.get("mounts_capsule") is not False
        or capsule_verifier.get("network_access") is not False
        or capsule_verifier.get("pid1_connected") is not False
        or not _SHA256.fullmatch(str(capsule_verifier.get("source_sha256", "")))
    ):
        raise BuildError("initramfs provenance is missing the fixed portable capsule verifier")

    candidate_pid1 = provenance.get("portable_candidate_pid1", {})
    if (
        candidate_pid1.get("installed") is not True
        or candidate_pid1.get("helper_path") != "/sbin/ordax-portable-init"
        or candidate_pid1.get("default_init") is not False
        or candidate_pid1.get("legacy_init_unchanged") is not True
        or candidate_pid1.get("candidate_invocation") != "rdinit=/sbin/ordax-portable-init"
        or candidate_pid1.get("requires_capsule_pin") is not True
        or candidate_pid1.get("requires_stable_base_pin") is not True
        or candidate_pid1.get("requires_bootstrap_owned_trust") is not True
        or candidate_pid1.get(
            "one_shot_candidate_then_current_known_good_exact_verification"
        ) is not True
        or candidate_pid1.get("candidate_slot_boot_authority") is not True
        or candidate_pid1.get("candidate_slot_boot_authority_policy")
        != "armed-one-shot-transaction-only"
        or candidate_pid1.get("network_required") is not False
        or candidate_pid1.get("physical_boot_authorized") is not False
        or not _SHA256.fullmatch(str(candidate_pid1.get("source_sha256", "")))
    ):
        raise BuildError("initramfs provenance is missing the isolated portable-v2 candidate PID1")

    base_verifier = provenance.get("portable_stable_base_verifier", {})
    if (
        base_verifier.get("installed") is not True
        or base_verifier.get("helper_path") != "/sbin/ordax-portable-base-verify"
        or base_verifier.get("pin_path") != "/etc/ordax/portable-stable-base.sha256"
        or base_verifier.get("base_path") != "/ordax-data/.ordax/base/stable-base.erofs"
        or base_verifier.get("user_supplied_path_allowed") is not False
        or base_verifier.get("hash_algorithm") != "sha256"
        or base_verifier.get("mounts_base") is not False
        or base_verifier.get("network_access") is not False
        or base_verifier.get("pid1_connected") is not False
        or not _SHA256.fullmatch(str(base_verifier.get("source_sha256", "")))
    ):
        raise BuildError("initramfs provenance is missing the fixed portable Stable Base verifier")

    state_reader = provenance.get("portable_activation_state_reader", {})
    if (
        state_reader.get("installed") is not True
        or state_reader.get("helper_path") != "/sbin/ordax-portable-state"
        or state_reader.get("read_only") is not False
        or state_reader.get("activation_performed") is not True
        or state_reader.get("symlink_traversal_allowed") is not False
        or state_reader.get("accepted_slots")
        != ["current", "known-good", "candidate", "rejected"]
        or state_reader.get("operations")
        != [
            "read-slot",
            "resolve",
            "select",
            "prepare",
            "select-boot",
            "commit",
            "rollback",
        ]
        or state_reader.get("atomic_replace") is not True
        or state_reader.get("fsync_required") is not True
        or state_reader.get("directory_fsync_required") is not True
        or state_reader.get("runtime_copy_path")
        != "/run/ordax/bootstrap-tools/ordax-portable-state"
        or not _SHA256.fullmatch(str(state_reader.get("source_sha256", "")))
        or not _SHA256.fullmatch(str(state_reader.get("binary_sha256", "")))
    ):
        raise BuildError("initramfs provenance is missing the portable activation-state transaction helper")

    growth = provenance.get("filesystem_growth", {})
    if growth.get("mode") != "online-ext4-kernel-ioctl" or growth.get("helper_path") != "/sbin/ordax-grow-ext4":
        raise BuildError("initramfs provenance is missing the canonical ext4 growth helper")
    if growth.get("normal_boot_best_effort") is not True or growth.get("recovery_mode_allowed") is not False:
        raise BuildError("initramfs filesystem-growth safety policy is invalid")
    if not _SHA256.fullmatch(str(growth.get("source_sha256", ""))) or not _SHA256.fullmatch(str(growth.get("binary_sha256", ""))):
        raise BuildError("initramfs filesystem-growth provenance hashes are invalid")
    entries: dict[str, str] = {}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._+-]*)", line)
        if not match or match.group(2) in entries or match.group(2) == "SHA256SUMS":
            raise BuildError("unsafe, duplicate, or malformed initramfs checksum entry")
        entries[match.group(2)] = match.group(1)
    expected_names = set(provenance.get("artifacts", {})) | {"initramfs-provenance.json"}
    if set(entries) != expected_names:
        raise BuildError("initramfs checksum manifest disagrees with provenance")
    for name, expected in entries.items():
        path = out_dir / name
        if path.is_symlink() or not path.is_file() or sha256_file(path) != expected:
            raise BuildError(f"initramfs artifact verification failed: {name}")
    for name, expected in provenance["artifacts"].items():
        if entries.get(name) != expected:
            raise BuildError(f"initramfs provenance digest disagreement: {name}")
    return {"status": "verified", "artifact_count": len(entries), "source_commit": provenance.get("source_commit")}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--work-dir", type=Path, default=ROOT / "out" / "initramfs-work")
    build_parser.add_argument("--out-dir", type=Path, default=ROOT / "out" / "initramfs")
    build_parser.add_argument("--jobs", type=int, default=max(1, os.cpu_count() or 1))
    build_parser.add_argument(
        "--portable-bootstrap-capsule",
        type=Path,
        default=None,
        help="optional verified bootstrap.erofs candidate whose SHA-256 is embedded as a non-enforced pin",
    )
    build_parser.add_argument(
        "--portable-stable-base",
        type=Path,
        default=None,
        help="optional verified stable-base.erofs candidate whose SHA-256 is embedded as a non-enforced pin",
    )
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, default=ROOT / "out" / "initramfs")
    args = parser.parse_args()
    try:
        if args.command == "check":
            result = check_contract()
        elif args.command == "build":
            result = build(
                args.work_dir,
                args.out_dir,
                args.jobs,
                args.portable_bootstrap_capsule,
                args.portable_stable_base,
            )
        else:
            result = verify(args.out_dir)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (BuildError, KERNEL_BUILD.BuildError, OSError, subprocess.CalledProcessError) as exc:
        print(f"initramfs-build: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
