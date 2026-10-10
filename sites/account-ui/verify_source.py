#!/usr/bin/env python3
"""Verify byte-exact Lovable assets and unmodified source dependencies.

Account components are deliberately adapted after their baseline import; their
original blob SHAs remain documented in lovable-source.json and Git history.
"""
from __future__ import annotations
import hashlib
from pathlib import Path

BASE = Path(__file__).resolve().parent / "lovable-original"
SOURCE_BLOBS = {
    "src/components/account/integration-panel.tsx": "1786e4bf2e631b53ec3aaa2023d7c0456ed39c34",
    "src/lib/account/model.ts": "9b06816494a86604d172cb8c3ed36e124a2e6e0e",
    "src/styles.css": "772bb4ef2b595ef89d2cbdbf018e03330761b9a9",
    "package.json": "90838fc188dd038065a67529da35c5588d19dbe1",
    "src/components/ui/button.tsx": "bc3bc9f6bbefc3155d1f4d053ff58f9b8662edbe",
    "src/components/ui/dialog.tsx": "8ed559e3d6f2ab5f0d0287f56c63fbcd48a47b87",
    "src/components/ui/switch.tsx": "6338184e11d92961b4dfd06f151ce5ada7dd838c",
    "src/lib/utils.ts": "a5ef193506d07d0459fec4f187af08283094d7c8",
    "bun.lock": "e4600ab7d895cf3987045d9128e52315ea6e7d09",
    "tsconfig.json": "6b10c714ac8c07db8f7dc4b08af64df500c12ed5",
    "components.json": "f0817a84e832a693e7a79a911efe0b081bd97e06",
    "src/assets/ordax-landscape.jpg": "260e215794a3a38b03d0df6ce9395632aa7b78be",
    "src/assets/ordax-mark.png": "fa3e17f13e91f7710dd03eb23d0d5d9b3fce7541",
}
IMAGE_SHA256 = {
    "src/assets/ordax-landscape.jpg": "7ddb6607fa2584e9702fe55a7c9d06e610ab1fe3db0f31e40757b7d9e0347294",
    "src/assets/ordax-mark.png": "e261b8e4e12dccb83c9dc2bbb77155ec7e6e69fe70c5b0a1e6bfee58f492827c",
}

def verify() -> None:
    for rel, expected in SOURCE_BLOBS.items():
        path = BASE / rel
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"missing/non-regular source: {rel}")
        data = path.read_bytes()
        git_blob = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + bytes((0,)) + data).hexdigest()
        if git_blob != expected:
            raise ValueError(f"original source changed: {rel} {git_blob} != {expected}")
        if rel in IMAGE_SHA256 and hashlib.sha256(data).hexdigest() != IMAGE_SHA256[rel]:
            raise ValueError(f"original image bytes changed: {rel}")
    if not (BASE / "src/lib/account/official-session.tsx").is_file():
        raise ValueError("canonical session adapter missing")
    if not (BASE / "src/account-entry.tsx").is_file():
        raise ValueError("static frontend entry missing")
    if not (BASE / "vite.config.account.ts").is_file():
        raise ValueError("static Vite config missing")
    print(f"ORDAX_ACCOUNT_SOURCE_EXACT=PASS files={len(SOURCE_BLOBS)}")

if __name__ == "__main__":
    verify()
