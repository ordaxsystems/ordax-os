import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD_PATH = ROOT / "tools" / "component-package" / "build.py"
RELEASE_V2_PATH = ROOT / "tools" / "component-package" / "release_v2.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


package_builder = load_module("ordax_component_package_build", BUILD_PATH)
release_v2 = load_module("ordax_component_release_v2", RELEASE_V2_PATH)

SOURCE_COMMIT = "a" * 40


class RuntimeComponentReleaseV2Tests(unittest.TestCase):
    def build_package(self, root: Path, component_id: str) -> Path:
        package = root / f"{component_id}.zip"
        package_builder.build_package(component_id, SOURCE_COMMIT, package)
        return package

    def build_v2(self, root: Path, component_id: str):
        package = self.build_package(root, component_id)
        compatibility = root / f"{component_id}.compatibility.json"
        release = root / f"{component_id}.release-v2.json"
        descriptor = release_v2.build_release_v2(
            package,
            release,
            compatibility,
        )
        return package, compatibility, release, descriptor

    def test_release_v2_binds_canonical_local_ai_compatibility(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            package, compatibility, release, descriptor = self.build_v2(
                root, "local-ai-service"
            )

            verified = release_v2.verify_release_v2(release, compatibility, package)
            self.assertEqual(
                verified["$schema"],
                "prototype-ordax.runtime-component-release/2",
            )
            self.assertEqual(verified["component"]["id"], "local-ai-service")
            self.assertEqual(
                verified["compatibility"]["schema"],
                "ordax.component-compatibility/1",
            )
            self.assertEqual(
                verified["compatibility"]["sha256"],
                release_v2.sha256_bytes(compatibility.read_bytes()),
            )
            compatibility_value = json.loads(compatibility.read_text("utf-8"))
            self.assertEqual(compatibility_value["authority"], "none")
            self.assertEqual(
                compatibility_value["componentVersion"],
                descriptor["component"]["version"],
            )

    def test_release_v1_semantics_remain_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            package = self.build_package(Path(temp), "local-ai-service")
            release = package_builder.render_release_descriptor(package)
            self.assertEqual(
                release["$schema"],
                "prototype-ordax.runtime-component-release/1",
            )
            self.assertNotIn("compatibility", release)

    def test_compatibility_byte_tamper_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            package, compatibility, release, _ = self.build_v2(
                root, "ordax-intelligence"
            )
            value = json.loads(compatibility.read_text("utf-8"))
            value["requires"][0]["maxMajor"] = 2
            compatibility.write_bytes(release_v2.canonical_json_bytes(value))

            with self.assertRaisesRegex(
                release_v2.ReleaseV2Error,
                "digest binding mismatch",
            ):
                release_v2.verify_release_v2(release, compatibility, package)

    def test_rehashed_cross_component_descriptor_still_fails_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            package, compatibility, release, _ = self.build_v2(
                root, "local-ai-service"
            )
            value = json.loads(compatibility.read_text("utf-8"))
            value["componentId"] = "ordax-intelligence"
            payload = release_v2.canonical_json_bytes(value)
            compatibility.write_bytes(payload)

            release_value = json.loads(release.read_text("utf-8"))
            release_value["compatibility"]["sha256"] = release_v2.sha256_bytes(payload)
            release_value["compatibility"]["size"] = len(payload)
            release.write_bytes(release_v2.canonical_json_bytes(release_value))

            with self.assertRaisesRegex(
                release_v2.ReleaseV2Error,
                "component id does not match package",
            ):
                release_v2.verify_release_v2(release, compatibility, package)

    def test_rehashed_authority_escalation_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            package, compatibility, release, _ = self.build_v2(
                root, "local-ai-service"
            )
            value = json.loads(compatibility.read_text("utf-8"))
            value["authority"] = "system"
            payload = release_v2.canonical_json_bytes(value)
            compatibility.write_bytes(payload)

            release_value = json.loads(release.read_text("utf-8"))
            release_value["compatibility"]["sha256"] = release_v2.sha256_bytes(payload)
            release_value["compatibility"]["size"] = len(payload)
            release.write_bytes(release_v2.canonical_json_bytes(release_value))

            with self.assertRaisesRegex(
                release_v2.ReleaseV2Error,
                "authority:none",
            ):
                release_v2.verify_release_v2(release, compatibility, package)

    def test_release_v2_rejects_package_substitution(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            _, compatibility, release, _ = self.build_v2(
                root, "local-ai-service"
            )
            replacement = self.build_package(root, "ordax-intelligence")

            with self.assertRaises(release_v2.ReleaseV2Error):
                release_v2.verify_release_v2(release, compatibility, replacement)

    def test_v2_is_not_available_for_component_without_canonical_descriptor(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            package = self.build_package(root, "internet")
            with self.assertRaisesRegex(
                release_v2.ReleaseV2Error,
                "could not resolve canonical component compatibility",
            ):
                release_v2.build_release_v2(
                    package,
                    root / "internet.release-v2.json",
                    root / "internet.compatibility.json",
                )


if __name__ == "__main__":
    unittest.main()
