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
        "name": "project-catalog",
        "path": "system/contracts/project-catalog.mjs",
        "constant": "PROJECT_CATALOG_SCHEMA",
        "schema": "ordax.project-catalog/1",
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

BUNDLE_VERSION = "1.8.0"


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
