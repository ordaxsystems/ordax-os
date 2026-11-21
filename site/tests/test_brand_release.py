"""Fail-closed Surface Dev brand importer; no copy of brand source or release builder."""
import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from brand_release import BrandReleaseError, FILES, SOURCE_PATHS, OWNER, LICENSE_OWNER, LICENSE_PATH, LICENSE_BLOB, materialize, validate_pin


class Response(io.BytesIO):
    status = 200
    def geturl(self):
        return "https://release-assets.githubusercontent.com/download"


def make_archive(*, linked=False, altered_owner=False):
    source_sha = "a" * 40
    paths = {name: (b"SIL OPEN FONT LICENSE Version 1.1" if name.endswith("Inter-OFL-1.1.txt")
                    else b"url(\"./fonts/inter-latin-wght-normal.woff2\")" if name.endswith("ordax-font.css")
                    else (name + ":source").encode()) for name in FILES}
    sources = [{
        "repository": LICENSE_OWNER if path == LICENSE_PATH else OWNER,
        "commit": "b" * 40 if path == LICENSE_PATH else source_sha,
        "path": path,
        "git_blob": LICENSE_BLOB if path == LICENSE_PATH else "c" * 40,
        "sha256": "d" * 64,
    } for path in sorted(SOURCE_PATHS)]
    manifest = {
        "$schema": "ordax.surface-brand-artifact/1",
        "artifact_class": "ordax-brand",
        "status": "candidate-not-published",
        "immutable": True,
        "source_repository": "ordaxsystems/ordax-os" if altered_owner else OWNER,
        "source_commit": source_sha,
        "files": [{"path": p, "size": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}
                  for p, blob in sorted(paths.items())],
        "sources": sources,
    }
    paths["manifest.json"] = (json.dumps(manifest)+"\n").encode()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for path, blob in sorted(paths.items()):
            entry = tarfile.TarInfo("./"+path)
            entry.mode = 0o644
            entry.size = len(blob)
            tar.addfile(entry, io.BytesIO(blob))
        if linked:
            entry = tarfile.TarInfo("./assets/untrusted")
            entry.type = tarfile.SYMTYPE
            entry.linkname = "../../private"
            tar.addfile(entry)
    archive = buffer.getvalue()
    pin = {
        "source_repository": OWNER,
        "source_commit": source_sha,
        "release_tag": "brand-dev-"+source_sha,
        "archive_sha256": hashlib.sha256(archive).hexdigest(),
        "manifest_sha256": hashlib.sha256(paths["manifest.json"]).hexdigest(),
    }
    return archive, pin


class BrandDevReleaseTests(unittest.TestCase):
    def test_only_exact_pinned_owner_inputs_are_materialized(self):
        archive, pin = make_archive()
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)/"brand"
            materialize(pin, output, open_url=lambda req, timeout: Response(archive))
            self.assertEqual({x.relative_to(output).as_posix() for x in output.rglob("*") if x.is_file()},
                             FILES | {"manifest.json"})
            with self.assertRaisesRegex(BrandReleaseError, "already exists"):
                materialize(pin, output, open_url=lambda req, timeout: Response(archive))

    def test_wrong_owner_or_unsigned_self_asserted_release_rejected(self):
        archive, pin = make_archive(altered_owner=True)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)/"invalid"
            with self.assertRaisesRegex(BrandReleaseError, "authority"):
                materialize(pin, root, open_url=lambda req, timeout: Response(archive))
            self.assertFalse(root.exists())
        with self.assertRaisesRegex(BrandReleaseError, "release pin"):
            validate_pin(dict(pin, release_tag="brand-dev-main"))

    def test_archive_digest_links_and_manifest_swaps_rejected(self):
        archive, pin = make_archive()
        linked, linked_pin = make_archive(linked=True)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(ValueError, "pin mismatch"):
                materialize(dict(pin, archive_sha256="0"*64), root/"digest",
                            open_url=lambda req, timeout: Response(archive))
            with self.assertRaisesRegex(BrandReleaseError, "unsafe"):
                materialize(linked_pin, root/"linked",
                            open_url=lambda req, timeout: Response(linked))
            with self.assertRaisesRegex(BrandReleaseError, "digest"):
                materialize(dict(pin, manifest_sha256="0"*64), root/"manifest",
                            open_url=lambda req, timeout: Response(archive))
            self.assertFalse(any(root.iterdir()))


if __name__ == "__main__":
    unittest.main()
