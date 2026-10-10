import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CURRENT_STATE = ROOT / "docs" / "CURRENT-STATE.md"
AGENTS = ROOT / "AGENTS.md"
UPDATE_DOC = ROOT / "docs" / "UPDATE-NOMENCLATURE.md"
INTERNET_DOC = ROOT / "docs" / "INTERNET-APP.md"
PROMOTION_GATES = ROOT / "docs" / "PROMOTION-GATES.md"
UPDATE_CONTRACT = ROOT / "docs" / "contracts" / "update-nomenclature.json"
PRODUCT_VERSION = ROOT / "system" / "contracts" / "product-version.mjs"
BUNDLED_APP_MANIFESTS = ROOT / "system" / "services" / "components" / "manifests" / "apps.mjs"
PHYSICAL_SEED = ROOT / "docs" / "contracts" / "physical-media.json"
PHYSICAL_PREPARED = ROOT / "docs" / "contracts" / "physical-prepared-media.json"
MINIMAL_USB_BOOTSTRAP = ROOT / "docs" / "MINIMAL-USB-BOOTSTRAP.md"
PORTABLE_BOOTSTRAP = ROOT / "docs" / "contracts" / "portable-bootstrap-v2.json"
PORTABLE_MAIN_EVIDENCE = ROOT / "docs" / "evidence" / "portable-runtime-v3-main-proof.json"
PORTABLE_ONE_SHOT_EVIDENCE = ROOT / "docs" / "evidence" / "portable-v3-one-shot-qemu-proof.json"
PHYSICAL_WRITE_AUTHORIZATION = ROOT / "docs" / "contracts" / "physical-write-authorization.json"
HISTORICAL_V4_RELEASE_PROOF = ROOT / "docs" / "evidence" / "canonical-v4-release-proof.json"


def assignment_map(text):
    values = {}
    for line in text.splitlines():
        if "=" not in line or line.startswith(("#", " ", "\t")):
            continue
        key, value = line.split("=", 1)
        if re.fullmatch(r"[A-Z0-9_]+", key):
            values[key] = value.strip()
    return values


def field(text, name):
    match = re.search(rf'{re.escape(name)}:\s*"([^"]+)"', text)
    if not match:
        raise AssertionError(f"missing {name} in source")
    return match.group(1)


def bundled_apps():
    text = BUNDLED_APP_MANIFESTS.read_text(encoding="utf-8")
    result = {}
    for match in re.finditer(r"defineComponentManifest\(\{(?P<body>.*?)\n\}\);", text, re.S):
        body = match.group("body")
        app_id = field(body, "id")
        result[app_id] = {
            "version": field(body, "version"),
            "release_mode": field(body, "releaseMode"),
        }
    return result


def app_owned_manifest(app_id):
    component_text = (ROOT / "system" / "apps" / app_id / "component.mjs").read_text(encoding="utf-8")
    literal_version = re.search(r'version:\s*"([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)"', component_text)
    if literal_version:
        version = literal_version.group(1)
    else:
        version_text = (ROOT / "system" / "apps" / app_id / "version.mjs").read_text(encoding="utf-8")
        version_match = re.search(r'=\s*"([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)"', version_text)
        if not version_match:
            raise AssertionError(f"missing version for {app_id}")
        version = version_match.group(1)
    return {
        "version": version,
        "release_mode": field(component_text, "releaseMode"),
    }


def expected_apps():
    result = bundled_apps()
    result["files"] = app_owned_manifest("files")
    result["internet"] = app_owned_manifest("internet")
    result["projects"] = app_owned_manifest("projects")
    return result


