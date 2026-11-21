#!/usr/bin/env python3
"""Static candidate checks for all routes; no remote browser, auth or deploy access."""
from __future__ import annotations
import argparse
import json
import hashlib
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree
from site_routes import ROUTE_RECORDS, ROUTES
from site_seo import validate_origin

def check_css_dependencies(out: Path) -> int:
    """Reject broken or off-origin CSS assets in the actual build output.

    This is intentionally output-based: staging may rebase the upstream
    Surface font URL without changing the immutable source artifact.
    """
    checked = 0
    for path in sorted(out.rglob("*.css")):
        # Comments cannot declare dependencies. All other url() calls in CSS
        # must point to a shipped local resource or a self-contained data URI.
        css = re.sub(r"/\*.*?\*/", "", path.read_text("utf-8"), flags=re.S)
        if re.search(r"@import\b", css, flags=re.I):
            raise AssertionError(path.relative_to(out).as_posix() + ": CSS @import not allowed")
        for match in re.finditer(r"""url\(\s*(?:(["'])(.*?)\1|([^\s)]+))\s*\)""", css, flags=re.I | re.S):
            url = (match.group(2) or match.group(3)).strip()
            if url.startswith(("data:image/", "data:font/", "#")):
                continue
            asset = urlsplit(url)
            if (not url or asset.scheme or asset.netloc or asset.query or asset.fragment
                    or "\\" in url or ".." in asset.path.split("/")):
                raise AssertionError(path.relative_to(out).as_posix() + ": unsafe CSS URL " + url[:100])
            target = (out / asset.path.lstrip("/")) if asset.path.startswith("/") else path.parent / asset.path
            if not target.is_file() or target.is_symlink():
                raise AssertionError(path.relative_to(out).as_posix() + ": missing CSS asset " + url[:100])
            checked += 1
    return checked


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lang = ""
        self.in_title = False
        self.title = ""
        self.headings = 0
        self.mains = 0
        self.description = ""
        self.viewport = ""
        self.robots = ""
        self.canonical = None
        self.social_url = None
        self.social_title = None
        self.ids = set()
        self.skip_target = None
        self.assets = []
        self.forms = []
        self.password_inputs = []
        self.submit_buttons = []

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if tag == "html": self.lang = attr.get("lang", "")
        if tag == "title": self.in_title = True
        if tag == "main": self.mains += 1
        if tag == "h1": self.headings += 1
        if "id" in attr: self.ids.add(attr["id"])
        if tag == "meta":
            if attr.get("name") == "description": self.description = attr.get("content", "")
            if attr.get("name") == "viewport": self.viewport = attr.get("content", "")
            if attr.get("name") == "robots": self.robots = attr.get("content", "")
            if attr.get("property") == "og:url": self.social_url = attr.get("content")
            if attr.get("property") == "og:title": self.social_title = attr.get("content")
        if tag == "link" and attr.get("rel") == "canonical": self.canonical = attr.get("href")
        if tag == "link" and attr.get("rel") in {"stylesheet", "icon"}:
            self.assets.append(attr.get("href", ""))
        if tag in {"script", "img"} and attr.get("src"):
            self.assets.append(attr["src"])
        if tag == "a" and attr.get("class") == "skip-link":
            self.skip_target = attr.get("href")
        if tag == "form": self.forms.append(attr)
        if tag == "input" and attr.get("type") == "password":
            self.password_inputs.append(attr)
        if tag == "button" and attr.get("type") == "submit":
            self.submit_buttons.append(attr)

    def handle_endtag(self, tag):
        if tag == "title": self.in_title = False

    def handle_data(self, data):
        if self.in_title: self.title += data

