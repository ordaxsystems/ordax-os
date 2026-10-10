#!/usr/bin/env python3
"""Regression tests for the fail-closed Native component-slot reader."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "native_component_slots.py"
# Mirror the Native host bootstrap: sibling generated policy is importable.
if str(MODULE.parent) not in sys.path:
    sys.path.insert(0, str(MODULE.parent))

spec = importlib.util.spec_from_file_location("ordax_native_component_slots_test", MODULE)
slots = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = slots
spec.loader.exec_module(slots)


class NativeComponentSlotTests(unittest.TestCase):
    def make_capability_files(self, root: Path) -> tuple[Path, Path]:
        helper = root / "ordax-runtime-component-channel"
        helper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        helper.chmod(0o755)
        trust = root / "runtime-components-ed25519.json"
        trust.write_text("{}\n", encoding="utf-8")
        trust.chmod(0o644)
        return helper, trust

    def test_reader_requires_stable_usb_and_real_helper_and_trust(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            helper, trust = self.make_capability_files(root)

            self.assertTrue(
                slots.component_slot_reader_available(
                    helper_path=str(helper),
                    trust_path=str(trust),
                    distribution_profile="stable-mvp",
                    product_mode="usb",
                )
            )
            self.assertFalse(
                slots.component_slot_reader_available(
                    helper_path=str(helper),
                    trust_path=str(trust),
                    distribution_profile="owner-development",
                    product_mode="usb",
                )
            )
            self.assertFalse(
                slots.component_slot_reader_available(
                    helper_path=str(helper),
                    trust_path=str(trust),
                    distribution_profile="stable-mvp",
                    product_mode="native-disk",
                )
            )

            helper.unlink()
            helper.symlink_to("/bin/true")
            self.assertFalse(
                slots.component_slot_reader_available(
                    helper_path=str(helper),
                    trust_path=str(trust),
                    distribution_profile="stable-mvp",
                    product_mode="usb",
                )
            )

    def test_read_and_health_mutation_allowlists_are_explicit_and_separate(self):
        self.assertEqual(slots.SUPPORTED_COMPONENTS, frozenset({"internet", "notes", "studio"}))
        self.assertEqual(slots.HEALTH_MUTATION_COMPONENTS, frozenset({"internet", "notes"}))
        self.assertIn("studio", slots.SUPPORTED_COMPONENTS)
        self.assertNotIn("studio", slots.HEALTH_MUTATION_COMPONENTS)

    def test_store_metadata_queries_support_canonical_utility_without_runtime_read(self):
        from native_store_metadata_policy import STORE_METADATA_COMPONENT_IDS
        self.assertIn("calculator", STORE_METADATA_COMPONENT_IDS)
        self.assertNotIn("calculator", slots.SUPPORTED_COMPONENTS)
        self.assertIn("studio", STORE_METADATA_COMPONENT_IDS)
        self.assertNotIn("calculator", slots.HEALTH_MUTATION_COMPONENTS)

        output = (
            b"RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\n"
            b"COMPONENT_ID=calculator\n"
            b"REVISION=0\n"
            b"SOURCE=ABSENT\n"
            b"RUNTIME_SERVED_FROM_SLOT=NO\n"
        )
        completed = subprocess.CompletedProcess([], 0, stdout=output, stderr=b"")
        with mock.patch.object(slots.subprocess, "run", return_value=completed) as run:
            result = slots.resolve_component_slot(
                helper_path="/signed/bin/ordax-runtime-component-channel",
                trust_path="/signed/trust/runtime-components-ed25519.json",
                component_id="calculator",
                state="current",
            )
        self.assertEqual(result.source, "absent")
        self.assertEqual(result.component_id, "calculator")
        self.assertEqual(result.state, "current")
        self.assertIsNone(result.entrypoint)
        self.assertIsNone(result.version)
        self.assertIn("resolve-current", run.call_args.args[0])

        with mock.patch.object(slots.subprocess, "run") as runner:
            with self.assertRaises(slots.ComponentSlotRequestError):
                slots.resolve_component_slot(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust/public.json",
                    component_id="calculator",
                    state="pending",
                )
            with self.assertRaises(slots.ComponentSlotRequestError):
                slots.read_component_runtime_file(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust/public.json",
                    component_id="calculator",
                    state="current",
                    version="0.2.0",
                    source_commit="a" * 40,
                    requested_path="src/runtime.mjs",
                )
            with self.assertRaises(slots.ComponentSlotRequestError):
                slots.parse_component_module_path(
                    slots.COMPONENT_MODULE_PREFIX + "calculator/current/0.2.0/" + ("a" * 40) + "/src/runtime.mjs"
                )
            with self.assertRaises(slots.ComponentSlotRequestError):
                slots.resolve_component_slot(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust/public.json",
                    component_id="unknown-component",
                    state="current",
                )
            runner.assert_not_called()

    def test_current_bundled_resolution_is_parsed_without_slot_claim(self):
        output = (
            b"RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\n"
            b"COMPONENT_ID=internet\n"
            b"REVISION=0\n"
            b"SOURCE=BUNDLED\n"
            b"RUNTIME_SERVED_FROM_SLOT=NO\n"
        )
        completed = subprocess.CompletedProcess([], 0, stdout=output, stderr=b"")
        with mock.patch.object(slots.subprocess, "run", return_value=completed) as run:
            resolution = slots.resolve_component_slot(
                helper_path="/signed/bin/ordax-runtime-component-channel",
                trust_path="/signed/trust/runtime-components-ed25519.json",
                component_id="internet",
                state="current",
            )
        self.assertEqual(resolution.source, "bundled")
        self.assertIsNone(resolution.entrypoint)
        self.assertIsNone(resolution.slot)
        argv = run.call_args.args[0]
        self.assertEqual(argv[1], "resolve-current")
        self.assertIn("--trust", argv)
        self.assertIn("--root", argv)

    def test_external_first_party_current_absence_is_explicit(self):
        output = (
            b"RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\n"
            b"COMPONENT_ID=notes\n"
            b"REVISION=4\n"
            b"SOURCE=ABSENT\n"
            b"RUNTIME_SERVED_FROM_SLOT=NO\n"
        )
        completed = subprocess.CompletedProcess([], 0, stdout=output, stderr=b"")
        with mock.patch.object(slots.subprocess, "run", return_value=completed):
            resolution = slots.resolve_component_slot(
                helper_path="/signed/bin/ordax-runtime-component-channel",
                trust_path="/signed/trust/runtime-components-ed25519.json",
                component_id="notes",
                state="current",
            )
        self.assertEqual(resolution.source, "absent")
        self.assertEqual(resolution.component_id, "notes")
        self.assertIsNone(resolution.version)
        self.assertIsNone(resolution.source_commit)
        self.assertIsNone(resolution.entrypoint)
        self.assertIsNone(resolution.slot)

    def test_native_metadata_preserves_explicit_removal_without_slot_or_execution_authority(self):
        for component_id in ("internet", "notes", "calculator"):
            output = (
                "RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\n"
                f"COMPONENT_ID={component_id}\n"
                "REVISION=9\n"
                "SOURCE=REMOVED\n"
                "RUNTIME_SERVED_FROM_SLOT=NO\n"
            ).encode("utf-8")
            result = subprocess.CompletedProcess([], 0, stdout=output, stderr=b"")
            with mock.patch.object(slots.subprocess, "run", return_value=result):
                resolution = slots.resolve_component_slot(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust/public.json",
                    component_id=component_id,
                    state="current",
                )
            self.assertEqual(resolution.source, "removed")
            self.assertEqual(resolution.revision, 9)
            self.assertIsNone(resolution.version)
            self.assertIsNone(resolution.slot)

        with self.assertRaises(slots.ComponentSlotVerificationError):
            slots._parse_resolution_output(
                b"RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\n"
                b"COMPONENT_ID=notes\n"
                b"REVISION=9\n"
                b"SOURCE=REMOVED\n"
                b"CURRENT_VERSION=9.0.0\n"
                b"RUNTIME_SERVED_FROM_SLOT=NO\n",
                "notes", "current",
            )

    def test_verified_external_app_manifest_path_is_readable_but_untrusted_apps_are_not(self):
        commit = "7" * 40
        request = slots.parse_component_module_path(
            "/__ordax/native/component-module/notes/current/0.4.1/"
            + commit
            + "/system/apps/notes/ai/manifest.json"
        )
        self.assertEqual(request.component_id, "notes")
        self.assertEqual(request.state, "current")
        self.assertEqual(request.version, "0.4.1")
        self.assertEqual(request.source_commit, commit)
        self.assertEqual(request.requested_path, "system/apps/notes/ai/manifest.json")

        with self.assertRaises(slots.ComponentSlotRequestError):
            slots.parse_component_module_path(
                "/__ordax/native/component-module/assistant/current/0.4.1/"
                + commit
                + "/system/apps/assistant/ai/manifest.json"
            )

    def test_pending_resolution_is_exact_and_keeps_probation_health(self):
        commit = "7" * 40
        output = (
            "RUNTIME_COMPONENT_PENDING_RESOLVED=YES\n"
            "COMPONENT_ID=internet\n"
            "REVISION=3\n"
            "SOURCE=SLOT\n"
            "PENDING_VERSION=0.4.0\n"
            f"PENDING_SOURCE_COMMIT={commit}\n"
            "PENDING_HEALTH=unknown\n"
            "/var/lib/ordax/components/internet/versions/0.4.0/"
            f"{commit}"
        )
        # Insert the keyed slot field before the final entrypoint fields.
        slot_path = f"/var/lib/ordax/components/internet/versions/0.4.0/{commit}"
        output = (
            "RUNTIME_COMPONENT_PENDING_RESOLVED=YES\n"
            "COMPONENT_ID=internet\n"
            "REVISION=3\n"
            "SOURCE=SLOT\n"
            "PENDING_VERSION=0.4.0\n"
            f"PENDING_SOURCE_COMMIT={commit}\n"
            "PENDING_HEALTH=unknown\n"
            f"SLOT={slot_path}\n"
            "ENTRYPOINT=system/apps/internet/runtime.mjs\n"
            "RUNTIME_SERVED_FROM_SLOT=NO\n"
        ).encode("utf-8")
        completed = subprocess.CompletedProcess([], 0, stdout=output, stderr=b"")
        with mock.patch.object(slots.subprocess, "run", return_value=completed):
            resolution = slots.resolve_component_slot(
                helper_path="/signed/bin/ordax-runtime-component-channel",
                trust_path="/signed/trust/runtime-components-ed25519.json",
                component_id="internet",
                state="pending",
            )
        self.assertEqual(resolution.source, "slot")
        self.assertEqual(resolution.version, "0.4.0")
        self.assertEqual(resolution.source_commit, commit)
        self.assertEqual(resolution.pending_health, "unknown")
        self.assertEqual(resolution.entrypoint, "system/apps/internet/runtime.mjs")
        self.assertEqual(resolution.slot, slot_path)

    def test_component_module_path_binds_exact_identity_and_package_path(self):
        commit = "7" * 40
        request = slots.parse_component_module_path(
            "/__ordax/native/component-module/internet/pending/0.4.0/"
            + commit
            + "/system/apps/internet/runtime.mjs"
        )
        self.assertEqual(request.component_id, "internet")
        self.assertEqual(request.state, "pending")
        self.assertEqual(request.version, "0.4.0")
        self.assertEqual(request.source_commit, commit)
        self.assertEqual(
            request.requested_path,
            "system/apps/internet/runtime.mjs",
        )

    def test_component_module_path_rejects_encoded_or_traversal_forms(self):
        commit = "7" * 40
        bad = (
            "/__ordax/native/component-module/internet/pending/0.4.0/"
            + commit
            + "/system/apps/internet/%2e%2e/runtime.mjs",
            "/__ordax/native/component-module/internet/pending/0.4.0/"
            + commit
            + "/system/apps/../runtime.mjs",
            "/__ordax/native/component-module/internet/pending/not-semver/"
            + commit
            + "/system/apps/internet/runtime.mjs",
            "/__ordax/native/component-module/internet/pending/0.4.0/not-a-sha/"
            "system/apps/internet/runtime.mjs",
            "/__ordax/native/component-module/assistant/pending/0.4.0/"
            + commit
            + "/system/apps/assistant/runtime.mjs",
        )
        for path in bad:
            with self.subTest(path=path):
                with self.assertRaises(slots.ComponentSlotRequestError):
                    slots.parse_component_module_path(path)

    def test_runtime_file_read_uses_fixed_argv_and_returns_only_verified_stdout(self):
        payload = b'export const componentRuntime = { schema: "ordax.component-runtime/1" };\n'
        completed = subprocess.CompletedProcess([], 0, stdout=payload, stderr=b"")
        with mock.patch.object(slots.subprocess, "run", return_value=completed) as run:
            result = slots.read_component_runtime_file(
                helper_path="/signed/bin/ordax-runtime-component-channel",
                trust_path="/signed/trust/runtime-components-ed25519.json",
                component_id="internet",
                state="pending",
                version="0.4.0",
                source_commit="7777777777777777777777777777777777777777",
                requested_path="system/apps/internet/runtime.mjs",
            )
        self.assertEqual(result, payload)
        argv = run.call_args.args[0]
        self.assertEqual(argv[0], "/signed/bin/ordax-runtime-component-channel")
        self.assertEqual(argv[1], "read-runtime-file")
        self.assertIn("--version", argv)
        self.assertIn("0.4.0", argv)
        self.assertIn("--source-commit", argv)
        self.assertIn("7777777777777777777777777777777777777777", argv)
        self.assertIn("system/apps/internet/runtime.mjs", argv)
        self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertEqual(run.call_args.kwargs["stdout"], subprocess.PIPE)
        self.assertEqual(run.call_args.kwargs["stderr"], subprocess.PIPE)

    def test_invalid_component_and_paths_fail_before_verifier_execution(self):
        with mock.patch.object(slots.subprocess, "run") as run:
            with self.assertRaises(slots.ComponentSlotRequestError):
                slots.read_component_runtime_file(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust.json",
                    component_id="assistant",
                    state="pending",
                    version="0.4.0",
                    source_commit="7777777777777777777777777777777777777777",
                    requested_path="system/apps/assistant/runtime.mjs",
                )
            with self.assertRaises(slots.ComponentSlotRequestError):
                slots.read_component_runtime_file(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust.json",
                    component_id="internet",
                    state="pending",
                    version="0.4.0",
                    source_commit="7777777777777777777777777777777777777777",
                    requested_path="../escape.mjs",
                )
        run.assert_not_called()

    def test_runtime_file_read_rejects_invalid_slot_identity_before_verifier(self):
        with mock.patch.object(slots.subprocess, "run") as run:
            with self.assertRaises(slots.ComponentSlotRequestError):
                slots.read_component_runtime_file(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust.json",
                    component_id="internet",
                    state="pending",
                    version="not-semver",
                    source_commit="7" * 40,
                    requested_path="system/apps/internet/runtime.mjs",
                )
            with self.assertRaises(slots.ComponentSlotRequestError):
                slots.read_component_runtime_file(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust.json",
                    component_id="internet",
                    state="pending",
                    version="0.4.0",
                    source_commit="bad-sha",
                    requested_path="system/apps/internet/runtime.mjs",
                )
        run.assert_not_called()

    def test_verifier_rejection_and_timeout_fail_closed(self):
        rejected = subprocess.CompletedProcess([], 1, stdout=b"", stderr=b"rejected")
        with mock.patch.object(slots.subprocess, "run", return_value=rejected):
            with self.assertRaises(slots.ComponentSlotVerificationError):
                slots.resolve_component_slot(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust.json",
                    component_id="internet",
                    state="pending",
                )

        with mock.patch.object(
            slots.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired(["helper"], timeout=3),
        ):
            with self.assertRaises(slots.ComponentSlotUnavailableError):
                slots.resolve_component_slot(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust.json",
                    component_id="internet",
                    state="pending",
                )

    def test_pending_health_recorder_uses_exact_revision_and_fixed_argv(self):
        commit = "a" * 40
        output = (
            "RUNTIME_COMPONENT_PENDING_HEALTH_RECORDED=YES\n"
            "COMPONENT_ID=internet\n"
            "REVISION=8\n"
            "PENDING_VERSION=0.4.0\n"
            f"PENDING_SOURCE_COMMIT={commit}\n"
            "PENDING_HEALTH=healthy\n"
            "RUNTIME_ACTIVATED=NO\n"
        ).encode("utf-8")
        completed = subprocess.CompletedProcess([], 0, stdout=output, stderr=b"")
        with mock.patch.object(slots.subprocess, "run", return_value=completed) as run:
            record = slots.record_component_pending_health(
                helper_path="/signed/bin/ordax-runtime-component-channel",
                component_id="internet",
                version="0.4.0",
                source_commit=commit,
                expected_revision=7,
                health="healthy",
            )
        self.assertEqual(record.component_id, "internet")
        self.assertEqual(record.revision, 8)
        self.assertEqual(record.version, "0.4.0")
        self.assertEqual(record.source_commit, commit)
        self.assertEqual(record.health, "healthy")
        argv = run.call_args.args[0]
        self.assertEqual(argv[1], "record-health")
        self.assertIn("--expected-revision", argv)
        self.assertIn("7", argv)
        self.assertIn("--health", argv)
        self.assertIn("healthy", argv)
        self.assertNotIn("promote-state", argv)
        self.assertNotIn("reject-pending", argv)
        self.assertNotIn("rollback-state", argv)

    def test_notes_health_mutation_is_explicit_but_studio_read_does_not_imply_it(self):
        commit = "a" * 40
        output = (
            "RUNTIME_COMPONENT_PENDING_HEALTH_RECORDED=YES\n"
            "COMPONENT_ID=notes\n"
            "REVISION=8\n"
            "PENDING_VERSION=0.4.1\n"
            f"PENDING_SOURCE_COMMIT={commit}\n"
            "PENDING_HEALTH=healthy\n"
            "RUNTIME_ACTIVATED=NO\n"
        ).encode("utf-8")
        completed = subprocess.CompletedProcess([], 0, stdout=output, stderr=b"")
        with mock.patch.object(slots.subprocess, "run", return_value=completed) as run:
            record = slots.record_component_pending_health(
                helper_path="/signed/bin/helper",
                component_id="notes",
                version="0.4.1",
                source_commit=commit,
                expected_revision=7,
                health="healthy",
            )
        self.assertEqual(record.component_id, "notes")
        self.assertIn("notes", run.call_args.args[0])
        self.assertNotIn("promote-state", run.call_args.args[0])

        with mock.patch.object(slots.subprocess, "run") as run:
            with self.assertRaisesRegex(
                slots.ComponentSlotRequestError,
                "unsupported runtime component health mutation",
            ):
                slots.record_component_pending_health(
                    helper_path="/signed/bin/helper",
                    component_id="studio",
                    version="0.5.0",
                    source_commit=commit,
                    expected_revision=7,
                    health="healthy",
                )
        run.assert_not_called()

    def test_pending_health_recorder_rejects_invalid_input_before_helper(self):
        with mock.patch.object(slots.subprocess, "run") as run:
            with self.assertRaises(slots.ComponentSlotRequestError):
                slots.record_component_pending_health(
                    helper_path="/signed/bin/helper",
                    component_id="internet",
                    version="0.4.0",
                    source_commit="a" * 40,
                    expected_revision=0,
                    health="healthy",
                )
            with self.assertRaises(slots.ComponentSlotRequestError):
                slots.record_component_pending_health(
                    helper_path="/signed/bin/helper",
                    component_id="internet",
                    version="0.4.0",
                    source_commit="a" * 40,
                    expected_revision=7,
                    health="maybe",
                )
        run.assert_not_called()

    def test_pending_health_recorder_rejects_mismatched_helper_receipt(self):
        commit = "a" * 40
        bad = (
            "RUNTIME_COMPONENT_PENDING_HEALTH_RECORDED=YES\n"
            "COMPONENT_ID=internet\n"
            "REVISION=9\n"
            "PENDING_VERSION=0.4.0\n"
            f"PENDING_SOURCE_COMMIT={commit}\n"
            "PENDING_HEALTH=healthy\n"
            "RUNTIME_ACTIVATED=NO\n"
        ).encode("utf-8")
        completed = subprocess.CompletedProcess([], 0, stdout=bad, stderr=b"")
        with mock.patch.object(slots.subprocess, "run", return_value=completed):
            with self.assertRaises(slots.ComponentSlotVerificationError):
                slots.record_component_pending_health(
                    helper_path="/signed/bin/helper",
                    component_id="internet",
                    version="0.4.0",
                    source_commit=commit,
                    expected_revision=7,
                    health="healthy",
                )


if __name__ == "__main__":
    unittest.main()
