from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import json
import shutil
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "tools" / "component-package" / "build.py"
POLICY = ROOT / "docs" / "contracts" / "runtime-component-package.json"


def load_builder():
    spec = spec_from_file_location("ordax_runtime_component_package_test", BUILDER_PATH)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class RuntimeComponentPackageTests(unittest.TestCase):
    def test_policy_is_signed_slot_staging_and_fail_closed(self):
        policy = json.loads(POLICY.read_text(encoding="utf-8"))
        self.assertEqual(
            policy["$schema"],
            "prototype-ordax.runtime-component-package-policy/1",
        )
        self.assertEqual(policy["status"], "signed-slot-staging")
        self.assertEqual(
            policy["supported_components"],
            ["internet", "local-ai-service", "ordax-intelligence"],
        )
        self.assertNotIn("notes", policy["supported_components"])
        self.assertEqual(
            policy["packaging_only_components"],
            ["local-ai-service", "ordax-intelligence"],
        )
        self.assertFalse(policy["intelligence_component_activation_enabled"])
        self.assertFalse(policy["intelligence_component_health_promotion_proven"])
        self.assertFalse(policy["intelligence_component_rollback_proven"])
        self.assertEqual(
            policy["release_descriptor_schema"],
            "prototype-ordax.runtime-component-release/1",
        )
        self.assertEqual(
            policy["envelope_schema"],
            "prototype-ordax.runtime-component-envelope/1",
        )
        self.assertEqual(
            policy["trust_schema"],
            "prototype-ordax.runtime-component-trust/1",
        )
        self.assertEqual(policy["trust_domain"], "runtime-components")
        self.assertTrue(policy["self_contained_source_graph_required"])
        self.assertFalse(policy["remote_runtime_dependencies_allowed"])
        self.assertFalse(policy["native_adapters_may_be_packaged"])
        self.assertFalse(policy["composition_may_be_packaged"])
        self.assertTrue(policy["signature_required_before_activation"])
        self.assertFalse(policy["activation_allowed_from_unsigned_candidate"])
        self.assertFalse(policy["direct_activation_allowed_from_signed_package"])
        self.assertTrue(policy["pending_health_required_before_promotion"])
        self.assertFalse(policy["canonical_component_trust_anchor_pinned"])
        self.assertTrue(policy["ci_ephemeral_component_trust_allowed_for_protocol_proof"])
        self.assertFalse(policy["whole_os_release_trust_may_be_implicitly_reused"])
        self.assertEqual(policy["native_slot_root"], "/var/lib/ordax/components")
        self.assertTrue(policy["immutable_slot_staging_available"])
        self.assertTrue(policy["activation_state_machine_available"])
        self.assertTrue(policy["activation_state_atomic_current_previous_pending_rejected"])
        self.assertTrue(policy["activation_state_revalidates_signed_slots"])
        self.assertTrue(policy["activation_state_requires_component_slot_release_mode"])
        self.assertTrue(policy["pending_slot_resolution_available"])
        self.assertTrue(policy["current_slot_resolution_available"])
        self.assertTrue(policy["verified_runtime_file_read_available"])
        self.assertTrue(policy["runtime_file_read_revalidates_slot_and_hash"])
        self.assertTrue(policy["runtime_file_read_requires_exact_version_and_source_commit"])
        self.assertTrue(policy["runtime_file_read_rejects_state_identity_change"])
        self.assertTrue(policy["native_loopback_virtual_namespace_identity_bound"])
        self.assertTrue(policy["native_loopback_virtual_module_namespace_available"])
        self.assertEqual(policy["native_loopback_virtual_module_namespace_prefix"], "/__ordax/native/component-module/")
        self.assertTrue(policy["component_runtime_metadata_route_metadata_only"])
        self.assertFalse(policy["component_runtime_metadata_route_serves_bytes"])
        self.assertTrue(policy["relative_module_imports_preserve_identity_namespace"])
        self.assertTrue(policy["native_loopback_verified_read_broker_implemented"])
        self.assertTrue(policy["native_loopback_broker_stable_usb_only"])
        self.assertTrue(policy["native_loopback_broker_requires_signed_system_helper"])
        self.assertTrue(policy["native_loopback_broker_requires_component_trust"])
        self.assertTrue(policy["native_loopback_broker_read_only"])
        self.assertFalse(policy["failed_pending_runtime_read_allowed"])
        self.assertEqual(policy["native_loopback_broker_supported_components"], ["internet", "notes", "studio"])
        self.assertEqual(
            policy["native_loopback_broker_health_mutation_components"],
            ["internet", "notes"],
        )
        self.assertTrue(policy["notes_component_slot_read_available"])
        self.assertTrue(policy["notes_component_probation_available"])
        self.assertFalse(policy["notes_component_distribution_activation_enabled"])
        self.assertFalse(policy["notes_component_promotion_proven"])
        self.assertFalse(policy["notes_component_rollback_proven"])
        self.assertFalse(policy["native_slot_serving_available"])
        self.assertFalse(policy["slot_activation_available"])
        self.assertFalse(policy["pending_health_promotion_available"])
        self.assertFalse(policy["publish_allowed"])
        self.assertFalse(policy["rollback_slot_activation_available"])
        self.assertEqual(policy["internet_release_mode"], "git-app")
        self.assertTrue(policy["pending_probation_loader_available"])
        self.assertTrue(policy["native_pending_health_recorder_adapter_available"])
        self.assertTrue(policy["native_pending_health_recorder_requires_exact_revision"])
        self.assertFalse(policy["native_pending_health_recorder_promotes_candidate"])
        self.assertFalse(policy["native_pending_health_recorder_exposed_over_http"])
        self.assertFalse(policy["pending_probation_loader_promotes_candidate"])
        self.assertFalse(policy["pending_probation_loader_mutates_component_state"])
        self.assertTrue(policy["pending_probation_loader_requires_unknown_pending_health"])
        self.assertTrue(policy["runtime_health_bridge_available"])
        self.assertEqual(policy["runtime_health_bridge_owner"], "ordax_browser_host")
        self.assertEqual(
            policy["runtime_health_bridge_transport"],
            "native-webkit-message-nonce",
        )
        self.assertEqual(
            policy["runtime_health_bridge_probe_registry"],
            "system/services/components/probation-orchestrator.mjs",
        )
        self.assertEqual(
            policy["runtime_health_bridge_supported_components"],
            ["internet", "notes"],
        )
        self.assertEqual(policy["runtime_health_bridge_probe_mode"], "import-contract")
        self.assertTrue(policy["runtime_health_bridge_requires_host_nonce"])
        self.assertFalse(policy["runtime_health_bridge_exposed_over_http"])
        self.assertFalse(policy["runtime_health_bridge_promotes_candidate"])
        self.assertFalse(policy["runtime_health_bridge_rejects_candidate"])
        self.assertFalse(policy["runtime_health_bridge_rolls_back_candidate"])
        self.assertTrue(policy["runtime_health_bridge_records_exact_pending_revision"])
        self.assertTrue(policy["component_promotion_policy_available"])
        self.assertEqual(
            policy["component_promotion_policy_owner"],
            "system/services/components/promotion-policy.mjs",
        )
        self.assertFalse(policy["component_promotion_policy_executes_actions"])
        self.assertEqual(policy["component_promotion_policy_failed_health_action"], "reject")
        self.assertEqual(policy["component_promotion_policy_unknown_health_action"], "hold")
        self.assertTrue(policy["component_promotion_policy_requires_component_slot_for_promote"])
        self.assertTrue(policy["component_promotion_policy_requires_canonical_trust_for_promote"])
        self.assertTrue(policy["component_promotion_policy_requires_activation_gate_for_promote"])
        self.assertEqual(policy["component_promotion_policy_healthy_git_app_action"], "hold")
        self.assertFalse(policy["pending_health_promotion_available"])
        self.assertTrue(policy["promotion_requires_exact_revision"])
        self.assertTrue(policy["promotion_requires_exact_pending_identity"])
        self.assertTrue(policy["promotion_idempotent_same_decision"])
        self.assertTrue(policy["rejection_requires_exact_revision"])
        self.assertTrue(policy["rejection_requires_exact_pending_identity"])
        self.assertTrue(policy["rejection_idempotent_same_decision"])
        self.assertTrue(policy["rollback_requires_exact_revision"])
        self.assertTrue(policy["rollback_requires_exact_current_identity"])
        self.assertTrue(policy["rollback_idempotent_same_decision"])

    def test_internet_metadata_comes_from_canonical_component_manifest(self):
        builder = load_builder()
        metadata = builder.load_component_metadata("internet")
        component = metadata["component"]
        self.assertEqual(component["id"], "internet")
        self.assertEqual(component["version"], "0.3.0")
        self.assertEqual(component["releaseMode"], "git-app")
        self.assertEqual(component["restartScope"], "component")
        self.assertEqual(component["healthMode"], "runtime")
        self.assertEqual(
            metadata["entrypoint"].as_posix(),
            "system/apps/internet/runtime.mjs",
        )

    def test_intelligence_component_metadata_comes_from_canonical_manifests(self):
        builder = load_builder()
        cases = {
            "local-ai-service": "system/components/local-ai-service/runtime.mjs",
            "ordax-intelligence": "system/components/ordax-intelligence/runtime.mjs",
        }
        for component_id, entrypoint in cases.items():
            with self.subTest(component_id=component_id):
                metadata = builder.load_component_metadata(component_id)
                component = metadata["component"]
                self.assertEqual(component["id"], component_id)
                self.assertEqual(component["version"], "0.1.0")
                self.assertEqual(component["releaseMode"], "bundled")
                self.assertEqual(component["restartScope"], "component")
                self.assertIn(component["healthMode"], {"process", "runtime"})
                self.assertEqual(metadata["entrypoint"].as_posix(), entrypoint)

    def test_intelligence_component_packages_are_deterministic_but_not_activatable(self):
        builder = load_builder()
        source_commit = "a" * 40
        for component_id in ("local-ai-service", "ordax-intelligence"):
            with self.subTest(component_id=component_id), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                first = root / f"{component_id}-a.zip"
                second = root / f"{component_id}-b.zip"
                first_manifest = builder.build_package(component_id, source_commit, first)
                second_manifest = builder.build_package(component_id, source_commit, second)
                self.assertEqual(first.read_bytes(), second.read_bytes())
                self.assertEqual(first_manifest, second_manifest)
                verified = builder.verify_package(first)
                self.assertEqual(verified["component"]["id"], component_id)
                self.assertEqual(verified["component"]["releaseMode"], "bundled")
                self.assertFalse(verified["activation_allowed"])
                self.assertTrue(verified["signature_required_before_activation"])
                self.assertFalse(verified["native_adapters_packaged"])
                self.assertFalse(verified["composition_packaged"])

    def test_internet_candidate_graph_is_self_contained_and_excludes_platform_code(self):
        builder = load_builder()
        metadata, graph = builder.component_graph("internet")
        paths = {path.as_posix() for path in graph}
        self.assertIn(metadata["entrypoint"].as_posix(), paths)
        self.assertIn("system/apps/internet/internet.css", paths)
        self.assertIn("system/contracts/browser-session.mjs", paths)
        self.assertIn("system/apps/internet/services/history.mjs", paths)
        self.assertIn("system/apps/internet/ui/browser-controls.mjs", paths)
        self.assertFalse(any(path.startswith("system/adapters/") for path in paths))
        self.assertFalse(any(path.startswith("system/composition/") for path in paths))
        self.assertFalse(any(path.startswith("system/surface/runtime/") for path in paths))

    def test_package_build_is_byte_deterministic_and_verifiable(self):
        builder = load_builder()
        source_commit = "1" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "internet-a.zip"
            second = root / "internet-b.zip"

            first_manifest = builder.build_package(
                "internet",
                source_commit,
                first,
            )
            second_manifest = builder.build_package(
                "internet",
                source_commit,
                second,
            )

            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(
                hashlib.sha256(first.read_bytes()).hexdigest(),
                hashlib.sha256(second.read_bytes()).hexdigest(),
            )
            verified = builder.verify_package(first)
            self.assertEqual(verified, first_manifest)
            self.assertEqual(verified, second_manifest)
            self.assertEqual(verified["component"]["version"], "0.3.0")
            self.assertFalse(verified["activation_allowed"])
            self.assertTrue(verified["signature_required_before_activation"])
            self.assertFalse(verified["native_adapters_packaged"])
            self.assertFalse(verified["composition_packaged"])

    def test_release_descriptor_is_deterministic_and_binds_exact_package(self):
        builder = load_builder()
        source_commit = "4" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "internet.zip"
            first = root / "release-a.json"
            second = root / "release-b.json"
            builder.build_package("internet", source_commit, package)

            first_descriptor = builder.write_release_descriptor(package, first)
            second_descriptor = builder.write_release_descriptor(package, second)

            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(first_descriptor, second_descriptor)
            self.assertEqual(
                first_descriptor["$schema"],
                "prototype-ordax.runtime-component-release/1",
            )
            self.assertEqual(
                first_descriptor["source_repository"],
                "ordaxsystems/ordax-os",
            )
            self.assertEqual(first_descriptor["source_commit"], source_commit)
            self.assertEqual(first_descriptor["component"]["id"], "internet")
            self.assertEqual(first_descriptor["component"]["version"], "0.3.0")
            self.assertEqual(first_descriptor["component"]["release_mode"], "git-app")
            self.assertEqual(first_descriptor["package"]["name"], "internet.zip")
            self.assertEqual(
                first_descriptor["package"]["sha256"],
                hashlib.sha256(package.read_bytes()).hexdigest(),
            )
            with zipfile.ZipFile(package, "r") as archive:
                manifest_bytes = archive.read(builder.MANIFEST_NAME)
            self.assertEqual(
                first_descriptor["package"]["manifest_sha256"],
                hashlib.sha256(manifest_bytes).hexdigest(),
            )
            self.assertFalse(
                first_descriptor["activation"]["direct_activation_allowed"]
            )
            self.assertTrue(first_descriptor["activation"]["pending_health_required"])

    def test_tampered_file_is_rejected(self):
        builder = load_builder()
        source_commit = "2" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "internet.zip"
            tampered = root / "tampered.zip"
            builder.build_package("internet", source_commit, original)

            with zipfile.ZipFile(original, "r") as source:
                entries = {
                    info.filename: source.read(info.filename)
                    for info in source.infolist()
                }
            runtime = "system/apps/internet/runtime.mjs"
            entries[runtime] += b"\n// tampered\n"

            with zipfile.ZipFile(tampered, "w", compression=zipfile.ZIP_STORED) as target:
                for name in sorted(entries):
                    target.writestr(builder.zip_info(name), entries[name])

            with self.assertRaisesRegex(
                builder.ComponentPackageError,
                "integrity mismatch",
            ):
                builder.verify_package(tampered)

    def test_archive_traversal_and_unreachable_payload_are_rejected(self):
        builder = load_builder()
        source_commit = "3" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "internet.zip"
            malicious = root / "malicious.zip"
            builder.build_package("internet", source_commit, original)

            with zipfile.ZipFile(original, "r") as source:
                entries = [
                    (info.filename, source.read(info.filename))
                    for info in source.infolist()
                ]
            with zipfile.ZipFile(malicious, "w", compression=zipfile.ZIP_STORED) as target:
                for name, payload in entries:
                    target.writestr(builder.zip_info(name), payload)
                target.writestr(builder.zip_info("../escape.mjs"), b"export {};\n")

            with self.assertRaisesRegex(
                builder.ComponentPackageError,
                "unsafe package path",
            ):
                builder.verify_package(malicious)

    def test_component_manifest_rejects_cross_component_owner_files(self):
        builder = load_builder()
        manifest = {
            "$schema": builder.SCHEMA,
            "status": "candidate",
            "component": {
                "id": "local-ai-service",
                "version": "0.1.0",
                "releaseMode": "bundled",
            },
            "source_commit": "b" * 40,
            "entrypoint": "system/components/local-ai-service/runtime.mjs",
            "self_contained_source_graph": True,
            "remote_runtime_dependencies": False,
            "activation_allowed": False,
            "signature_required_before_activation": True,
            "native_adapters_packaged": False,
            "composition_packaged": False,
            "files": [
                {
                    "path": "system/components/local-ai-service/runtime.mjs",
                    "sha256": "1" * 64,
                    "size": 1,
                },
                {
                    "path": "system/components/ordax-intelligence/runtime.mjs",
                    "sha256": "2" * 64,
                    "size": 1,
                },
            ],
        }
        with self.assertRaisesRegex(
            builder.ComponentPackageError,
            "another component owner",
        ):
            builder.validate_manifest_shape(manifest)

    def test_shared_source_graph_detects_import_meta_assets(self):
        builder = load_builder()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = root / "system" / "components" / "sample" / "runtime.mjs"
            style = root / "system" / "components" / "sample" / "style.css"
            helper = root / "system" / "contracts" / "sample.mjs"
            entry.parent.mkdir(parents=True)
            helper.parent.mkdir(parents=True)
            entry.write_text(
                'import "../../contracts/sample.mjs";\n'
                'export const style = new URL("./style.css", import.meta.url).href;\n',
                encoding="utf-8",
            )
            style.write_text(".sample { display: block; }\n", encoding="utf-8")
            helper.write_text("export const sample = true;\n", encoding="utf-8")

            graph = builder.discover_graph(
                root,
                builder.PurePosixPath("system/components/sample/runtime.mjs"),
                allowed_prefixes=("system",),
            )
            self.assertEqual(
                {path.as_posix() for path in graph},
                {
                    "system/components/sample/runtime.mjs",
                    "system/components/sample/style.css",
                    "system/contracts/sample.mjs",
                },
            )


if __name__ == "__main__":
    unittest.main()
