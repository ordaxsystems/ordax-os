#!/usr/bin/env python3
"""Generate and validate the public playground fixture from Surface source."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
APPS_ROOT = ROOT / "system" / "apps"
APP_CATALOG = APPS_ROOT / "catalog.mjs"
DESKTOP_SHELL = ROOT / "system" / "surface" / "ui" / "desktop-shell.mjs"
SHORTCUT_CATALOG = ROOT / "system" / "services" / "surface" / "shortcut-catalog.mjs"
SURFACE_LOCALIZATION = ROOT / "system" / "services" / "i18n" / "surface.mjs"
PUBLIC_ROOT = ROOT / "sites" / "public"
FIXTURE_PATH = PUBLIC_ROOT / "assets" / "playground-fixture.json"
INDEX_PATH = PUBLIC_ROOT / "index.html"
SCHEMA = "prototype-ordax.public-playground-fixture/1"

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
RAIL_RE = re.compile(
    r'railButton\("([a-z][a-z0-9-]*)",\s*t\("([^"]+)"\),\s*ICONS\.[a-zA-Z0-9]+,\s*t\)'
)
SPACE_RE = re.compile(r'spaceLink\("([^"]+)",\s*"([^"]+)",\s*t\)')
AREA_RE = re.compile(r't\("surface\.area\.label",\s*\{\s*ordinal:\s*"([^"]+)"\s*\}\)')
COMMAND_RE = re.compile(r't\("shell\.launcher\.command"\)')
SPACE_LABEL_RE = re.compile(r't\("shell\.space\.title"\)')


class PlaygroundFixtureError(RuntimeError):
    """Raised when the generated fixture cannot represent current Surface source."""


def _decode(value: str) -> str:
    return json.loads(f'"{value}"')


def _app_metadata(path: Path) -> dict[str, str]:
    fields = {name: _decode(value) for name, value in FIELD_RE.findall(path.read_text(encoding="utf-8"))}
    required = {"id", "title", "description", "monogram"}
    missing = sorted(required - fields.keys())
    if missing:
        raise PlaygroundFixtureError(f"{path.relative_to(ROOT)} is missing app fields: {missing}")
    return {key: fields[key] for key in ("id", "title", "description", "monogram")}


def _catalog_order() -> list[str]:
    text = APP_CATALOG.read_text(encoding="utf-8")
    match = re.search(r"const APPS = Object\.freeze\(\[(.*?)\]\);", text, re.DOTALL)
    if not match:
        raise PlaygroundFixtureError("system/apps/catalog.mjs has no readable APPS order")
    return CATALOG_RE.findall(match.group(1))


def _catalog_source_messages(path: Path, symbol: str) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    match = re.search(
        rf"export const {re.escape(symbol)} = Object\.freeze\(\{{(.*?)\n\}}\);",
        text,
        re.DOTALL,
    )
    if not match:
        raise PlaygroundFixtureError(
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
        raise PlaygroundFixtureError("shared Surface localization has no readable source catalog")

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
            raise PlaygroundFixtureError(
                f"Surface localization catalog import is outside the approved catalog root: {relative_path}"
            )
        for raw_name in names.split(","):
            symbol = raw_name.strip()
            if symbol.endswith("_SOURCE_MESSAGES"):
                imported_catalogs[symbol] = target

    for symbol in SOURCE_SPREAD_RE.findall(source_body):
        path = imported_catalogs.get(symbol)
        if path is None:
            raise PlaygroundFixtureError(
                f"shared Surface source spread has no readable import: {symbol}"
            )
        messages.update(_catalog_source_messages(path, symbol))

    if not messages:
        raise PlaygroundFixtureError("shared Surface localization source catalog is empty")
    return messages


def _message(messages: dict[str, str], message_id: str, **values: str) -> str:
    if message_id not in messages:
        raise PlaygroundFixtureError(f"missing Surface source message: {message_id}")
    value = messages[message_id]
    for key, replacement in values.items():
        value = value.replace("{" + key + "}", replacement)
    if re.search(r"\{[A-Za-z][A-Za-z0-9]*\}", value):
        raise PlaygroundFixtureError(f"unresolved Surface source message values: {message_id}")
    return value


def _surface_home() -> dict[str, object]:
    """Project real Native Meridian device-app shortcuts into the public demo.

    The sidebar destinations come from MERIDIAN_RAIL_DESTINATIONS, not from
    the retired desktop-shell railButton/spaceLink layout. The home metadata
    here only describes device apps genuinely reachable in the Native menu.
    """
    text = DESKTOP_SHELL.read_text(encoding="utf-8")
    messages = _surface_source_messages()
    # Native shell consumes the shared shortcut catalog. The public fixture
    # reads that same catalog rather than parsing a rendered list or carrying
    # a second copy of the app order.
    if not re.search(
        r'const NAVIGATION_MENU_APP_IDS = listSurfaceShortcutAppIds\("navigation-menu"\);',
        text,
    ) or "NAVIGATION_MENU_APP_IDS.map(id =>" not in text:
        raise PlaygroundFixtureError(
            "Native Meridian menu is not bound to the canonical shortcut catalog"
        )
    catalog = SHORTCUT_CATALOG.read_text(encoding="utf-8")
    entries_match = re.search(r"const entries = \[(.*?)\];", catalog, re.DOTALL)
    if not entries_match:
        raise PlaygroundFixtureError("Surface shortcut catalog has no readable entries")
    entries_source = entries_match.group(1)
    entries = re.findall(
        r'\{\s*appId:\s*"([a-z][a-z0-9-]*)",\s*placements:\s*\{([^}]+)\}\s*\}',
        entries_source,
    )
    if len(entries) != len(re.findall(r"\bappId\s*:", entries_source)):
        raise PlaygroundFixtureError("Surface shortcut catalog entries are malformed")
    app_ids_seen: set[str] = set()
    positioned: list[tuple[int, str]] = []
    occupied_positions: set[int] = set()
    for app_id, placements_source in entries:
        if app_id in app_ids_seen:
            raise PlaygroundFixtureError("Surface shortcut catalog contains duplicated app ids")
        app_ids_seen.add(app_id)
        position_match = re.search(
            r'"navigation-menu"\s*:\s*([^,}\s]+)', placements_source,
        )
        if not position_match:
            continue
        try:
            position = int(position_match.group(1))
        except ValueError as error:
            raise PlaygroundFixtureError("Surface shortcut catalog placement is malformed") from error
        if position < 0:
            raise PlaygroundFixtureError("Surface shortcut catalog placement is malformed")
        if position in occupied_positions:
            raise PlaygroundFixtureError("Surface shortcut catalog placement is duplicated")
        occupied_positions.add(position)
        positioned.append((position, app_id))
    positioned.sort()
    if not positioned or [position for position, _ in positioned] != list(range(len(positioned))):
        raise PlaygroundFixtureError("Surface shortcut catalog placement is malformed")
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


def _current_surface_snapshot():
    # This OS portal is an immutable *historical* static Dev artifact. Its
    # source files now belong to ordax-surface and must not be reconstructed
    # from files on the current OS checkout.
    snapshot = json.loads((PUBLIC_ROOT / "assets/surface-snapshot.json").read_text(encoding="utf-8"))
    css = (PUBLIC_ROOT / "assets/surface-snapshot.css").read_bytes()
    if hashlib.sha256(css).hexdigest() != snapshot.get("cssSha256"):
        raise PlaygroundFixtureError("frozen public Surface CSS integrity mismatch")
    entries = snapshot.get("sources")
    if not isinstance(entries, list) or not entries:
        raise PlaygroundFixtureError("frozen snapshot missing historical source receipt")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise PlaygroundFixtureError("invalid frozen historical source entry")
        value = entry.get("path")
        digest = entry.get("sha256")
        if not isinstance(value, str) or not isinstance(digest, str):
            raise PlaygroundFixtureError("invalid frozen historical source receipt")
        relative = Path(value)
        if (relative.is_absolute() or not value or ".." in relative.parts
                or value in seen or re.fullmatch(r"[0-9a-f]{64}", digest) is None):
            raise PlaygroundFixtureError("invalid frozen historical source provenance")
        seen.add(value)
    return snapshot


def project_public_catalog() -> dict[str, object]:
    order = _catalog_order()
    metadata = {}
    imports = CATALOG_APP_IMPORT_RE.findall(APP_CATALOG.read_text(encoding="utf-8"))
    if len(imports) != len({symbol for symbol, _ in imports}):
        raise PlaygroundFixtureError("duplicate app source imports in canonical catalog")
    app_sources = dict(imports)
    for app_id in order:
        specifier = app_sources.get(f"{app_id}App")
        if specifier is None:
            raise PlaygroundFixtureError(f"catalog app has no source import: {app_id}")
        app_file = (APP_CATALOG.parent / specifier).resolve()
        if not app_file.is_relative_to(ROOT.resolve()) or not app_file.is_file():
            raise PlaygroundFixtureError(f"invalid catalog app source: {specifier}")
        app = _app_metadata(app_file)
        if app["id"] != app_id:
            raise PlaygroundFixtureError(f"catalog app identity mismatch: {app_id}")
        metadata[app_id] = app
    if len(app_sources) != len(metadata):
        raise PlaygroundFixtureError("unused app source import in canonical catalog")
    if set(order) != set(metadata):
        raise PlaygroundFixtureError(
            f"app catalog/source mismatch: catalog={sorted(order)} source={sorted(metadata)}"
        )
    home = _surface_home()
    unknown = sorted(set(home["rail_apps"]) - set(metadata))
    if unknown:
        raise PlaygroundFixtureError(f"Surface Home references unknown apps: {unknown}")
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
            "home": "system/surface/ui/desktop-shell.mjs",
        },
    }


def _read_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PlaygroundFixtureError(f"cannot read fixture {path}: {exc}") from exc
    if not isinstance(value, dict) or value.get("$schema") != SCHEMA:
        raise PlaygroundFixtureError(f"invalid playground fixture schema: {path}")
    return value


def _inline_fixture_bounds(text: str) -> tuple[int, int]:
    match = re.search(
        r'<script\s+id="playground-fixture"\s+type="application/json">(.*?)</script>',
        text,
        re.DOTALL,
    )
    if not match:
        raise PlaygroundFixtureError("sites/public/index.html is missing the inline playground fixture")
    return match.start(1), match.end(1)


def read_inline_fixture() -> dict[str, object]:
    text = INDEX_PATH.read_text(encoding="utf-8")
    start, end = _inline_fixture_bounds(text)
    try:
        value = json.loads(text[start:end])
    except json.JSONDecodeError as exc:
        raise PlaygroundFixtureError(f"invalid inline playground fixture: {exc}") from exc
    if not isinstance(value, dict) or value.get("$schema") != SCHEMA:
        raise PlaygroundFixtureError("inline playground fixture has an unexpected schema")
    return value


def validate_fixture() -> dict[str, object]:
    # Validate the OS historic *static* presentation against its own immutable
    # assets. The current OS catalog is projected independently for Surface,
    # and must not be conflated with an archived Site snapshot.
    fixture = _read_json(FIXTURE_PATH)
    if fixture != read_inline_fixture():
        raise PlaygroundFixtureError("frozen inline/file playground fixture diverged")
    if fixture.get("surface") != _current_surface_snapshot():
        raise PlaygroundFixtureError("frozen playground Surface snapshot diverged")
    if not isinstance(fixture.get("apps"), list) or not isinstance(fixture.get("home"), dict):
        raise PlaygroundFixtureError("frozen playground catalog structure invalid")
    return fixture


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-catalog", type=Path,
                        help="read-only OS/catalog projection into a new external JSON file")
    args = parser.parse_args()
    if args.project_catalog:
        output = args.project_catalog.absolute()
        if (output.is_relative_to(ROOT.resolve()) or not output.parent.is_dir()
                or output.exists() or output.is_symlink()):
            raise PlaygroundFixtureError("projection output must be a new file outside OS source")
        projection = project_public_catalog()
        output.write_text(json.dumps(projection, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
                          encoding="utf-8")
        print("PUBLIC_OS_CATALOG_PROJECTION=PASS")
    else:
        # Frozen OS portal verification only. Never rewrite public markup,
        # fixtures, CSS or localized copy; the Surface/Site owners publish.
        validate_fixture()
        print("PUBLIC_PLAYGROUND_FIXTURE=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, PlaygroundFixtureError, UnicodeDecodeError) as exc:
        print(f"PUBLIC_PLAYGROUND_FIXTURE=ERROR {exc}")
        raise SystemExit(1)
