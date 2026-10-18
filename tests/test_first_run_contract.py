from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
CONTRACT = ROOT / "docs" / "contracts" / "first-run.json"
BRANDING = ROOT / "docs" / "contracts" / "branding.json"
ADAPTER = ROOT / "system" / "adapters" / "native" / "first-run-state.mjs"
UI = ROOT / "system" / "surface" / "ui" / "first-run.mjs"
CAPABILITIES = ROOT / "system" / "services" / "first-run" / "capabilities.mjs"
CSS = ROOT / "system" / "surface" / "ui" / "first-run.css"
SETTINGS = ROOT / "system" / "surface" / "ui" / "settings-overview-controls.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
NATIVE_HTML = ROOT / "system" / "composition" / "native" / "index.html"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.tsx"
WEB_HTML = ROOT / "system" / "composition" / "web" / "index.html"


def load_host_server():
    spec = spec_from_file_location("ordax_native_host_first_run_test", HOST_SERVER)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FirstRunContractTests(unittest.TestCase):
    def test_contract_keeps_usb_local_first_and_account_optional(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["$schema"], "prototype-ordax.first-run/1")
        self.assertEqual(contract["owners"]["journey"], "system/services/first-run/journey.mjs")
        self.assertTrue(contract["flow"])
        self.assertEqual(len(contract["flow"]), len(set(contract["flow"])))
        self.assertEqual(contract["regional"]["complete_locales"], ["pt-BR", "en-US", "es-ES", "de-DE", "fr-FR"])
        self.assertEqual(contract["regional"]["public_mvp_locales"], ["pt-BR", "en-US"])
        self.assertEqual(contract["regional"]["retained_compatible_locales"], ["es-ES", "de-DE", "fr-FR"])
        self.assertTrue(contract["regional"]["public_selector_must_only_offer_surface_ready_locales"])
        self.assertEqual(contract["regional"]["completeness_scope"], "first-run-oobe-only")
        self.assertEqual(
            contract["regional"]["launch_locale_policy"],
            "mvp-public-pt-br-en-us-retain-hidden-oobe-translations",
        )
        self.assertEqual(contract["regional"]["surface_complete_locales"], ["pt-BR", "en-US"])
        self.assertEqual(
            contract["regional"]["surface_translation_status"]["en-US"],
            "complete",
        )
        for locale in ("es-ES", "de-DE", "fr-FR"):
            self.assertEqual(
                contract["regional"]["surface_translation_status"][locale],
                "migration-in-progress",
            )
        self.assertTrue(contract["network"]["skippable"])
        self.assertTrue(contract["network"]["password_is_transient_only"])
        self.assertTrue(contract["security"]["local_session_optional"])
        self.assertTrue(contract["security"]["secret_is_transient_in_surface"])
        self.assertTrue(contract["security"]["secret_must_not_enter_first_run_state"])
        self.assertTrue(contract["security"]["bad_or_unreadable_credential_fails_closed"])
        self.assertTrue(contract["security"]["account_identity_independent"])
        self.assertEqual(
            contract["security"]["protection_scope"],
            "surface-session-not-storage-encryption",
        )
        self.assertTrue(contract["account"]["optional"])
        self.assertTrue(contract["account"]["local_only_always_available"])
        self.assertFalse(contract["account"]["cloud_sync_required_for_mvp"])
        self.assertTrue(contract["mvp"]["runs_from_usb"])
        self.assertFalse(contract["mvp"]["permanent_internal_disk_install_exposed"])
        self.assertFalse(contract["mvp"]["web_mode_uses_this_device_oobe"])
        self.assertTrue(contract["regional"]["editable_after_first_run_in_settings"])
        self.assertEqual(
            contract["regional"]["keyboard_layout_contract"],
            "docs/contracts/keyboard-layout.json",
        )
        self.assertFalse(contract["regional"]["keyboard_layout_selector_exposed"])

    def test_regional_choices_remain_editable_after_first_run(self):
        settings = SETTINGS.read_text(encoding="utf-8")
        self.assertIn('Object.freeze({ id: "regional", messageId: "settings.section.regional" })', settings)
        self.assertIn('t(`settings.section.${activeSection}`)', settings)
        self.assertIn('"regional.locale": Object.freeze({', settings)
        self.assertIn('"regional.time-zone": Object.freeze({', settings)
        self.assertIn('"settings.preference.locale.title"', settings)
        self.assertIn('"settings.preference.timeZone.title"', settings)
        self.assertIn('["appearance", "accessibility", "regional"].includes(activeSection)', settings)

    def test_native_host_first_run_state_is_atomic_private_and_bounded(self):
        host = load_host_server()
        initial = host.initial_first_run_state()
        self.assertTrue(host.valid_first_run_state(initial))
        self.assertFalse(
            host.valid_first_run_state({**initial, "completed": True, "accountMode": None})
        )
        self.assertFalse(
            host.valid_first_run_state({**initial, "timeZone": "Europe/London"})
        )
        self.assertTrue(host.valid_first_run_state({**initial, "locale": "en-US"}))
        self.assertTrue(host.valid_first_run_state({**initial, "locale": "es-ES"}))
        self.assertTrue(host.valid_first_run_state({**initial, "locale": "de-DE"}))
        self.assertTrue(host.valid_first_run_state({**initial, "locale": "fr-FR"}))
        self.assertFalse(host.valid_first_run_state({**initial, "locale": "it-IT"}))

        with tempfile.TemporaryDirectory() as directory:
            host.FIRST_RUN_FILE = str(Path(directory) / "first-run.json")
            self.assertEqual(host.read_first_run_state(), initial)
            complete = {
                **initial,
                "completed": True,
                "accountMode": "local-only",
            }
            host.write_first_run_state(complete)
            self.assertEqual(host.read_first_run_state(), complete)
            self.assertFalse(list(Path(directory).glob("*.tmp.*")))
            if hasattr(stat, "S_IMODE"):
                self.assertEqual(
                    stat.S_IMODE(Path(host.FIRST_RUN_FILE).stat().st_mode),
                    0o600,
                )

    def test_first_run_completion_is_monotonic_and_exact_retry_is_idempotent(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            host.FIRST_RUN_FILE = str(Path(directory) / "first-run.json")
            initial = host.initial_first_run_state()
            completed = {**initial, "completed": True, "accountMode": "local-only"}
            host.write_first_run_state(completed)
            host.write_first_run_state(completed)
            self.assertEqual(host.read_first_run_state(), completed)
            for rejected in (
                initial,
                {**completed, "locale": "en-US"},
                {**completed, "accountMode": "identity"},
            ):
                with self.assertRaisesRegex(ValueError, "cannot be overwritten"):
                    host.write_first_run_state(rejected)
                self.assertEqual(host.read_first_run_state(), completed)
            self.assertFalse(list(Path(directory).glob("*.tmp.*")))

    def test_corrupted_or_linked_existing_receipt_cannot_be_reset_by_post(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "first-run.json"
            host.FIRST_RUN_FILE = str(receipt)
            completed = {**host.initial_first_run_state(), "completed": True, "accountMode": "local-only"}
            for corrupted in ("{broken", '{"schema":"invalid"}'):
                receipt.write_text(corrupted, encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "unreadable|invalid"):
                    host.write_first_run_state(completed)
                self.assertEqual(receipt.read_text(encoding="utf-8"), corrupted)
            receipt.unlink()
            external = Path(directory) / "external.json"
            external.write_text("keep-original", encoding="utf-8")
            receipt.symlink_to(external)
            with self.assertRaisesRegex(ValueError, "cannot be a symlink"):
                host.write_first_run_state(completed)
            self.assertEqual(external.read_text(encoding="utf-8"), "keep-original")
            self.assertTrue(receipt.is_symlink())

    def test_parallel_conflicting_completion_requests_cannot_overwrite_each_other(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            host.FIRST_RUN_FILE = str(Path(directory) / "first-run.json")
            initial = host.initial_first_run_state()
            choices = [
                {**initial, "completed": True, "accountMode": "local-only"},
                {**initial, "completed": True, "accountMode": "identity"},
            ]
            def attempt(value):
                try:
                    host.write_first_run_state(value)
                    return "written"
                except ValueError:
                    return "blocked"
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(attempt, choices))
            self.assertEqual(sorted(results), ["blocked", "written"])
            self.assertIn(host.read_first_run_state(), choices)
            self.assertFalse(list(Path(directory).glob("*.tmp.*")))

    def test_directory_fsync_failure_does_not_report_completion_success(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            host.FIRST_RUN_FILE = str(Path(directory) / "first-run.json")
            completed = {**host.initial_first_run_state(), "completed": True, "accountMode": "local-only"}
            real_fsync = host.os.fsync
            count = 0
            def fail_directory_only(fd):
                nonlocal count
                count += 1
                if count == 2:
                    raise OSError("directory fsync failed")
                return real_fsync(fd)
            with patch.object(host.os, "fsync", side_effect=fail_directory_only):
                with self.assertRaisesRegex(OSError, "directory fsync failed"):
                    host.write_first_run_state(completed)
            self.assertEqual(count, 2)
            self.assertEqual(host.read_first_run_state(), completed)
            self.assertFalse(list(Path(directory).glob("*.tmp.*")))

    def test_native_first_run_completion_survives_fresh_native_process(self):
        # Real native host implementation and real on-disk receipt; no mocked
        # transport. The writer exits without Python shutdown hooks so a fresh
        # interpreter must recover the fsynced state from durable bytes.
        program = """
import importlib.util
import os
import pathlib
import sys
spec = importlib.util.spec_from_file_location('ordax_native_restart_proof', sys.argv[1])
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
host.FIRST_RUN_FILE = sys.argv[2]
mode = sys.argv[3]
if mode == 'write':
    saved = {
        **host.initial_first_run_state(),
        'completed': True,
        'accountMode': 'local-only',
    }
    host.write_first_run_state(saved)
    os._exit(0)
if mode == 'read':
    saved = host.read_first_run_state()
    if not host.valid_first_run_state(saved) or not saved.get('completed') or saved.get('accountMode') != 'local-only':
        raise SystemExit('Native First Run completion was not recovered')
    try:
        host.write_first_run_state(host.initial_first_run_state())
    except ValueError:
        pass
    else:
        raise SystemExit('Native First Run reset was not blocked after restart')
    if host.read_first_run_state() != saved:
        raise SystemExit('Native First Run changed during rejected rollback')
    print('NATIVE_FIRST_RUN_RESTART_OK')
    raise SystemExit(0)
raise SystemExit('Unknown subprocess proof mode')
"""
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "first-run.json"
            for mode in ("write", "read"):
                child = subprocess.run(
                    [sys.executable, "-c", program, str(HOST_SERVER), str(receipt), mode],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                if mode == "read":
                    self.assertEqual(child.stdout.strip(), "NATIVE_FIRST_RUN_RESTART_OK")
            recovered = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertTrue(recovered["completed"])
            self.assertEqual(recovered["accountMode"], "local-only")
            self.assertFalse("subjectId" in recovered)
            self.assertFalse(list(Path(directory).glob("*.tmp.*")))
            self.assertEqual(stat.S_IMODE(receipt.stat().st_mode), 0o600)

    def test_native_adapter_and_host_use_separate_first_run_endpoint(self):
        adapter = ADAPTER.read_text(encoding="utf-8")
        host = HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn('FIRST_RUN_ENDPOINT = "/__ordax/native/first-run"', adapter)
        self.assertIn("validateFirstRunState", adapter)
        self.assertIn("assertFirstRunStateStore", adapter)
        self.assertIn('method: "GET"', adapter)
        self.assertIn('method: "POST"', adapter)
        self.assertNotIn("localStorage", adapter)
        self.assertNotIn("sessionStorage", adapter)
        self.assertIn('FIRST_RUN_FILE = "/var/lib/ordax/first-run.json"', host)
        self.assertIn("MAX_FIRST_RUN_BODY = 2048", host)
        self.assertIn("write_first_run_state", host)

    def test_oobe_is_native_only_and_capability_driven(self):
        ui = UI.read_text(encoding="utf-8")
        native_main = NATIVE_MAIN.read_text(encoding="utf-8")
        native_html = NATIVE_HTML.read_text(encoding="utf-8")
        web_main = WEB_MAIN.read_text(encoding="utf-8")
        web_html = WEB_HTML.read_text(encoding="utf-8")

        self.assertIn("mountFirstRunExperience", native_main)
        self.assertIn("createNativeFirstRunStateStore", native_main)
        self.assertIn('reportClientDiagnostic("first-run", error)', native_main)
        self.assertIn('href="../../surface/ui/first-run.css"', native_html)
        self.assertNotIn("mountFirstRunExperience", web_main)
        self.assertNotIn("first-run.css", web_html)

        self.assertIn("Continuar sem conta", ui)
        self.assertIn("translateFirstRunText", ui)
        self.assertIn("syncFirstRunDocumentLocale(documentObject, draft.locale)", ui)
        self.assertIn("documentObject.documentElement.lang = profile.locale", ui)
        self.assertIn("documentObject.documentElement.dir = profile.direction", ui)
        capabilities = CAPABILITIES.read_text(encoding="utf-8")
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["owners"]["capabilities"], "system/services/first-run/capabilities.mjs")
        self.assertIn("deriveFirstRunCapabilities", ui)
        self.assertIn("capabilitySnapshot.identitySignIn", ui)
        self.assertIn("capabilitySnapshot.identityRegister", ui)
        self.assertIn('isIdentityActionSupported(actions, "sign-in")', capabilities)
        self.assertIn('isIdentityActionSupported(actions, "register")', capabilities)
        self.assertIn("passwordDraft", ui)
        self.assertIn("await store.save(completeFirstRunState(draft))", ui)
        self.assertNotIn("localStorage", ui)
        self.assertNotIn("sessionStorage", ui)

    def test_first_run_essentials_reuses_native_store_and_never_installs_by_presentation(self):
        native = NATIVE_MAIN.read_text(encoding="utf-8")
        first_run = UI.read_text(encoding="utf-8")
        composition = (ROOT / "system" / "composition" / "native" / "store-catalog.mjs").read_text(encoding="utf-8")
        projection = (ROOT / "system" / "services" / "apps" / "verified-store-projection.mjs").read_text(encoding="utf-8")
        translated = (ROOT / "system" / "services" / "i18n" / "first-run.mjs").read_text(encoding="utf-8")
        self.assertIn("planFirstRunAppSelectionFromStore", native)
        self.assertIn("initialProvisioning: !firstRunStateStore.load().completed", native)
        self.assertIn("storeCatalogComposition?.getCurrentObservations()", native)
        self.assertIn("getCurrentObservations()", composition)
        self.assertIn("currentObservations = Object.freeze([])", projection)
        self.assertIn('firstRunAppSelection.installedByThisPlan !== false', first_run)
        self.assertIn("Esta lista é informativa e não instala aplicativos.", first_run)
        self.assertNotIn("installApp(", first_run)
        for text in (
            "Aplicativos essenciais",
            "Aplicativos independentes verificados:",
            "Candidatos verificados para futura distribuição:",
            "Removidos ou fora desta configuração:",
            "Distribuição ainda não verificada:",
        ):
            self.assertEqual(translated.count(json.dumps(text, ensure_ascii=False) + ":"), 4)

    def test_branding_records_first_run_without_claiming_early_graphics(self):
        branding = json.loads(BRANDING.read_text(encoding="utf-8"))
        self.assertTrue(branding["first_run"]["implemented"])
        self.assertTrue(branding["first_run"]["native_usb_only"])
        self.assertTrue(branding["first_run"]["account_optional"])
        self.assertFalse(branding["early_boot"]["graphical_splash_implemented"])
        self.assertTrue(branding["failure_policy"]["first_run_persistence_failure_stays_visible"])

    def test_first_run_styles_cover_focus_mobile_and_reduced_motion(self):
        css = CSS.read_text(encoding="utf-8")
        self.assertIn(".ordax-first-run", css)
        self.assertIn(":focus-visible", css)
        self.assertIn("@media (max-width: 820px)", css)
        self.assertIn("prefers-reduced-motion", css)


if __name__ == "__main__":
    unittest.main()
