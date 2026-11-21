"""Single owner of public Site routes and indexability.

The canonical *origin* is provided at build time by the OS deployment owner.
This contract owns only the Site's presentation route inventory.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/site-routes.json"
SCHEMA = "ordax.site-routes/1"


def load_routes(path: Path = CONTRACT) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if (set(payload) != {"$schema", "status", "canonical_origin_authority", "routes"}
            or payload["$schema"] != SCHEMA
            or payload["canonical_origin_authority"] != "ordax-os:docs/contracts/public-site-deployment.json"
            or not isinstance(payload["routes"], list) or not payload["routes"]):
        raise ValueError("invalid canonical Site routes manifest")
    seen = set()
    output = []
    for route in payload["routes"]:
        if not isinstance(route, dict) or set(route) != {"path", "source", "indexable"}:
            raise ValueError("invalid Site route fields")
        path_value, source, indexable = route["path"], route["source"], route["indexable"]
        if (not isinstance(path_value, str)
                or not re.fullmatch(r"/(?:[a-z0-9-]+/)*", path_value)
                or path_value in seen
                or source != (path_value.lstrip("/") + "index.html")
                or type(indexable) is not bool):
            raise ValueError("unsafe or duplicated public Site route")
        seen.add(path_value)
        output.append(route)
    if "/conta/" not in seen or "/" not in seen:
        raise ValueError("required Site entry points missing")
    for route in output:
        if route["path"] in {"/conta/", "/login/", "/cadastro/", "/recuperar/",
                             "/recuperar/nova-senha/", "/web/"} and route["indexable"]:
            raise ValueError("sensitive, gated or unavailable route cannot be indexed")
    return output


ROUTE_RECORDS = load_routes()
ROUTES = tuple(item["source"] for item in ROUTE_RECORDS)
PATHS = tuple(item["path"] for item in ROUTE_RECORDS)
