import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ordax_public_deployment_tests", ROOT / "tools/public-site/deployment.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PublicDeploymentBundleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.portal, cls.web = cls.root / "portal", cls.root / "web"
        MODULE.PORTAL.build_bundle(cls.portal, "1" * 40)
        compiled = cls.root / "compiled"
        (compiled / "assets").mkdir(parents=True)
        (compiled / "index.html").write_text('<script src="/ordax/assets/app.js"></script>', encoding="utf-8")
        (compiled / "assets/app.js").write_text('console.log("canonical Web")', encoding="utf-8")
        with patch.object(MODULE.WEB, "compile_frontend", return_value=compiled):
            MODULE.WEB.build_bundle(cls.web, "1" * 40, mount_path="/ordax/")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.output = self.root / self._testMethodName

    def test_components_keep_bytes_and_repeatable_receipts(self):
        first = MODULE.assemble(self.portal, self.web, self.output)
        second = MODULE.assemble(self.portal, self.web, self.root / "repeat")
        self.assertEqual(first, second)
        self.assertEqual((self.output / "index.html").read_bytes(), (self.portal / "index.html").read_bytes())
        self.assertEqual((self.output / "ordax/index.html").read_bytes(), (self.web / "index.html").read_bytes())
        self.assertEqual(MODULE.verify(self.output)["source_commit"], "1" * 40)
        with self.assertRaisesRegex(MODULE.DeploymentError, "already exists"):
            MODULE.assemble(self.portal, self.web, self.output)

    def test_commit_mismatch_and_wrong_mount_fail_before_copy(self):
        path = self.web / MODULE.WEB.MANIFEST_NAME
        original = path.read_text(encoding="utf-8")
        try:
            for field, value, message in [("source_commit", "2" * 40, "commits differ"), ("mount_path", "/", "compiled for")]:
                data = json.loads(original)
                data[field] = value
                path.write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaisesRegex(MODULE.DeploymentError, message):
                    MODULE.assemble(self.portal, self.web, self.output)
                self.assertFalse(self.output.exists())
        finally:
            path.write_text(original, encoding="utf-8")

    def test_corruption_and_extra_files_are_rejected(self):
        MODULE.assemble(self.portal, self.web, self.output)
        extra = self.output / "unexpected.js"
        extra.write_text("unreceipted", encoding="utf-8")
        with self.assertRaisesRegex(MODULE.DeploymentError, "integrity"):
            MODULE.verify(self.output)
        extra.unlink()
        (self.output / "ordax/assets/app.js").write_text("corrupted", encoding="utf-8")
        with self.assertRaisesRegex(MODULE.DeploymentError, "integrity"):
            MODULE.verify(self.output)

    def test_rehashed_extra_file_still_cannot_escape_component_ownership(self):
        MODULE.assemble(self.portal, self.web, self.output)
        (self.output / "unowned.js").write_text("unowned", encoding="utf-8")
        path = self.output / MODULE.MANIFEST
        data = json.loads(path.read_text(encoding="utf-8"))
        data["files"] = MODULE.records(self.output)
        path.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(MODULE.DeploymentError, "outside its components"):
            MODULE.verify(self.output)

    def test_portal_traversal_is_rejected_before_component_reconstruction(self):
        MODULE.assemble(self.portal, self.web, self.output)
        path = self.output / MODULE.PORTAL.MANIFEST_NAME
        aggregate = self.output / MODULE.MANIFEST
        original = path.read_text(encoding="utf-8")
        for unsafe in ("../outside", "C:/outside", "..\\outside", "/outside", "ordax/index.html"):
            with self.subTest(path=unsafe):
                data = json.loads(original)
                data["files"].append({"path": unsafe, "size": 0, "sha256": "0" * 64})
                path.write_text(json.dumps(data), encoding="utf-8")
                manifest = json.loads(aggregate.read_text(encoding="utf-8"))
                manifest["files"] = MODULE.records(self.output)
                aggregate.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaisesRegex(MODULE.DeploymentError, "unsafe portal"):
                    MODULE.verify(self.output)


if __name__ == "__main__":
    unittest.main()
