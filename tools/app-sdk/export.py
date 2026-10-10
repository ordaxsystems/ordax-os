#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE_PATH = ROOT / "sdk" / "app-sdk-v1" / "bundle.json"
DIGEST_PATH = ROOT / "sdk" / "app-sdk-v1" / "bundle.sha256"

CONTRACTS = (
    {
        "name": "app-activation",
        "path": "system/contracts/app-activation.mjs",
        "constant": "APP_ACTIVATION_SCHEMA",
        "schema": "ordax.app-activation/1",
        "major": 1,
    },
    {
        "name": "app-data",
        "path": "system/contracts/app-data.mjs",
        "constant": "APP_DATA_SCHEMA",
        "schema": "ordax.app-data/1",
        "major": 1,
    },
    {
        "name": "app-intelligence-manifest",
        "path": "system/contracts/app-intelligence-manifest.mjs",
        "constant": "APP_INTELLIGENCE_MANIFEST_SCHEMA",
        "schema": "ordax.app-intelligence-manifest/1",
        "major": 1,
    },
    {
        "name": "application-action-capability",
        "path": "system/contracts/application-action-capability.mjs",
        "constant": "APPLICATION_ACTION_CAPABILITY_SCHEMA",
        "schema": "ordax.application-action-capability/1",
        "major": 1,
    },
    {
        "name": "application-action-capability-registry",
        "path": "system/contracts/application-action-capability.mjs",
        "constant": "APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA",
        "schema": "ordax.application-action-capability-registry/1",
        "major": 1,
    },
    {
        "name": "application-action-manifest",
        "path": "system/contracts/application-action-manifest.mjs",
        "constant": "APPLICATION_ACTION_MANIFEST_SCHEMA",
        "schema": "ordax.application-action-manifest/1",
        "major": 1,
    },
    {
        "name": "application-action-provider",
        "path": "system/contracts/application-action-provider.mjs",
        "constant": "APPLICATION_ACTION_PROVIDER_SCHEMA",
        "schema": "ordax.application-action-provider/1",
        "major": 1,
    },
    {
        "name": "application-action-provider-invocation",
        "path": "system/contracts/application-action-provider.mjs",
        "constant": "APPLICATION_ACTION_PROVIDER_INVOCATION_SCHEMA",
        "schema": "ordax.application-action-provider-invocation/1",
        "major": 1,
    },
    {
        "name": "application-action-provider-result",
        "path": "system/contracts/application-action-provider.mjs",
        "constant": "APPLICATION_ACTION_PROVIDER_RESULT_SCHEMA",
        "schema": "ordax.application-action-provider-result/1",
        "major": 1,
    },
    {
        "name": "application-action-proposal",
        "path": "system/contracts/application-action-capability.mjs",
        "constant": "APPLICATION_ACTION_PROPOSAL_SCHEMA",
        "schema": "ordax.application-action-proposal/1",
        "major": 1,
    },
    {
        "name": "browser-download",
        "path": "system/contracts/browser-download.mjs",
        "constant": "BROWSER_DOWNLOAD_PORT_SCHEMA",
        "schema": "ordax.browser-download-port/1",
        "major": 1,
    },
    {
        "name": "browser-favorites",
        "path": "system/contracts/browser-favorites.mjs",
        "constant": "BROWSER_FAVORITES_SCHEMA",
        "schema": "ordax.browser-favorites/1",
        "major": 1,
    },
    {
        "name": "browser-favorites-store",
        "path": "system/contracts/browser-favorites-store.mjs",
        "constant": "BROWSER_FAVORITES_STORE_SCHEMA",
        "schema": "ordax.browser-favorites-store/1",
        "major": 1,
    },
    {
        "name": "browser-history",
        "path": "system/contracts/browser-history.mjs",
        "constant": "BROWSER_HISTORY_SCHEMA",
        "schema": "ordax.browser-history/1",
        "major": 1,
    },
    {
        "name": "browser-history-store",
        "path": "system/contracts/browser-history-store.mjs",
        "constant": "BROWSER_HISTORY_STORE_SCHEMA",
        "schema": "ordax.browser-history-store/1",
        "major": 1,
    },
    {
        "name": "browser-navigation",
        "path": "system/contracts/browser-navigation.mjs",
        "constant": "BROWSER_NAVIGATION_POLICY_SCHEMA",
        "schema": "ordax.browser-navigation-policy/1",
        "major": 1,
    },
    {
        "name": "browser-page-find",
        "path": "system/contracts/browser-page-find.mjs",
        "constant": "BROWSER_PAGE_FIND_PORT_SCHEMA",
        "schema": "ordax.browser-page-find-port/1",
        "major": 1,
    },
    {
        "name": "browser-page-selection",
        "path": "system/contracts/browser-page-selection.mjs",
        "constant": "BROWSER_PAGE_SELECTION_PORT_SCHEMA",
        "schema": "ordax.browser-page-selection-port/1",
        "major": 1,
    },
    {
        "name": "browser-page-selection-data",
        "path": "system/contracts/browser-page-selection.mjs",
        "constant": "BROWSER_PAGE_SELECTION_SCHEMA",
        "schema": "ordax.browser-page-selection/1",
        "major": 1,
    },
    {
        "name": "browser-search-preferences",
        "path": "system/contracts/browser-search-preferences.mjs",
        "constant": "BROWSER_SEARCH_PREFERENCES_SCHEMA",
        "schema": "ordax.browser-search-preferences/1",
        "major": 1,
    },
    {
        "name": "browser-search-preferences-store",
        "path": "system/contracts/browser-search-preferences.mjs",
        "constant": "BROWSER_SEARCH_PREFERENCES_STORE_SCHEMA",
        "schema": "ordax.browser-search-preferences-store/1",
        "major": 1,
    },
    {
        "name": "browser-session",
        "path": "system/contracts/browser-session.mjs",
        "constant": "BROWSER_SESSION_SCHEMA",
        "schema": "ordax.browser-session/1",
        "major": 1,
    },
    {
        "name": "component-localization",
        "path": "system/contracts/localization-pack.mjs",
        "constant": "COMPONENT_LOCALIZATION_SCHEMA",
        "schema": "prototype-ordax.component-localization/1",
        "major": 1,
    },
    {
        "name": "component-manifest",
        "path": "system/contracts/component-manifest.mjs",
        "constant": "COMPONENT_MANIFEST_SCHEMA",
        "schema": "ordax.component-manifest/1",
        "major": 1,
    },
    {
        "name": "component-runtime",
        "path": "system/contracts/component-runtime.mjs",
        "constant": "COMPONENT_RUNTIME_SCHEMA",
        "schema": "ordax.component-runtime/1",
        "major": 1,
    },
    {
        "name": "device-action-receipt",
        "path": "system/contracts/device-action-envelope.mjs",
        "constant": "DEVICE_ACTION_RECEIPT_SCHEMA",
        "schema": "ordax.device-action-receipt/1",
        "major": 1,
    },
    {
        "name": "device-action-request",
        "path": "system/contracts/device-action-envelope.mjs",
        "constant": "DEVICE_ACTION_REQUEST_SCHEMA",
        "schema": "ordax.device-action-request/1",
        "major": 1,
    },
    {
        "name": "device-action-request-v2",
        "path": "system/contracts/device-action-envelope-v2.mjs",
        "constant": "DEVICE_ACTION_REQUEST_V2_SCHEMA",
        "schema": "ordax.device-action-request/2",
        "major": 2,
    },
    {
        "name": "device-action-result",
        "path": "system/contracts/device-action-result.mjs",
        "constant": "DEVICE_ACTION_RESULT_SCHEMA",
        "schema": "ordax.device-action-result/1",
        "major": 1,
    },
    {
        "name": "device-capabilities",
        "path": "system/contracts/device-capabilities.mjs",
        "constant": "DEVICE_AGENT_CAPABILITIES_SCHEMA",
        "schema": "ordax.device-agent-capabilities/1",
        "major": 1,
    },
    {
        "name": "device-capability-reader",
        "path": "system/contracts/device-capabilities.mjs",
        "constant": "DEVICE_AGENT_CAPABILITY_READER_SCHEMA",
        "schema": "ordax.device-agent-capability-reader/1",
        "major": 1,
    },
    {
        "name": "file-space",
        "path": "system/contracts/file-space.mjs",
        "constant": "FILE_SPACE_SCHEMA",
        "schema": "ordax.file-space/11",
        "major": 11,
    },
    {
        "name": "first-party-app-delivery",
        "path": "system/contracts/first-party-app-delivery.mjs",
        "constant": "FIRST_PARTY_APP_DELIVERY_POLICY_SCHEMA",
        "schema": "ordax.first-party-app-delivery-policy/1",
        "major": 1,
    },
    {
        "name": "identity-session",
        "path": "system/contracts/identity-session.mjs",
        "constant": "IDENTITY_SESSION_SCHEMA",
        "schema": "ordax.identity-session/1",
        "major": 1,
    },
    {
        "name": "intelligence",
        "path": "system/contracts/intelligence.mjs",
        "constant": "INTELLIGENCE_PORT_SCHEMA",
        "schema": "ordax.intelligence/1",
        "major": 1,
    },
    {
        "name": "locale-profile",
        "path": "system/contracts/locale-profile.mjs",
        "constant": "LOCALE_PROFILE_SCHEMA",
        "schema": "ordax.locale-profile/1",
        "major": 1,
    },
    {
        "name": "localization",
        "path": "system/contracts/localization.mjs",
        "constant": "LOCALIZATION_SCHEMA",
        "schema": "ordax.localization/2",
        "major": 2,
    },
    {
        "name": "localization-pack",
        "path": "system/contracts/localization-pack.mjs",
        "constant": "LOCALIZATION_PACK_SCHEMA",
        "schema": "prototype-ordax.localization-pack/1",
        "major": 1,
    },
    {
        "name": "localization-pack-release",
        "path": "system/contracts/localization-pack.mjs",
        "constant": "LOCALIZATION_PACK_RELEASE_SCHEMA",
        "schema": "prototype-ordax.localization-pack-release/1",
        "major": 1,
    },
    {
        "name": "memory",
        "path": "system/contracts/memory.mjs",
        "constant": "MEMORY_PORT_SCHEMA",
        "schema": "ordax.memory/1",
        "major": 1,
    },
    {
        "name": "profile-activation-state",
        "path": "system/contracts/profile-activation-state.mjs",
        "constant": "PROFILE_ACTIVATION_STATE_SCHEMA",
        "schema": "ordax.profile-activation-state/1",
        "major": 1,
    },
    {
        "name": "profile-activation-state-port",
        "path": "system/contracts/profile-activation-state.mjs",
        "constant": "PROFILE_ACTIVATION_STATE_PORT_SCHEMA",
        "schema": "ordax.profile-activation-state-port/1",
        "major": 1,
    },
    {
        "name": "project-catalog",
        "path": "system/contracts/project-catalog.mjs",
        "constant": "PROJECT_CATALOG_SCHEMA",
        "schema": "ordax.project-catalog/1",
        "major": 1,
    },
    {
        "name": "project-cloud-links-data",
        "path": "system/contracts/project-cloud-links-data.mjs",
        "constant": "PROJECT_CLOUD_LINKS_SCHEMA",
        "schema": "ordax.project-cloud-links/1",
        "major": 1,
    },
    {
        "name": "project-cloud-links-reader",
        "path": "system/contracts/project-cloud-links-reader.mjs",
        "constant": "PROJECT_CLOUD_LINKS_READER_SCHEMA",
        "schema": "ordax.project-cloud-links-reader/1",
        "major": 1,
    },
    {
        "name": "project-web-references",
        "path": "system/contracts/project-web-references.mjs",
        "constant": "PROJECT_WEB_REFERENCES_SCHEMA",
        "schema": "ordax.project-web-references/1",
        "major": 1,
    },
    {
        "name": "space-selection",
        "path": "system/contracts/space-selection.mjs",
        "constant": "SPACE_SELECTION_SCHEMA",
        "schema": "ordax.space-selection/1",
        "major": 1,
    },
    {
        "name": "space-selection-record",
        "path": "system/contracts/space-selection.mjs",
        "constant": "SPACE_SELECTION_RECORD_SCHEMA",
        "schema": "ordax.space-selection-record/1",
        "major": 1,
    },
    {
        "name": "space-selection-store",
        "path": "system/contracts/space-selection.mjs",
        "constant": "SPACE_SELECTION_STORE_SCHEMA",
        "schema": "ordax.space-selection-store/1",
        "major": 1,
    },
    {
        "name": "spaces",
        "path": "system/contracts/spaces.mjs",
        "constant": "SPACES_PORT_SCHEMA",
        "schema": "ordax.spaces/1",
        "major": 1,
    },
    {
        "name": "spaces-profile-packs",
        "path": "system/contracts/spaces.mjs",
        "constant": "PROFILE_PACKS_PORT_SCHEMA",
        "schema": "ordax.profile-packs/1",
        "major": 1,
    },
    {
        "name": "spaces-snapshot",
        "path": "system/contracts/spaces.mjs",
        "constant": "SPACES_SNAPSHOT_SCHEMA",
        "schema": "ordax.spaces-snapshot/1",
        "major": 1,
    },
    {
        "name": "studio-action-context",
        "path": "system/contracts/studio-action-context.mjs",
        "constant": "STUDIO_ACTION_CONTEXT_SCHEMA",
        "schema": "ordax.studio-action-context/1",
        "major": 1,
    },
    {
        "name": "studio-runtime",
        "path": "system/contracts/studio-runtime.mjs",
        "constant": "STUDIO_RUNTIME_PORT_SCHEMA",
        "schema": "ordax.studio-runtime/1",
        "major": 1,
    },
    {
        "name": "studio-runtime-v2",
        "path": "system/contracts/studio-runtime-v2.mjs",
        "constant": "STUDIO_RUNTIME_V2_PORT_SCHEMA",
        "schema": "ordax.studio-runtime/2",
        "major": 2,
    },
    {
        "name": "studio-runtime-v3",
        "path": "system/contracts/studio-runtime-v3.mjs",
        "constant": "STUDIO_RUNTIME_V3_PORT_SCHEMA",
        "schema": "ordax.studio-runtime/3",
        "major": 3,
    },
    {
        "name": "surface-render-lifecycle",
        "path": "system/contracts/surface-render-lifecycle.mjs",
        "constant": "SURFACE_RENDER_LIFECYCLE_SCHEMA",
        "schema": "ordax.surface-render-lifecycle/5",
        "major": 5,
    },
)

