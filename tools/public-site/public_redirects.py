"""Internal permanent redirects shared by Vercel, preview and Nginx builds."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE_PATH = re.compile(r"/[a-z0-9-]+(?:/index\.html|/)?")


def public_redirects(config_path: Path = ROOT / "vercel.json") -> dict[str, str]:
    routes = {}
    for rule in json.loads(config_path.read_text(encoding="utf-8")).get("redirects", []):
        source, destination = rule.get("source"), rule.get("destination")
        if (
            set(rule) != {"source", "destination", "permanent"}
            or rule["permanent"] is not True
            or not isinstance(source, str) or not PAGE_PATH.fullmatch(source)
            or not isinstance(destination, str) or not PAGE_PATH.fullmatch(destination)
            or source == destination or source in routes
        ):
            raise ValueError("invalid-public-redirect")
        routes[source] = destination
    if any(target in routes for target in routes.values()):
        raise ValueError("public-redirect-chains-not-supported")
    return routes


def nginx_redirects(config_path: Path = ROOT / "vercel.json") -> str:
    return "# Generated from vercel.json; do not edit.\n" + "".join(
        f"location = {source} {{ return 308 {destination}$is_args$args; }}\n"
        for source, destination in public_redirects(config_path).items()
    )
