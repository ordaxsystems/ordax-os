#!/usr/bin/env python3
"""Local, non-deploy browser proof for an already-verified static Site artifact.

Uses Python stdlib + ChromeDriver preinstalled on GitHub's pinned Ubuntu image.
No browser package or OS/Surface checkout is required.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import math
import os
import posixpath
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

from site_routes import PATHS as ROUTES
VIEWPORTS = ((1440, 900), (1024, 900), (768, 900), (760, 900),
             (430, 900), (390, 844), (360, 800), (320, 740), (280, 740))
# Touch-first tablets retain a desktop CSS viewport while using coarse input.
# Sample both sides of shared-shell and account-app layout boundaries.
TOUCH_VIEWPORTS = (641, 760, 761, 1100, 1101, 1180, 1181)
LOCALIZATION_VIEWPORTS = (280, 320, 360, 390, 430, 600, 641, 768, 980, 1024, 1100, 1180, 1280, 1440)
NO_SCRIPT_ROUTES = ("/login/", "/cadastro/", "/recuperar/",
                    "/recuperar/nova-senha/", "/conta/", "/web/")
# 1280px layout viewed through 200% and 400% effective CSS viewports.
# This checks responsive reflow, not real browser zoom or text magnification.
REFLOW_WIDTHS = ((640, 200), (320, 400))
BREAKPOINT_WIDTH_RANGE = (280, 2560)
SURFACE_OWNED_STYLESHEETS = frozenset({"playground.css", "surface-snapshot.css"})


class StylesheetLinkCollector(HTMLParser):
    """Collect stylesheet links from the built route, including rel token lists."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "link":
            return
        attributes = {name.lower(): value for name, value in attrs}
        rel = set((attributes.get("rel") or "").lower().split())
        href = attributes.get("href")
        if "stylesheet" in rel and href:
            self.hrefs.append(href)


def responsive_breakpoint_audit(root: Path, route: str) -> dict:
    """Derive viewport checks from CSS actually linked by one built route."""
    route_file = root / ("index.html" if route == "/" else f"{route.strip('/')}/index.html")
    if not route_file.is_file():
        raise BrowserProofError(f"built route is missing while reading responsive CSS: {route}")

    html = route_file.read_text(encoding="utf-8")
    collector = StylesheetLinkCollector()
    collector.feed(html)
    base_url = urljoin("http://ordax.local/", route.lstrip("/"))
    pending = [(href, base_url) for href in collector.hrefs]
    visited: set[str] = set()
    owner_stylesheets: set[str] = set()
    thresholds: set[float] = set()
    root_resolved = root.resolve()

    while pending:
        href, source_url = pending.pop()
        stylesheet_url = urljoin(source_url, href)
        parsed = urlsplit(stylesheet_url)
        if (parsed.scheme not in ("http", "https") or parsed.netloc != "ordax.local"
                or not parsed.path.lower().endswith(".css")):
            continue

        css_url_path = posixpath.normpath(unquote(parsed.path))
        if not css_url_path.startswith("/"):
            continue
        css_name = Path(css_url_path).name.lower()
        if css_name in SURFACE_OWNED_STYLESHEETS:
            owner_stylesheets.add(css_url_path)
        if css_url_path in visited:
            continue

        css_path = (root / Path(css_url_path.lstrip("/")).as_posix()).resolve()
        if not css_path.is_relative_to(root_resolved):
            raise BrowserProofError(f"stylesheet escapes built candidate: {css_url_path}")
        if not css_path.is_file():
            raise BrowserProofError(f"route links a missing local stylesheet: {css_url_path}")
        visited.add(css_url_path)
        css = re.sub(r"/\*.*?\*/", "", css_path.read_text(encoding="utf-8"), flags=re.S)

        for imported in re.findall(
                r"@import\s+(?:url\(\s*)?['\"]?([^'\"\s)]+)", css, flags=re.I):
            pending.append((imported, stylesheet_url))

        for media_query in re.findall(r"@media\s*([^{}]*)\{", css, flags=re.I):
            for value in re.findall(
                    r"\b(?:max|min)-width\s*:\s*(\d+(?:\.\d+)?)\s*px\b",
                    media_query, flags=re.I):
                thresholds.add(float(value))

    lower, upper = BREAKPOINT_WIDTH_RANGE
    centers = {center for threshold in thresholds
               for center in (math.floor(threshold), math.ceil(threshold))
               if lower - 1 <= center <= upper + 1}
    candidates = {center + delta for center in centers for delta in (-1, 0, 1)}
    candidates = {width for width in candidates if lower <= width <= upper}
    representative_widths = {width for width, _height in VIEWPORTS}
    return {
        "thresholdsPx": [int(value) if value.is_integer() else value
                         for value in sorted(thresholds)],
        "stylesheets": sorted(visited),
        "ownerStylesheets": sorted(owner_stylesheets),
        "testedWidths": sorted(candidates - representative_widths),
    }


def responsive_shell_checks(report: dict, width: int, route: str,
                            coarse_pointer: bool = False) -> dict:
    """Keep the shared responsive contract identical across viewport audits."""
    checks = {
        "routeRendered": report["complete"] and report["pathname"] == route
            and report["mainCount"] == 1,
        "noHorizontalOverflow": report["noOverflow"],
        "noUnexpectedRemoteRequests": not report["remoteResources"],
        "noBrokenStaticAssets": not report["failedStaticAssets"],
        "noUncaughtBrowserErrors": not report["runtimeErrors"],
        "siteTargetsMeetMinimumSize": not report["undersizedAAInteractiveTargets"],
        "mobileTargetsRemainComfortable": width > 640
            or not report["undersizedInteractiveTargets"],
        "publicHeaderRegionsReady": report["publicHeaderRegionsReady"],
        "publicHeaderRegionsVisible": report["publicHeaderRegionsVisible"],
        "publicHeaderBrandActionsShareRow": report["publicHeaderBrandActionsShareRow"],
        "publicHeaderBrandActionsDoNotOverlap": report["publicHeaderBrandActionsDoNotOverlap"],
        "publicHeaderBrandContentFits": report["publicHeaderBrandContentFits"],
        "publicHeaderActionsFit": report["publicHeaderActionsFit"],
        "publicHeaderLocalePresentation": report["publicHeaderLocalePresentation"],
        "publicHeaderMobileLocaleInDisclosure": report["publicHeaderMobileLocaleInDisclosure"],
        "publicPageStartSpacing": report["publicPageStartSpacingReady"],
        "sharedFooterContract": report["sharedFooterContract"],
        "sharedFooterResponsiveLayout": report["sharedFooterResponsiveLayout"],
        "sharedFooterFitsViewport": report["sharedFooterFitsViewport"],
        "sharedFooterLinksHaveComfortableTargets": report["sharedFooterLinksHaveComfortableTargets"],
    }
    if route != "/conta/":
        checks["publicMobileNavigationDisclosureReady"] = (
            report["publicMobileNavigationDisclosureReady"]
        )
    if coarse_pointer:
        checks["coarsePointerTargetsRemainComfortable"] = (
            not report["undersizedInteractiveTargets"]
        )
    if route == "/":
        checks["compactDemoOnlyInertWithoutPrecisePointer"] = (
            report["compactDemoInput"]["valid"]
        )
    if route == "/conta/":
        checks["accountShellPresent"] = report["accountPortal"]
        checks["accountTopbarFitsViewport"] = report["accountTopbarFitsViewport"]
        checks["accountMobileNavigationLabelsFit"] = report["accountMobileNavigationLabelsFit"]
        checks["noInventedVerifiedUser"] = not report["accountHasVerifiedUser"]
        if report["accountMobileFooterClearance"]["checked"]:
            checks["accountMobileFooterClearOfNavigation"] = (
                report["accountMobileFooterClearance"]["clear"]
            )
    return checks


class BrowserProofError(RuntimeError):
    pass


class LocalProofHTTPServer(http.server.ThreadingHTTPServer):
    """Ignore expected socket closes when Chrome moves between test routes."""

    def handle_error(self, request, client_address):
        error = sys.exc_info()[1]
        if isinstance(error, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, root: Path, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)

    def log_message(self, _format, *_args):
        pass

    def do_POST(self):
        self.send_response(503)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b'{"error":"service-unavailable"}')

    def do_GET(self):
        # Deliberately stall a JSON route to prove the browser's real abort
        # closes the UI fail-closed. The timeout is bounded to this harness.
        if self.path == getattr(self.server, "stall_json_for_deadline_test", None):
            threading.Event().wait(timeout=13)
            return
        # Hold the config fetch after login has loaded to prove legacy bearer
        # fragments are removed BEFORE the first asynchronous network reply.
        if self.path == "/config/public-site.json" and getattr(
                self.server, "hold_config_for_fragment_test", False):
            self.server.fragment_config_started.set()
            self.server.fragment_config_release.wait(timeout=4)
            return super().do_GET()
        # Three synthetic sessions share an email but differ in identity.
        # Usage A (91) is shown, B (44) is delayed, and C (7) must replace
        # both. Only the loopback proof serves these read-only fixtures.
        if getattr(self.server, "same_email_usage_test", False) and self.path in (
                "/auth/session", "/account/usage/mcp"):
            with self.server.same_email_lock:
                if self.path == "/auth/session":
                    self.server.same_email_session_requests += 1
                    attempt = self.server.same_email_session_requests
                else:
                    self.server.same_email_usage_requests += 1
                    attempt = self.server.same_email_usage_requests
            if self.path == "/auth/session":
                payload = {
                    "$schema": "prototype-ordax.public-identity-session/1",
                    "provider": "supabase", "status": "authenticated",
                    "authenticated": True, "subject": "synthetic-owner-" + str(attempt),
                    "email": "same-email@example.test",
                }
            else:
                if attempt == 2:
                    time.sleep(1.05)
                count = {1: 91, 2: 44, 3: 7}.get(attempt, 0)
                payload = {
                    "ok": True, "schema": "ordax.product-mcp-usage/1",
                    "billable": False, "observed_only": True,
                    "coverage": "partial_observational",
                    "collection_active_now": True,
                    "quota": None, "charge": None,
                    "current_month": "2026-10-01",
                    "previous_month": "2026-09-01",
                    "entries": [{"month": "2026-10-01", "tool_name": "local_test",
                                 "tool_calls": count}],
                }
            content = json.dumps(payload).encode("utf-8")
            try:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        # Identity JSON attacks are local to this browser proof: a 200 with
        # JSON bytes is not enough if MIME or the byte budget is wrong.
        json_attack = getattr(self.server, "auth_json_attack_for_test", None)
        if self.path == "/auth/session" and json_attack:
            payload = {
                "$schema": "prototype-ordax.public-identity-session/1",
                "provider": "supabase", "status": "authenticated",
                "authenticated": True, "subject": "synthetic-json-attack",
                "email": "untrusted-json@example.test",
            }
            if json_attack == "oversized":
                payload["padding"] = "x" * 270000
            content = json.dumps(payload).encode("utf-8")
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/plain" if json_attack == "wrong-mime"
                                 else "application/json")
                self.send_header("Cache-Control", "no-store")
                # Omitting Content-Length in the oversized case proves the
                # actual streaming cap, not merely a header-size rejection.
                if json_attack != "oversized":
                    self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        # Delayed old anonymous response vs. immediate new unavailability:
        # page revalidation must not resurrect a stale Identity form.
        if self.path == "/auth/session" and getattr(self.server, "auth_session_race_for_test", False):
            with self.server.auth_race_lock:
                self.server.auth_race_requests += 1
                attempt = self.server.auth_race_requests
            if attempt == 1:
                time.sleep(0.8)
                code = 200
                payload = {"$schema": "prototype-ordax.public-identity-session/1",
                           "provider": "supabase", "authenticated": False, "status": "anonymous"}
            else:
                code = 503
                payload = {"error": "service-unavailable"}
            content = json.dumps(payload).encode("utf-8")
            try:
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass  # A superseded fetch is allowed to abort on the client.
            return
        # Redirect-based session forgery exists only in this loopback proof.
        # Even a 200 JSON served at a different same-origin route is not the
        # canonical /auth/session response; the browser must reject it.
        if getattr(self.server, "auth_session_redirect_for_test", False):
            if self.path == "/auth/session":
                self.send_response(302)
                self.send_header("Location", "/__test_redirected_identity.json")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            if self.path == "/__test_redirected_identity.json":
                payload = {
                    "$schema": "prototype-ordax.public-identity-session/1",
                    "provider": "supabase",
                    "status": "authenticated",
                    "authenticated": True,
                    "subject": "synthetic-test-subject",
                    "email": "redirect-attacker@example.test",
                }
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
        # Synthetic fixture attacks exist only inside this loopback proof:
        # no signed public asset is changed or duplicated.
        fixture_attack = getattr(self.server, "fixture_attack_for_test", None)
        if self.path == "/assets/playground-fixture.json" and fixture_attack:
            if fixture_attack == "redirect":
                self.send_response(302)
                self.send_header("Location", "/assets/playground-fixture.json?untrusted=1")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            raw = ((Path(self.directory) / "assets/playground-fixture.json").read_bytes()
                   if fixture_attack == "wrong-mime"
                   else b'{"padding":"' + b"x" * 550000 + b'"}')
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/plain" if fixture_attack == "wrong-mime"
                                 else "application/json")
                self.send_header("Cache-Control", "no-store")
                if fixture_attack != "oversized":
                    self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        # Negative download-contract responses exist only inside this loopback
        # browser proof. Never modify the verified build or publish a fixture.
        catalog_override = getattr(self.server, "catalog_override", None)
        manifest_override = getattr(self.server, "manifest_override", None)
        payload = (catalog_override if self.path == "/releases/catalog.json"
                   else manifest_override if self.path == "/public-site-manifest.json"
                   else None)
        if payload is not None:
            content = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)
            return
        if self.path.startswith(("/auth/", "/account/", "/api/", "/sync/")):
            self.send_response(503)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b'{"error":"service-unavailable"}')
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()


def free_port():
    with socket.socket() as connection:
        connection.bind(("127.0.0.1", 0))
        return connection.getsockname()[1]


