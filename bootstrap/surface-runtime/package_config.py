"""Shared package selection for offline builds and the development launcher."""

from pathlib import Path
import re

PACKAGES_FILE = "system/surface/runtime/packages.txt"


def requested_packages(contract: dict, root: Path) -> list[str]:
    if contract.get("packages_file") != PACKAGES_FILE or "packages" in contract:
        raise ValueError("Surface packages must use the single runtime package manifest")
    path = root / PACKAGES_FILE
    if path.is_symlink() or not path.is_file():
        raise ValueError("Surface runtime package manifest is unavailable")
    packages = path.read_text(encoding="ascii").splitlines()
    if not packages or len(packages) != len(set(packages)):
        raise ValueError("Surface runtime packages must be nonempty and unique")
    if any(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9+_.-]*", name) is None for name in packages):
        raise ValueError("Surface runtime manifest contains an invalid package name")
    return packages
