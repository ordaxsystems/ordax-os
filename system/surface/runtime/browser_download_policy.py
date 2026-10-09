"""Strict OrdaX Internet download destination policy."""
from __future__ import annotations
import os
import re
import stat

# The filesystem, quota and free space determine download capacity. There is
# deliberately no per-file byte ceiling: SSD/HD installations may download
# multi-gigabyte archives without staging them in RAM.
MIN_FILESYSTEM_RESERVE_BYTES = 32 * 1024 * 1024
MAX_FILESYSTEM_RESERVE_BYTES = 1024 * 1024 * 1024


class DownloadStorageSpaceError(ValueError):
    """Insufficient storage on the actual download filesystem."""


def available_download_bytes(directory: str) -> int:
    """Usable bytes beyond a small proportional filesystem safety reserve.

    f_bavail, unlike f_bfree, honors blocks reserved by the filesystem for
    privileged/system operations. Keep an additional 1% of the volume (bounded
    to 32 MiB–1 GiB) so a download cannot exhaust normal user-space metadata.
    This is a free-space safeguard, not an artificial file-size limit.
    """
    stats = os.statvfs(directory)
    block_size = stats.f_frsize or stats.f_bsize
    if block_size <= 0 or stats.f_blocks <= 0:
        raise DownloadStorageSpaceError("download filesystem capacity unavailable")
    total = stats.f_blocks * block_size
    available = stats.f_bavail * block_size
    reserve = min(MAX_FILESYSTEM_RESERVE_BYTES, max(MIN_FILESYSTEM_RESERVE_BYTES, total // 100))
    return max(0, available - reserve)


def ensure_download_space(directory: str, required_bytes: int | None = None) -> int:
    """Fail closed if known payload or unknown-size streaming cannot fit."""
    if required_bytes is not None and (
        isinstance(required_bytes, bool) or not isinstance(required_bytes, int)
        or required_bytes < 0
    ):
        raise ValueError("invalid download length")
    available = available_download_bytes(directory)
    if available <= 0 or (required_bytes is not None and required_bytes > available):
        raise DownloadStorageSpaceError("not enough free disk space for download")
    return available

MAX_DOWNLOAD_NAME_LENGTH = 90  # prefix download-<16-hex>- keeps full filename below 120
SAFE_FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$")
OPAQUE_ID_RE = re.compile(r"^download-[0-9a-f]{16}$")

def safe_download_name(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("invalid filename")
    filename = value.replace("\\", "/").split("/")[-1]
    filename = re.sub(r"[^A-Za-z0-9 ._-]", "_", filename).strip(" ._")
    filename = filename[:MAX_DOWNLOAD_NAME_LENGTH].rstrip(" ._")
    if filename in {"", ".", ".."} or SAFE_FILENAME_RE.fullmatch(filename) is None:
        return "download.bin"
    return filename

def download_destination(user_root: str, download_id: str, suggested_name: object) -> tuple[str, str]:
    if not isinstance(download_id, str) or OPAQUE_ID_RE.fullmatch(download_id) is None:
        raise ValueError("invalid download identifier")
    root = os.path.abspath(user_root)
    folder = os.path.join(root, "Downloads")
    try:
        info = os.lstat(folder)
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise ValueError("unsafe downloads directory")
    except FileNotFoundError:
        os.mkdir(folder, 0o700)
    filename = f"{download_id}-{safe_download_name(suggested_name)}"
    path = os.path.join(folder, filename)
    if os.path.lexists(path):
        raise FileExistsError("download destination already exists")
    return path, filename

def verified_download(path: str) -> int:
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode) or info.st_size < 0:
        raise ValueError("download destination invalid")
    os.chmod(path, 0o600, follow_symlinks=False)
    return info.st_size
