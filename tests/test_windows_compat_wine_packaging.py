import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/wine_packaging.py"


def load_module():
    spec = importlib.util.spec_from_file_location("wine_packaging", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PACKAGING = load_module()


class WinePackagingInputTests(unittest.TestCase):
    def test_pinned_alpine_rpath_patch_matches_contract(self):
        value = PACKAGING.validate()
        patch = PACKAGING.PATCH_PATH.read_bytes()
        self.assertEqual(len(patch), 1569)
        self.assertEqual(hashlib.sha256(patch).hexdigest(), value["local_patch"]["sha256"])
        self.assertEqual(hashlib.sha512(patch).hexdigest(), value["authority"]["apkbuild_declared_patch_sha512"])
        self.assertIn(b"UNIXLDFLAGS", patch)
        self.assertIn(b"$ORIGIN", patch)

    def test_runtime_and_execution_promotion_remain_closed(self):
        value = PACKAGING.validate()
        promotion = value["promotion"]
        self.assertTrue(promotion["packaging_patch_content_pinned"])
        for key in (
            "runtime_dependency_inventory_complete",
            "runtime_package_content_hashes_pinned",
            "binary_artifact_pinned",
            "activation_authorized",
            "execution_authorized",
            "wine_executed",
            "windows_payload_executed",
        ):
            self.assertFalse(promotion[key], key)

    def test_validator_rejects_patch_tampering(self):
        original_path = PACKAGING.PATCH_PATH
        with tempfile.TemporaryDirectory() as temp:
            bad = Path(temp) / "alpine-wine-rpath.patch"
            bad.write_bytes(original_path.read_bytes() + b"\n# tampered\n")
            PACKAGING.PATCH_PATH = bad
            try:
                with self.assertRaises(PACKAGING.WinePackagingInputError):
                    PACKAGING.validate()
            finally:
                PACKAGING.PATCH_PATH = original_path

    def test_contract_has_pinned_aports_commit_not_moving_branch_authority(self):
        value = PACKAGING.validate()
        authority = value["authority"]
        self.assertRegex(authority["commit_sha"], r"^[0-9a-f]{40}$")
        self.assertEqual(authority["repository"], "alpinelinux/aports")
        self.assertEqual(authority["patch_path"], "community/wine/rpath.patch")
        self.assertNotIn("master", json.dumps(authority, sort_keys=True))


if __name__ == "__main__":
    unittest.main()
