"""Deterministic SEO projection of the Site route SSOT. Not a DNS authority."""
from __future__ import annotations

import html
import re
from pathlib import Path
from urllib.parse import urlsplit

from site_routes import ROUTE_RECORDS


def validate_origin(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("public SEO origin must come from authorized deployment input")
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.port is not None
            or parsed.path or parsed.query or parsed.fragment
            or parsed.netloc != parsed.hostname
            or not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", parsed.hostname)):
        raise ValueError("public SEO origin must be an exact HTTPS host without path or credentials")
    return value


def render_html(source: str, route: dict, origin: str) -> str:
    if source.count("</head>") != 1:
        raise ValueError("SEO injection requires one head")
    if re.search(r'<link[^>]*rel=["\']canonical["\']', source, re.I):
        raise ValueError("source page cannot redefine canonical URL")
    if route["indexable"]:
        title = re.search(r"<title>([^<]+)</title>", source, re.I)
        description = re.search(r'<meta\s+name="description"\s+content="([^"]+)"', source, re.I)
        if title is None or description is None:
            raise ValueError("indexable page lacks title or description")
        target = origin + route["path"]
        snippet = "\n".join((
            '  <link rel="canonical" href="' + html.escape(target, quote=True) + '">',
            '  <meta property="og:type" content="website">',
            '  <meta property="og:url" content="' + html.escape(target, quote=True) + '">',
            '  <meta property="og:title" content="' + html.escape(title.group(1), quote=True) + '">',
            '  <meta property="og:description" content="' + html.escape(description.group(1), quote=True) + '">',
            '  <meta property="og:image" content="' + html.escape(origin, quote=True) + '/assets/ordax-landscape.png">',
            '  <meta property="og:image:alt" content="OrdaX">',
        ))
    else:
        robots = re.search(r'<meta\s+name="robots"\s+content="([^"]+)"', source, re.I)
        if robots and "noindex" not in robots.group(1).lower():
            raise ValueError("gated/unavailable route has incompatible robots policy")
        snippet = "" if robots else '  <meta name="robots" content="noindex, nofollow">'
    # Brand symbol comes from the verified brand artifact. Without a favicon,
    # Chrome falls back to GET /favicon.ico, producing a real 404 even when all
    # explicitly linked scripts/styles/images are valid.
    if not re.search(r'<link[^>]+\brel=["\'](?:shortcut )?icon["\']', source, re.I):
        snippet += ('\n' if snippet else '') + '  <link rel="icon" href="/assets/ordax-symbol.png" type="image/png">'
    return source.replace("</head>", snippet + "\n</head>" if snippet else "</head>")


def write_robots_sitemap(destination: Path, origin: str) -> None:
    validate_origin(origin)
    (destination / "robots.txt").write_text(
        "User-agent: *\n"
        "Disallow: /conta/\n"
        "Disallow: /auth/\n"
        "Disallow: /account/\n"
        "Disallow: /api/\n"
        "Disallow: /sync/\n"
        f"Sitemap: {origin}/sitemap.xml\n",
        encoding="utf-8",
    )
    indexed = [route["path"] for route in ROUTE_RECORDS if route["indexable"]]
    if not indexed:
        raise ValueError("Site cannot generate an empty public sitemap")
    sitemap = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    sitemap.extend('  <url><loc>' + html.escape(origin + route, quote=True) + '</loc></url>' for route in indexed)
    sitemap.append("</urlset>")
    (destination / "sitemap.xml").write_text("\n".join(sitemap) + "\n", encoding="utf-8")