BUNDLE_VERSION = "1.14.0"


def git_blob(path: Path) -> str:
    result = subprocess.run(
        ["git", "hash-object", str(path)],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    value = result.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise RuntimeError(f"invalid git blob hash for {path}")
    return value


def schema_from_source(path: Path, constant: str) -> str:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(
        rf'^export const {re.escape(constant)} = "([^"]+)";$',
        re.MULTILINE,
    )
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"missing schema constant {constant} in {path}")
    return match.group(1)


def build_bundle() -> dict:
    contracts = []
    for spec in CONTRACTS:
        path = ROOT / spec["path"]
        actual_schema = schema_from_source(path, spec["constant"])
        if actual_schema != spec["schema"]:
            raise RuntimeError(
                f"contract schema drift for {spec['name']}: "
                f"expected {spec['schema']}, got {actual_schema}"
            )
        contracts.append(
            {
                "major": spec["major"],
                "name": spec["name"],
                "schema": actual_schema,
                "source_git_blob": git_blob(path),
                "source_path": spec["path"],
            }
        )

    return {
        "$schema": "ordax.app-sdk-bundle/1",
        "authority": "none",
        "bundle_version": BUNDLE_VERSION,
        "compatibility_policy": "contract-major",
        "contracts": contracts,
    }