class Driver:
    def __init__(self, port: int):
        self.base = f"http://127.0.0.1:{port}"
        self.session_id = None

    def command(self, method: str, suffix: str, payload=None):
        req = urllib.request.Request(
            self.base + suffix,
            data=(json.dumps(payload).encode("utf-8") if payload is not None else None),
            headers={"Content-Type": "application/json"},
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                result = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            content = exc.read().decode("utf-8", "replace")
            raise BrowserProofError(f"{method} {suffix}: {exc.code} {content[:500]}") from exc
        if isinstance(result.get("value"), dict) and result["value"].get("error"):
            raise BrowserProofError(str(result["value"]))
        return result.get("value")

    def create(self, chrome_binary: str | None = None):
        chrome_options = {"args": [
            "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
            "--disable-gpu", "--no-first-run", "--no-default-browser-check",
            "--window-size=1440,900",
        ]}
        if chrome_binary:
            chrome_options["binary"] = chrome_binary
        response = self.command("POST", "/session", {
            "capabilities": {"alwaysMatch": {
                "browserName": "chrome",
                "goog:chromeOptions": chrome_options,
            }}
        })
        # W3C response returns {sessionId,capabilities} under value.
        self.session_id = response["sessionId"]
        self.command("POST", f"/session/{self.session_id}/timeouts", {
            "pageLoad": 30000, "script": 15000, "implicit": 0
        })
        # Install before any Site script runs. A syntactically broken module
        # must not pass merely because its static HTML still looks correct.
        self.cdp("Page.addScriptToEvaluateOnNewDocument", {"source": r"""
          window.__ordaxPageErrors = [];
          addEventListener('error', event => {
            if (event.target && event.target !== window) {
              const resource = event.target.src || event.target.href || event.target.tagName;
              window.__ordaxPageErrors.push('resource: ' + String(resource).slice(0, 180));
            } else {
              window.__ordaxPageErrors.push('script: ' +
                String(event.message || 'unknown').slice(0, 180));
            }
          }, true);
          addEventListener('unhandledrejection', event => {
            window.__ordaxPageErrors.push('promise: ' +
              String(event.reason?.message || event.reason || 'unknown').slice(0, 180));
          });
        """})

    def run(self, script: str):
        return self.command("POST", f"/session/{self.session_id}/execute/sync", {
            "script": script, "args": []
        })

    def cdp(self, cmd: str, params: dict):
        return self.command("POST", f"/session/{self.session_id}/goog/cdp/execute", {
            "cmd": cmd, "params": params
        })

    def navigate(self, url: str):
        self.command("POST", f"/session/{self.session_id}/url", {"url": url})

    def press(self, value: str):
        # W3C hardware keyboard action, not a DOM .click() substitute.
        self.command("POST", f"/session/{self.session_id}/actions", {
            "actions": [{"type": "key", "id": "keyboard", "actions": [
                {"type": "keyDown", "value": value},
                {"type": "keyUp", "value": value},
            ]}]
        })
        self.command("DELETE", f"/session/{self.session_id}/actions")

    def shot(self, destination: Path):
        content = self.command("GET", f"/session/{self.session_id}/screenshot")
        destination.write_bytes(base64.b64decode(content))

    def close(self):
        if self.session_id:
            try:
                self.command("DELETE", f"/session/{self.session_id}")
            except (BrowserProofError, OSError):
                pass


def probe(driver: Driver, route: str, width: int, height: int) -> dict:
    return driver.run(r"""return (() => {
      const route = location.pathname;
      const $ = s => document.querySelector(s);
      const body = document.body;
      const main = $('main');
      const header = $('header.site-header');
      const heroCopy = route === '/' ? $('.hero-copy') : null;
      const heroCopyStyle = heroCopy ? getComputedStyle(heroCopy) : null;
      const compactDemoInput = route !== '/' ? null : (() => {
        const stage = $('[data-demo-stage]');
        const coarse = matchMedia('(any-pointer: coarse)').matches;
        const precise = matchMedia('(any-pointer: fine)').matches;
        return {
          present: !!stage, coarse, precise,
          inert: stage?.inert === true,
          valid: !!stage && stage.inert === (coarse && !precise)
        };
      })();
      const landingPhoneEntrance = route !== '/' ? null : (() => {
        const phone = $('.playground .phone-device');
        const animation = phone?.getAnimations().find(item =>
          item.animationName === 'phone-enter');
        if (!phone || !animation) return {checked: false, fits: false};
        const previousTime = animation.currentTime;
        const previousState = animation.playState;
        animation.pause();
        animation.currentTime = 0;
        const rect = phone.getBoundingClientRect();
        const viewportWidth = visualViewport?.width || innerWidth;
        const documentWidth = document.documentElement.scrollWidth;
        const result = {
          checked: true,
          fits: rect.left >= -1 && rect.right <= viewportWidth + 1 &&
            documentWidth <= viewportWidth + 1,
          phoneLeft: Math.round(rect.left * 10) / 10,
          phoneRight: Math.round(rect.right * 10) / 10,
          viewportWidth,
          documentWidth
        };
        if (previousTime !== null) animation.currentTime = previousTime;
        if (previousState === 'running') animation.play();
        else if (previousState === 'finished') animation.finish();
        else animation.pause();
        return result;
      })();
      const headerBrand = header?.querySelector(':scope > .brand') ||
        header?.querySelector(':scope > a:first-child');
      const headerActions = header?.querySelector(':scope > .site-actions');
      const headerNav = header?.querySelector(':scope > .site-nav');
      const headerTools = headerNav?.querySelector(':scope > .site-nav-tools');
      const navLinksContainer = headerNav?.querySelector(':scope > .site-nav-links');
      const localeSelect = header?.querySelector('[data-public-locale-select]');
      const navToggle = headerActions?.querySelector(':scope > [data-public-nav-toggle]');
      const headerBrandBox = headerBrand?.getBoundingClientRect();
      const headerActionsBox = headerActions?.getBoundingClientRect();
      const localeBox = localeSelect?.getBoundingClientRect();
      const compactHeader = !!navToggle && getComputedStyle(navToggle).display !== 'none';
      const pageIntro = main?.matches('.page-shell')
        ? main.querySelector(':scope > .page-hero > .eyebrow') : null;
      const publicPageStartGap = pageIntro && header
        ? Math.round(pageIntro.getBoundingClientRect().top - header.getBoundingClientRect().bottom)
        : null;
      const renderedInsideViewport = element => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility === 'visible' && Number(style.opacity) > 0 &&
          rect.left >= -2 && rect.right <= innerWidth + 2 &&
          rect.top >= -2 && rect.bottom <= innerHeight + 2;
      };
      const headerBrandText = headerBrand?.querySelector('.brand-name');
      const publicHeaderRegionsVisible = route === '/conta/' || !header ||
        (renderedInsideViewport(headerBrand) && renderedInsideViewport(headerBrandText) &&
          !!headerBrandText.textContent.trim() && renderedInsideViewport(headerActions) &&
          (compactHeader
            ? renderedInsideViewport(navToggle) && getComputedStyle(headerNav).display === 'none'
            : renderedInsideViewport(headerNav) && renderedInsideViewport(localeSelect) &&
              renderedInsideViewport(navLinksContainer)));
      const box = element => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          top: Math.round(rect.top), left: Math.round(rect.left),
          width: Math.round(rect.width), height: Math.round(rect.height),
          display: style.display, visibility: style.visibility, color: style.color,
          background: style.backgroundColor
        };
      };
      const publicHeaderLocalePresentation = route === '/conta/' || !header ||
        (compactHeader
          ? headerNav.contains(localeSelect) && getComputedStyle(headerNav).display === 'none' &&
            !renderedInsideViewport(localeSelect)
          : renderedInsideViewport(localeSelect) && renderedInsideViewport(navLinksContainer) &&
            [...navLinksContainer.querySelectorAll(':scope > a')].some(link => {
          const box = link.getBoundingClientRect();
          return Math.abs((box.top + box.height / 2) - (localeBox.top + localeBox.height / 2)) <= 4;
        }));
      const publicHeaderMobileLocaleInDisclosure = route === '/conta/' || !header || !compactHeader ||
        (headerNav.contains(localeSelect) && navToggle.parentElement === headerActions);
      const publicHeaderBrandActionsDoNotOverlap = route === '/conta/' || !header ||
        (renderedInsideViewport(headerBrand) && renderedInsideViewport(headerActions) &&
          !!headerBrandBox && !!headerActionsBox &&
          headerActionsBox.left - headerBrandBox.right >= 4);
      const publicHeaderBrandContentFits = route === '/conta/' || !header || (() => {
        if (!headerBrand || headerBrand.scrollWidth > headerBrand.clientWidth + 1) return false;
        const brandBox = headerBrand.getBoundingClientRect();
        return [...headerBrand.children].every(child => {
          const rect = child.getBoundingClientRect();
          return rect.left >= brandBox.left - 1 && rect.right <= brandBox.right + 1 &&
            child.scrollWidth <= child.clientWidth + 1;
        });
      })();
      const publicHeaderActionsFit = route === '/conta/' || !header || (() => {
        if (!headerActions || headerActions.scrollWidth > headerActions.clientWidth + 1) return false;
        const actionsBox = headerActions.getBoundingClientRect();
        return [...headerActions.children].filter(child => getComputedStyle(child).display !== 'none')
          .every(child => {
            const rect = child.getBoundingClientRect();
            const children = child.matches('.site-auth-actions') ? [...child.children] : [];
            const groupBox = child.getBoundingClientRect();
            return rect.left >= actionsBox.left - 1 && rect.right <= actionsBox.right + 1 &&
              child.scrollWidth <= child.clientWidth + 1 && children.every(link => {
                const linkBox = link.getBoundingClientRect();
                return linkBox.left >= groupBox.left - 1 && linkBox.right <= groupBox.right + 1 &&
                  link.scrollWidth <= link.clientWidth + 1;
              });
          });
      })();
      const mobileNavigationDisclosureReady = route === '/conta/' || !header || !compactHeader ||
        (renderedInsideViewport(navToggle) && navLinksContainer &&
          navToggle.parentElement === headerActions &&
          navToggle.getAttribute('aria-controls') === headerNav.id &&
          navToggle.getAttribute('aria-expanded') === 'false' &&
          headerNav.dataset.expanded === 'false' &&
          getComputedStyle(headerNav).display === 'none' &&
          !renderedInsideViewport(localeSelect));
      const accountTopbar = route === '/conta/' ? body.querySelector('.topbar') : null;
      const accountTopbarActions = accountTopbar?.querySelector('.topbar-actions');
      const accountTopbarFitsViewport = !accountTopbar || (() => {
        const topbarBox = accountTopbar.getBoundingClientRect();
        const actionsBox = accountTopbarActions?.getBoundingClientRect();
        return !!actionsBox && topbarBox.left >= -1 && topbarBox.right <= innerWidth + 1 &&
          actionsBox.left >= topbarBox.left - 1 && actionsBox.right <= topbarBox.right + 1 &&
          actionsBox.top >= topbarBox.top - 1 && actionsBox.bottom <= topbarBox.bottom + 1 &&
          accountTopbar.scrollWidth <= accountTopbar.clientWidth + 1;
      })();
      const accountMobileNavigationLabelsFit = route !== '/conta/' || (() => {
        const nav = body.querySelector('.mobile-nav');
        if (!nav || getComputedStyle(nav).display === 'none') return true;
        const items = [...nav.querySelectorAll(':scope > a, :scope > button')];
        const boxes = items.map(item => {
          const label = item.querySelector(':scope > span');
          if (!label) return null;
          const target = item.getBoundingClientRect();
          const text = label.getBoundingClientRect();
          return {target, text};
        });
        return boxes.length === 5 && boxes.every(box => box &&
          box.target.width >= 44 && box.target.height >= 44 && box.text.width > 0 &&
          box.text.left >= box.target.left - 1 &&
          box.text.right <= box.target.right + 1) &&
          boxes.slice(1).every((box, index) =>
            boxes[index].text.right <= box.text.left + 1);
      })();
      const accountMobileFooterClearance = route !== '/conta/' ? null : (() => {
        const nav = body.querySelector('.mobile-nav');
        const footer = body.querySelector('.page-footer');
        const expected = innerWidth <= 640 ||
          (matchMedia('(any-pointer: coarse)').matches && innerWidth <= 1180);
        if (!expected) return {checked:false, clear:true, clearance:null};
        if (!nav || !footer || getComputedStyle(nav).display === 'none') {
          return {checked:true, clear:false, clearance:null};
        }
        const navStyle = getComputedStyle(nav);
        const navBox = nav.getBoundingClientRect();
        const footerBox = footer.getBoundingClientRect();
        const maximumScrollY = Math.max(0,
          document.documentElement.scrollHeight - innerHeight);
        const footerBottomAtPageEnd = footerBox.bottom + scrollY - maximumScrollY;
        const clearance = navBox.top - footerBottomAtPageEnd;
        return {
          checked:true,
          clear:navStyle.position === 'fixed' && navBox.height > 0 && clearance >= -1,
          clearance:Math.round(clearance),
        };
      })();
      const footer = $('footer.site-footer');
      const footerLinks = footer ? [...footer.querySelectorAll('a')] : [];
      const footerBox = footer?.getBoundingClientRect();
      const forms = [...document.querySelectorAll('form.identity-form')];
      const visibleAuthForms = forms.filter(x => !x.hidden);
      const readyControls = forms.flatMap(f => [...f.querySelectorAll('input[type=password],button[type=submit]')]).filter(x => !x.disabled);
      const els = [...document.querySelectorAll('[id]')];
      const ids = els.map(e => e.id);
      const controls = [...document.querySelectorAll('a[href],button,input,select,textarea')].filter(e => {
        const box = e.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(e).visibility !== 'hidden';
      });
      const undersizedInteractiveTargets = controls.filter(e => {
        const style = getComputedStyle(e);
        const inlineTextLink = e.matches('a[href]') && style.display === 'inline' && e.closest('p');
        return !e.closest('.playground, [hidden], [aria-hidden="true"], dialog:not([open]), details:not([open])') &&
          !e.disabled && !inlineTextLink &&
          (e.getBoundingClientRect().width < 44 || e.getBoundingClientRect().height < 44);
      }).slice(0, 8).map(e => {
        const rect = e.getBoundingClientRect();
        return {tag: e.tagName.toLowerCase(), text: e.textContent.trim().slice(0, 60),
          width: Math.round(rect.width), height: Math.round(rect.height)};
      });
      const undersizedAAInteractiveTargets = controls.filter(e => {
        const style = getComputedStyle(e);
        const inlineTextLink = e.matches('a[href]') && style.display === 'inline' && e.closest('p');
        return !e.closest('.playground, [hidden], [aria-hidden="true"], dialog:not([open]), details:not([open])') &&
          !e.disabled && !inlineTextLink &&
          (e.getBoundingClientRect().width < 24 || e.getBoundingClientRect().height < 24);
      }).slice(0, 8).map(e => {
        const rect = e.getBoundingClientRect();
        return {tag: e.tagName.toLowerCase(), text: e.textContent.trim().slice(0, 60),
          width: Math.round(rect.width), height: Math.round(rect.height)};
      });
      const nameless = controls.filter(e => {
        if (e.getAttribute('aria-hidden') === 'true' || e.disabled) return false;
        if (e.matches('input[type=hidden]')) return false;
        const name = e.getAttribute('aria-label') || e.getAttribute('title') ||
          (e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]')?.textContent) ||
          e.closest('label')?.textContent || e.textContent || e.getAttribute('alt');
        return !String(name || '').trim() && !e.querySelector('img[alt]');
      }).slice(0, 6).map(e => e.outerHTML.slice(0, 200));
      const unlabeledImages = [...document.querySelectorAll('img:not([alt])')].filter(x =>
        x.getBoundingClientRect().width > 0).map(x => x.outerHTML.slice(0, 200)).slice(0, 8);
      const resources = performance.getEntriesByType('resource');
      const unexpectedRemote = resources
        .map(x => x.name).filter(x => !x.startsWith(location.origin) && !x.startsWith('data:'));
      const failedStaticAssets = resources.filter(x => {
        if (x.responseStatus < 400) return false;
        const path = new URL(x.name, location.href).pathname;
        // Identity endpoints deliberately respond 503 in this offline proof.
        return !['/auth/', '/account/', '/api/', '/sync/'].some(prefix =>
          path.startsWith(prefix));
      }).map(x => ({url: x.name.slice(0, 180), status: x.responseStatus})).slice(0, 8);
      const overflowElements = [...document.querySelectorAll('body *')].filter(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.right > innerWidth + 2 &&
          rect.left < innerWidth && style.display !== 'none' &&
          style.visibility !== 'hidden' && style.position !== 'fixed';
      }).slice(0, 18).map(el => {
        const r = el.getBoundingClientRect();
        return {tag:el.tagName.toLowerCase(), className:String(el.className?.baseVal || el.className || '').slice(0, 100),
          width:Math.round(r.width), left:Math.round(r.left), right:Math.round(r.right)};
      });
      const session = $('[data-identity-state],#account-session,[data-web-state]');
      return {
        pathname: route,
        width: innerWidth,
        height: innerHeight,
        title: document.title,
        lang: document.documentElement.lang,
        complete: document.readyState === 'complete',
        main: !!main,
        mainCount: document.querySelectorAll('main').length,
        mainH1Count: [...document.querySelectorAll('main h1')].filter(h => !h.closest('.playground, [aria-hidden="true"]')).length,
        landingHeroCopyVisible: !heroCopy || (heroCopyStyle.opacity === '1' &&
          heroCopyStyle.visibility === 'visible' && heroCopyStyle.display !== 'none'),
        landingHeroCopyHasNoEntranceAnimation: !heroCopy || heroCopyStyle.animationName === 'none',
        landingPhoneEntrance,
        compactDemoInput,
        skip: !!$('.skip-link[href^="#"]'),
        publicHeaderRegionsReady: route === '/conta/' || !header ||
          (!!headerBrand && !!headerActions && !!headerNav && !!navLinksContainer && !!localeSelect),
        publicHeaderRegionsVisible,
        accountTopbarFitsViewport,
        accountMobileNavigationLabelsFit,
        accountMobileFooterClearance,
        publicHeaderBrandActionsShareRow: route === '/conta/' || !header ||
          (renderedInsideViewport(headerBrand) && renderedInsideViewport(headerActions) &&
            !!headerBrandBox && !!headerActionsBox &&
            Math.abs((headerBrandBox.top + headerBrandBox.height / 2) -
              (headerActionsBox.top + headerActionsBox.height / 2)) <= 6),
        publicHeaderBrandActionsDoNotOverlap,
        publicHeaderBrandContentFits,
        publicHeaderActionsFit,
        publicHeaderLocalePresentation,
        publicHeaderMobileLocaleInDisclosure,
        publicMobileNavigationDisclosureReady: mobileNavigationDisclosureReady,
        publicPageStartGap,
        publicPageStartSpacingReady: publicPageStartGap === null ||
          (publicPageStartGap >= 0 && publicPageStartGap <= 64),
        publicHeaderLayout: !header ? null : {
          header: box(header), brand: box(headerBrand), actions: box(headerActions),
          brandActionsGap: headerBrandBox && headerActionsBox
            ? Math.round(headerActionsBox.left - headerBrandBox.right) : null,
          navigation: box(headerNav),
          tools: box(headerTools),
          locale: box(localeSelect), toggle: box(navToggle),
          links: box(navLinksContainer), expanded: headerNav?.dataset.expanded
        },
        sharedFooterContract: route === '/conta/'
          ? !footer && !!$('footer.page-footer')
          : !!footer,
        sharedFooterLayout: footer ? getComputedStyle(footer).display : null,
        sharedFooterResponsiveLayout: !footer || getComputedStyle(footer).display ===
          (innerWidth <= 600 ? 'grid' : 'flex'),
        sharedFooterFitsViewport: !footer || (footerBox.left >= -2 && footerBox.right <= innerWidth + 2
          && footer.scrollWidth <= footer.clientWidth + 2),
        sharedFooterLinksHaveComfortableTargets: !footer || footerLinks.every(link =>
          link.getBoundingClientRect().width >= 44 && link.getBoundingClientRect().height >= 44),
        undersizedInteractiveTargets,
        undersizedAAInteractiveTargets,
        noOverflow: document.documentElement.scrollWidth <= innerWidth + 2,
        scrollWidth: document.documentElement.scrollWidth,
        overflowElements,
        duplicateIds: ids.length !== new Set(ids).size,
        nameless,
        unlabeledImages,
        remoteResources: unexpectedRemote,
        failedStaticAssets,
        runtimeErrors: (window.__ordaxPageErrors || ['browser-error-monitor-missing']).slice(0, 10),
        authFormCount: forms.length,
        exposedAuthForms: visibleAuthForms.length,
        enabledCredentials: readyControls.length,
        sessionStatus: session?.dataset?.status || null,
        accountHasVerifiedUser: !!document.querySelector('[data-verified-user]') ||
          [...document.querySelectorAll('.verified-email')].some(x => x.textContent.includes('@')),
        landingFixturePresent: !!document.querySelector('.playground[data-fixture-ready="true"]') &&
          !!document.querySelector('.playground .demo-native'),
        accountPortal: !!document.querySelector('#account-app'),
        interactiveCount: controls.length
      };
    })();""")


def accessibility_probe(driver: Driver) -> dict:
    """Read the browser accessibility tree and exercise real keyboard navigation."""
    ax = driver.cdp("Accessibility.getFullAXTree", {})
    interactive = {"button", "link", "textbox", "searchbox", "combobox",
                   "checkbox", "radio", "switch"}
    missing_names = []
    for node in ax.get("nodes", []):
        role = node.get("role", {}).get("value", "")
        if (not node.get("ignored", False) and role in interactive
                and not str(node.get("name", {}).get("value", "")).strip()):
            missing_names.append({
                "role": role,
                "backendDOMNodeId": node.get("backendDOMNodeId"),
            })
    # Once per page, exercise the first focusable keyboard target and the
    # actual Enter activation instead of assuming that the skip link works.
    driver.press("\ue004")
    # The actual focus-reveal animation has a 180ms CSS transition.
    time.sleep(0.25)
    first = driver.run("""return (() => {
      const focused = document.activeElement;
      const rect = focused?.getBoundingClientRect();
      const styles = focused && getComputedStyle(focused);
      return {
        skipFocused: focused?.matches?.('.skip-link[href="#conteudo"]') || false,
        focusVisible: Boolean(rect && rect.width > 0 && rect.height > 0
          && rect.bottom > 0 && rect.top < innerHeight
          && styles.visibility !== 'hidden'),
      };
    })();""")
    driver.press("\ue007")
    time.sleep(0.1)
    destination = driver.run("""return {
      hash: location.hash,
      mainFocus: document.activeElement?.id === 'conteudo',
      mainExists: !!document.querySelector('#conteudo'),
    };""")
    return {
        "accessibilityTreeUnnamedControls": missing_names[:12],
        "skipLinkFirstKeyboardTarget": first["skipFocused"],
        "skipLinkVisibleOnFocus": first["focusVisible"],
        "skipLinkDestination": destination["mainExists"] and
          (destination["hash"] == "#conteudo" or destination["mainFocus"]),
        "skipLinkFocusLandsOnMain": destination["mainFocus"],
    }


def restore_capture_state(driver: Driver, route: str) -> dict:
    """Remove keyboard-test focus and fragment before saving the normal screenshot."""
    state = driver.run(r"""const expectedRoute = '""" + route + r"""';
      const skipLink = document.querySelector('.skip-link');
      const main = document.querySelector('main#conteudo');
      document.activeElement?.blur();
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      window.scrollTo({left: 0, top: 0, behavior: 'instant'});
      return {
        route: location.pathname,
        expectedRoute,
        noSkipLinkFocus: !skipLink || !skipLink.matches(':focus'),
        mainExists: !!main,
        noTestFragment: location.hash === '',
        atTop: window.scrollY === 0
      };""")
    # The skip link animates out for 180ms after blur. Let it clear before the
    # screenshot so the accessibility probe cannot cover the shared brand.
    time.sleep(0.25)
    state["skipLinkHidden"] = driver.run(r"""const link = document.querySelector('.skip-link');
      if (!link) return true;
      const rect = link.getBoundingClientRect();
      return getComputedStyle(link).visibility === 'hidden' || rect.bottom <= 0;""")
    return state


def apply_public_locale(driver: Driver, locale: str) -> dict:
    """Select a supported language and report its native labels and lang tags."""
    requested = json.dumps(locale)
    return driver.run(r"""return (() => {
      const requested = """ + requested + r""";
      const selector = document.querySelector('[data-public-locale-select]');
      const runtime = window.OrdaXPublicI18n;
      const toggle = document.querySelector('[data-public-nav-toggle]');
      if (!selector || !runtime) return {ready:false};
      selector.value = requested;
      selector.dispatchEvent(new Event('change', {bubbles:true}));
      const options = [...selector.options].map(option => ({
        value: option.value, lang: option.lang, label: option.textContent.trim(),
      }));
      const expected = [
        {value:'pt-BR', lang:'pt-BR', label:'Português'},
        {value:'en-US', lang:'en-US', label:'English'},
      ];
      return {
        ready:true,
        language:document.documentElement.lang,
        stored:localStorage.getItem('ordax.public.locale'),
        selected:selector.value,
        accessibleName:selector.getAttribute('aria-label'),
        navigationLabels: {
          primary:document.querySelector('header.site-header > nav.site-nav')?.getAttribute('aria-label') || null,
          footer:document.querySelector('footer.site-footer nav')?.getAttribute('aria-label') || null,
        },
        skip:document.querySelector('.skip-link')?.textContent?.trim(),
        menu:toggle?.querySelector('span')?.textContent?.trim(),
        toggleLabel:toggle?.getAttribute('aria-label'),
        languageNamesAndTags:options.length === expected.length &&
          expected.every(wanted => options.some(option =>
            option.value === wanted.value && option.lang === wanted.lang &&
            option.label === wanted.label)),
      };
    })();""")


def localization_probe(driver: Driver) -> dict:
    """Exercise real locale changes, self-named languages, and accessibility labels."""
    english = apply_public_locale(driver, "en-US")
    portuguese = apply_public_locale(driver, "pt-BR")
    account_route = driver.run("return location.pathname === '/conta/'")
    return {
        "selector": english.get("ready") and portuguese.get("ready"),
        "english": english.get("language") == "en-US"
            and english.get("selected") == "en-US"
            and english.get("stored") == "en-US"
            and english.get("accessibleName") == "Language"
            and english.get("skip") == "Skip to content",
        "portuguese": portuguese.get("language") == "pt-BR"
            and portuguese.get("selected") == "pt-BR"
            and portuguese.get("stored") == "pt-BR"
            and portuguese.get("accessibleName") == "Idioma"
            and portuguese.get("skip") == "Ir para o conteúdo",
        "persistence": portuguese.get("stored") == "pt-BR",
        "languageNamesAndTags": english.get("languageNamesAndTags")
            and portuguese.get("languageNamesAndTags"),
        "menuEnglish": account_route or (english.get("menu") == "Menu"
            and english.get("toggleLabel") == "Toggle primary navigation"),
        "menuPortuguese": account_route or (portuguese.get("menu") == "Menu"
            and portuguese.get("toggleLabel") == "Alternar navegação principal"),
    }


def mobile_navigation_interaction_probe(driver: Driver) -> dict:
    """Exercise the mobile disclosure, locale control, Escape, and focus restoration."""
    return driver.run(r"""return (() => {
      const nav = document.querySelector('.site-header > .site-nav');
      const linksContainer = nav?.querySelector(':scope > .site-nav-links');
      const actions = document.querySelector('.site-header > .site-actions');
      const button = actions?.querySelector(':scope > [data-public-nav-toggle]');
      const locale = nav?.querySelector('[data-public-locale-select]');
      const localeLabel = nav?.querySelector('[data-public-locale-label]');
      const links = linksContainer ? [...linksContainer.querySelectorAll(':scope > a')] : [];
      if (!nav || !linksContainer || !actions || !button || !locale || !links.length) return {
        buttonPresent: false, startsCollapsed: false, opensLinks: false,
        localeLivesInDisclosure: false, localeLabelVisibleWhenOpen: false,
        localeCanSwitchInsideDisclosure: false, menuPanelFitsViewport: false,
        escapeClosesAndRestoresFocus: false
      };
      const startsCollapsed = button.parentElement === actions &&
        button.getAttribute('aria-controls') === nav.id &&
        button.getAttribute('aria-expanded') === 'false' && nav.dataset.expanded === 'false' &&
        getComputedStyle(nav).display === 'none' && locale.getBoundingClientRect().width === 0;
      button.focus();
      button.click();
      const opensLinks = button.getAttribute('aria-expanded') === 'true' && nav.dataset.expanded === 'true' &&
        getComputedStyle(nav).display !== 'none' && getComputedStyle(linksContainer).display === 'grid' &&
        links.every(link => getComputedStyle(link).display !== 'none');
      const navBox = nav.getBoundingClientRect();
      const menuPanelFitsViewport = navBox.left >= -1 &&
        navBox.right <= document.documentElement.clientWidth + 1 &&
        nav.scrollWidth <= nav.clientWidth + 1;
      const localeLivesInDisclosure = nav.contains(locale) && locale.getBoundingClientRect().width > 0;
      const localeLabelVisibleWhenOpen = !!localeLabel &&
        getComputedStyle(localeLabel).position !== 'absolute' &&
        localeLabel.getBoundingClientRect().width > 0 && localeLabel.textContent.trim().length > 0;
      const initialLocale = document.documentElement.lang;
      locale.value = initialLocale === 'en-US' ? 'pt-BR' : 'en-US';
      locale.dispatchEvent(new Event('change', {bubbles: true}));
      const localeCanSwitchInsideDisclosure = document.documentElement.lang === locale.value;
      locale.value = initialLocale;
      locale.dispatchEvent(new Event('change', {bubbles: true}));
      links[0].focus();
      links[0].dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      const escapeClosesAndRestoresFocus = button.getAttribute('aria-expanded') === 'false' &&
        nav.dataset.expanded === 'false' && document.activeElement === button &&
        getComputedStyle(nav).display === 'none';
      return {buttonPresent: true, startsCollapsed, opensLinks, localeLivesInDisclosure,
        localeLabelVisibleWhenOpen, localeCanSwitchInsideDisclosure, menuPanelFitsViewport,
        escapeClosesAndRestoresFocus};
    })();""")


def mobile_account_navigation_interaction_probe(driver: Driver) -> dict:
    """Exercise the account overflow dialog with hardware keyboard input."""
    before = driver.run("""const button=document.querySelector('#more-toggle');
      const dialog=document.querySelector('#more-dialog');
      return {buttonPresent:!!button, dialogPresent:!!dialog,
        startsCollapsed:!!button && !!dialog && !dialog.open &&
          button.getAttribute('aria-expanded')==='false',
        controlsDialog:!!button && !!dialog && button.getAttribute('aria-controls')===dialog.id,
        dialogNamed:!!dialog && dialog.getAttribute('aria-labelledby')==='more-title' &&
          !!document.getElementById('more-title')?.textContent.trim()};""")
    if not before["buttonPresent"] or not before["dialogPresent"]:
        return {**before, "keyboardOpensDialog": False,
                "focusMovesIntoDialog": False, "hasOverflowLinks": False,
                "escapeClosesAndRestoresFocus": False}

    driver.run("document.querySelector('#more-toggle').focus()")
    driver.press("\uE007")
    opened = {}
    for _ in range(20):
        opened = driver.run("""const button=document.querySelector('#more-toggle');
          const dialog=document.querySelector('#more-dialog');
          return {open:dialog.open, expanded:button.getAttribute('aria-expanded'),
            focusInside:dialog.contains(document.activeElement),
            links:dialog.querySelectorAll('#more-navigation a').length};""")
        if opened["open"]:
            break
        time.sleep(0.05)

    driver.press("\uE00C")
    closed = {}
    for _ in range(20):
        closed = driver.run("""const button=document.querySelector('#more-toggle');
          const dialog=document.querySelector('#more-dialog');
          return {open:dialog.open, expanded:button.getAttribute('aria-expanded'),
            focusRestored:document.activeElement===button};""")
        if not closed["open"] and closed["expanded"] == "false":
            break
        time.sleep(0.05)

    return {
        **before,
        "keyboardOpensDialog": opened.get("open") is True and opened.get("expanded") == "true",
        "focusMovesIntoDialog": opened.get("focusInside") is True,
        "hasOverflowLinks": opened.get("links", 0) > 0,
        "escapeClosesAndRestoresFocus": not closed.get("open", True)
            and closed.get("expanded") == "false" and closed.get("focusRestored") is True,
    }


def solid_surface_contrast_probe(driver: Driver) -> dict:
    """Measure WCAG 2.x text contrast only when the visible backing is a flat color.

    Gradients, images, alpha effects, decorative demo, and pseudo elements are
    out of scope; never treat an unverifiable surface as a passing measurement.
    """
    return driver.run(r"""return (() => {
      const parse = raw => {
        const value = String(raw).trim();
        const legacy = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\s*\)$/i);
        if (legacy) return [+legacy[1], +legacy[2], +legacy[3], legacy[4] == null ? 1 : +legacy[4]];

        // Modern browsers may serialize computed RGB colors as color(srgb ...).
        // CSS Color 4 also defines srgb-linear; convert it to encoded sRGB before
        // applying the WCAG relative-luminance formula below.
        const modern = value.match(/^color\(\s*(srgb|srgb-linear)\s+(.+)\)$/i);
        if (!modern) return null;
        const [components, alphaValue] = modern[2].split('/').map(part => part.trim());
        const channels = components.split(/\s+/);
        if (channels.length !== 3 || channels.some(channel => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(channel))) return null;
        if (alphaValue != null && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(alphaValue)) return null;
        const normalized = channels.map(channel => {
          const parsed = Number.parseFloat(channel);
          return Math.max(0, Math.min(1, channel.endsWith('%') ? parsed / 100 : parsed));
        });
        const encoded = modern[1].toLowerCase() === 'srgb-linear'
          ? normalized.map(channel => channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055)
          : normalized;
        const alpha = alphaValue == null ? 1 : Number.parseFloat(alphaValue) / (alphaValue.endsWith('%') ? 100 : 1);
        return [...encoded.map(channel => channel * 255), Math.max(0, Math.min(1, alpha))];
      };
      const blend = (front, back) => {
        const a = front[3];
        return [front[0]*a + back[0]*(1-a),
                front[1]*a + back[1]*(1-a),
                front[2]*a + back[2]*(1-a), 1];
      };
      const luminance = rgb => {
        const linear = rgb.slice(0,3).map(v => {
          const c=v/255; return c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4;
        });
        return 0.2126*linear[0] + 0.7152*linear[1] + 0.0722*linear[2];
      };
      const ratio = (a,b) => {
        const [high,low]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
        return (high+0.05)/(low+0.05);
      };
      // Audit every visible DOM text owner, rather than maintaining a selector
      // list that can silently miss newly added headings, labels, or notices.
      const nodes = [...document.querySelectorAll('body *')];
      const failed = [], unchecked = {}, uncheckedItems = [];
      const uncheckedExampleLimit = 24;
      let measured = 0;
      const describe = el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0,5) : [],
        text: el.textContent.trim().replace(/\s+/g, ' ').slice(0,90),
      });
      const skip = (why, el, details={}) => {
        unchecked[why] = (unchecked[why] || 0) + 1;
        if (uncheckedItems.length < uncheckedExampleLimit) {
          const style = getComputedStyle(el);
          uncheckedItems.push({reason:why, ...describe(el), foreground:style.color, ...details});
        }
      };
      for (const el of nodes) {
        if (!Array.from(el.childNodes).some(n => n.nodeType===Node.TEXT_NODE && n.textContent.trim())) continue;
        const style=getComputedStyle(el);
        const rect=el.getBoundingClientRect();
        if (el.closest('[hidden], [aria-hidden="true"], .demo-native, .playground') ||
            rect.width<1 || rect.height<1 || style.visibility!=='visible' ||
            style.display==='none' || Number(style.opacity)<1 ||
            rect.right<=0 || rect.bottom<=0 || rect.left>=innerWidth || rect.top>=innerHeight) continue;
        const chain=[];
        for(let p=el; p; p=p.parentElement) chain.unshift(p);
        let background=[255,255,255,1], unmeasurable=false;
        for (const n of chain) {
          const css=getComputedStyle(n);
          if (css.backgroundImage!=='none') {
            skip('image-or-gradient', el, {
              backgroundOwner: describe(n),
              backgroundImage: css.backgroundImage.slice(0,180),
            });
            unmeasurable=true;break;
          }
          if (Number(css.opacity)<1 || css.mixBlendMode!=='normal' || css.filter!=='none') {
            skip('layer-compositing', el, {
              compositingOwner: describe(n),
              opacity: css.opacity,
              mixBlendMode: css.mixBlendMode,
              filter: css.filter,
            });
            unmeasurable=true;break;
          }
          const bg=parse(css.backgroundColor);
          if (!bg){skip('unknown-background', el, {backgroundOwner:describe(n)});unmeasurable=true;break}
          background=blend(bg,background);
        }
        if (unmeasurable) continue;
        const text=parse(style.color);
        if (!text) {skip('unknown-foreground', el);continue}
        const foreground=blend(text,background);
        const px=parseFloat(style.fontSize)||0;
        const weight=parseInt(style.fontWeight,10)||400;
        const threshold=(px>=24 || (px>=18.66 && weight>=700)) ? 3 : 4.5;
        const value=ratio(foreground,background);
        measured++;
        if (value+0.0001<threshold) failed.push({
          tag:el.tagName.toLowerCase(),
          selector:el.className && typeof el.className==='string' ? el.className.slice(0,70) : '',
          text:el.textContent.trim().slice(0,65),
          foreground:style.color,
          backing:background.slice(0,3).map(Math.round),
          ratio:+value.toFixed(2),
          minimum:threshold,
        });
      }
      const uncheckedCount = Object.values(unchecked).reduce((sum,count)=>sum+count,0);
      const unsupportedColorCount = (unchecked['unknown-foreground'] || 0) +
        (unchecked['unknown-background'] || 0);
      return {measured, failed:failed.slice(0,16), failedCount:failed.length,
              unsupportedColorCount,
              unchecked, uncheckedItems, uncheckedItemsCapped:Math.max(0,uncheckedCount-uncheckedItems.length),
              scope:'flat-color foreground/background with no image or compositing'};
    })();""")


def reduced_motion_probe(driver: Driver) -> dict:
    """Exercise browser prefers-reduced-motion, not a simulated CSS class."""
    return driver.run(r"""return (() => {
      const active = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const html = getComputedStyle(document.documentElement);
      const tested = [];
      for (const selector of [
        '.skip-link', '.button', '.laptop-device', '.phone-device',
        '.phone-shell', '.auth-card', '.account-main', '.desktop-sidebar',
        '.download-hero-art'
      ]) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const style = getComputedStyle(el);
        const time = value => String(value || '').split(',').some(x =>
          Number.parseFloat(x.trim()) > 0.0001);
        tested.push({
          selector,
          transition: style.transitionDuration,
          animation: style.animationDuration,
          animating: time(style.transitionDuration) || time(style.animationDuration),
        });
      }
      return {
        preferenceMatches: active,
        scrollingIsInstant: html.scrollBehavior === 'auto',
        tested,
        activeMotion: tested.filter(x => x.animating).map(x => x.selector),
      };
    })();""")


def forced_colors_probe(driver: Driver) -> dict:
    """Verify Chrome's native forced-colors mode and a perceivable skip-link focus.

    This is a focused automated regression, not a screen-reader or WCAG audit.
    """
    driver.run("""const skip = document.querySelector('.skip-link[href="#conteudo"]');
      if (skip) skip.focus({preventScroll:true});
      return Boolean(skip);""")
    return driver.run(r"""return (() => {
      const skip = document.querySelector('.skip-link[href="#conteudo"]');
      const style = skip && getComputedStyle(skip);
      const rect = skip && skip.getBoundingClientRect();
      const focused = skip && document.activeElement === skip;
      return {
        preferenceMatches: matchMedia('(forced-colors: active)').matches,
        skipFocused: Boolean(focused),
        skipPerceivable: Boolean(focused && rect && rect.width > 0 && rect.height > 0 &&
          rect.top >= 0 && rect.bottom <= innerHeight &&
          style.visibility === 'visible' && style.display !== 'none'),
        skipFocusIndicator: Boolean(style && style.outlineStyle !== 'none' &&
          parseFloat(style.outlineWidth) >= 2),
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 2,
      };
    })();""")


def text_enlargement_probe(driver: Driver) -> dict:
    """200% computed-font-size stress test; not native browser text zoom."""
    return driver.run(r"""return (() => {
      const excluded = '.playground, .sr-only, [hidden], [aria-hidden="true"], script, style';
      const els = [...document.querySelectorAll('body *')].filter(el => {
        if (el.closest(excluded) || el.matches('svg, svg *, img, canvas')) return false;
        const css = getComputedStyle(el);
        if (css.display === 'none' || css.visibility !== 'visible') return false;
        const ownsText = [...el.childNodes].some(n =>
          n.nodeType === Node.TEXT_NODE && n.textContent.trim());
        return ownsText || el.matches('input:not([type="hidden"]), textarea, select');
      });
      const samples = els.map(el => ({el, size: parseFloat(getComputedStyle(el).fontSize)}))
        .filter(x => Number.isFinite(x.size) && x.size > 0);
      for (const {el, size} of samples)
        el.style.setProperty('font-size', (size * 2) + 'px', 'important');
      const wrongSizes = samples.filter(({el, size}) =>
        Math.abs(parseFloat(getComputedStyle(el).fontSize) - size * 2) > 0.25);
      const clippedText = samples.filter(({el}) => {
        const css = getComputedStyle(el), rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        return (/^(hidden|clip)$/.test(css.overflowY) && el.scrollHeight > el.clientHeight + 2) ||
          (/^(hidden|clip)$/.test(css.overflowX) && el.scrollWidth > el.clientWidth + 2);
      }).slice(0, 12).map(({el}) => ({
        tag: el.tagName.toLowerCase(), selector: String(el.className || '').slice(0, 70),
        text: String(el.textContent || el.value || '').trim().slice(0, 70),
        width: el.clientWidth, scrollWidth: el.scrollWidth,
        height: el.clientHeight, scrollHeight: el.scrollHeight
      }));
      const overflowElements = [...document.querySelectorAll('body *')].filter(el => {
        if (el.closest('.playground')) return false;
        const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
        return rect.width > 0 && rect.right > innerWidth + 2 &&
          rect.left < innerWidth && css.display !== 'none' &&
          css.visibility !== 'hidden' && css.position !== 'fixed';
      }).slice(0, 12).map(el => ({
        tag: el.tagName.toLowerCase(), selector: String(el.className || '').slice(0, 85),
        right: Math.round(el.getBoundingClientRect().right)
      }));
      // Rectangular overlap is distinct from clipping/scroll overflow.
      // A 200%-enlarged brand may overlap account actions while both boxes
      // remain individually unclipped. Check only known Site-owned pairs.
      const visualOverlaps = [];
      const intersects = (a, b) => {
        if (!a || !b) return false;
        const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
        return x.width > 0 && x.height > 0 && y.width > 0 && y.height > 0 &&
          x.left < y.right - 1 && x.right > y.left + 1 &&
          x.top < y.bottom - 1 && x.bottom > y.top + 1;
      };
      const header = document.querySelector('.site-header');
      const brand = header?.querySelector(':scope > .brand') ||
        header?.querySelector(':scope > a:first-child');
      const actions = header?.querySelector(':scope > .site-actions');
      if (intersects(brand, actions) ||
          intersects(brand?.querySelector('.brand-name'), actions))
        visualOverlaps.push('public-header-brand-vs-actions');
      if (intersects(document.querySelector('.download-hero .art-caption'),
                     document.querySelector('.download-hero-copy .eyebrow')))
        visualOverlaps.push('download-art-caption-vs-eyebrow');
      return {
        method: 'computed-font-size-doubling-not-native-browser-zoom',
        scalePercent: 200, scaledTextNodes: samples.length,
        wrongSizes: wrongSizes.length, clippedText, visualOverlaps,
        width: innerWidth, documentScrollWidth: document.documentElement.scrollWidth,
        noPageHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 2,
        overflowElements,
        noUnexpectedRuntimeErrors: !(window.__ordaxPageErrors || []).length
      };
    })();""")


def text_spacing_probe(driver: Driver) -> dict:
    """Apply WCAG 1.4.12 spacing overrides to Site text, then inspect layout.

    Browser DOM stress test, not visual proof or validation of Surface internals.
    """
    return driver.run(r"""return (() => {
      const ignored = '.playground, .sr-only, [hidden], [aria-hidden="true"], script, style';
      const nodes = [...document.querySelectorAll('body *')].filter(el => {
        if (el.closest(ignored) || el.matches('svg, svg *, img, canvas')) return false;
        const css = getComputedStyle(el);
        if (css.display === 'none' || css.visibility !== 'visible') return false;
        return [...el.childNodes].some(node =>
          node.nodeType === Node.TEXT_NODE && node.textContent.trim()) ||
          el.matches('input:not([type="hidden"]), textarea, select');
      });
      const paragraphs = [...document.querySelectorAll('p')].filter(el =>
        !el.closest(ignored) && getComputedStyle(el).display !== 'none' &&
        el.getBoundingClientRect().height > 0);
      for (const el of nodes) {
        el.style.setProperty('line-height', '1.5', 'important');
        el.style.setProperty('letter-spacing', '0.12em', 'important');
        el.style.setProperty('word-spacing', '0.16em', 'important');
      }
      for (const el of paragraphs)
        el.style.setProperty('margin-block-end', '2em', 'important');
      const wrongMetrics = nodes.filter(el => {
        const c = getComputedStyle(el), sz = parseFloat(c.fontSize);
        return !sz || parseFloat(c.lineHeight) + 0.25 < 1.5 * sz ||
          parseFloat(c.letterSpacing) + 0.25 < 0.12 * sz ||
          parseFloat(c.wordSpacing) + 0.25 < 0.16 * sz;
      }).slice(0, 12).map(el => ({
        tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 65),
        text: String(el.textContent || el.value || '').trim().slice(0, 70),
      }));
      const wrongParagraphMargins = paragraphs.filter(el => {
        const c = getComputedStyle(el);
        return parseFloat(c.marginBottom) + 0.25 < 2 * parseFloat(c.fontSize);
      }).slice(0, 12).map(el => ({
        text: String(el.textContent || '').trim().slice(0, 65),
        margin: getComputedStyle(el).marginBottom,
        fontSize: getComputedStyle(el).fontSize
      }));
      const clippedText = nodes.filter(el => {
        const c = getComputedStyle(el), rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        return (/^(hidden|clip)$/.test(c.overflowY) && el.scrollHeight > el.clientHeight + 2) ||
          (/^(hidden|clip)$/.test(c.overflowX) && el.scrollWidth > el.clientWidth + 2);
      }).slice(0, 12).map(el => ({
        tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 65),
        text: String(el.textContent || el.value || '').trim().slice(0, 70),
        width: el.clientWidth, scrollWidth: el.scrollWidth,
        height: el.clientHeight, scrollHeight: el.scrollHeight
      }));
      return {
        locale: document.documentElement.lang,
        method: 'dom-wcag-text-spacing-overrides-not-native-text-zoom',
        spacedTextNodes: nodes.length,
        spacedParagraphs: paragraphs.length,
        wrongMetrics, wrongParagraphMargins, clippedText,
        width: innerWidth, documentScrollWidth: document.documentElement.scrollWidth,
        noPageHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 2,
        noUnexpectedRuntimeErrors: !(window.__ordaxPageErrors || []).length
      };
    })();""")


def no_script_probe(driver: Driver) -> dict:
    """Inspect the offline presentation after loading with script execution blocked."""
    return driver.run(r"""return (() => {
      const forms = [...document.querySelectorAll('form.identity-form')];
      const enabledCredentials = forms.flatMap(form =>
        [...form.querySelectorAll('input,button,select,textarea')])
        .filter(control => !control.disabled).length;
      const exposedForms = forms.filter(form => {
        const style = getComputedStyle(form);
        return !form.hidden && style.display !== 'none' &&
          style.visibility !== 'hidden';
      }).length;
      const notice = [...document.querySelectorAll('noscript')].some(el =>
        el.getClientRects().length > 0 ||
        [...el.querySelectorAll('*')].some(child => child.getClientRects().length > 0));
      return {
        pathname: location.pathname,
        lang: document.documentElement.lang,
        hasMain: document.querySelectorAll('main').length === 1,
        mainHasSinglePrimaryHeading: [...document.querySelectorAll('main h1')].filter(h => !h.closest('.playground, [aria-hidden="true"]')).length === 1,
        noscriptGuidanceVisible: notice,
        navigationAvailable: !!document.querySelector('a[href="/"]'),
        authFormsExposed: exposedForms,
        enabledAuthControls: enabledCredentials,
        noRuntimeActivated: typeof window.OrdaXPublicI18n === 'undefined',
        accountNotVerified: !document.querySelector('[data-verified-user]') &&
          ![...document.querySelectorAll('.verified-email')].some(x =>
            x.textContent.includes('@')),
        webLaunchUnavailable: !document.querySelector('[data-web-launch]') ||
          document.querySelector('[data-web-launch]').hidden
      };
    })();""")


def wait_for_route(driver: Driver, route: str) -> None:
    """Wait for visible state without depending on a privileged backend."""
    for _ in range(35):
        if driver.run("return document.readyState === 'complete'"):
            break
        time.sleep(0.1)
    if route == "/":
        for _ in range(40):
            done = driver.run("""return document.querySelector('.playground')?.dataset.fixtureReady || null;""")
            if done in ("true", "false"):
                break
            time.sleep(0.1)
    if route in NO_SCRIPT_ROUTES:
        for _ in range(30):
            status = driver.run("""const el=document.querySelector('[data-identity-state],#account-session,[data-web-state]'); return el?.dataset?.status || null;""")
            if status not in (None, "checking"):
                break
            time.sleep(0.1)


def run(root: Path, evidence: Path, chrome_binary: str | None = None) -> dict:
    if not (root / "public-site-manifest.json").is_file():
        raise BrowserProofError("build candidate missing; never browse unpackaged source")
    chrome_binary = (str(Path(chrome_binary).resolve()) if chrome_binary
                     else shutil.which("google-chrome"))
    if (not shutil.which("chromedriver") or not chrome_binary
            or not Path(chrome_binary).is_file()):
        raise BrowserProofError(
            "Chrome + ChromeDriver required; pass --chrome-binary when Chrome is not on PATH")
    evidence.mkdir(parents=True, exist_ok=True)
    server = LocalProofHTTPServer(
        ("127.0.0.1", 0),
        lambda *a, **k: Handler(*a, root=root, **k),
    )
    server.catalog_override = None
    server.manifest_override = None
    server.fixture_attack_for_test = None
    server.stall_json_for_deadline_test = None
    server.auth_session_redirect_for_test = False
    server.auth_json_attack_for_test = None
    server.auth_session_race_for_test = False
    server.auth_race_requests = 0
    server.auth_race_lock = threading.Lock()
    server.same_email_usage_test = False
    server.same_email_session_requests = 0
    server.same_email_usage_requests = 0
    server.same_email_lock = threading.Lock()
    server.hold_config_for_fragment_test = False
    server.fragment_config_started = threading.Event()
    server.fragment_config_release = threading.Event()
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    webdriver_port = free_port()
    command = ["chromedriver", f"--port={webdriver_port}", "--allowed-ips=127.0.0.1"]
    child = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    driver = Driver(webdriver_port)
    results = []
    responsive_breakpoint_results = []
    responsive_breakpoint_routes = {}
    localized_responsive_results = []
    touch_results = []
    reflow_results = []
    text_enlargement_results = []
    text_spacing_results = []
    no_script_results = []
    catalog_failure_results = []
    fixture_transport_results = []
    json_deadline_results = []
    redirect_identity_results = []
    json_contract_results = []
    identity_race_results = []
    same_email_usage_results = []
    legacy_fragment_results = []
    failures = []
    try:
        for _ in range(100):
            if child.poll() is not None:
                raise BrowserProofError("ChromeDriver stopped before accepting a session")
            try:
                with urllib.request.urlopen(driver.base + "/status", timeout=1):
                    break
            except (urllib.error.URLError, OSError):
                time.sleep(0.1)
        else:
            raise BrowserProofError("ChromeDriver did not start")
        driver.create(chrome_binary)
        for route in ROUTES:
            for width, height in VIEWPORTS:
                driver.cdp("Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": height, "deviceScaleFactor": 1,
                    "mobile": width <= 430,
                })
                url = f"http://127.0.0.1:{server.server_port}{route}"
                driver.navigate(url)
                # No user data or privileged service is available; all
                # backend requests remain fail-closed on loopback.
                wait_for_route(driver, route)
                report = probe(driver, route, width, height)
                report["solidSurfaceContrast"] = solid_surface_contrast_probe(driver)
                # The viewport and browser accessibility tree are audited on
                # every route. Keyboard travel is tested on desktop only:
                # the same page markup and tab order is shared with mobile.
                if width == VIEWPORTS[0][0]:
                    report.update(accessibility_probe(driver))
                    report["localeSwitch"] = localization_probe(driver)
                    driver.cdp("Emulation.setEmulatedMedia", {"features": [
                        {"name": "prefers-reduced-motion", "value": "reduce"}
                    ]})
                    try:
                        report["reducedMotion"] = reduced_motion_probe(driver)
                    finally:
                        driver.cdp("Emulation.setEmulatedMedia", {"features": [
                            {"name": "prefers-reduced-motion", "value": "no-preference"}
                        ]})
                    driver.cdp("Emulation.setEmulatedMedia", {"features": [
                        {"name": "forced-colors", "value": "active"}
                    ]})
                    try:
                        report["forcedColors"] = forced_colors_probe(driver)
                        short = route.strip("/").replace("/", "-") or "home"
                        forced_shot = f"forced-colors-{short}.png"
                        driver.shot(evidence / forced_shot)
                        report["forcedColors"]["screenshot"] = forced_shot
                    finally:
                        driver.cdp("Emulation.setEmulatedMedia", {"features": [
                            {"name": "forced-colors", "value": "none"}
                        ]})
                    report["captureStateRestored"] = restore_capture_state(driver, route)
                short = route.strip("/").replace("/", "-") or "home"
                filename = f"{short}-{width}x{height}.png"
                driver.shot(evidence / filename)
                report.update({"expectedRoute": route, "screenshot": filename})
                if width == 390:
                    if route == "/conta/":
                        report["accountMobileNavigationInteraction"] = (
                            mobile_account_navigation_interaction_probe(driver)
                        )
                    else:
                        report["mobileNavigationInteraction"] = mobile_navigation_interaction_probe(driver)
                results.append(report)
                check = {
                    "loaded": report["complete"] and report["pathname"] == route and report["mainCount"] == 1,
                    "correctLanguage": report["lang"] in ("pt-BR", "en-US"),
                    "namedDocument": bool(report["title"]),
                    "mainHasSinglePrimaryHeading": report["mainH1Count"] == 1,
                    "skipNavigation": report["skip"],
                    "publicHeaderRegionsReady": report["publicHeaderRegionsReady"],
                    "publicHeaderRegionsVisible": report["publicHeaderRegionsVisible"],
                    "publicHeaderBrandActionsShareRow": report["publicHeaderBrandActionsShareRow"],
                    "publicHeaderBrandActionsDoNotOverlap": report["publicHeaderBrandActionsDoNotOverlap"],
                    "publicHeaderBrandContentFits": report["publicHeaderBrandContentFits"],
                    "publicHeaderActionsFit": report["publicHeaderActionsFit"],
                    "publicHeaderLocalePresentation": report["publicHeaderLocalePresentation"],
                    "publicHeaderMobileLocaleInDisclosure": report["publicHeaderMobileLocaleInDisclosure"],
                    "publicMobileNavigationDisclosureReady": report["publicMobileNavigationDisclosureReady"],
                    "publicPageStartSpacing": report["publicPageStartSpacingReady"],
                    "sharedFooterContract": report["sharedFooterContract"],
                    "sharedFooterResponsiveLayout": report["sharedFooterResponsiveLayout"],
                    "sharedFooterFitsViewport": report["sharedFooterFitsViewport"],
                    "sharedFooterLinksHaveComfortableTargets": report["sharedFooterLinksHaveComfortableTargets"],
                    "siteInteractiveTargetsHaveComfortableSize": width > 640 or not report["undersizedInteractiveTargets"],
                    "siteInteractiveTargetsMeetMinimumSize": not report["undersizedAAInteractiveTargets"],
                    "noHorizontalOverflow": report["noOverflow"],
                    "uniqueElementIds": not report["duplicateIds"],
                    "accessibleInteractiveNames": not report["nameless"],
                    "visibleImagesHaveAltAttribute": not report["unlabeledImages"],
                    "noUnexpectedRemoteRequests": not report["remoteResources"],
                    "noBrokenStaticNetworkAssets": not report["failedStaticAssets"],
                    "noUncaughtBrowserErrors": not report["runtimeErrors"],
                    "measuredFlatSurfaceTextContrast": (
                        report["solidSurfaceContrast"]["failedCount"] == 0
                        and report["solidSurfaceContrast"]["unsupportedColorCount"] == 0
                    ),
                    "flatSurfaceCoverage": (
                        report["solidSurfaceContrast"]["measured"] > 0
                        and report["solidSurfaceContrast"]["unsupportedColorCount"] == 0
                    ),
                }
                if width == 390 and route != "/conta/":
                    check["publicMobileNavigationOpensAndEscapes"] = all(
                        report["mobileNavigationInteraction"].values()
                    )
                if width == VIEWPORTS[0][0]:
                    check.update({
                        "accessibilityTreeNames": not report["accessibilityTreeUnnamedControls"],
                        "skipLinkKeyboardFirst": report["skipLinkFirstKeyboardTarget"],
                        "skipLinkKeyboardVisible": report["skipLinkVisibleOnFocus"],
                        "skipLinkKeyboardNavigates": report["skipLinkDestination"],
                        "skipLinkKeyboardFocus": report["skipLinkFocusLandsOnMain"],
                        "localeSwitcherLocalizedAndPersistent": all(report["localeSwitch"].values()),
                        "reducedMotionBrowserPreferenceHonored": report["reducedMotion"]["preferenceMatches"]
                          and report["reducedMotion"]["scrollingIsInstant"]
                          and not report["reducedMotion"]["activeMotion"],
                        "nativeForcedColorsAndSkipFocus": all(
                            report["forcedColors"][key] for key in (
                                "preferenceMatches", "skipFocused", "skipPerceivable",
                                "skipFocusIndicator", "noHorizontalOverflow"
                            )
                        ),
                        "visualScreenshotRestoredAfterKeyboardProbe": (
                            report["captureStateRestored"]["route"] == route
                            and report["captureStateRestored"]["expectedRoute"] == route
                            and report["captureStateRestored"]["noSkipLinkFocus"]
                            and report["captureStateRestored"]["skipLinkHidden"]
                            and report["captureStateRestored"]["mainExists"]
                            and report["captureStateRestored"]["noTestFragment"]
                            and report["captureStateRestored"]["atTop"]
                        ),
                    })
                if route in ("/login/", "/cadastro/", "/recuperar/", "/recuperar/nova-senha/"):
                    check.update({"formsFailClosed": not report["exposedAuthForms"] and not report["enabledCredentials"]})
                if route == "/conta/":
                    check.update({"accountShellPresent": report["accountPortal"],
                                  "accountTopbarFitsViewport": report["accountTopbarFitsViewport"],
                                  "noInventedVerifiedUser": not report["accountHasVerifiedUser"]})
                    if width == 390:
                        check["accountMobileNavigationOpensAndEscapes"] = all(
                            report["accountMobileNavigationInteraction"].values()
                        )
                    if report["accountMobileFooterClearance"]["checked"]:
                        check["accountMobileFooterClearOfNavigation"] = (
                            report["accountMobileFooterClearance"]["clear"]
                        )
                if route == "/":
                    check.update({
                        "landingFixturePresent": report["landingFixturePresent"],
                        "compactDemoOnlyInertWithoutPrecisePointer": report["compactDemoInput"]["valid"],
                        "landingHeroCopyVisibleOnFirstRender": report["landingHeroCopyVisible"],
                        "landingHeroCopyHasNoEntranceAnimation": report["landingHeroCopyHasNoEntranceAnimation"],
                        "landingPhoneEntranceFitsViewport": report["landingPhoneEntrance"]["checked"]
                          and report["landingPhoneEntrance"]["fits"],
                    })
                for name, success in check.items():
                    if not success:
                        failures.append({"route": route, "viewport": width, "rule": name,
                                         "summary": ({"contrast": report["solidSurfaceContrast"]}
                                                     if name == "measuredFlatSurfaceTextContrast"
                                                     else {"reducedMotion": report["reducedMotion"]}
                                                     if name == "reducedMotionBrowserPreferenceHonored"
                                                     else {"forcedColors": report["forcedColors"]}
                                                     if name == "nativeForcedColorsAndSkipFocus" else report)})
        # CSS remains the source of truth for each route's breakpoints. Read
        # the candidate's linked stylesheets and probe immediately around
        # every authored min/max-width boundary rather than duplicating them
        # in a second hand-maintained viewport list.
        for route in ROUTES:
            route_audit = responsive_breakpoint_audit(root, route)
            responsive_breakpoint_routes[route] = route_audit
            for width in route_audit["testedWidths"]:
                driver.cdp("Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": 900, "deviceScaleFactor": 1,
                    "mobile": width <= 430,
                })
                driver.navigate(f"http://127.0.0.1:{server.server_port}{route}")
                wait_for_route(driver, route)
                report = probe(driver, route, width, 900)
                checks = responsive_shell_checks(report, width, route)
                report["breakpointChecks"] = checks
                failed = [name for name, success in checks.items() if not success]
                if failed:
                    short = route.strip("/").replace("/", "-") or "home"
                    screenshot = f"breakpoint-{short}-{width}px.png"
                    driver.shot(evidence / screenshot)
                    report["screenshot"] = screenshot
                    for name in failed:
                        failures.append({"route": route, "viewport": f"breakpoint-{width}",
                                         "rule": name, "summary": report})
                responsive_breakpoint_results.append(report)
        # Validate language-dependent wrapping and touch targets in both real
        # locales across every public route. The representative locale widths
        # live here once; the route inventory still comes from the route contract.
        driver.cdp("Emulation.setTouchEmulationEnabled", {
            "enabled": True, "maxTouchPoints": 1,
        })
        for width in LOCALIZATION_VIEWPORTS:
            driver.cdp("Emulation.setDeviceMetricsOverride", {
                "width": width, "height": 900, "deviceScaleFactor": 1,
                "mobile": width <= 430,
            })
            for route in ROUTES:
                driver.navigate(f"http://127.0.0.1:{server.server_port}{route}")
                wait_for_route(driver, route)
                for locale in ("pt-BR", "en-US"):
                    locale_state = apply_public_locale(driver, locale)
                    report = probe(driver, route, width, 900)
                    report["locale"] = locale
                    report["localeState"] = locale_state
                    report["coarsePointer"] = driver.run(
                        "return matchMedia('(any-pointer: coarse)').matches"
                    )
                    checks = responsive_shell_checks(
                        report, width, route, coarse_pointer=True
                    )
                    checks["coarsePointerProfileActive"] = report["coarsePointer"]
                    checks["localeAppliedAndRemembered"] = (
                        locale_state.get("ready")
                        and locale_state.get("language") == locale
                        and locale_state.get("selected") == locale
                        and locale_state.get("stored") == locale
                    )
                    checks["languageNamesRemainNativeAndTagged"] = (
                        locale_state.get("languageNamesAndTags") is True
                    )
                    if route != "/conta/":
                        expected_landmarks = {
                            "pt-BR": ("Navegação principal", "Rodapé"),
                            "en-US": ("Primary navigation", "Footer"),
                        }[locale]
                        checks["navigationLandmarksMatchLocale"] = (
                            locale_state.get("navigationLabels") == {
                                "primary": expected_landmarks[0],
                                "footer": expected_landmarks[1],
                            }
                        )
                    checks["selectorAccessibleNameMatchesLocale"] = (
                        locale_state.get("accessibleName") == {
                            "pt-BR": "Idioma", "en-US": "Language"
                        }[locale]
                    )
                    if route != "/conta/":
                        checks["navigationLabelMatchesLocale"] = (
                            locale_state.get("menu") == "Menu"
                            and locale_state.get("toggleLabel") == {
                                "pt-BR": "Alternar navegação principal",
                                "en-US": "Toggle primary navigation",
                            }[locale]
                        )
                    report["localizedResponsiveChecks"] = checks
                    short = route.strip("/").replace("/", "-") or "home"
                    failed = [name for name, success in checks.items() if not success]
                    screenshot = None
                    if failed or (width in (280, 320) and locale == "en-US"):
                        screenshot = f"localized-{locale}-{short}-{width}.png"
                        driver.shot(evidence / screenshot)
                        report["screenshot"] = screenshot
                    for name in failed:
                        failures.append({"route": route,
                                         "viewport": f"{locale}-{width}-coarse",
                                         "rule": name, "summary": report})
                    localized_responsive_results.append(report)
        driver.cdp("Emulation.setTouchEmulationEnabled", {"enabled": False})
        apply_public_locale(driver, "pt-BR")
        # Verify the desktop-CSS layouts used by tablets and hybrid touch
        # devices. This exercises any-pointer: coarse independently from the
        # narrow mobile viewport matrix above.
        driver.cdp("Emulation.setTouchEmulationEnabled", {
            "enabled": True, "maxTouchPoints": 1,
        })
        for route in ROUTES:
            for width in TOUCH_VIEWPORTS:
                driver.cdp("Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": 900, "deviceScaleFactor": 1,
                    "mobile": False,
                })
                driver.navigate(f"http://127.0.0.1:{server.server_port}{route}")
                wait_for_route(driver, route)
                report = probe(driver, route, width, 900)
                report["coarsePointer"] = driver.run(
                    "return matchMedia('(any-pointer: coarse)').matches"
                )
                touch_results.append(report)
                checks = {
                    "coarsePointerProfileActive": report["coarsePointer"],
                    "routeRendered": report["complete"] and report["pathname"] == route
                        and report["mainCount"] == 1,
                    "noHorizontalOverflow": report["noOverflow"],
                    "headerBrandActionsShareRow": report["publicHeaderBrandActionsShareRow"],
                    "headerBrandActionsDoNotOverlap": report["publicHeaderBrandActionsDoNotOverlap"],
                    "headerBrandContentFits": report["publicHeaderBrandContentFits"],
                    "headerActionsFit": report["publicHeaderActionsFit"],
                    "localePresentation": report["publicHeaderLocalePresentation"],
                    "mobileLocaleIsInsideDisclosure": report["publicHeaderMobileLocaleInDisclosure"],
                    "publicPageStartSpacing": report["publicPageStartSpacingReady"],
                    "footerFitsViewport": report["sharedFooterFitsViewport"],
                    "footerLinksHaveComfortableTargets": report["sharedFooterLinksHaveComfortableTargets"],
                    "interactiveTargetsHaveComfortableSize": not report["undersizedInteractiveTargets"],
                }
                if route == "/conta/" and report["accountMobileFooterClearance"]["checked"]:
                    checks["accountMobileFooterClearOfNavigation"] = (
                        report["accountMobileFooterClearance"]["clear"]
                    )
                if route != "/conta/":
                    checks["mobileDisclosureReady"] = report["publicMobileNavigationDisclosureReady"]
                if route == "/conta/":
                    checks["accountShellPresent"] = report["accountPortal"]
                    checks["accountTopbarFitsViewport"] = report["accountTopbarFitsViewport"]
                    checks["accountMobileNavigationLabelsFit"] = report["accountMobileNavigationLabelsFit"]
                    checks["noInventedVerifiedUser"] = not report["accountHasVerifiedUser"]
                if route == "/":
                    checks["compactDemoOnlyInertWithoutPrecisePointer"] = report["compactDemoInput"]["valid"]
                    checks["landingPhoneEntranceFitsViewport"] = (
                        report["landingPhoneEntrance"]["checked"]
                        and report["landingPhoneEntrance"]["fits"]
                    )
                for name, success in checks.items():
                    if not success:
                        failures.append({"route": route, "viewport": f"touch-{width}",
                                         "rule": name, "summary": report})
        driver.cdp("Emulation.setTouchEmulationEnabled", {"enabled": False})
        # Simulate the CSS layout viewport available when a 1280px desktop
        # is viewed at 200% and 400% scale. Keep mobile=False so responsive
        # rules are exercised in desktop emulation, distinct from the 320px
        # phone proof. This does not claim full text zoom conformance.
        for route in ROUTES:
            for width, scale in REFLOW_WIDTHS:
                driver.cdp("Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": 900, "deviceScaleFactor": 1,
                    "mobile": False,
                })
                driver.navigate(f"http://127.0.0.1:{server.server_port}{route}")
                wait_for_route(driver, route)
                report = probe(driver, route, width, 900)
                report["equivalentScalePercent"] = scale
                short = route.strip("/").replace("/", "-") or "home"
                shot = f"reflow-{scale}pct-{short}.png"
                driver.shot(evidence / shot)
                report["screenshot"] = shot
                reflow_results.append(report)
                checks = {
                    "routeRendered": report["complete"] and report["pathname"] == route
                        and report["mainCount"] == 1,
                    "effectiveCssViewport": report["width"] == width,
                    "reflowsWithoutPageHorizontalScroll": report["noOverflow"],
                    "noRemoteResources": not report["remoteResources"],
                    "noBrokenStaticResources": not report["failedStaticAssets"],
                    "noUncaughtScripts": not report["runtimeErrors"],
                }
                if route == "/":
                    checks["landingDemoMounted"] = report["landingFixturePresent"]
                if route == "/conta/":
                    checks["noInventedVerifiedUser"] = not report["accountHasVerifiedUser"]
                if route in NO_SCRIPT_ROUTES[:4]:
                    checks["formsRemainFailClosed"] = not report["exposedAuthForms"] and not report["enabledCredentials"]
                for rule, good in checks.items():
                    if not good:
                        failures.append({"route": route, "viewport": f"reflow-{scale}",
                                         "rule": rule, "summary": report})
        # Stress test computed font-size 200% on the Site-owned presentation.
        # This is not Chrome's native text-only zoom and does not alter source.
        for route in ROUTES:
            driver.cdp("Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True
            })
            driver.navigate(f"http://127.0.0.1:{server.server_port}{route}")
            wait_for_route(driver, route)
            report = text_enlargement_probe(driver)
            report["route"] = route
            short = route.strip("/").replace("/", "-") or "home"
            shot = f"text-200pct-{short}.png"
            driver.shot(evidence / shot)
            report["screenshot"] = shot
            text_enlargement_results.append(report)
            checks = {
                "textActuallyDoubled": report["scaledTextNodes"] > 0 and report["wrongSizes"] == 0,
                "textDoesNotClip": not report["clippedText"],
                "textDoesNotOverlapSiteControls": not report["visualOverlaps"],
                "textDoesNotCausePageOverflow": report["noPageHorizontalOverflow"],
                "noUncaughtScripts": report["noUnexpectedRuntimeErrors"],
            }
            for rule, passed in checks.items():
                if not passed:
                    failures.append({"route": route, "viewport": "text-200pct",
                                     "rule": rule, "summary": report})
        # WCAG 1.4.12 spacing stress at 390px in both supported locales.
        # Overrides exist only in the test DOM; keep external Surface immutable.
        for route in ROUTES:
            for locale in ("pt-BR", "en-US"):
                driver.cdp("Emulation.setDeviceMetricsOverride", {
                    "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True
                })
                driver.navigate(f"http://127.0.0.1:{server.server_port}{route}")
                wait_for_route(driver, route)
                selected_locale = driver.run(
                    """const selector = document.querySelector('[data-public-locale-select]');
                    if (!selector) return false;
                    selector.value = '""" + locale + """';
                    selector.dispatchEvent(new Event('change', {bubbles: true}));
                    return selector.value === document.documentElement.lang
                      && selector.value === '""" + locale + """';"""
                )
                report = text_spacing_probe(driver)
                report.update({"route": route, "expectedLocale": locale, "localeChanged": selected_locale})
                short = route.strip("/").replace("/", "-") or "home"
                shot = f"spacing-{locale}-{short}.png"
                driver.shot(evidence / shot)
                report["screenshot"] = shot
                text_spacing_results.append(report)
                checks = {
                    "localeApplied": selected_locale and report["locale"] == locale,
                    "textActuallySpaced": report["spacedTextNodes"] > 0,
                    "metricsMeet1_4_12": not report["wrongMetrics"] and not report["wrongParagraphMargins"],
                    "noTextClipping": not report["clippedText"],
                    "noPageHorizontalOverflow": report["noPageHorizontalOverflow"],
                    "noUncaughtScripts": report["noUnexpectedRuntimeErrors"],
                }
                for rule, passed in checks.items():
                    if not passed:
                        failures.append({"route": route, "viewport": f"spacing-{locale}",
                                         "rule": rule, "summary": report})
        # The Site's disabled Web product must not invite login or expose a
        # launch URL, even with an independently authenticated synthetic user.
        # The fixture exists only on the isolated loopback HTTP server.
        server.auth_json_attack_for_test = "valid"
        try:
            driver.cdp("Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True
            })
            driver.navigate(f"http://127.0.0.1:{server.server_port}/web/")
            web_gate = {}
            for _ in range(40):
                web_gate = driver.run("""return (() => {
                  const status = document.querySelector('[data-web-state]');
                  const login = document.querySelector('[data-web-login]');
                  const launch = document.querySelector('[data-web-launch]');
                  return {
                    pathname: window.location.pathname,
                    status: status?.dataset?.status,
                    statusUnbusy: status?.getAttribute('aria-busy') !== 'true',
                    loginHidden: login?.hidden === true,
                    launchHidden: launch?.hidden === true,
                    noLaunchHref: launch && !launch.hasAttribute('href'),
                    runtimeErrors: window.__ordaxPageErrors || []
                  };
                })();""")
                if web_gate.get("status") == "unavailable":
                    break
                time.sleep(0.1)
            if (web_gate.get("pathname") != "/web/"
                    or web_gate.get("status") != "unavailable"
                    or not all(web_gate.get(key) for key in
                               ("statusUnbusy", "loginHidden", "launchHidden", "noLaunchHref"))
                    or web_gate.get("runtimeErrors")):
                failures.append({"route": "/web/", "viewport": "product-disabled-authenticated",
                                 "rule": "web-entry-must-fail-closed", "summary": web_gate})
        finally:
            server.auth_json_attack_for_test = None
        # The production viewer must reject MIME/redirect/streaming attacks
        # on the signed static fixture, without rendering any forged Surface.
        for scenario in ("redirect", "wrong-mime", "oversized"):
            server.fixture_attack_for_test = scenario
            try:
                driver.navigate(f"http://127.0.0.1:{server.server_port}/")
                report = {}
                for _ in range(40):
                    report = driver.run("""return {
                      ready: document.querySelector('.playground')?.dataset.fixtureReady ?? null,
                      demoMounted: !!document.querySelector('.playground .demo-native'),
                      runtimeErrors: window.__ordaxPageErrors || []
                    };""")
                    if report.get("ready") in ("true", "false"):
                        break
                    time.sleep(0.1)
                report["scenario"] = scenario
                fixture_transport_results.append(report)
                if (report.get("ready") != "false"
                        or report.get("demoMounted") or report.get("runtimeErrors")):
                    failures.append({"route": "/", "viewport": "fixture-" + scenario,
                                     "rule": "fixture-transport-fail-closed", "summary": report})
            finally:
                server.fixture_attack_for_test = None
        # A server that accepts a request but never finishes it cannot leave
        # either product configuration or signed demo in a permanent loading
        # state. Exercise actual production fetch/stream cancellation, not a
        # structural imitation of the deadline logic.
        for route, path, state_selector in (
            ("/web/", "/config/public-site.json", "[data-web-state]"),
            ("/", "/assets/playground-fixture.json", ".playground"),
        ):
            server.stall_json_for_deadline_test = path
            try:
                driver.navigate(f"http://127.0.0.1:{server.server_port}{route}")
                report = {}
                for _ in range(125):
                    report = driver.run("""return (() => {
                      const path = window.location.pathname;
                      const gate = document.querySelector('[data-web-state]');
                      const fixture = document.querySelector('.playground');
                      const check = path === '/web/' ? gate : fixture;
                      return {
                        pathname: path,
                        status: path === '/web/' ? gate?.dataset.status
                                                : fixture?.dataset.fixtureReady,
                        notBusy: path !== '/web/' || gate?.getAttribute('aria-busy') !== 'true',
                        loginHidden: path !== '/web/' || document.querySelector('[data-web-login]')?.hidden,
                        launchHidden: path !== '/web/' || document.querySelector('[data-web-launch]')?.hidden,
                        noLaunchHref: path !== '/web/' || !document.querySelector('[data-web-launch]')?.hasAttribute('href'),
                        noDemo: path !== '/' || !document.querySelector('.playground .demo-native'),
                        runtimeErrors: window.__ordaxPageErrors || []
                      };
                    })();""")
                    if report.get("status") in ("unavailable", "false"):
                        break
                    time.sleep(0.1)
                report["testPath"] = path
                json_deadline_results.append(report)
                expected = "unavailable" if route == "/web/" else "false"
                if (report.get("pathname") != route or report.get("status") != expected
                        or not all(report.get(x) for x in (
                            "notBusy", "loginHidden", "launchHidden", "noLaunchHref", "noDemo"))
                        or report.get("runtimeErrors")):
                    failures.append({"route": route, "viewport": "json-deadline",
                                     "rule": "stalled-json-must-resolve-fail-closed", "summary": report})
            finally:
                server.stall_json_for_deadline_test = None
        # Exercise poisoned catalogs through the REAL Site browser runtime
        # without changing the pinned candidate or invoking any publisher.
        demo_id = "1" * 40
        artifact = lambda path: {"href": path, "sha256": "a" * 64, "size": 123}
        demo_target = {"id": "unit-test-only", "label": "Never published",
                       **artifact("/releases/offline-test-only.img")}
        demo_release = {
            "release_id": demo_id, "source_commit": demo_id,
            "version": "offline-test-only", "channel": "test",
            "published_at": "2026-10-24",
            "targets": [demo_target],
            "compliance": {
                "sbom": artifact("/compliance/test-sbom.json"),
                "third_party_notices": artifact("/compliance/test-notices.txt"),
                "source_bundle": artifact("/compliance/test-sources.tar.gz"),
            },
        }
        invalid_catalogs = [
            ("empty-with-releases", {"$schema": "prototype-ordax.public-release-catalog/1",
                                      "status": "empty", "releases": [demo_release]}),
            ("repeated-target-id", {"$schema": "prototype-ordax.public-release-catalog/1",
                                     "status": "ready",
                                     "releases": [{**demo_release,
                                                   "targets": [demo_target, demo_target]}]}),
            ("encoded-traversal", {"$schema": "prototype-ordax.public-release-catalog/1",
                                    "status": "ready",
                                    "releases": [{**demo_release,
                                                  "targets": [{**demo_target, "href":
                                                    "/releases/%2e%2e/auth/login"}]}]}),
            # This one is structurally valid. It must STILL fail because the
            # immutable CI bundle authorizes only the original empty catalog.
            ("valid-ready-but-unattested", {
                "$schema": "prototype-ordax.public-release-catalog/1",
                "status": "ready", "releases": [demo_release],
            }),
            ("empty-with-unauthorized-field", {
                "$schema": "prototype-ordax.public-release-catalog/1",
                "status": "empty", "releases": [], "injected": True,
            }),
        ]
        # A forged ready catalog AND a matching, self-authored manifest are
        # still unauthorized. Both responses come only from this loopback
        # test handler: a matching digest is not a publisher signature.
        actual_manifest = json.loads((root / "public-site-manifest.json").read_text("utf-8"))
        valid_ready = {"$schema": "prototype-ordax.public-release-catalog/1",
                       "status": "ready", "releases": [demo_release]}
        ready_bytes = json.dumps(valid_ready, separators=(",", ":")).encode("utf-8")
        self_attested = json.loads(json.dumps(actual_manifest))
        self_attested["catalog_status"] = "ready"
        self_attested["publications_sha256"] = "a" * 64
        for record in self_attested["files"]:
            if record["path"] == "releases/catalog.json":
                record["size"] = len(ready_bytes)
                record["sha256"] = hashlib.sha256(ready_bytes).hexdigest()
        invalid_catalogs.append(("forged-catalog-and-manifest", valid_ready))
        for scenario, payload in invalid_catalogs:
            server.catalog_override = payload
            server.manifest_override = (
                self_attested if scenario == "forged-catalog-and-manifest" else None
            )
            try:
                driver.cdp("Emulation.setDeviceMetricsOverride", {
                    "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True
                })
                driver.navigate(f"http://127.0.0.1:{server.server_port}/download/")
                state = {}
                for _ in range(45):
                    state = driver.run("""const status = document.querySelector('[data-download-status] strong');
                    const expected = window.OrdaXPublicI18n?.t('download.error.title');
                    return {
                      errorState: Boolean(status && expected && status.textContent === expected),
                      visibleReleaseLinks: document.querySelectorAll('[data-release-list] a[href]').length,
                      runtimeErrors: window.__ordaxPageErrors || []
                    };""")
                    if state["errorState"]:
                        break
                    time.sleep(0.1)
                state["scenario"] = scenario
                catalog_failure_results.append(state)
                if not state["errorState"] or state["visibleReleaseLinks"] or state["runtimeErrors"]:
                    failures.append({"route": "/download/", "viewport": "poisoned-catalog",
                                     "rule": scenario, "summary": state})
            finally:
                server.catalog_override = None
                server.manifest_override = None
        # A redirected 200 with plausible authenticated JSON must not grant
        # even a verified *visual* account state. Test at the existing browser
        # entry point rather than introducing a second Identity simulator.
        for scenario in ("redirect", "oversized", "wrong-mime"):
            server.auth_session_redirect_for_test = scenario == "redirect"
            server.auth_json_attack_for_test = scenario if scenario != "redirect" else None
            try:
                driver.navigate(f"http://127.0.0.1:{server.server_port}/conta/")
                report = {}
                for _ in range(45):
                    report = driver.run("""return (() => {
                      const panel = document.getElementById('account-session');
                      const poisoned = ['redirect-attacker@example.test', 'untrusted-json@example.test'];
                      const hasPoison = text => poisoned.some(email => text.includes(email));
                      return {
                        status: panel?.dataset?.status || null,
                        hasAttackerEmail: hasPoison(document.body.textContent),
                        hasVerifiedEmail: [...document.querySelectorAll('.verified-email')]
                          .some(node => hasPoison(node.textContent)),
                        errors: window.__ordaxPageErrors || []
                      };
                    })();""")
                    if report["status"] == "unavailable":
                        break
                    time.sleep(0.1)
                report["scenario"] = scenario
                (redirect_identity_results if scenario == "redirect" else json_contract_results).append(report)
                if report["status"] != "unavailable" or report["hasAttackerEmail"] or report["hasVerifiedEmail"] or report["errors"]:
                    failures.append({"route": "/conta/", "viewport": "untrusted-identity-json",
                                     "rule": "reject-" + scenario, "summary": report})
            finally:
                server.auth_session_redirect_for_test = False
                server.auth_json_attack_for_test = None
        # The old /auth/session GET deliberately returns after a newer refresh
        # has failed. The older 200 must not reactivate a login form even for
        # a moment after the 503 was accepted by the current generation.
        server.auth_session_race_for_test = True
        with server.auth_race_lock:
            server.auth_race_requests = 0
        try:
            driver.navigate(f"http://127.0.0.1:{server.server_port}/login/")
            for _ in range(40):
                with server.auth_race_lock:
                    count = server.auth_race_requests
                if count >= 1:
                    break
                time.sleep(0.05)
            if count < 1:
                failures.append({"route": "/login/", "viewport": "session-race",
                                 "rule": "first-session-request-not-seen"})
            else:
                driver.run("""void window.OrdaXPublicAccount.refreshSession(); return true;""")
                for _ in range(40):
                    with server.auth_race_lock:
                        count = server.auth_race_requests
                    if count >= 2:
                        break
                    time.sleep(0.05)
                # Let both concurrent requests resolve and inspect the final
                # state. No credentials or Turnstile provider are invoked.
                time.sleep(1.05)
                report = driver.run("""return (() => {
                  const form = document.querySelector('[data-identity-form]');
                  const state = document.querySelector('[data-identity-state]');
                  return {
                    status: state?.dataset?.status || null,
                    hidden: form?.hidden === true,
                    activeAction: form?.hasAttribute('action') || false,
                    enabledControls: [...(form?.querySelectorAll('input, button') || [])]
                      .filter(control => !control.disabled).length,
                    ready: document.body.dataset.identityReady,
                    errors: window.__ordaxPageErrors || []
                  };
                })();""")
                report["scenario"] = "stale-anonymous-reply-after-session-refresh"
                report["sessionRequests"] = count
                identity_race_results.append(report)
                if count < 2 or report["status"] != "unavailable" or not report["hidden"] or report["activeAction"] or report["enabledControls"] or report["ready"] != "false" or report["errors"]:
                    failures.append({"route": "/login/", "viewport": "session-race",
                                     "rule": "old-session-result-reactivated-form", "summary": report})
        finally:
            server.auth_session_race_for_test = False
        # Changing verified session with the SAME email must clear usage A
        # instantly; an older B request may never override the newer C data.
        server.same_email_usage_test = True
        with server.same_email_lock:
            server.same_email_session_requests = 0
            server.same_email_usage_requests = 0
        try:
            driver.navigate(f"http://127.0.0.1:{server.server_port}/conta/#consumo")
            def usage_probe():
                return driver.run("""return (() => ({
                  session: document.getElementById('account-session')?.dataset?.status,
                  measurement: document.querySelector('.usage-mcp-panel .billing-large')?.textContent?.trim() || '',
                  email: document.querySelector('#account-session .session-email')?.textContent || '',
                  errors: window.__ordaxPageErrors || []
                }))();""")
            initial = {}
            for _ in range(60):
                initial = usage_probe()
                if initial["measurement"] == "91":
                    break
                time.sleep(0.1)
            if initial.get("measurement") != "91":
                failures.append({"route": "/conta/#consumo", "viewport": "same-email-usage",
                                 "rule": "first-observed-session-not-loaded", "summary": initial})
            else:
                driver.run("""void window.OrdaXPublicAccount.refreshSession(); return true;""")
                cleared = usage_probe()
                for _ in range(40):
                    with server.same_email_lock:
                        b_started = server.same_email_usage_requests >= 2
                    if b_started:
                        break
                    time.sleep(0.05)
                driver.run("""void window.OrdaXPublicAccount.refreshSession(); return true;""")
                final = {}
                for _ in range(50):
                    final = usage_probe()
                    if final["measurement"] == "7":
                        break
                    time.sleep(0.1)
                time.sleep(1.2)  # Delayed B (44) must not replace current C (7).
                after_delayed = usage_probe()
                with server.same_email_lock:
                    counts = (server.same_email_session_requests,
                              server.same_email_usage_requests)
                report = {"scenario": "same-email-different-sessions",
                          "initial": initial, "afterRefresh": cleared,
                          "afterCurrent": final, "afterDelayedOldResponse": after_delayed,
                          "sessionAndUsageRequests": counts}
                same_email_usage_results.append(report)
                if (not b_started or counts[0] < 3 or counts[1] < 3
                    or cleared["measurement"] == "91"
                    or final["measurement"] != "7"
                    or after_delayed["measurement"] != "7"
                    or after_delayed["email"] != "same-email@example.test"
                    or after_delayed["session"] != "authenticated"
                    or after_delayed["errors"]):
                    failures.append({"route": "/conta/#consumo", "viewport": "same-email-usage",
                                     "rule": "session-usage-cache-crossed-boundary", "summary": report})
        finally:
            server.same_email_usage_test = False
        # Historic hosted-identity bearer fragments can reach any of the
        # four form routes. The Site must scrub them before even the normal
        # public config request; never consume/store/exchange such tokens.
        # Reuse the existing form route scope rather than adding another list.
        for identity_route in NO_SCRIPT_ROUTES[:4]:
            server.fragment_config_started.clear()
            server.fragment_config_release.clear()
            server.hold_config_for_fragment_test = True
            try:
                driver.navigate(f"http://127.0.0.1:{server.server_port}{identity_route}"
                                "#access_token=synthetic-local-proof&token_type=bearer")
                config_started = server.fragment_config_started.wait(timeout=1.5)
                report = driver.run("""return (() => {
                  const form = document.querySelector('[data-identity-form]');
                  return {
                    hashGone: window.location.hash === '',
                    tokenNotInAddress: !window.location.href.includes('synthetic-local-proof'),
                    formInactive: !form || form.hidden || !form.hasAttribute('action'),
                    errors: window.__ordaxPageErrors || []
                  };
                })();""")
                report["route"] = identity_route
                report["scenario"] = "legacy-fragment-before-config"
                report["configFetchStarted"] = config_started
                report["configStillHeld"] = not server.fragment_config_release.is_set()
                legacy_fragment_results.append(report)
                if (not all((report["hashGone"], report["tokenNotInAddress"],
                             report["formInactive"], report["configFetchStarted"],
                             report["configStillHeld"])) or report["errors"]):
                    failures.append({"route": identity_route,
                                     "viewport": "legacy-bearer-fragment",
                                     "rule": "fragment-not-cleared-before-config",
                                     "summary": report})
            finally:
                server.fragment_config_release.set()
                server.hold_config_for_fragment_test = False
        # Legitimate in-page anchors are not bearer-like fragments. Keep the
        # keyboard skip-link behavior rather than stripping every URL hash.
        driver.navigate(f"http://127.0.0.1:{server.server_port}/cadastro/#conteudo")
        anchor_report = driver.run("""return {
            hashPreserved: window.location.hash === '#conteudo',
            errorFree: !(window.__ordaxPageErrors || []).length
        };""")
        anchor_report["route"] = "/cadastro/"
        anchor_report["scenario"] = "non-credential-skip-link"
        legacy_fragment_results.append(anchor_report)
        if not all(anchor_report[k] for k in ("hashPreserved", "errorFree")):
            failures.append({"route": "/cadastro/", "viewport": "skip-link-fragment",
                             "rule": "legitimate-anchor-stripped",
                             "summary": anchor_report})
        # Restore the default language to keep the no-JavaScript checks independent.
        driver.run("""localStorage.setItem('ordax.public.locale', 'pt-BR'); return true;""")
        # Verify that disabling JavaScript at document parse time cannot
        # expose identity forms, verified identity or the Web launch. Re-enable
        # only after loading to inspect the inert DOM; deferred scripts must
        # not be replayed.
        driver.cdp("Emulation.setDeviceMetricsOverride", {
            "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True
        })
        for route in NO_SCRIPT_ROUTES:
            driver.cdp("Emulation.setScriptExecutionDisabled", {"value": True})
            driver.navigate(f"http://127.0.0.1:{server.server_port}{route}")
            driver.cdp("Emulation.setScriptExecutionDisabled", {"value": False})
            report = no_script_probe(driver)
            name = route.strip("/").replace("/", "-")
            shot = f"noscript-{name}.png"
            driver.shot(evidence / shot)
            report["screenshot"] = shot
            no_script_results.append(report)
            checks = {
                "loaded": report["pathname"] == route and report["hasMain"],
                "visibleNoScriptGuidance": report["noscriptGuidanceVisible"],
                "mainHasSinglePrimaryHeading": report["mainHasSinglePrimaryHeading"],
                "navigationStillAvailable": report["navigationAvailable"],
                "noAuthFormExposed": not report["authFormsExposed"],
                "noCredentialEntryActivated": not report["enabledAuthControls"],
                "noScriptRuntimeActivated": report["noRuntimeActivated"],
                "noFabricatedAccount": report["accountNotVerified"],
                "noWebLaunch": report["webLaunchUnavailable"],
            }
            for rule, good in checks.items():
                if not good:
                    failures.append({"route": route, "viewport": "noscript",
                                     "rule": rule, "summary": report})
        output = {"schema": "ordax.site-browser-proof/3", "routeCount": len(ROUTES),
                  "viewportCount": len(VIEWPORTS), "checks": len(results),
                  "breakpointResponsiveChecks": len(responsive_breakpoint_results),
                  "breakpointResponsiveViewports": sum(
                      len(item["testedWidths"]) for item in responsive_breakpoint_routes.values()
                  ),
                  "breakpointResponsiveRoutes": responsive_breakpoint_routes,
                  "localizedResponsiveChecks": len(localized_responsive_results),
                  "localizedResponsiveViewports": len(LOCALIZATION_VIEWPORTS),
                  "localizedResponsiveLocales": ["pt-BR", "en-US"],
                  "touchResponsiveChecks": len(touch_results),
                  "reflowChecks": len(reflow_results), "textEnlargementChecks": len(text_enlargement_results),
                  "textSpacingChecks": len(text_spacing_results),
                  "noScriptChecks": len(no_script_results),
                  "catalogFailureChecks": len(catalog_failure_results),
                  "fixtureTransportChecks": len(fixture_transport_results),
                  "jsonDeadlineChecks": len(json_deadline_results),
                  "redirectIdentityChecks": len(redirect_identity_results),
                  "jsonContractChecks": len(json_contract_results),
                  "identityRaceChecks": len(identity_race_results),
                  "sameEmailUsageChecks": len(same_email_usage_results),
                  "legacyFragmentChecks": len(legacy_fragment_results),
                  "failures": failures, "results": results,
                  "breakpointResponsiveResults": responsive_breakpoint_results,
                  "localizedResponsiveResults": localized_responsive_results,
                  "touchResults": touch_results,
                  "reflowResults": reflow_results, "textEnlargementResults": text_enlargement_results,
                  "textSpacingResults": text_spacing_results,
                  "noScriptResults": no_script_results,
                  "catalogFailureResults": catalog_failure_results,
                   "fixtureTransportResults": fixture_transport_results,
                   "jsonDeadlineResults": json_deadline_results,
                  "redirectIdentityResults": redirect_identity_results,
                  "jsonContractResults": json_contract_results,
                  "identityRaceResults": identity_race_results,
                  "sameEmailUsageResults": same_email_usage_results,
                  "legacyFragmentResults": legacy_fragment_results}
        (evidence / "report.json").write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if failures:
            raise BrowserProofError(f"{len(failures)} browser checks failed; see report.json; "
                                    + "; ".join(f"{r['route']}@{r['viewport']}:{r['rule']}"
                                      + (":" + json.dumps(r["summary"].get("overflowElements", [])[:6], ensure_ascii=False)
                                         if r["rule"] == "reflowsWithoutPageHorizontalScroll" else "")
                                      + (":" + json.dumps(r["summary"].get("contrast", {}).get("failed", [])[:4], ensure_ascii=False)
                                         if r["rule"] == "measuredFlatSurfaceTextContrast" else "")
                                      + (":" + json.dumps(r["summary"].get("reducedMotion", {}), ensure_ascii=False)
                                         if r["rule"] == "reducedMotionBrowserPreferenceHonored" else "")
                                      + (":" + json.dumps(r["summary"].get("forcedColors", {}), ensure_ascii=False)
                                         if r["rule"] == "nativeForcedColorsAndSkipFocus" else "")
                                      + (":" + json.dumps({
                                           "clippedText":r["summary"].get("clippedText", []),
                                           "overflowElements":r["summary"].get("overflowElements", []),
                                           "documentScrollWidth":r["summary"].get("documentScrollWidth", 0)
                                         }, ensure_ascii=False)
                                         if r["viewport"] == "text-200pct" else "")
                                      + (":" + json.dumps({
                                           "wrongMetrics":r["summary"].get("wrongMetrics", []),
                                           "wrongParagraphMargins":r["summary"].get("wrongParagraphMargins", []),
                                           "clippedText":r["summary"].get("clippedText", []),
                                           "documentScrollWidth":r["summary"].get("documentScrollWidth", 0)
                                         }, ensure_ascii=False)
                                         if str(r["viewport"]).startswith("spacing-") else "")
                                      for r in failures[:15]))
        return output
    finally:
        driver.close()
        child.terminate()
        try:
            child.wait(timeout=4)
        except subprocess.TimeoutExpired:
            child.kill()
        server.shutdown()
        server.server_close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="out/site")
    parser.add_argument("--evidence", default="out/browser-evidence")
    parser.add_argument(
        "--chrome-binary",
        help="Path to Chrome/Chromium when it is not named google-chrome on PATH",
    )
    args = parser.parse_args()
    output = run(Path(args.out).resolve(), Path(args.evidence).resolve(), args.chrome_binary)
    print(f"SITE_BROWSER_PROOF=PASS routes={output['routeCount']} viewports={output['viewportCount']} checks={output['checks']} cssBreakpointViewports={output['breakpointResponsiveViewports']} cssBreakpointChecks={output['breakpointResponsiveChecks']} localeResponsive={output['localizedResponsiveChecks']} localeViewports={output['localizedResponsiveViewports']} touch={output['touchResponsiveChecks']} reflow={output['reflowChecks']} text200={output['textEnlargementChecks']} spacing={output['textSpacingChecks']} noscript={output['noScriptChecks']} catalogReject={output['catalogFailureChecks']} fixtureReject={output['fixtureTransportChecks']} jsonDeadline={output['jsonDeadlineChecks']} redirectIdentity={output['redirectIdentityChecks']} jsonContract={output['jsonContractChecks']} identityRace={output['identityRaceChecks']} usageSession={output['sameEmailUsageChecks']} fragmentScrub={output['legacyFragmentChecks']}")


if __name__ == "__main__":
    try:
        main()
    except (BrowserProofError, OSError, ValueError) as error:
        raise SystemExit(f"SITE_BROWSER_PROOF=FAIL {error}")
