#!/usr/bin/env python3
"""Read-only, fail-closed Internet App SDK dependency audit.

The platform remains source owner until an explicit remove-first cutover.
This tool does not publish SDK contracts, copy app code, install, or activate.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = "ordax.internet-sdk-readiness/1"
APP_PATH = Path("system/apps/internet")
SDK_PATH = Path("sdk/app-sdk-v1/bundle.json")
STATIC_IMPORT = re.compile(
    r"""(?:\bfrom\s*["']([^"'\\\r\n]+)["']"""
    r"""|(?:^|\n)\s*import\s*["']([^"'\\\r\n]+)["']"""
    r"""|\bimport\s*\(\s*["']([^"'\\\r\n]+)["']\s*\))""",
    re.MULTILINE,
)
DYNAMIC_IMPORT = re.compile(r"\bimport\s*\(\s*(?!['\"])")
LOCAL_ASSET = re.compile(
    r"""new\s+URL\(\s*["']([^"'\\\r\n]+)["']\s*,\s*import\.meta\.url\s*\)"""
)


class InternetSdkAuditError(ValueError):
    pass


def relative_path(root: Path, file: Path) -> str:
    try:
        return file.relative_to(root).as_posix()
    except ValueError as exc:
        raise InternetSdkAuditError("Internet import escapes the platform repository") from exc


def audit(root: Path = ROOT) -> dict:
    root = root.resolve()
    app = root / APP_PATH
    if app.is_symlink() or not app.is_dir():
        raise InternetSdkAuditError("Internet source must be a real app directory")
    bundle_path = root / SDK_PATH
    if bundle_path.is_symlink() or not bundle_path.is_file():
        raise InternetSdkAuditError("canonical published App SDK bundle missing")
    try:
        sdk = json.loads(bundle_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InternetSdkAuditError("published App SDK bundle unreadable") from exc
    if sdk.get("$schema") != "ordax.app-sdk-bundle/1" or sdk.get("authority") != "none":
        raise InternetSdkAuditError("App SDK bundle identity/authority mismatch")
    contracts = sdk.get("contracts")
    if not isinstance(contracts, list):
        raise InternetSdkAuditError("published App SDK contract inventory invalid")
    published = set()
    for contract in contracts:
        if not isinstance(contract, dict) or not isinstance(contract.get("source_path"), str):
            raise InternetSdkAuditError("invalid App SDK contract inventory entry")
        if contract.get("schema") is None or contract.get("major") is None:
            raise InternetSdkAuditError("App SDK contract metadata incomplete")
        published.add(contract["source_path"])

    local_files = sorted(app.rglob("*.mjs"))
    if not local_files:
        raise InternetSdkAuditError("Internet has no app source files")
    if any(path.is_symlink() for path in app.rglob("*")):
        raise InternetSdkAuditError("symlinks forbidden in Internet product source")

    local_imports: set[str] = set()
    external: set[str] = set()
    unsupported: set[str] = set()
    for source in local_files:
        try:
            content = source.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise InternetSdkAuditError("Internet module unreadable") from exc
        if DYNAMIC_IMPORT.search(content):
            raise InternetSdkAuditError(
                f"{relative_path(root, source)} uses non-literal dynamic import"
            )
        imports = [
            next(value for value in match.groups() if value is not None)
            for match in STATIC_IMPORT.finditer(content)
        ]
        # CSS/other local assets are packaging dependencies, not SDK ports.
        imports.extend(match.group(1) for match in LOCAL_ASSET.finditer(content))
        for item in imports:
            if not item.startswith("."):
                raise InternetSdkAuditError(
                    f"{relative_path(root, source)} uses non-relative import: {item}"
                )
            target = (source.parent / item).resolve()
            name = relative_path(root, target)
            if not target.is_file():
                raise InternetSdkAuditError(
                    f"{relative_path(root, source)} imports absent source: {name}"
                )
            if target.is_relative_to(app):
                local_imports.add(name)
            elif target.is_relative_to(root / "system" / "contracts"):
                external.add(name)
            else:
                unsupported.add(name)
    # A module listed in the published SDK is not independently usable if
    # it imports another unpublished/private platform module. Walk the
    # canonical source graph transitively rather than trusting only the
    # Internet app's immediate imports. Imports remain read-only: this never
    # copies source into the external app repository.
    direct_contracts = set(external)
    inspected: set[str] = set()
    queue = sorted(external)
    while queue:
        contract_name = queue.pop()
        if contract_name in inspected:
            continue
        inspected.add(contract_name)
        contract_file = root / contract_name
        if not contract_file.is_file() or contract_file.is_symlink():
            raise InternetSdkAuditError(
                f"canonical contract source missing or symlinked: {contract_name}"
            )
        try:
            contract_source = contract_file.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise InternetSdkAuditError("canonical contract source unreadable") from exc
        if DYNAMIC_IMPORT.search(contract_source):
            raise InternetSdkAuditError(
                f"{contract_name} has a non-literal dynamic import"
            )
        deps = [
            next(value for value in match.groups() if value is not None)
            for match in STATIC_IMPORT.finditer(contract_source)
        ]
        deps.extend(match.group(1) for match in LOCAL_ASSET.finditer(contract_source))
        for relative in deps:
            if not relative.startswith("."):
                raise InternetSdkAuditError(
                    f"{contract_name} uses a non-relative dependency: {relative}"
                )
            dependency = (contract_file.parent / relative).resolve()
            dependency_name = relative_path(root, dependency)
            if not dependency.is_file() or dependency.is_symlink():
                raise InternetSdkAuditError(
                    f"{contract_name} imports missing or symlinked dependency: "
                    f"{dependency_name}"
                )
            if dependency.is_relative_to(root / "system" / "contracts"):
                if dependency_name not in external:
                    external.add(dependency_name)
                    queue.append(dependency_name)
            else:
                unsupported.add(dependency_name)
    transitive_contracts = external - direct_contracts
    unpublished = external - published
    # A clean source-level dependency boundary is not evidence of signed
    # packages, installation, rollback or hardware behavior.
    blockers = sorted(
        ["private-platform-imports"] if unsupported else []
    )
    if unpublished:
        blockers.append("unpublished-app-sdk-contracts")
    return {
        "schema": SCHEMA,
        "appId": "internet",
        "sourceOwner": "ordaxsystems/ordax-os",
        "sourcePath": APP_PATH.as_posix(),
        "sdkBundleVersion": sdk.get("bundle_version"),
        "appModuleCount": len(local_files),
        "directContracts": sorted(direct_contracts),
        "transitiveContracts": sorted(transitive_contracts),
        "requiredContracts": sorted(external),
        "publishedContracts": sorted(external & published),
        "unpublishedContracts": sorted(unpublished),
        "privatePlatformImports": sorted(unsupported),
        "sdkBoundaryClean": not blockers,
        "blockers": sorted(blockers),
        "sourceCutoverAuthorized": False,
        "distributionActivated": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate source inventory and print its truthful state")
    parser.add_argument("--require-public", action="store_true", help="fail unless all imports have public App SDK boundaries")
    args = parser.parse_args(argv)
    try:
        report = audit()
    except InternetSdkAuditError as exc:
        print("INTERNET_SDK_AUDIT=FAIL\n" + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True))
    if args.require_public and not report["sdkBoundaryClean"]:
        print("INTERNET_SDK_PUBLIC_BOUNDARY=BLOCKED", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