class CanonicalDocumentFreshnessTests(unittest.TestCase):
    def test_first_party_app_registry_snapshot_matches_runtime_catalog(self):
        state = assignment_map(CURRENT_STATE.read_text(encoding="utf-8"))
        runtime = subprocess.run(
            [
                "node", "--input-type=module", "-e",
                'import {listFirstPartyApps} from "./system/apps/catalog.mjs"; '
                'process.stdout.write(JSON.stringify(listFirstPartyApps().map(app => app.id)));',
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        app_ids = json.loads(runtime.stdout)
        self.assertEqual(
            state["FIRST_PARTY_APP_REGISTRY"],
            ",".join(app_id.upper() for app_id in app_ids),
        )

    def test_product_version_snapshot_matches_runtime_and_contract(self):
        state = assignment_map(CURRENT_STATE.read_text(encoding="utf-8"))
        product = PRODUCT_VERSION.read_text(encoding="utf-8")
        contract = json.loads(UPDATE_CONTRACT.read_text(encoding="utf-8"))
        semantic = field(product, "semanticVersion")
        display = field(product, "displayVersion")

        self.assertEqual(state["PRODUCT_VERSION"], semantic)
        self.assertEqual(state["PRODUCT_VERSION_LABEL"], display)
        self.assertEqual(contract["product_version"]["current"], semantic)
        self.assertEqual(contract["product_version"]["display"], display)

    def test_first_party_app_snapshot_matches_real_manifests(self):
        state = assignment_map(CURRENT_STATE.read_text(encoding="utf-8"))
        apps = expected_apps()
        self.assertEqual(set(apps), {"files", "settings", "account", "store", "system", "internet", "projects"})

        for app_id, app in apps.items():
            prefix = f"APP_{app_id.upper()}"
            self.assertEqual(state[f"{prefix}_VERSION"], app["version"])
            self.assertEqual(state[f"{prefix}_RELEASE_MODE"], app["release_mode"])
            expected_maturity = "BETA" if int(app["version"].split(".", 1)[0]) == 0 else "STABLE"
            self.assertEqual(state[f"{prefix}_MATURITY"], expected_maturity)

    def test_internet_app_doc_tracks_app_owned_version_and_release_mode(self):
        internet = app_owned_manifest("internet")
        document = INTERNET_DOC.read_text(encoding="utf-8")
        self.assertIn(internet["version"], document)
        self.assertIn(f'releaseMode: "{internet["release_mode"]}"', document)
        self.assertNotIn("Internet remains `bundled`", document)

    def test_physical_snapshot_distinguishes_seed_from_prepared_usb(self):
        state = assignment_map(CURRENT_STATE.read_text(encoding="utf-8"))
        seed = json.loads(PHYSICAL_SEED.read_text(encoding="utf-8"))
        prepared = json.loads(PHYSICAL_PREPARED.read_text(encoding="utf-8"))
        seed_names = ",".join(partition["name"] for partition in seed["partitions"])
        prepared_names = ",".join(partition["name"] for partition in prepared["partitions"])

        self.assertEqual(state["BOOTSTRAP_SEED_PARTITIONS"], str(len(seed["partitions"])))
        self.assertEqual(state["BOOTSTRAP_SEED_PARTITION_NAMES"], seed_names)
        self.assertEqual(state["PREPARED_USB_PARTITIONS"], str(len(prepared["partitions"])))
        self.assertEqual(state["PREPARED_USB_PARTITION_NAMES"], prepared_names)

    def test_minimal_usb_bootstrap_tracks_portable_pid1_source_state(self):
        document = MINIMAL_USB_BOOTSTRAP.read_text(encoding="utf-8")
        contract = json.loads(PORTABLE_BOOTSTRAP.read_text(encoding="utf-8"))
        pid1 = contract["initramfs_helpers"]["portable_candidate_pid1"]

        self.assertTrue(contract["migration"]["portable_v2_pid1_integration_implemented"])
        self.assertFalse(pid1["default_init"])
        self.assertFalse(pid1["physical_boot_entry_implemented"])
        self.assertFalse(pid1["physical_boot_proven"] if "physical_boot_proven" in pid1 else contract["physical_boot_proven"])

        self.assertIn("MVP_TARGET_BOOT_HANDOFF_IMPLEMENTED=YES_CANDIDATE", document)
        self.assertIn("MVP_TARGET_PHYSICAL_BOOT_PROVEN=NO", document)
        self.assertIn("MVP_TARGET_PUBLIC_PHYSICAL_APPLY=NO", document)
        self.assertIn("armed candidate (one attempt only)", document)
        self.assertIn("separate exact signed offline verification", document)
        self.assertIn("activate-exact", document)
        self.assertNotIn("candidate is never boot authority", document)
        pid1_source = (ROOT / "bootstrap/initramfs/portable_init.sh").read_text(encoding="utf-8")
        self.assertIn('if [ "$slot" = "candidate" ]; then', pid1_source)
        self.assertIn('"$STATE_MOUNT" "$PORTABLE_ROOT" known-good', pid1_source)

        for stale in (
            "That still does **not** mean the v2 boot handoff is implemented.",
            "QEMU end-to-end proof is still pending",
            "This is deliberately **not yet a UEFI proof**",
            "its hash is not yet pinned inside the fixed initramfs",
            "PID1 does not mount or execute it",
        ):
            self.assertNotIn(stale, document)

    def test_current_stable_docs_make_v4_canonical_and_v3_compatibility(self):
        current = CURRENT_STATE.read_text(encoding="utf-8")
        bootstrap = MINIMAL_USB_BOOTSTRAP.read_text(encoding="utf-8")

        self.assertIn(
            "current Stable/MVP candidate uses signed `release-manifest/4`",
            current,
        )
        self.assertIn("release-manifest/3` remains a verified compatibility baseline", current)
        self.assertIn("PORTABLE_RELEASE_MANIFEST_V4_SIGN_VERIFY=PASS_CI_CURRENT_MVP", current)
        self.assertIn("PORTABLE_RELEASE_OFFLINE_EXACT_VERIFY=PASS_CI_V2_V3_V4", current)
        self.assertNotIn(
            "current Stable/MVP candidate uses signed `release-manifest/3`",
            current,
        )

        self.assertIn("current Stable/MVP release shape is release-manifest v4", bootstrap)
        self.assertIn("v4 disposable boot plus fallback are now PASS_CI", bootstrap)
        self.assertNotIn("A signed/materialized v4 disposable boot proof is still pending.", bootstrap)

    def test_version_identity_is_not_confused_with_independent_delivery(self):
        contract = json.loads(UPDATE_CONTRACT.read_text(encoding="utf-8"))
        component = contract["component_version"]
        self.assertTrue(component["identity_independent_from_release_mode"])
        self.assertFalse(component["version_identity_requires_independent_packaging"])
        self.assertEqual(component["development_app_release_mode"], "git-app")
        self.assertEqual(component["independent_update_release_mode"], "component-slot")
        self.assertEqual(component["first_party_pre_1_0_maturity"], "beta")
        self.assertEqual(component["independent_components_currently_enabled_scope"], "production-component-slot-only")

    def test_promotion_gates_separate_development_proof_from_canonical_stable(self):
        state = assignment_map(CURRENT_STATE.read_text(encoding="utf-8"))
        promotion = assignment_map(PROMOTION_GATES.read_text(encoding="utf-8"))

        self.assertEqual(state["WEB_CLIENT_CANDIDATE"], "PASS")
        self.assertEqual(promotion["WEB_MODE"], "PASS_SOURCE_BROWSER_CANDIDATE")

        self.assertEqual(state["NATIVE_GRAPHICAL_HOST"], "PASS_PHYSICAL_DEVELOPMENT_USB")
        self.assertEqual(
            state["CANONICAL_TRUST_TOOLKIT_REQUIRES_PORTABLE_ONE_SHOT_PROOF"],
            "YES",
        )
        self.assertEqual(
            state["CANONICAL_TRUST_TOOLKIT_PROVENANCE_ELIGIBLE"],
            "YES",
        )
        self.assertEqual(
            state["CANONICAL_TRUST_TOOLKIT_LOCAL_PREFLIGHT_EXECUTED"],
            "YES",
        )
        self.assertEqual(state["CANONICAL_KEY_MATERIAL_GENERATED"], "YES")
        self.assertEqual(state["CANONICAL_TRUST_RECOVERY_VERIFIED"], "YES")
        self.assertEqual(state["PUBLIC_ANCHOR_PINNED"], "YES")
        self.assertEqual(state["LOCAL_ENCRYPTED_BACKUP_COPY_VERIFIED"], "YES")
        self.assertEqual(state["EXTERNAL_OFFLINE_BACKUP_CUSTODY_CONFIRMED"], "NO")
        self.assertEqual(state["EXTERNAL_OFFLINE_BACKUP_REQUIRED_BEFORE_BROAD_DISTRIBUTION"], "YES")
        self.assertEqual(state["MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED"], "YES")
        authorization = json.loads(PHYSICAL_WRITE_AUTHORIZATION.read_text(encoding="utf-8"))
        self.assertEqual(
            authorization["status"],
            "blocked-canonical-v4-release-proof-pending",
        )
        self.assertFalse(
            authorization["requirements"]["canonical_v4_release_proof_bound"]
        )
        self.assertEqual(
            state["PHYSICAL_AUTHORIZATION_ELIGIBLE"],
            "NO_REPLACEMENT_CANONICAL_V4_PROOF_REQUIRED",
        )
        self.assertEqual(promotion["NATIVE_GRAPHICAL_MODE"], "PASS_PHYSICAL_DEVELOPMENT_USB")
        self.assertEqual(promotion["CANONICAL_STABLE_GRAPHICAL_MODE"], "PENDING")

        self.assertEqual(state["GIT_HOT_UPDATE_ROUND_TRIP"], "PASS")
        self.assertEqual(promotion["DEVELOPMENT_DEVICE_GIT_HOT_UPDATE"], "PASS_PHYSICAL_DEVELOPMENT_USB")
        self.assertEqual(
            promotion["STABLE_DEVICE_RELEASE_OR_DELTA_UPDATE"],
            "PASS_SOURCE_PORTABLE_V4_LIFECYCLE_WITH_V3_FALLBACK_BASELINE_PENDING_COLD_HEALTH_AND_PHYSICAL",
        )
        self.assertEqual(
            promotion["STABLE_HEALTH_READINESS"],
            "PASS_SOURCE_PORTABLE_COLD_HEALTH_MAIN_PENDING_PHYSICAL",
        )
        self.assertEqual(
            state["PORTABLE_V3_UPDATE_ACTIVATION_SOURCE"],
            "CONNECTED_ONE_SHOT_REBOOT_COLD_HEALTH",
        )
        self.assertEqual(
            state["PORTABLE_V3_UPDATE_BASELINE_QEMU_REGRESSION"],
            "PASS_CI_CURRENT_MAIN_DIRECT_AND_UEFI",
        )
        self.assertEqual(
            state["PORTABLE_V3_UPDATE_ACTIVATION_QEMU_ONE_SHOT_PROOF"],
            "PASS_CI_DISPOSABLE_EXACT_SOURCE",
        )
        self.assertEqual(
            state["PORTABLE_V3_UPDATE_ACTIVATION_PHYSICAL_PROOF"],
            "NO",
        )
        self.assertEqual(
            state["PORTABLE_COLD_HEALTH_PROOF_SCOPE"],
            "PHYSICAL_STABLE_MVP_REQUIRED_NO_SYNTHETIC_CI",
        )

        self.assertEqual(promotion["MVP_SURFACE_SMOKE_HARNESS"], "PASS_SOURCE")
        self.assertEqual(promotion["MVP_SURFACE_SMOKE_PHYSICAL"], "PENDING")
        self.assertEqual(promotion["CANONICAL_RELEASE_TRUST"], "PASS_CANONICAL_PUBLIC_ANCHOR_PINNED")
        self.assertEqual(
            promotion["PRIOR_STABLE_MVP_USB_WRITE"],
            "PASS_AUTHORIZED_CONTROLLED_PROOF",
        )
        self.assertEqual(
            promotion["PRIOR_STABLE_MVP_ARTIFACT_READBACK"],
            "PASS_17_OF_17",
        )
        self.assertEqual(
            promotion["PRIOR_STABLE_MVP_UEFI_BOOT"],
            "PASS_PHYSICAL_PRE_HARDENING",
        )
        self.assertEqual(
            promotion["CANONICAL_NOTEBOOK_UEFI_BOOT_CURRENT_MAIN"],
            "PENDING_PHYSICAL_RETEST",
        )
        expected_destructive_state = (
            "NOT_REACHABLE_REPLACEMENT_PROOF_REQUIRED"
            if authorization["status"] == "blocked-canonical-v4-release-proof-pending"
            else "NO_FRESH_AUTHORIZATION"
        )
        self.assertEqual(
            promotion["DESTRUCTIVE_AUTHORIZATION"],
            expected_destructive_state,
        )
        self.assertEqual(promotion["POST_588_PHYSICAL_REWRITE_AUTHORIZED"], "NO")

    def test_portable_update_docs_keep_source_ci_and_physical_evidence_separate(self):
        current = CURRENT_STATE.read_text(encoding="utf-8")
        promotion = PROMOTION_GATES.read_text(encoding="utf-8")
        self.assertIn(
            "PORTABLE_V3_UPDATE_ACTIVATION_SOURCE=CONNECTED_ONE_SHOT_REBOOT_COLD_HEALTH",
            current,
        )
        self.assertIn(
            "PORTABLE_V3_UPDATE_BASELINE_QEMU_REGRESSION=PASS_CI_CURRENT_MAIN_DIRECT_AND_UEFI",
            current,
        )
        self.assertIn(
            "PORTABLE_V3_UPDATE_ACTIVATION_QEMU_ONE_SHOT_PROOF=PASS_CI_DISPOSABLE_EXACT_SOURCE",
            current,
        )
        self.assertIn("PORTABLE_V3_UPDATE_ACTIVATION_PHYSICAL_PROOF=NO", current)
        self.assertIn("PORTABLE_V3_ONE_SHOT_ACTIVATION=PASS_CI_DISPOSABLE_FAILURE_FALLBACK", promotion)
        self.assertIn("PORTABLE_V4_QEMU_UEFI_BOOT_PROOF=PASS_CI_NON_PHYSICAL", promotion)
        self.assertIn("current Portable Stable/MVP path is `release-manifest/4`", promotion)
        self.assertNotIn("Portable v3 source path now stages through the official signed channel", promotion)
        self.assertIn("KNOWN_GOOD_PERSISTED=PENDING_PHYSICAL", promotion)
        self.assertIn("ROLLBACK=PENDING_PHYSICAL", promotion)
        self.assertNotIn("portable-v2-activation-not-connected", current)

    def test_portable_main_evidence_matches_current_baseline_markers(self):
        evidence = json.loads(PORTABLE_MAIN_EVIDENCE.read_text(encoding="utf-8"))
        state = assignment_map(CURRENT_STATE.read_text(encoding="utf-8"))

        self.assertEqual(
            evidence["$schema"],
            "prototype-ordax.portable-runtime-v3-main-proof/1",
        )
        self.assertEqual(evidence["status"], "pass")
        self.assertEqual(
            evidence["source_commit"],
            state["PORTABLE_RUNTIME_V3_LAST_PROVEN_SOURCE_COMMIT"],
        )
        self.assertEqual(
            str(evidence["workflow_run_id"]),
            state["PORTABLE_RUNTIME_V3_LAST_PROVEN_WORKFLOW_RUN_ID"],
        )
        self.assertEqual(
            evidence["artifact"]["sha256"],
            state["PORTABLE_RUNTIME_V3_PROOF_ARTIFACT_SHA256"],
        )
        self.assertTrue(evidence["proven"]["direct_kernel_current_slot_boot"])
        self.assertTrue(evidence["proven"]["ovmf_systemd_boot_current_slot_boot"])
        self.assertTrue(evidence["not_proven"]["armed_candidate_one_shot"])
        self.assertTrue(evidence["not_proven"]["cold_health_commit"])
        self.assertTrue(evidence["not_proven"]["physical_usb_boot"])
        self.assertFalse(evidence["safety"]["physical_target_device_touched"])
        self.assertFalse(evidence["safety"]["physical_write_authorized"])

    def test_portable_one_shot_evidence_matches_current_markers(self):
        evidence = json.loads(PORTABLE_ONE_SHOT_EVIDENCE.read_text(encoding="utf-8"))
        state = assignment_map(CURRENT_STATE.read_text(encoding="utf-8"))

        self.assertEqual(
            evidence["$schema"],
            "prototype-ordax.portable-v3-one-shot-qemu-proof/1",
        )
        self.assertEqual(evidence["status"], "pass")
        self.assertEqual(
            evidence["source_commit"],
            state["PORTABLE_V3_UPDATE_ONE_SHOT_PROVEN_SOURCE_COMMIT"],
        )
        self.assertEqual(
            str(evidence["workflow_run_id"]),
            state["PORTABLE_V3_UPDATE_ONE_SHOT_WORKFLOW_RUN_ID"],
        )
        self.assertEqual(
            evidence["artifact"]["sha256"],
            state["PORTABLE_V3_UPDATE_ONE_SHOT_PROOF_ARTIFACT_SHA256"],
        )
        self.assertTrue(evidence["proven"]["candidate_boot_selected_once"])
        self.assertTrue(evidence["proven"]["fallback_previous_selected"])
        self.assertTrue(evidence["proven"]["candidate_persisted_as_rejected"])
        self.assertTrue(evidence["proven"]["candidate_file_removed"])
        self.assertTrue(evidence["proven"]["activation_transaction_removed"])
        self.assertTrue(evidence["not_proven"]["cold_health_commit"])
        self.assertTrue(evidence["not_proven"]["physical_usb_boot"])
        self.assertTrue(evidence["not_proven"]["secure_boot"])
        self.assertFalse(evidence["safety"]["physical_target_device_touched"])
        self.assertFalse(evidence["safety"]["physical_write_authorized"])

    def test_surface_smoke_gate_tracks_fail_closed_finalizer(self):
        promotion_text = PROMOTION_GATES.read_text(encoding="utf-8")
        current_state_text = CURRENT_STATE.read_text(encoding="utf-8")
        promotion = assignment_map(promotion_text)

        self.assertEqual(promotion["MVP_SURFACE_SMOKE_HARNESS"], "PASS_SOURCE")
        self.assertEqual(promotion["MVP_SURFACE_SMOKE_PHYSICAL"], "PENDING")
        self.assertIn("tour-template", promotion_text)
        self.assertIn("`finalize`", promotion_text)
        self.assertIn("all 12 required tour items are PASS", promotion_text)
        self.assertIn("MVP_SURFACE_SMOKE_TOUR_ITEMS=12", current_state_text)
        self.assertIn("requires all 12 manual tour items", current_state_text)
        self.assertIn("Account/Memory without requiring an online login", current_state_text)
        self.assertIn("verified Stable/MVP runtime", promotion_text)
        self.assertIn("physical keyboard layout", promotion_text)
        self.assertIn("matches a fresh recomputation", promotion_text)

    def test_known_stale_promotion_claims_cannot_return(self):
        promotion = assignment_map(PROMOTION_GATES.read_text(encoding="utf-8"))
        stale_keys = {
            "PHYSICAL_KERNEL_BOOT",
            "NOTEBOOK_UEFI_BOOT",
            "NETWORK_READY",
            "RELEASE_CHANNEL_REACHABLE",
            "RELEASE_SIGNATURE_VERIFY",
            "RECOVERY_PATH",
            "DEVICE_RELEASE_OR_DELTA_UPDATE",
            "HEALTH_READINESS",
        }
        for key in stale_keys:
            self.assertNotIn(key, promotion)

        self.assertNotEqual(promotion["WEB_MODE"], "PENDING")
        self.assertNotEqual(promotion["NATIVE_GRAPHICAL_MODE"], "PENDING")
        self.assertNotEqual(promotion["SAME_COMMIT_VISUAL_CHANGE"], "PENDING")
        self.assertNotEqual(promotion["EDIT_SOURCE"], "PENDING_END_TO_END")
        self.assertNotEqual(promotion["WEB_PREVIEW"], "PENDING")

    def test_known_stale_version_claims_cannot_return(self):
        current = CURRENT_STATE.read_text(encoding="utf-8")
        agents = AGENTS.read_text(encoding="utf-8")
        nomenclature = UPDATE_DOC.read_text(encoding="utf-8")

        forbidden_current = (
            "continue to share the product version",
            "continues to share the product release/version",
            "currently bundled with the product rather than a Surface/system subsystem",
            "instead of static placeholders",
        )
        for phrase in forbidden_current:
            self.assertNotIn(phrase, current)

        self.assertNotIn(
            "componentes não recebem número próprio enquanto não tiverem empacotamento e ciclo de release independentes",
            agents,
        )
        self.assertIn("Versão própria de componente e atualização independente são eixos diferentes", agents)
        self.assertIn("Versão própria de um componente e capacidade de atualizá-lo independentemente são eixos diferentes", nomenclature)

    def test_root_mvp_docs_follow_current_v4_canonical_state(self):
        state = assignment_map(CURRENT_STATE.read_text(encoding="utf-8"))
        mvp = (ROOT / "MVP.md").read_text(encoding="utf-8")
        agents = AGENTS.read_text(encoding="utf-8")
        plan = (ROOT / "PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md").read_text(encoding="utf-8")
        authorization = json.loads(PHYSICAL_WRITE_AUTHORIZATION.read_text(encoding="utf-8"))
        historical = json.loads(HISTORICAL_V4_RELEASE_PROOF.read_text(encoding="utf-8"))

        self.assertEqual(state["RELEASE_TRUST"], "PASS_CANONICAL_PUBLIC_ANCHOR_PINNED")
        self.assertEqual(
            authorization["status"],
            "blocked-canonical-v4-release-proof-pending",
        )
        self.assertFalse(
            authorization["requirements"]["canonical_v4_release_proof_bound"]
        )
        self.assertEqual(
            authorization["release_binding"]["source_commit"],
            historical["source_commit"],
        )
        self.assertEqual(
            state["CANONICAL_V4_RELEASE_PROOF_HISTORY"],
            "PASS_SIGNED_MATERIALIZED_EXACT_PRE_HARDENING",
        )
        self.assertEqual(
            state["CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN"],
            "PENDING_POST_HARDENING_REPLACEMENT",
        )
        self.assertEqual(
            state["PHYSICAL_AUTHORIZATION_ELIGIBLE"],
            "NO_REPLACEMENT_CANONICAL_V4_PROOF_REQUIRED",
        )
        self.assertIn("canonical release trust público: **PASS**", mvp)
        self.assertIn(
            "CANONICAL_V4_RELEASE_PROOF_HISTORY=PASS_BOUND_VERSIONED_PRERELEASE_PRE_HARDENING",
            mvp,
        )
        self.assertIn(
            "CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN=PENDING_POST_HARDENING_REPLACEMENT",
            mvp,
        )
        self.assertIn(
            "FIRST_STABLE_MVP_USB_WRITE=PASS_AUTHORIZED_CONTROLLED_PROOF_PRE_HARDENING",
            mvp,
        )
        self.assertIn("FIRST_STABLE_MVP_USB_READBACK=PASS_17_OF_17_PRE_HARDENING", mvp)
        self.assertIn("FIRST_STABLE_MVP_USB_UEFI_BOOT=PASS_PHYSICAL_PRE_HARDENING", mvp)
        self.assertIn(
            "CURRENT_MAIN_STABLE_MVP_PHYSICAL_RETEST=BLOCKED_REPLACEMENT_RELEASE_PROOF",
            mvp,
        )
        self.assertNotIn("CURRENT_MAIN_STABLE_MVP_PHYSICAL_RETEST=PENDING_FRESH_AUTHORIZATION", mvp)
        self.assertIn("O MVP público oferece **pt-BR e en-US**", mvp)
        self.assertNotIn("canonical release trust público: pendente", mvp)
        self.assertNotIn("O primeiro uso Native oferece **pt-BR, en-US, es-ES, de-DE e fr-FR**", mvp)

        self.assertNotIn("fresh owner authorization for the current 17-artifact / 39-operation writer context", agents)
        self.assertNotIn("canonical v4 signed/materialized release aggregate proof + binding", agents)
        self.assertNotIn("canonical Ed25519 release trust ceremony/public anchor", agents)
        self.assertIn("| C16 IA nativa | **ENTRA como capability do sistema** |", plan)
        self.assertIn("replacement proof v4 pós-hardening pendente", plan)
        self.assertNotIn("trust e proof canônico v4 resolvidos; consentimento físico pendente", plan)

    def test_pre_usb_v4_gate_distinguishes_history_from_current_replacement_proof(self):
        plan = (ROOT / "PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md").read_text(encoding="utf-8")
        promotion = (ROOT / "docs/PROMOTION-GATES.md").read_text(encoding="utf-8")
        current = (ROOT / "docs/CURRENT-STATE.md").read_text(encoding="utf-8")
        authorization = json.loads(PHYSICAL_WRITE_AUTHORIZATION.read_text(encoding="utf-8"))
        self.assertIn(
            "SIGNED_RELEASE_V4_WITH_LOCAL_AI=REQUIRED_PASS_BEFORE_PHYSICAL_PREFLIGHT",
            plan,
        )
        self.assertNotIn("SIGNED_RELEASE_V4_WITH_LOCAL_AI=PASS\n", plan)
        self.assertIn("SIGNED_RELEASE_V4_WITH_LOCAL_AI=REQUIRED", promotion)
        self.assertEqual(
            authorization["status"],
            "blocked-canonical-v4-release-proof-pending",
        )
        self.assertFalse(
            authorization["requirements"]["canonical_v4_release_proof_bound"]
        )
        self.assertIn(
            "CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN=PENDING_POST_HARDENING_REPLACEMENT",
            current,
        )
        self.assertIn(
            "FIRST_STABLE_MVP_USB_WRITE=HOLD_CANONICAL_V4_RELEASE_PROOF_PENDING",
            current,
        )
        self.assertIn("PHYSICAL_OWNER_AUTHORIZATION_RECORDED=NO", current)
        self.assertIn(
            "PHYSICAL_OWNER_AUTHORIZATION_REACHABLE=NO_REPLACEMENT_PROOF_REQUIRED",
            current,
        )
        self.assertIn(
            "PHYSICAL_WRITE_AUTHORITY=BLOCKED_CANONICAL_V4_RELEASE_PROOF_PENDING",
            current,
        )
        self.assertIn(
            "FIRST_STABLE_MVP_USB_WRITE=PASS_AUTHORIZED_CONTROLLED_PROOF_PRE_HARDENING",
            plan,
        )
        self.assertIn(
            "CURRENT_MAIN_STABLE_MVP_PHYSICAL_RETEST=BLOCKED_REPLACEMENT_RELEASE_PROOF",
            plan,
        )
        self.assertIn(
            "PHYSICAL_WRITE_AUTHORITY=BLOCKED_CANONICAL_V4_RELEASE_PROOF_PENDING",
            plan,
        )
        for stale in (
            "CANONICAL_V4_RELEASE_PROOF=PASS_SIGNED_MATERIALIZED_VERSIONED_PRERELEASE",
            "FIRST_STABLE_MVP_USB_WRITE=HOLD_EXPLICIT_PHYSICAL_AUTHORIZATION_PENDING",
            "PHYSICAL_OWNER_AUTHORIZATION_RECORDED=NO_FRESH_CONSENT_REQUIRED",
            "CURRENT_MAIN_STABLE_MVP_PHYSICAL_RETEST=PENDING_FRESH_AUTHORIZATION",
            "PHYSICAL_WRITE_AUTHORITY=BLOCKED_EXPLICIT_OWNER_AUTHORIZATION_PENDING",
        ):
            self.assertNotIn(stale, current + "\n" + plan)
        self.assertIn(
            "blocked-canonical-v4-release-proof-pending",
            promotion,
        )
        self.assertNotIn("AUTHORIZED_CANDIDATE_ONLY_TARGET_CONFIRMATION_REQUIRED", plan)
        self.assertNotIn("Como não há USB disponível", plan)


if __name__ == "__main__":
    unittest.main()