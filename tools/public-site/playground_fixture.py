#!/usr/bin/env python3
"""Generate and validate the public playground fixture from Surface source."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
APPS_ROOT = ROOT / "system" / "apps"
APP_CATALOG = APPS_ROOT / "catalog.mjs"
DESKTOP_SHELL = ROOT / "system" / "surface" / "ui" / "desktop-shell.mjs"
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
    text = DESKTOP_SHELL.read_text(encoding="utf-8")
    messages = _surface_source_messages()
    rail_matches = RAIL_RE.findall(text)
    space_matches = SPACE_RE.findall(text)
    area = AREA_RE.search(text)
    command = COMMAND_RE.search(text)
    space_label = SPACE_LABEL_RE.search(text)
    if not area or not command or not space_label or not rail_matches or not space_matches:
        raise PlaygroundFixtureError("desktop shell is missing Home metadata required by the playground")

    rail = [
        {"id": app_id, "label": _message(messages, message_id)}
        for app_id, message_id in rail_matches
    ]
    spaces = [
        {"label": _message(messages, message_id), "target": target}
        for message_id, target in space_matches
    ]
    return {
        "area_label": _message(messages, "surface.area.label", ordinal=area.group(1)),
        "command_label": _message(messages, "shell.launcher.command"),
        "space_label": _message(messages, "shell.space.title"),
        "spaces": spaces,
        "rail_apps": [item["id"] for item in rail],
        "rail_labels": rail,
    }


def generate_fixture() -> dict[str, object]:
    order = _catalog_order()
    metadata = {}
    for app_dir in sorted(APPS_ROOT.iterdir()):
        app_file = app_dir / "app.mjs"
        if app_file.is_file():
            app = _app_metadata(app_file)
            metadata[app["id"]] = app
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
        "$schema": SCHEMA,
        "source": {
            "apps": "system/apps/catalog.mjs",
            "home": "system/surface/ui/desktop-shell.mjs",
        },
        "home": home,
        "apps": apps,
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
    expected = generate_fixture()
    file_value = _read_json(FIXTURE_PATH)
    inline_value = read_inline_fixture()
    if file_value != expected:
        raise PlaygroundFixtureError(
            "playground-fixture.json is stale; run tools/public-site/playground_fixture.py --write"
        )
    if inline_value != expected:
        raise PlaygroundFixtureError(
            "inline playground fixture is stale; run tools/public-site/playground_fixture.py --write"
        )
    return expected


def write_fixture() -> None:
    fixture = generate_fixture()
    payload = json.dumps(fixture, ensure_ascii=False, indent=2) + "\n"
    FIXTURE_PATH.write_text(payload, encoding="utf-8")

    html = INDEX_PATH.read_text(encoding="utf-8")
    start, end = _inline_fixture_bounds(html)
    html = html[:start] + "\n" + payload + html[end:]
    INDEX_PATH.write_text(html, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="write generated fixture and inline copy")
    args = parser.parse_args()
    if args.write:
        write_fixture()
        print(f"PUBLIC_PLAYGROUND_FIXTURE=WRITTEN path={FIXTURE_PATH.relative_to(ROOT)}")
    else:
        validate_fixture()
        print("PUBLIC_PLAYGROUND_FIXTURE=PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, PlaygroundFixtureError, UnicodeDecodeError) as exc:
        print(f"PUBLIC_PLAYGROUND_FIXTURE=ERROR {exc}")
        raise SystemExit(1)
