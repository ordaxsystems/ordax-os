#!/usr/bin/env python3
"""OS-owned read-only catalog projection consumed by the Surface Dev demo.

No Site assets, visual source, runtime session or static page renderer here.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APPS_ROOT = ROOT / "system/apps"
APP_CATALOG = APPS_ROOT / "catalog.mjs"
SHORTCUT_CATALOG = ROOT / "system/services/surface/shortcut-catalog.mjs"
SURFACE_LOCALIZATION = ROOT / "system/services/i18n/surface.mjs"

FIELD_RE = re.compile(
    r'^\s*(id|title|description|monogram):\s*"((?:\\.|[^"\\])*)",?\s*$',
    re.MULTILINE,
)
CATALOG_RE = re.compile(r"\b([a-z][a-z0-9-]*)App\b")
CATALOG_APP_IMPORT_RE = re.compile(r'import\s+\{\s*([A-Za-z][A-Za-z0-9_]*App)\s*\}\s+from\s+"(\.[^"]+/app\.mjs)";')
MESSAGE_RE = re.compile(
    r'^\s*"([^"]+)":\s*"((?:\\.|[^"\\])*)",?\s*$',
    re.MULTILINE,
)
CATALOG_IMPORT_RE = re.compile(
    r'import\s+\{([^}]+)\}\s+from\s+"(\./catalog/[a-z0-9-]+\.mjs)";',
    re.MULTILINE,
)
SOURCE_SPREAD_RE = re.compile(r"\.\.\.([A-Z][A-Z0-9_]*_SOURCE_MESSAGES)\s*,?")


class CatalogProjectionError(RuntimeError):
    pass

def _decode(value: str) -> str:
    return json.loads(f'"{value}"')


def _app_metadata(path: Path) -> dict[str, str]:
    fields = {name: _decode(value) for name, value in FIELD_RE.findall(path.read_text(encoding="utf-8"))}
    required = {"id", "title", "description", "monogram"}
    missing = sorted(required - fields.keys())
    if missing:
        raise CatalogProjectionError(f"{path.relative_to(ROOT)} is missing app fields: {missing}")
    return {key: fields[key] for key in ("id", "title", "description", "monogram")}


def _catalog_order() -> list[str]:
    text = APP_CATALOG.read_text(encoding="utf-8")
    match = re.search(r"const APPS = Object\.freeze\(\[(.*?)\]\);", text, re.DOTALL)
    if not match:
        raise CatalogProjectionError("system/apps/catalog.mjs has no readable APPS order")
    return CATALOG_RE.findall(match.group(1))


def _catalog_source_messages(path: Path, symbol: str) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    match = re.search(
        rf"export const {re.escape(symbol)} = Object\.freeze\(\{{(.*?)\n\}}\);",
        text,
        re.DOTALL,
    )
    if not match:
        raise CatalogProjectionError(
            f"{path.relative_to(ROOT)} has no readable {symbol} catalog"
        )
    return {
        message_id: _decode(value)
        for message_id, value in MESSAGE_RE.findall(match.group(1))
    }


def _surface_source_messages() -> dict[str, str]:
    text = SURFACE_LOCALIZATION.read_text(encoding="utf-8")
    match = re.search(
        r"const SOURCE = Object\.freeze\(\{(.*?)\n\}\);",
        text,
        re.DOTALL,
    )
    if not match:
        raise CatalogProjectionError("shared Surface localization has no readable source catalog")

    source_body = match.group(1)
    messages = {
        message_id: _decode(value)
        for message_id, value in MESSAGE_RE.findall(source_body)
    }

    imported_catalogs: dict[str, Path] = {}
    catalog_root = SURFACE_LOCALIZATION.parent / "catalog"
    for names, relative_path in CATALOG_IMPORT_RE.findall(text):
        target = (SURFACE_LOCALIZATION.parent / relative_path.removeprefix("./")).resolve()
        if target.parent != catalog_root.resolve() or not target.is_file():
            raise CatalogProjectionError(
                f"Surface localization catalog import is outside the approved catalog root: {relative_path}"
            )
        for raw_name in names.split(","):
            symbol = raw_name.strip()
            if symbol.endswith("_SOURCE_MESSAGES"):
                imported_catalogs[symbol] = target

    for symbol in SOURCE_SPREAD_RE.findall(source_body):
        path = imported_catalogs.get(symbol)
        if path is None:
            raise CatalogProjectionError(
                f"shared Surface source spread has no readable import: {symbol}"
            )
        messages.update(_catalog_source_messages(path, symbol))

    if not messages:
        raise CatalogProjectionError("shared Surface localization source catalog is empty")
    return messages


def _message(messages: dict[str, str], message_id: str, **values: str) -> str:
    if message_id not in messages:
        raise CatalogProjectionError(f"missing Surface source message: {message_id}")
    value = messages[message_id]
    for key, replacement in values.items():
        value = value.replace("{" + key + "}", replacement)
    if re.search(r"\{[A-Za-z][A-Za-z0-9]*\}", value):
        raise CatalogProjectionError(f"unresolved Surface source message values: {message_id}")
    return value


def _surface_home() -> dict[str, object]:
    """Project real Native Meridian device-app shortcuts into the public demo.

    This projection owns no visual shell and reads only OS catalog contracts.
    """
    messages = _surface_source_messages()
    # OS owns shortcuts and translations. Surface CI proves that its UI
    # uses the same OS shortcut owner, without source copied into the OS.
    catalog = SHORTCUT_CATALOG.read_text(encoding="utf-8")
    entries_match = re.search(r"const entries = \[(.*?)\];", catalog, re.DOTALL)
    if not entries_match:
        raise CatalogProjectionError("Surface shortcut catalog has no readable entries")
    entries_source = entries_match.group(1)
    entries = re.findall(
        r'\{\s*appId:\s*"([a-z][a-z0-9-]*)",\s*placements:\s*\{([^}]+)\}\s*\}',
        entries_source,
    )
    if len(entries) != len(re.findall(r"\bappId\s*:", entries_source)):
        raise CatalogProjectionError("Surface shortcut catalog entries are malformed")
    app_ids_seen: set[str] = set()
    positioned: list[tuple[int, str]] = []
    occupied_positions: set[int] = set()
    for app_id, placements_source in entries:
        if app_id in app_ids_seen:
            raise CatalogProjectionError("Surface shortcut catalog contains duplicated app ids")
        app_ids_seen.add(app_id)
        position_match = re.search(
            r'"navigation-menu"\s*:\s*([^,}\s]+)', placements_source,
        )
        if not position_match:
            continue
        try:
            position = int(position_match.group(1))
        except ValueError as error:
            raise CatalogProjectionError("Surface shortcut catalog placement is malformed") from error
        if position < 0:
            raise CatalogProjectionError("Surface shortcut catalog placement is malformed")
        if position in occupied_positions:
            raise CatalogProjectionError("Surface shortcut catalog placement is duplicated")
        occupied_positions.add(position)
        positioned.append((position, app_id))
    positioned.sort()
    if not positioned or [position for position, _ in positioned] != list(range(len(positioned))):
        raise CatalogProjectionError("Surface shortcut catalog placement is malformed")
    app_ids = [app_id for _, app_id in positioned]

    rail = [
        {"id": app_id, "label": _message(messages, f"app.{app_id}.title")}
        for app_id in app_ids
    ]
    # File-system folder shortcuts are no longer part of the Meridian Home.
    # Do not carry the historical spaceLink demo entries forward.
    return {
        "area_label": _message(messages, "surface.area.label", ordinal="01"),
        "command_label": _message(messages, "shell.launcher.command"),
        "space_label": _message(messages, "shell.space.title"),
        "spaces": [],
        "rail_apps": app_ids,
        "rail_labels": rail,
    }



def project_public_catalog() -> dict[str, object]:
    order = _catalog_order()
    metadata = {}
    imports = CATALOG_APP_IMPORT_RE.findall(APP_CATALOG.read_text(encoding="utf-8"))
    if len(imports) != len({symbol for symbol, _ in imports}):
        raise CatalogProjectionError("duplicate app source imports in canonical catalog")
    app_sources = dict(imports)
    for app_id in order:
        specifier = app_sources.get(f"{app_id}App")
        if specifier is None:
            raise CatalogProjectionError(f"catalog app has no source import: {app_id}")
        app_file = (APP_CATALOG.parent / specifier).resolve()
        if not app_file.is_relative_to(ROOT.resolve()) or not app_file.is_file():
            raise CatalogProjectionError(f"invalid catalog app source: {specifier}")
        app = _app_metadata(app_file)
        if app["id"] != app_id:
            raise CatalogProjectionError(f"catalog app identity mismatch: {app_id}")
        metadata[app_id] = app
    if len(app_sources) != len(metadata):
        raise CatalogProjectionError("unused app source import in canonical catalog")
    if set(order) != set(metadata):
        raise CatalogProjectionError(
            f"app catalog/source mismatch: catalog={sorted(order)} source={sorted(metadata)}"
        )
    home = _surface_home()
    unknown = sorted(set(home["rail_apps"]) - set(metadata))
    if unknown:
        raise CatalogProjectionError(f"Surface Home references unknown apps: {unknown}")
    display_titles = {item["id"]: item["label"] for item in home["rail_labels"]}
    apps = [
        {
            **metadata[app_id],
            "display_title": display_titles.get(app_id, metadata[app_id]["title"]),
        }
        for app_id in order
    ]
    return {
        "$schema": "ordax.os-public-catalog-projection/1",
        "source_repository": "ordaxsystems/ordax-os",
        "home": home,
        "apps": apps,
        "source": {
            "apps": "system/apps/catalog.mjs",
            "home": "system/services/surface/shortcut-catalog.mjs",
        },
    }



def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True,
                        help="new JSON file outside OS source")
    path = parser.parse_args().output.resolve()
    if path.is_relative_to(ROOT.resolve()) or not path.parent.is_dir() or path.exists():
        raise CatalogProjectionError("output must be a new file outside OS source")
    result = project_public_catalog()
    path.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True,
                               separators=(",", ":")) + "\n", encoding="utf-8")
    print("ORDAX_PUBLIC_CATALOG_PROJECTION=PASS")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, CatalogProjectionError, UnicodeDecodeError) as error:
        raise SystemExit(f"ORDAX_PUBLIC_CATALOG_PROJECTION=FAIL {error}")
