"""Strict OrdaX Internet download destination policy."""
from __future__ import annotations
import os
import re
import stat

MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
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

def verified_download(path: str, limit: int = MAX_DOWNLOAD_BYTES) -> int:
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode) or info.st_size < 0 or info.st_size > limit:
        raise ValueError("download destination invalid or too large")
    os.chmod(path, 0o600, follow_symlinks=False)
    return info.st_size
