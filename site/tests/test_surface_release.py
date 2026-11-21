"""Dev prerelease ingestion is bound to external digests and safe archive paths."""
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
from surface_release import SurfaceReleaseError, materialize, validate_pin


class Response(io.BytesIO):
    status = 200
    def geturl(self):
        return "https://release-assets.githubusercontent.com/verified"


def fixture(*, invalid_link=False, extra=False):
    surface = "a" * 40
    host = "b" * 40
    files = {
        "assets/playground-fixture.json": b'{"surface":{"views":{}}}',
        "assets/surface-snapshot.css": b".demo-native{color:blue}",
    }
    if extra:
        files["assets/unexpected.js"] = b"alert(1)"
    manifest = {
        "$schema": "ordax.meridian-readonly-preview-artifact/2",
        "artifact_class": "ordax-meridian-preview",
        "status": "candidate-not-published",
        "runtime_authority": False,
        "source_repository": "ordaxsystems/ordax-surface",
        "source_commit": surface,
        "os_host_repository": "ordaxsystems/ordax-os",
        "os_host_commit": host,
        "files": [{"path": name, "size": len(raw),
                   "sha256": hashlib.sha256(raw).hexdigest()}
                  for name, raw in sorted(files.items())],
    }
    raw_manifest = (json.dumps(manifest) + "\n").encode()
    files["manifest.json"] = raw_manifest
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as tar:
        for name, payload in files.items():
            member = tarfile.TarInfo(name)
            member.mode = 0o644
            member.size = len(payload)
            tar.addfile(member, io.BytesIO(payload))
        if invalid_link:
            member = tarfile.TarInfo("assets/linked.js")
            member.type = tarfile.SYMTYPE
            member.linkname = "../../escape"
            tar.addfile(member)
    archive = data.getvalue()
    pin = {
        "source_repository": "ordaxsystems/ordax-surface",
        "source_commit": surface,
        "os_host_commit": host,
        "release_tag": "meridian-dev-" + surface,
        "archive_sha256": hashlib.sha256(archive).hexdigest(),
        "manifest_sha256": hashlib.sha256(raw_manifest).hexdigest(),
    }
    return archive, pin


class SurfaceDevReleaseTests(unittest.TestCase):
    def test_verified_archive_materializes_read_only_sources(self):
        data, pin = fixture()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "extract"
            materialize(pin, root, open_url=lambda req, timeout: Response(data))
            self.assertTrue((root / "manifest.json").is_file())
            self.assertTrue((root / "assets/surface-snapshot.css").is_file())
            self.assertEqual((root / "manifest.json").read_bytes(),
                             next_tar_manifest(data))
            with self.assertRaisesRegex(SurfaceReleaseError, "already exists"):
                materialize(pin, root, open_url=lambda req, timeout: Response(data))

    def test_forgeries_and_traversal_fail_before_writing(self):
        archive, pin = fixture()
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            tampered = dict(pin, archive_sha256="0"*64)
            with self.assertRaisesRegex(SurfaceReleaseError, "archive pin"):
                materialize(tampered, base / "digest", open_url=lambda req, timeout: Response(archive))
            with self.assertRaisesRegex(SurfaceReleaseError, "release pin"):
                validate_pin(dict(pin, release_tag="meridian-dev-main"))
            link_data, link_pin = fixture(invalid_link=True)
            with self.assertRaisesRegex(SurfaceReleaseError, "archive entry"):
                materialize(link_pin, base / "link", open_url=lambda req, timeout: Response(link_data))
            extra_data, extra_pin = fixture(extra=True)
            with self.assertRaisesRegex(SurfaceReleaseError, "archive entry"):
                materialize(extra_pin, base / "extra", open_url=lambda req, timeout: Response(extra_data))
            self.assertFalse((base / "digest").exists())
            self.assertFalse((base / "link").exists())
            self.assertFalse((base / "extra").exists())

    def test_redirects_outside_github_are_refused(self):
        archive, pin = fixture()
        class Untrusted(Response):
            def geturl(self):
                return "http://127.0.0.1/unsafe"
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(SurfaceReleaseError, "redirect"):
                materialize(pin, Path(tmp) / "out",
                            open_url=lambda req, timeout: Untrusted(archive))


def next_tar_manifest(data):
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        return tar.extractfile("manifest.json").read()


if __name__ == "__main__":
    unittest.main()