def assert_candidate(out: Path) -> dict:
    if not (out / "public-site-manifest.json").is_file():
        raise AssertionError("candidate manifest is absent")
    manifest = json.loads((out / "public-site-manifest.json").read_text(encoding="utf-8"))
    origin = validate_origin(manifest["seo_origin"])
    css_dependencies_checked = check_css_dependencies(out)
    inspected = []
    for route in ROUTE_RECORDS:
        relative = route["source"]
        html = (out / relative).read_text(encoding="utf-8")
        page = Page()
        page.feed(html)
        checks = {
            "html language": page.lang == "pt-BR",
            "document title": bool(page.title.strip()),
            "meta description": bool(page.description.strip()),
            "viewport": "width=device-width" in page.viewport,
            "single main": page.mains == 1,
            "primary heading": page.headings == 1,
            "skip navigation": page.skip_target in {"#" + identifier for identifier in page.ids},
        }
        for key, good in checks.items():
            if not good:
                raise AssertionError(relative + ": " + key + " failed")
        if route["indexable"]:
            if page.canonical != origin + route["path"] or page.social_url != page.canonical or page.social_title != page.title:
                raise AssertionError(relative + ": canonical and OpenGraph metadata drift")
            if "noindex" in page.robots:
                raise AssertionError(relative + ": public information page incorrectly noindexed")
        elif "noindex" not in page.robots.lower() or page.canonical is not None:
            raise AssertionError(relative + ": gated route must have only noindex metadata")
        for value in page.assets:
            url = urlsplit(value)
            if url.scheme or url.netloc or not value.startswith("/"):
                raise AssertionError(relative + ": remote/relative active asset " + value)
            if ".." in url.path.split("/"):
                raise AssertionError(relative + ": unsafe resource path " + value)
            if not (out / url.path.lstrip("/")).is_file():
                raise AssertionError(relative + ": missing referenced asset " + value)
        if relative in {"login/index.html", "cadastro/index.html", "recuperar/index.html", "recuperar/nova-senha/index.html"}:
            if not page.forms:
                raise AssertionError(relative + ": guarded native form missing")
            if any("hidden" not in form or form.get("action") for form in page.forms):
                raise AssertionError(relative + ": credential form published as active")
            if any("disabled" not in field for field in page.password_inputs):
                raise AssertionError(relative + ": password input active without server readiness")
            if any("disabled" not in button for button in page.submit_buttons):
                raise AssertionError(relative + ": credential submission active without server readiness")
        if relative == "index.html":
            receipt = manifest["surface_preview"]
            if (receipt.get("status") != "candidate-not-published"
                    or receipt.get("source_repository") != "ordaxsystems/ordax-surface"
                    or not receipt.get("os_host_commit")
                    or receipt.get("font_url_rebased") is not True):
                raise AssertionError("invalid signed Dev Surface producer receipt")
            css_path = out / "assets/surface-snapshot.css"
            css = css_path.read_bytes()
            delivered_digest = hashlib.sha256(css).hexdigest()
            if delivered_digest != receipt["rendered_css_sha256"]:
                raise AssertionError("delivered Surface CSS differs from verified receipt")
            if f"/assets/surface-snapshot.css?v={delivered_digest[:12]}" not in html:
                raise AssertionError("Surface CSS cache key is not tied to distributed bytes")
            if b"inter-latin-wght-normal-Dx4kXJAl.woff2" in css:
                raise AssertionError("Surface preview retains unpublished hashed font URL")
            if b"/assets/fonts/inter-latin-wght-normal.woff2" not in css:
                raise AssertionError("preview font is not referenced from verified brand")
            if (out / "assets/surface-snapshot.json").exists():
                raise AssertionError("duplicated embedded Surface snapshot JSON reached the public bundle")
            if 'id="playground-fixture"' in html:
                raise AssertionError("landing embeds a duplicate fixture instead of the canonical JSON asset")
            fixture = out / "assets/playground-fixture.json"
            if not fixture.is_file() or not json.loads(fixture.read_text("utf-8")).get("surface"):
                raise AssertionError("standalone playground fixture is missing or malformed")
            if 'window.OrdaXPublicJsonTransport.loadStatic(' not in (out / "assets/playground.js").read_text("utf-8"):
                raise AssertionError("playground controller must consume only the canonical fixture")
        if relative == "conta/index.html" and "noindex" not in page.robots:
            raise AssertionError(relative + ": account portal must not be indexed")
        if relative in {"index.html", "conta/index.html"}:
            if 'class="commercial-plan"' in html:
                raise AssertionError(relative + ": no authorized commercial offers available")
            if "Planos em preparação" not in html or "contratação indisponível" not in html:
                raise AssertionError(relative + ": inactive commercial availability not explicit")
            if "ORDAX_PUBLIC_PLAN_CATALOG" in html or "ORDAX_ACCOUNT_PLAN_CATALOG" in html:
                raise AssertionError(relative + ": unresolved reference catalog marker")
        inspected.append({"route": "/" + relative.removesuffix("index.html"), "assets": len(page.assets), "headings": page.headings})
    indexed = [origin + route["path"] for route in ROUTE_RECORDS if route["indexable"]]
    sitemap = ElementTree.parse(out / "sitemap.xml").getroot()
    locations = [elem.text for elem in sitemap.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
    if locations != indexed or manifest["indexable_routes"] != [r["path"] for r in ROUTE_RECORDS if r["indexable"]]:
        raise AssertionError("SEO sitemap does not match the canonical Site route inventory")
    robots = (out / "robots.txt").read_text("utf-8")
    if "Disallow: /conta/" not in robots or f"Sitemap: {origin}/sitemap.xml" not in robots:
        raise AssertionError("robots.txt lacks account boundary or canonical sitemap")
    catalog = json.loads((out / "releases/catalog.json").read_text("utf-8"))
    if catalog != {"$schema": "prototype-ordax.public-release-catalog/1", "status": "empty", "releases": []}:
        raise AssertionError("CI candidate must fail closed on absent authorized publications")
    return {"result": "PASS", "routes": inspected, "default_public_releases": 0,
            "sitemap_entries": len(indexed), "css_dependencies_checked": css_dependencies_checked}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="out/site")
    args = parser.parse_args()
    print(json.dumps(assert_candidate(Path(args.out)), sort_keys=True, ensure_ascii=False))