def bundle_bytes() -> bytes:
    return (
        json.dumps(build_bundle(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def digest_line(content: bytes) -> bytes:
    digest = hashlib.sha256(content).hexdigest()
    return f"{digest}  bundle.json\n".encode("ascii")


def check() -> None:
    expected_bundle = bundle_bytes()
    actual_bundle = BUNDLE_PATH.read_bytes()
    if actual_bundle != expected_bundle:
        raise SystemExit(
            "APP_SDK_BUNDLE=FAIL\n"
            "sdk/app-sdk-v1/bundle.json is stale; run tools/app-sdk/export.py --write"
        )

    expected_digest = digest_line(expected_bundle)
    actual_digest = DIGEST_PATH.read_bytes()
    if actual_digest != expected_digest:
        raise SystemExit(
            "APP_SDK_BUNDLE=FAIL\n"
            "sdk/app-sdk-v1/bundle.sha256 is stale"
        )

    print("APP_SDK_BUNDLE=PASS")
    print("APP_SDK_SCHEMA=ordax.app-sdk-bundle/1")
    print(f"APP_SDK_VERSION={BUNDLE_VERSION}")
    print(f"APP_SDK_CONTRACT_COUNT={len(CONTRACTS)}")
    print("APP_SDK_AUTHORITY=none")


def write() -> None:
    content = bundle_bytes()
    BUNDLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    BUNDLE_PATH.write_bytes(content)
    DIGEST_PATH.write_bytes(digest_line(content))
    print(BUNDLE_PATH.relative_to(ROOT))
    print(DIGEST_PATH.relative_to(ROOT))


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--check", action="store_true")
    group.add_argument("--write", action="store_true")
    args = parser.parse_args()

    if args.write:
        write()
    else:
        check()


if __name__ == "__main__":
    main()
