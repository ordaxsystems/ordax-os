import importlib.util
import json
import stat
import tempfile
import threading
import unittest
from unittest import mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "system" / "diagnostics" / "mvp_surface_smoke.py"
WRAPPER = ROOT / "system" / "surface" / "bin" / "ordax-mvp-smoke"
RUNTIME_RESOLVER = ROOT / "system" / "surface" / "bin" / "ordax-proof-runtime.sh"

spec = importlib.util.spec_from_file_location("ordax_mvp_surface_smoke", PROOF)
proof = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(proof)


class SmokeHandler(BaseHTTPRequestHandler):
    expected_authority = ""

    def log_message(self, _format, *_args):
        return

    def _send_json(self, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Host") != self.expected_authority:
            self.send_response(403)
            self.end_headers()
            return
        if self.path == "/composition/native/index.html":
            body = b"<!doctype html><title>OrdaX</title>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/__ordax/native/preferences":
            self._send_json({"appearance.theme": "dark", "private.customer-note": "SECRET-PREFERENCE"})
            return
        if self.path == "/__ordax/native/metrics":
            self._send_json({
                "uptimeSeconds": 123,
                "memoryTotalBytes": 1000,
                "memoryAvailableBytes": 400,
                "userStorageTotalBytes": 5000,
                "userStorageFreeBytes": 3000,
            })
            return
        if self.path == "/__ordax/native/network-status":
            self._send_json({
                "interfaces": [
                    {"name": "wlan0", "kind": "wifi", "state": "connected", "signalDbm": -54},
                    {"name": "eth0", "kind": "ethernet", "state": "disconnected", "signalDbm": None},
                ]
            })
            return
        if self.path == "/__ordax/native/power-status":
            self._send_json({
                "battery": {"percent": 71, "state": "discharging"},
                "externalPower": False,
            })
            return
        if self.path == "/__ordax/native/keyboard-layout":
            self._send_json({
                "configuredLayoutId": "br-abnt2",
                "appliedLayoutId": "br-abnt2",
                "supportedLayoutIds": ["br-abnt2", "us"],
                "restartRequired": False,
            })
            return
        if self.path == "/__ordax/native/files?path=%2F":
            self._send_json({
                "path": "/",
                "entries": [
                    {"name": "Documento secreto.txt", "kind": "file", "size": 12, "modifiedAt": 1234},
                    {"name": "Projetos", "kind": "directory", "size": 0, "modifiedAt": 1235},
                ],
            })
            return
        if self.path == "/__ordax/native/update":
            self._send_json({
                "sourceSha": "b" * 40,
                "deliveryNumber": 42,
                "runtimeSurfaceSha": "b" * 40,
                "targetSha": "",
                "status": "running",
                "phase": "idle",
                "applyMode": "none",
                "attemptId": "",
                "bootRefreshRequired": False,
                "baseUpdatePhase": "none",
                "baseUpdateSha": "",
                "checkedAt": "2026-09-20T12:00:00Z",
                "lastAppliedSha": "b" * 40,
                "lastAppliedAt": "2026-09-20T11:59:00Z",
                "lastApplyDurationSeconds": 1,
                "lastStageDurationSeconds": 2,
                "rejectedSha": "",
                "lastError": "",
                "healthToken": "SECRET-HEALTH-TOKEN",
            })
            return
        if self.path == "/__ordax/native/update-history":
            self._send_json({
                "releases": [],
                "applications": [
                    {
                        "deliveryNumber": 42,
                        "sourceSha": "a" * 40,
                        "appliedAt": "2026-09-20T12:00:00Z",
                        "applyMode": "reload",
                        "result": "applied",
                        "applyDurationSeconds": 1,
                        "stageDurationSeconds": 2,
                    }
                ],
            })
            return
        self.send_response(404)
        self.end_headers()


class MvpSurfaceSmokeTests(unittest.TestCase):
    def _source_tree(self, root: Path):
        for relative in proof.REQUIRED_SOURCE_FILES:
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"// {relative}\n", encoding="utf-8")

    def _comparison_report(
        self,
        *,
        boot_id="boot-secret",
        source_digest="a" * 64,
        updater_digest="b" * 64,
        runtime_matches=True,
        fail_count=0,
        label="sample",
    ):
        return {
            "schema": proof.SCHEMA,
            "captured_at": "2026-09-20T12:00:00Z",
            "label": label,
            "boot_id": boot_id,
            "evidence_context": {
                "distribution_profile": "owner-development",
                "runtime_mode": "dynamic-native-runtime",
                "evidence_scope": "development",
                "runtime_sha256": None,
            },
            "source": {
                "files": {
                    relative: {"size": index + 1, "sha256": source_digest}
                    for index, relative in enumerate(proof.REQUIRED_SOURCE_FILES)
                }
            },
            "observed": {
                "update_status": {
                    "source_identity_sha256": updater_digest,
                    "runtime_surface_matches_source": runtime_matches,
                },
                "keyboard_layout": {
                    "configured_layout_id": "br-abnt2",
                    "applied_layout_id": "br-abnt2",
                    "restart_required": False,
                    "settled": True,
                },
            },
            "summary": {"pass": 10, "warn": 0, "fail": fail_count},
        }

    def test_collect_probes_read_only_mvp_runtime_without_leaking_names(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), SmokeHandler)
        SmokeHandler.expected_authority = f"127.0.0.1:{server.server_port}"
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / "source"
                run = root / "run"
                proc = root / "proc"
                self._source_tree(source)
                run.mkdir(parents=True)
                (run / "host.log").write_text("surface healthy\n", encoding="utf-8")
                boot = proc / "sys/kernel/random"
                boot.mkdir(parents=True)
                (boot / "boot_id").write_text("boot-123\n", encoding="ascii")
                report = proof.collect(
                    "unit",
                    host="127.0.0.1",
                    port=server.server_port,
                    timeout=1.0,
                    source_root=source,
                    run_root=run,
                    proc_root=proc,
                    expected_theme="dark",
                )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(report["summary"]["fail"], 0, report["checks"])
        self.assertEqual(report["observed"]["file_space_root"]["entry_count"], 2)
        self.assertEqual(report["observed"]["network_status"]["interface_count"], 2)
        self.assertEqual(report["evidence_context"]["evidence_scope"], "development")
        self.assertIsNone(report["evidence_context"]["runtime_sha256"])
        self.assertEqual(
            report["observed"]["preference_theme_witness"],
            {"preference_id": "appearance.theme", "expected_theme": "dark", "matched": True},
        )
        self.assertTrue(report["observed"]["keyboard_layout"]["settled"])
        self.assertEqual(report["observed"]["keyboard_layout"]["applied_layout_id"], "br-abnt2")
        self.assertEqual(report["observed"]["update_status"]["status"], "running")
        self.assertEqual(report["observed"]["update_status"]["phase"], "idle")
        self.assertEqual(report["observed"]["update_status"]["delivery_number"], 42)
        self.assertTrue(report["observed"]["update_status"]["runtime_surface_matches_source"])
        self.assertTrue(report["observed"]["update_status"]["health_token_present"])
        serialized = json.dumps(report, ensure_ascii=False)
        self.assertNotIn("Documento secreto.txt", serialized)
        self.assertNotIn("wlan0", serialized)
        self.assertNotIn("eth0", serialized)
        self.assertNotIn("SECRET-HEALTH-TOKEN", serialized)
        self.assertNotIn("SECRET-PREFERENCE", serialized)
        self.assertNotIn("private.customer-note", serialized)
        self.assertNotIn("b" * 40, serialized)

    def test_preference_reboot_requires_different_boot_and_identical_witness(self):
        before = self._comparison_report(boot_id="boot-A", label="before")
        after = self._comparison_report(boot_id="boot-B", label="after")
        witness = {"preference_id": "appearance.theme", "expected_theme": "dark", "matched": True}
        before["observed"]["preference_theme_witness"] = dict(witness)
        after["observed"]["preference_theme_witness"] = dict(witness)
        report = proof.compare_preference_reboots(before, after)
        self.assertEqual(report["schema"], proof.PREFERENCE_REBOOT_SCHEMA)
        self.assertEqual(report["summary"]["fail"], 0, report["checks"])
        self.assertGreater(proof.compare_reports(before, after)["summary"]["fail"], 0)
        self.assertNotIn("boot-A", json.dumps(report))

        same_boot = self._comparison_report(boot_id="boot-A")
        same_boot["observed"]["preference_theme_witness"] = dict(witness)
        self.assertGreater(proof.compare_preference_reboots(before, same_boot)["summary"]["fail"], 0)
        missing = self._comparison_report(boot_id="boot-B")
        self.assertGreater(proof.compare_preference_reboots(before, missing)["summary"]["fail"], 0)
        changed = self._comparison_report(boot_id="boot-B")
        changed["observed"]["preference_theme_witness"] = {
            "preference_id": "appearance.theme", "expected_theme": "light", "matched": True,
        }
        self.assertGreater(proof.compare_preference_reboots(before, changed)["summary"]["fail"], 0)
        failed = self._comparison_report(boot_id="boot-B")
        failed["observed"]["preference_theme_witness"] = {**witness, "matched": False}
        self.assertGreater(proof.compare_preference_reboots(before, failed)["summary"]["fail"], 0)
        malformed = self._comparison_report(boot_id="boot-B")
        malformed["observed"]["preference_theme_witness"] = {**witness, "matched": 1}
        self.assertGreater(proof.compare_preference_reboots(before, malformed)["summary"]["fail"], 0)

    def test_read_only_optional_theme_probe_rejects_unknown_ids_and_network_failures(self):
        with self.assertRaises(ValueError):
            proof.preference_theme_witness("regional.locale", "127.0.0.1", 8765, 0.1)
        witness, checks = proof.preference_theme_witness("dark", "127.0.0.1", 0, 0.1)
        self.assertFalse(witness["matched"])
        self.assertEqual(checks[0]["status"], "fail")

    def test_files_validator_rejects_traversal_and_never_returns_entry_names(self):
        with self.assertRaises(ValueError):
            proof.validate_files({"path": "/../etc", "entries": []})
        summary = proof.validate_files({
            "path": "/",
            "entries": [{"name": "private.txt", "kind": "file", "size": 1, "modifiedAt": 2}],
        })
        self.assertEqual(summary["entry_count"], 1)
        self.assertNotIn("private.txt", json.dumps(summary))

    def test_keyboard_layout_validator_requires_supported_settled_state_shape(self):
        self.assertEqual(
            proof.validate_keyboard_layout({
                "configuredLayoutId": "us",
                "appliedLayoutId": "us",
                "supportedLayoutIds": ["br-abnt2", "us"],
                "restartRequired": False,
            })["settled"],
            True,
        )
        with self.assertRaises(ValueError):
            proof.validate_keyboard_layout({
                "configuredLayoutId": "us",
                "appliedLayoutId": "br-abnt2",
                "supportedLayoutIds": ["br-abnt2", "us"],
                "restartRequired": False,
            })

    def test_evidence_context_requires_exact_profile_mode_scope_and_digest(self):
        self.assertEqual(
            proof.evidence_context_from_environment(),
            {
                "distribution_profile": "owner-development",
                "runtime_mode": "dynamic-native-runtime",
                "evidence_scope": "development",
                "runtime_sha256": None,
            },
        )

        with mock.patch.dict(
            "os.environ",
            {
                "ORDAX_PROOF_PROFILE": "stable-mvp",
                "ORDAX_PROOF_RUNTIME_MODE": "verified-erofs-overlay",
                "ORDAX_PROOF_EVIDENCE_SCOPE": "canonical-stable-mvp",
                "ORDAX_PROOF_RUNTIME_SHA256": "c" * 64,
            },
            clear=False,
        ):
            self.assertEqual(
                proof.evidence_context_from_environment()["runtime_sha256"],
                "c" * 64,
            )

        with mock.patch.dict(
            "os.environ",
            {
                "ORDAX_PROOF_PROFILE": "stable-mvp",
                "ORDAX_PROOF_RUNTIME_MODE": "dynamic-native-runtime",
                "ORDAX_PROOF_EVIDENCE_SCOPE": "canonical-stable-mvp",
                "ORDAX_PROOF_RUNTIME_SHA256": "c" * 64,
            },
            clear=False,
        ):
            with self.assertRaisesRegex(ValueError, "evidence context"):
                proof.evidence_context_from_environment()

        with mock.patch.dict(
            "os.environ",
            {
                "ORDAX_PROOF_PROFILE": "stable-mvp",
                "ORDAX_PROOF_RUNTIME_MODE": "verified-erofs-overlay",
                "ORDAX_PROOF_EVIDENCE_SCOPE": "canonical-stable-mvp",
                "ORDAX_PROOF_RUNTIME_SHA256": "",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(ValueError, "runtime digest"):
                proof.evidence_context_from_environment()

    def test_owner_verified_erofs_proof_is_development_scoped_and_digest_bound(self):
        context = {
            "ORDAX_PROOF_PROFILE": "owner-development",
            "ORDAX_PROOF_RUNTIME_MODE": "verified-erofs-overlay",
            "ORDAX_PROOF_EVIDENCE_SCOPE": "development",
            "ORDAX_PROOF_RUNTIME_SHA256": "b" * 64,
        }
        with mock.patch.dict("os.environ", context, clear=False):
            self.assertEqual(
                proof.evidence_context_from_environment(),
                {
                    "distribution_profile": "owner-development",
                    "runtime_mode": "verified-erofs-overlay",
                    "evidence_scope": "development",
                    "runtime_sha256": "b" * 64,
                },
            )
            self.assertIsNotNone(proof._evidence_context({"evidence_context": proof.evidence_context_from_environment()}))
        for changes in (
            {"ORDAX_PROOF_RUNTIME_SHA256": ""},
            {"ORDAX_PROOF_EVIDENCE_SCOPE": "canonical-stable-mvp"},
        ):
            with self.subTest(changes=changes), mock.patch.dict(
                "os.environ", {**context, **changes}, clear=False
            ):
                with self.assertRaises(ValueError):
                    proof.evidence_context_from_environment()
        self.assertIsNone(proof._evidence_context({"evidence_context": {
            "distribution_profile": "owner-development",
            "runtime_mode": "verified-erofs-overlay",
            "evidence_scope": "development",
            "runtime_sha256": None,
        }}))

    def test_metrics_validator_rejects_impossible_values(self):
        with self.assertRaises(ValueError):
            proof.validate_metrics({
                "uptimeSeconds": 1,
                "memoryTotalBytes": 10,
                "memoryAvailableBytes": 11,
                "userStorageTotalBytes": 20,
                "userStorageFreeBytes": 10,
            })

    def test_update_status_validator_is_bounded_and_redacts_runtime_secrets(self):
        payload = {
            "sourceSha": "c" * 40,
            "deliveryNumber": 7,
            "runtimeSurfaceSha": "c" * 40,
            "status": "running",
            "phase": "idle",
            "applyMode": "none",
            "bootRefreshRequired": False,
            "baseUpdatePhase": "none",
            "lastAppliedSha": "c" * 40,
            "lastApplyDurationSeconds": 3,
            "lastStageDurationSeconds": 2,
            "lastError": "private diagnostic detail",
            "healthToken": "very-secret-token",
        }
        summary = proof.validate_update_status(payload)
        self.assertEqual(summary["delivery_number"], 7)
        self.assertTrue(summary["runtime_surface_matches_source"])
        self.assertTrue(summary["has_last_error"])
        self.assertTrue(summary["health_token_present"])
        serialized = json.dumps(summary)
        self.assertNotIn("very-secret-token", serialized)
        self.assertNotIn("private diagnostic detail", serialized)
        self.assertNotIn("c" * 40, serialized)

        bad_phase = dict(payload, phase="teleporting")
        with self.assertRaises(ValueError):
            proof.validate_update_status(bad_phase)
        bad_delivery = dict(payload, deliveryNumber=-1)
        with self.assertRaises(ValueError):
            proof.validate_update_status(bad_delivery)
        bad_duration = dict(payload, lastApplyDurationSeconds=3601)
        with self.assertRaises(ValueError):
            proof.validate_update_status(bad_duration)

    def test_compare_accepts_only_same_clean_boot_source_and_updater_identity(self):
        baseline = self._comparison_report(label="baseline")
        after = self._comparison_report(label="after")
        comparison = proof.compare_reports(baseline, after, "comparison")
        self.assertEqual(comparison["schema"], proof.COMPARE_SCHEMA)
        self.assertEqual(comparison["summary"]["fail"], 0, comparison["checks"])
        serialized = json.dumps(comparison)
        self.assertNotIn("boot-secret", serialized)
        self.assertNotIn("a" * 64, serialized)
        self.assertNotIn("b" * 64, serialized)

        different_boot = self._comparison_report(boot_id="other-boot", label="after")
        self.assertGreater(proof.compare_reports(baseline, different_boot)["summary"]["fail"], 0)

        different_context = self._comparison_report(label="after")
        different_context["evidence_context"] = {
            "distribution_profile": "stable-mvp",
            "runtime_mode": "verified-erofs-overlay",
            "evidence_scope": "canonical-stable-mvp",
            "runtime_sha256": "e" * 64,
        }
        self.assertGreater(
            proof.compare_reports(baseline, different_context)["summary"]["fail"],
            0,
        )

        different_source = self._comparison_report(label="after")
        source_path = proof.REQUIRED_SOURCE_FILES[0]
        different_source["source"]["files"][source_path]["sha256"] = "c" * 64
        self.assertGreater(proof.compare_reports(baseline, different_source)["summary"]["fail"], 0)

        different_updater = self._comparison_report(updater_digest="d" * 64, label="after")
        self.assertGreater(proof.compare_reports(baseline, different_updater)["summary"]["fail"], 0)

        stale_surface = self._comparison_report(runtime_matches=False, label="after")
        self.assertGreater(proof.compare_reports(baseline, stale_surface)["summary"]["fail"], 0)

        changed_keyboard = self._comparison_report(label="after")
        changed_keyboard["observed"]["keyboard_layout"] = {
            "configured_layout_id": "us",
            "applied_layout_id": "us",
            "restart_required": False,
            "settled": True,
        }
        self.assertGreater(
            proof.compare_reports(baseline, changed_keyboard)["summary"]["fail"],
            0,
        )

        failed_after = self._comparison_report(fail_count=1, label="after")
        self.assertGreater(proof.compare_reports(baseline, failed_after)["summary"]["fail"], 0)

    def test_tour_checklist_and_finalizer_fail_closed(self):
        baseline = self._comparison_report(label="baseline")
        after = self._comparison_report(label="after")
        comparison = proof.compare_reports(baseline, after, "comparison")
        checklist = {
            "schema": proof.TOUR_SCHEMA,
            "label": "tour",
            "items": [{"id": item_id, "status": "pass"} for item_id in proof.TOUR_ITEMS],
        }

        final = proof.finalize_evidence(baseline, after, comparison, checklist, "final")
        self.assertEqual(final["schema"], proof.FINAL_SCHEMA)
        self.assertEqual(final["summary"]["fail"], 0, final["checks"])
        self.assertFalse(final["physical_write"])
        self.assertFalse(final["reboot_required"])
        serialized = json.dumps(final)
        self.assertNotIn("boot-secret", serialized)
        self.assertNotIn("a" * 64, serialized)
        self.assertNotIn("b" * 64, serialized)

        edited = json.loads(json.dumps(comparison))
        edited["checks"][0]["detail"] = "manually edited"
        self.assertGreater(
            proof.finalize_evidence(baseline, after, edited, checklist)["summary"]["fail"],
            0,
        )

        failed_tour = json.loads(json.dumps(checklist))
        failed_tour["items"][0]["status"] = "fail"
        self.assertGreater(
            proof.finalize_evidence(baseline, after, comparison, failed_tour)["summary"]["fail"],
            0,
        )

    def test_tour_template_is_non_pass_and_loader_rejects_unreviewed_or_extra_fields(self):
        template = proof.tour_template("tour")
        self.assertEqual(template["schema"], proof.TOUR_SCHEMA)
        self.assertEqual(
            [item["id"] for item in template["items"]],
            list(proof.TOUR_ITEMS),
        )
        self.assertTrue(all(item["status"] == "pending" for item in template["items"]))
        self.assertIn("account-memory", [item["id"] for item in template["items"]])
        self.assertEqual(len(template["items"]), 12)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pending = root / "pending.json"
            pending.write_text(json.dumps(template), encoding="utf-8")
            with self.assertRaises(ValueError):
                proof.load_tour_checklist(pending)

            valid = {
                **template,
                "items": [{"id": item["id"], "status": "pass"} for item in template["items"]],
            }
            valid_path = root / "valid.json"
            valid_path.write_text(json.dumps(valid), encoding="utf-8")
            loaded = proof.load_tour_checklist(valid_path)
            self.assertEqual(len(loaded["items"]), len(proof.TOUR_ITEMS))

            extra = json.loads(json.dumps(valid))
            extra["items"][0]["notes"] = "private free text"
            extra_path = root / "extra.json"
            extra_path.write_text(json.dumps(extra), encoding="utf-8")
            with self.assertRaises(ValueError):
                proof.load_tour_checklist(extra_path)

    def test_load_report_is_bounded_and_requires_current_schema(self):
        report = self._comparison_report()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            valid = root / "valid.json"
            valid.write_text(json.dumps(report), encoding="utf-8")
            self.assertEqual(proof.load_report(valid)["schema"], proof.SCHEMA)

            wrong = root / "wrong.json"
            wrong.write_text(json.dumps({**report, "schema": "wrong/1"}), encoding="utf-8")
            with self.assertRaises(ValueError):
                proof.load_report(wrong)

            oversized = root / "oversized.json"
            oversized.write_bytes(b"{" + b" " * proof.MAX_REPORT + b"}")
            with self.assertRaises(ValueError):
                proof.load_report(oversized)

    def test_source_snapshot_hashes_required_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._source_tree(root)
            snapshot, checks = proof.source_snapshot(root)
        self.assertEqual(len(snapshot["files"]), len(proof.REQUIRED_SOURCE_FILES))
        self.assertIn("apps/account/app.mjs", snapshot["files"])
        self.assertIn("surface/ui/account-overview-controls.mjs", snapshot["files"])
        self.assertIn("surface/ui/memory-review-controls.mjs", snapshot["files"])
        self.assertTrue(all(item["status"] == "pass" for item in checks))
        self.assertTrue(all(len(item["sha256"]) == 64 for item in snapshot["files"].values()))

    def test_wrapper_uses_verified_stable_or_development_runtime_without_install(self):
        text = WRAPPER.read_text(encoding="utf-8")
        resolver = RUNTIME_RESOLVER.read_text(encoding="utf-8")
        self.assertIn("ordax-proof-runtime.sh", text)
        self.assertIn("resolve_ordax_proof_runtime_root", text)
        self.assertIn("/srv/ordax-system/diagnostics/mvp_surface_smoke.py", text)
        self.assertIn('busybox chroot "$RUNTIME_ROOT"', text)
        self.assertIn("/run/ordax-surface/runtime-proof-context", resolver)
        self.assertIn("/run/ordax/runtime/native-surface/rootfs", resolver)
        self.assertIn("alpine-v3.22-cage-webkitgtk-v1", resolver)
        self.assertIn("verified-erofs-overlay", resolver)
        self.assertIn("canonical-stable-mvp", resolver)
        self.assertIn("dynamic-native-runtime", resolver)
        self.assertIn("development", resolver)
        self.assertNotIn('if [ -x "$stable_root/usr/bin/python3" ]', resolver)
        self.assertNotIn("apk add", text + resolver)
        self.assertNotIn("curl ", text + resolver)
        self.assertEqual(stat.S_IMODE(WRAPPER.stat().st_mode), 0o755)

    def test_collector_has_no_mutating_http_methods(self):
        text = PROOF.read_text(encoding="utf-8")
        self.assertIn('putrequest("GET"', text)
        self.assertIn('"/__ordax/native/update"', text)
        for method in ('putrequest("POST"', 'putrequest("PUT"', 'putrequest("PATCH"', 'putrequest("DELETE"'):
            self.assertNotIn(method, text)


if __name__ == "__main__":
    unittest.main()
