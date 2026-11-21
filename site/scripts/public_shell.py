"""Render the public header and footer from one route-aware Site contract."""
from __future__ import annotations

from copy import deepcopy
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts/public-shell.json"
HEADER_MARKER = "<!-- ORDAX_PUBLIC_HEADER -->"
FOOTER_MARKER = "<!-- ORDAX_PUBLIC_FOOTER -->"


class PublicShellError(ValueError):
    pass


def _is_safe_href(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    if re.fullmatch(r"#[A-Za-z][A-Za-z0-9_-]*", value):
        return True
    if "#" in value:
        path, fragment = value.split("#", 1)
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", fragment):
            return False
    else:
        path = value
    if not path.startswith("/") or path.startswith("//") or "\\" in path or "?" in path:
        return False
    segments = path[1:].split("/")
    if segments and segments[-1] == "":
        segments.pop()
    return all(re.fullmatch(r"[A-Za-z0-9._~-]+", part)
               and part not in {".", ".."} for part in segments)


def _validate_links(value: object, label: str, *, allow_auth: bool = False) -> None:
    if not isinstance(value, list) or not value:
        raise PublicShellError(label + " must contain links")
    current_count = 0
    for item in value:
        allowed = {"href", "label", "current"}
        if allow_auth:
            allowed |= {"auth", "cta", "arrow", "mobile_label"}
        if not isinstance(item, dict) or set(item) - allowed:
            raise PublicShellError(label + " has invalid link fields")
        if not _is_safe_href(item.get("href")):
            raise PublicShellError(label + " has an unsafe link target")
        if not isinstance(item.get("label"), str) or not item["label"].strip():
            raise PublicShellError(label + " has an empty label")
        if "mobile_label" in item and (
                not isinstance(item["mobile_label"], str) or not item["mobile_label"].strip()):
            raise PublicShellError(label + " has an empty mobile label")
        if "current" in item and type(item["current"]) is not bool:
            raise PublicShellError(label + " has an invalid current-page marker")
        current_count += item.get("current") is True
        if allow_auth:
            if any(key in item and type(item[key]) is not bool for key in ("cta", "arrow")):
                raise PublicShellError(label + " has invalid action decoration")
            auth = item.get("auth")
            if auth is not None:
                if not isinstance(auth, str):
                    raise PublicShellError(label + " has an invalid Identity action")
                expected_href = {"login": "/login/", "register": "/cadastro/"}.get(auth)
                if expected_href is None or item["href"] != expected_href:
                    raise PublicShellError(label + " has an invalid Identity action")
    if current_count > 1:
        raise PublicShellError(label + " marks multiple current pages")


def _resolve_profile(value: object, profiles: dict, label: str) -> object:
    """Expand an explicit named profile while keeping route overrides local."""
    if isinstance(value, dict) and set(value) == {"profile"}:
        name = value["profile"]
        if not isinstance(name, str) or name not in profiles:
            raise PublicShellError(label + " references an unknown profile")
        return deepcopy(profiles[name])
    return value


def _validate_footer(value: object, label: str) -> None:
    if (not isinstance(value, dict) or set(value) != {"tagline", "navigation"}
            or not isinstance(value["tagline"], str) or not value["tagline"].strip()):
        raise PublicShellError(label + " has invalid footer data")
    _validate_links(value["navigation"], label + " footer")


def load_contract(routes: list[dict], path: Path = CONTRACT_PATH) -> dict:
    """Load the shell data and prove its route keys cover the canonical routes."""
    if path.is_symlink() or not path.is_file():
        raise PublicShellError("public shell contract missing or symlinked")
    contract = json.loads(path.read_text(encoding="utf-8"))
    if (not isinstance(contract, dict)
            or set(contract) != {"$schema", "brand", "header_navigation_label",
                                 "footer_navigation_label", "exceptions", "profiles", "routes"}
            or contract["$schema"] != "ordax.site-public-shell/2"):
        raise PublicShellError("invalid public shell contract")
    brand = contract["brand"]
    if (not isinstance(brand, dict)
            or set(brand) != {"href", "aria_label", "name", "symbol"}
            or not _is_safe_href(brand["href"])
            or not isinstance(brand["aria_label"], str) or not brand["aria_label"].strip()
            or not isinstance(brand["name"], str) or not brand["name"].strip()
            or not isinstance(brand["symbol"], str)
            or not re.fullmatch(r"/assets/[A-Za-z0-9._-]+", brand["symbol"])):
        raise PublicShellError("invalid public shell brand")
    for field in ("header_navigation_label", "footer_navigation_label"):
        if not isinstance(contract[field], str) or not contract[field].strip():
            raise PublicShellError("invalid public shell navigation label")

    profiles = contract["profiles"]
    if (not isinstance(profiles, dict)
            or set(profiles) != {"actions", "navigation", "footers"}
            or any(not isinstance(profiles[group], dict) or not profiles[group]
                   for group in ("actions", "navigation", "footers"))):
        raise PublicShellError("invalid public shell profiles")
    for group in ("actions", "navigation", "footers"):
        for name, value in profiles[group].items():
            if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", name):
                raise PublicShellError("invalid public shell profile name")
            if group == "actions":
                _validate_links(value, "profile " + name, allow_auth=True)
            elif group == "navigation":
                _validate_links(value, "profile " + name)
            else:
                _validate_footer(value, "profile " + name)

    exceptions = contract["exceptions"]
    if not isinstance(exceptions, list):
        raise PublicShellError("invalid public shell exceptions")
    exception_paths: set[str] = set()
    route_paths = {item["path"] for item in routes}
    for exception in exceptions:
        if (not isinstance(exception, dict)
                or set(exception) != {"path", "owner", "reason"}
                or exception["path"] not in route_paths
                or exception["path"] in exception_paths
                or exception["owner"] not in {"account-app", "identity"}
                or not isinstance(exception["reason"], str) or not exception["reason"].strip()):
            raise PublicShellError("invalid public shell exception")
        exception_paths.add(exception["path"])
    route_data = contract["routes"]
    expected_paths = route_paths - exception_paths
    if not isinstance(route_data, dict) or set(route_data) != expected_paths:
        raise PublicShellError("public shell route data must match canonical Site routes")

    for route_path, data in route_data.items():
        if not isinstance(data, dict) or set(data) != {"actions", "navigation", "footer"}:
            raise PublicShellError("invalid public shell route data: " + route_path)
        resolved = {
            "actions": _resolve_profile(
                data["actions"], profiles["actions"], route_path + " actions"
            ),
            "navigation": _resolve_profile(
                data["navigation"], profiles["navigation"], route_path + " navigation"
            ),
            "footer": _resolve_profile(
                data["footer"], profiles["footers"], route_path + " footer"
            ),
        }
        if not isinstance(resolved["actions"], list) or not 1 <= len(resolved["actions"]) <= 2:
            raise PublicShellError("invalid public shell route data: " + route_path)
        _validate_links(resolved["actions"], route_path + " actions", allow_auth=True)
        _validate_links(resolved["navigation"], route_path + " navigation")
        _validate_footer(resolved["footer"], route_path)
        route_data[route_path] = resolved
    return contract


def _attribute(name: str, value: str) -> str:
    return f' {name}="{html.escape(value, quote=True)}"'


def _link(item: dict, *, auth_label: bool = False) -> str:
    classes = "nav-cta" if item.get("cta") else ""
    class_attribute = _attribute("class", classes) if classes else ""
    auth_attribute = _attribute("data-auth-nav", item["auth"]) if item.get("auth") else ""
    current_attribute = _attribute("aria-current", "page") if item.get("current") else ""
    label = html.escape(item["label"])
    if "mobile_label" in item:
        desktop_label = f'<span data-shell-label="desktop">{label}</span>'
        mobile_label = html.escape(item["mobile_label"])
        label = (f'{desktop_label}<span data-shell-label="mobile">{mobile_label}</span>')
    if auth_label:
        if "mobile_label" in item:
            label = (f'<span data-auth-nav-label data-shell-label="desktop">{html.escape(item["label"])}</span>'
                     f'<span data-shell-label="mobile">{html.escape(item["mobile_label"])}</span>')
        else:
            label = f'<span data-auth-nav-label>{label}</span>'
    # Spacing belongs to the shell's flex gap. A literal separator remains a
    # flex item when responsive CSS hides the decorative arrow.
    arrow = '<span aria-hidden="true">↗</span>' if item.get("arrow") else ""
    return (f'<a{class_attribute}{_attribute("href", item["href"])}'
            f'{auth_attribute}{current_attribute}>{label}{arrow}</a>')


def _render_brand(contract: dict, *, header: bool) -> str:
    brand = contract["brand"]
    size = (30, 30) if header else (48, 30)
    return (
        f'<a class="brand"{_attribute("href", brand["href"])}'
        f'{_attribute("aria-label", brand["aria_label"])}>'
        f'<img class="brand-mark" src="{html.escape(brand["symbol"], quote=True)}" '
        f'width="{size[0]}" height="{size[1]}" alt="">'
        f'<span class="brand-name">{html.escape(brand["name"])}</span></a>'
    )


def _render_header(contract: dict, data: dict) -> str:
    actions = "".join(_link(item, auth_label=bool(item.get("auth")))
                      for item in data["actions"])
    navigation = "".join(_link(item) for item in data["navigation"])
    return (
        '<header class="site-header">'
        + _render_brand(contract, header=True)
        + f'<div class="site-actions"><div class="site-auth-actions">{actions}</div></div>'
        + f'<nav class="site-nav" aria-label="{html.escape(contract["header_navigation_label"], quote=True)}">'
        + '<div class="site-nav-tools"></div>'
        + f'<div class="site-nav-links">{navigation}</div></nav></header>'
    )


def _render_footer(contract: dict, data: dict) -> str:
    footer = data["footer"]
    navigation = "".join(_link(item) for item in footer["navigation"])
    return (
        '<footer class="site-footer"><div>'
        + _render_brand(contract, header=False)
        + f'<p>{html.escape(footer["tagline"])}</p></div>'
        + f'<nav aria-label="{html.escape(contract["footer_navigation_label"], quote=True)}">'
        + navigation + '</nav></footer>'
    )


def render_public_shell(markup: str, route_path: str, contract: dict) -> str:
    """Replace shell markers in ordinary routes; leave locked/app shells intact."""
    data = contract["routes"].get(route_path)
    if data is None:
        if HEADER_MARKER in markup or FOOTER_MARKER in markup:
            raise PublicShellError("shell marker found on an exempt route: " + route_path)
        return markup
    if markup.count(HEADER_MARKER) != 1 or markup.count(FOOTER_MARKER) != 1:
        raise PublicShellError("public shell markers must each occur once: " + route_path)
    if re.search(r'<header class="site-header"|<footer class="site-footer"', markup):
        raise PublicShellError("route source duplicates generated public shell: " + route_path)
    return markup.replace(HEADER_MARKER, _render_header(contract, data)).replace(
        FOOTER_MARKER, _render_footer(contract, data)
    )
