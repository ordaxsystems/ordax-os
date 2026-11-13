#!/usr/bin/env python3
"""Canonical OS-owned untrusted WebKit navigation adapter.

Only the Surface host owns the privileged Native message bridge. This module
owns external WebViews and public-network policy; the Internet product UI is
kept in ordax-apps, and downloads/session state have independent OS owners.
"""
from __future__ import annotations
import ipaddress
import math
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit
import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2  # type: ignore  # noqa: E402

MAX_TABS = 16
MAX_PAGE_FIND_CHARS = 256
MAX_PAGE_FIND_MATCHES = 1000
PAGE_SELECTION_MAX_CHARS = 4096
PAGE_SELECTION_REQUEST_RE = re.compile(r"^selection-[1-9][0-9]{0,8}$")
MAX_URI_LENGTH = 8192
MAX_VIEWPORT_DIMENSION = 16384
TOP_LEVEL_NETWORK_SCHEMES = frozenset({"http", "https"})
RESOURCE_NETWORK_SCHEMES = frozenset({"http", "https", "ws", "wss"})
INTERNAL_RESOURCE_SCHEMES = frozenset({"about", "blob", "data"})
LOCAL_HOST_SUFFIXES = (".localhost", ".local", ".home.arpa")

def public_network_uri(uri: str, schemes: frozenset[str]) -> bool:
    if not isinstance(uri, str) or not uri or len(uri) > MAX_URI_LENGTH:
        return False
    # URL parsers and WebKit can interpret backslashes, embedded controls and
    # userinfo differently. Reject ambiguity before validating the destination.
    if "\\" in uri or any(ord(char) < 0x20 or ord(char) == 0x7f for char in uri):
        return False
    try:
        parsed = urlsplit(uri)
        # Accessing .port validates malformed/out-of-range explicit ports.
        _port = parsed.port
    except ValueError:
        return False
    if parsed.scheme.lower() not in schemes or not parsed.hostname:
        return False
    if parsed.username is not None or parsed.password is not None:
        return False
    # WebKit applies WHATWG host normalization, including percent-decoding.
    # urlsplit does not: a host such as %31%32%37.0.0.1 must never bypass
    # the private-network boundary before WebKit resolves it to 127.0.0.1.
    if "%" in parsed.netloc:
        return False
    try:
        # Unicode dot variants and IDNA compatibility characters can also
        # normalize into local hosts or numeric IPs in the browser engine.
        host = parsed.hostname.encode("idna").decode("ascii").rstrip(".").lower()
    except (UnicodeError, ValueError):
        return False
    if (
        host == "localhost"
        or host.endswith(LOCAL_HOST_SUFFIXES)
        or ("." not in host and ":" not in host)
    ):
        return False

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        # Browsers and libc can accept legacy numeric IPv4 spellings that
        # ipaddress deliberately rejects (for example 0177.0.0.1 or 127.1).
        # Parse those forms without DNS so they cannot masquerade as a name.
        try:
            address = ipaddress.ip_address(socket.inet_aton(host))
        except OSError:
            # DNS names still require server-side Host/origin hardening before
            # the native loopback control plane can be considered rebinding-proof.
            return True
    return address.is_global


def allowed_external_uri(uri: str) -> bool:
    return public_network_uri(uri, TOP_LEVEL_NETWORK_SCHEMES)



def allowed_external_resource_uri(uri: str) -> bool:
    if not isinstance(uri, str) or not uri or len(uri) > MAX_URI_LENGTH:
        return False
    try:
        scheme = urlsplit(uri).scheme.lower()
    except ValueError:
        return False
    if scheme in INTERNAL_RESOURCE_SCHEMES:
        return True
    return public_network_uri(uri, RESOURCE_NETWORK_SCHEMES)


def allocate_popup_tab_id(existing_ids: object) -> str:
    """Give page-opened tabs their own namespace, apart from Surface tab IDs."""
    for index in range(1, MAX_TABS + 1):
        candidate = f"popup-{index}"
        if candidate not in existing_ids:
            return candidate
    raise ValueError("tab limit reached")


def bounded_int(value: object, minimum: int, maximum: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    integer = int(round(value))
    if integer < minimum or integer > maximum:
        return None
    return integer


@dataclass
class BrowserTab:
    tab_id: str
    view: WebKit2.WebView
    url: str = ""
    title: str = ""
    loading: bool = False

    def snapshot(self) -> dict:
        return {
            "id": self.tab_id,
            "url": self.url,
            "title": self.title,
            "loading": bool(self.loading),
            "canGoBack": bool(self.view.can_go_back()),
            "canGoForward": bool(self.view.can_go_forward()),
        }



class InternetNavigationHost:
    """Untrusted page callbacks; no Surface message handlers or capabilities."""

    def create_external_view(self, tab_id: str) -> WebKit2.WebView:
        view = WebKit2.WebView.new_with_context(self.external_context)
        view.set_hexpand(False)
        view.set_vexpand(False)
        view.set_halign(Gtk.Align.START)
        view.set_valign(Gtk.Align.START)
        view.connect("notify::uri", self.on_view_state, tab_id)
        view.connect("notify::title", self.on_view_state, tab_id)
        view.connect("notify::estimated-load-progress", self.on_view_state, tab_id)
        view.connect("load-changed", self.on_load_changed, tab_id)
        view.connect("load-failed", self.on_load_failed, tab_id)
        view.connect("decide-policy", self.on_decide_policy, tab_id)
        view.connect("permission-request", self.on_permission_request, tab_id)
        view.connect("resource-load-started", self.on_resource_load_started, tab_id)
        find_controller = view.get_find_controller()
        find_controller.connect("found-text", self.on_find_found, tab_id)
        find_controller.connect("failed-to-find-text", self.on_find_failed, tab_id)
        self.overlay.add_overlay(view)
        self.overlay.set_overlay_pass_through(view, False)
        view.hide()
        return view

    def open_tab(self, tab_id_value: object, url_value: object) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        # Reject first: an invalid external target must not create a ghost tab
        # or activate a different existing tab before the host rejects it.
        if not isinstance(url_value, str) or (url_value and not allowed_external_uri(url_value)):
            raise ValueError("only public external http/https addresses are allowed")
        self.activate_browser_session()
        if tab_id in self.tabs:
            self.activate_tab(tab_id)
            return
        if len(self.tabs) >= MAX_TABS:
            raise ValueError("tab limit reached")
        view = self.create_external_view(tab_id)
        tab = BrowserTab(tab_id=tab_id, view=view)
        self.tab_registry.attach(tab_id, tab)
        self.update_visibility()
        if url_value:
            self.navigate(tab_id, url_value)
        else:
            self.emit_snapshot()
            self.persist_session()

    def finish_page_find(self) -> None:
        previous = self.find_active_tab_id
        self.find_active_tab_id = None
        self.find_query = ""
        if previous is not None and previous in self.tabs:
            self.tabs[previous].view.get_find_controller().search_finish()

    def handle_page_find(self, action: str, tab_id_value: object, query: object = None) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        tab = self.tabs.get(tab_id)
        if tab is None or tab_id != self.active_tab_id or tab.loading:
            raise ValueError("Page find requires an active loaded tab")
        uri = tab.view.get_uri() or ""
        if uri != tab.url or not allowed_external_uri(uri):
            raise ValueError("Page find requires a public loaded page")
        if action == "page-find.finish":
            self.finish_page_find()
            return
        controller = tab.view.get_find_controller()
        if action == "page-find.search":
            if (
                not isinstance(query, str)
                or len(query) > MAX_PAGE_FIND_CHARS
                or any(ord(char) < 0x20 or ord(char) == 0x7f for char in query)
            ):
                raise ValueError("Page find query is invalid")
            self.finish_page_find()
            if not query:
                return
            self.find_active_tab_id = tab_id
            self.find_query = query
            controller.search(
                query,
                WebKit2.FindOptions.CASE_INSENSITIVE | WebKit2.FindOptions.WRAP_AROUND,
                MAX_PAGE_FIND_MATCHES,
            )
            return
        if self.find_active_tab_id != tab_id or not self.find_query:
            raise ValueError("Page find has no active query")
        if action == "page-find.next":
            controller.search_next()
        elif action == "page-find.previous":
            controller.search_previous()
        else:
            raise ValueError("Unknown Page find action")

    def on_find_found(self, controller: object, count: int, tab_id: str) -> None:
        if tab_id != self.find_active_tab_id or tab_id != self.active_tab_id:
            return
        tab = self.tabs.get(tab_id)
        if tab is None or tab.loading or controller.get_search_text() != self.find_query:
            return
        self.emit_host_event({
            "type": "page-find.result",
            "tabId": tab_id,
            "query": self.find_query,
            "state": "found",
            "count": min(MAX_PAGE_FIND_MATCHES, max(0, int(count))),
        })

    def on_find_failed(self, controller: object, tab_id: str) -> None:
        if tab_id != self.find_active_tab_id or tab_id != self.active_tab_id:
            return
        if tab_id not in self.tabs or controller.get_search_text() != self.find_query:
            return
        self.emit_host_event({
            "type": "page-find.result",
            "tabId": tab_id,
            "query": self.find_query,
            "state": "not-found",
            "count": 0,
        })

    def close_tab(self, tab_id_value: object) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        if self.find_active_tab_id == tab_id:
            self.finish_page_find()
        tab = self.tab_registry.detach(tab_id)
        if tab is None:
            return
        self.overlay.remove(tab.view)
        self.update_visibility()
        self.emit_snapshot()
        self.persist_session()

    def activate_tab(self, tab_id_value: object) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        if tab_id not in self.tabs:
            raise ValueError("unknown tab")
        if self.find_active_tab_id != tab_id:
            self.finish_page_find()
        self.tab_registry.select(tab_id)
        self.update_visibility()
        self.emit_snapshot()
        self.persist_session()

    def navigate(self, tab_id_value: object, url_value: object) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        if tab_id not in self.tabs:
            raise ValueError("unknown tab")
        if not isinstance(url_value, str) or not allowed_external_uri(url_value):
            raise ValueError("only public external http/https addresses are allowed")
        if self.find_active_tab_id == tab_id:
            self.finish_page_find()
        tab = self.tabs[tab_id]
        tab.url = url_value
        tab.loading = True
        tab.view.load_uri(url_value)
        self.update_visibility()
        self.emit_snapshot()
        self.persist_session()

    def capture_page_selection(self, request_id: object, tab_id_value: object) -> None:
        # Only the trusted Surface bridge may request this one-shot action.
        # External pages have no OrdaX message handler.
        if not isinstance(request_id, str) or PAGE_SELECTION_REQUEST_RE.fullmatch(request_id) is None:
            raise ValueError("invalid page selection request id")
        tab_id = self.valid_tab_id(tab_id_value)

        def unavailable() -> None:
            self.emit_host_event({
                "type": "page-selection.result",
                "requestId": request_id,
                "tabId": tab_id,
                "error": "unavailable",
            })

        tab = self.tabs.get(tab_id)
        if tab is None or tab_id != self.active_tab_id or tab.loading:
            unavailable()
            return
        view = tab.view
        uri = view.get_uri() or ""
        if uri != tab.url or not allowed_external_uri(uri):
            unavailable()
            return

        # Retrieve only what the user highlighted, never arbitrary DOM, cookies
        # or hidden inputs. The excerpt is untrusted website data.
        script = (
            "(()=>{const selection=window.getSelection();"
            "return selection ? String(selection).slice(0,4097) : '';})()"
        )

        def completed(_view: object, result: object) -> None:
            # Ignore late callbacks if tab/URL/active scope changed mid-flight.
            current = self.tabs.get(tab_id)
            if (
                current is not tab or self.active_tab_id != tab_id
                or current.loading or (view.get_uri() or "") != uri
                or not allowed_external_uri(uri)
            ):
                unavailable()
                return
            try:
                js_result = view.run_javascript_finish(result)
                selected = js_result.get_js_value().to_string()
                if not isinstance(selected, str):
                    raise ValueError("invalid page selection")
                selected = selected.strip()
                if not selected:
                    raise ValueError("empty page selection")
                truncated = len(selected) > PAGE_SELECTION_MAX_CHARS
                selected = selected[:PAGE_SELECTION_MAX_CHARS]
                title = (view.get_title() or "")[:256]
                self.emit_host_event({
                    "type": "page-selection.result",
                    "requestId": request_id,
                    "tabId": tab_id,
                    "selection": {
                        "schema": "ordax.browser-page-selection/1",
                        "kind": "selection",
                        "source": "untrusted-web-content",
                        "tabId": tab_id,
                        "url": uri,
                        "title": title,
                        "text": selected,
                        "truncated": truncated,
                    },
                })
            except Exception:
                unavailable()

        try:
            view.run_javascript(script, None, completed, None)
        except Exception:
            unavailable()

    def history_action(self, tab_id_value: object, action: str) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        tab = self.tabs.get(tab_id)
        if tab is None:
            raise ValueError("unknown tab")
        if action == "back" and tab.view.can_go_back():
            tab.view.go_back()
        elif action == "forward" and tab.view.can_go_forward():
            tab.view.go_forward()
        elif action == "reload" and tab.url:
            tab.view.reload()

    def set_viewport(self, value: object) -> None:
        if not isinstance(value, dict) or not isinstance(value.get("visible"), bool):
            raise ValueError("invalid viewport")
        x = bounded_int(value.get("x", 0), 0, MAX_VIEWPORT_DIMENSION)
        y = bounded_int(value.get("y", 0), 0, MAX_VIEWPORT_DIMENSION)
        width = bounded_int(value.get("width", 0), 0, MAX_VIEWPORT_DIMENSION)
        height = bounded_int(value.get("height", 0), 0, MAX_VIEWPORT_DIMENSION)
        if None in {x, y, width, height}:
            raise ValueError("invalid viewport geometry")
        if value["visible"]:
            self.activate_browser_session()
        self.viewport = {
            "visible": value["visible"],
            "x": x,
            "y": y,
            "width": width,
            "height": height,
        }
        self.update_visibility()

    def update_visibility(self) -> None:
        for tab_id, tab in self.tabs.items():
            visible = (
                tab_id == self.active_tab_id
                and bool(tab.url)
                and bool(self.viewport["visible"])
                and self.viewport["width"] > 1
                and self.viewport["height"] > 1
            )
            if visible:
                tab.view.set_margin_start(self.viewport["x"])
                tab.view.set_margin_top(self.viewport["y"])
                tab.view.set_size_request(self.viewport["width"], self.viewport["height"])
                tab.view.show()
            else:
                tab.view.hide()

    def on_view_state(self, view: WebKit2.WebView, _spec: object, tab_id: str) -> None:
        tab = self.tabs.get(tab_id)
        if tab is None:
            return
        uri = view.get_uri() or ""
        if uri and uri != "about:blank":
            tab.url = uri
        tab.title = view.get_title() or tab.title
        self.emit_snapshot()

    def on_load_changed(self, view: WebKit2.WebView, event: WebKit2.LoadEvent, tab_id: str) -> None:
        tab = self.tabs.get(tab_id)
        if tab is None:
            return
        if event != WebKit2.LoadEvent.FINISHED and self.find_active_tab_id == tab_id:
            self.finish_page_find()
        tab.loading = event != WebKit2.LoadEvent.FINISHED
        uri = view.get_uri() or ""
        if uri and uri != "about:blank":
            tab.url = uri
        tab.title = view.get_title() or tab.title
        self.emit_snapshot()
        if event == WebKit2.LoadEvent.FINISHED:
            self.persist_session()

    def on_load_failed(
        self,
        _view: WebKit2.WebView,
        _event: WebKit2.LoadEvent,
        _failing_uri: str,
        _error: object,
        tab_id: str,
    ) -> bool:
        tab = self.tabs.get(tab_id)
        if tab is not None:
            tab.loading = False
            self.emit_snapshot()
            self.persist_session()
        return False

    def on_decide_policy(
        self,
        _view: WebKit2.WebView,
        decision: WebKit2.PolicyDecision,
        decision_type: WebKit2.PolicyDecisionType,
        _tab_id: str,
    ) -> bool:
        if decision_type not in {
            WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
            WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION,
        }:
            return False
        new_window = decision_type == WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION
        try:
            action = decision.get_navigation_action()
            uri = action.get_request().get_uri()
            user_gesture = bool(action.is_user_gesture()) if new_window else False
        except Exception:
            decision.ignore()
            return True
        if not allowed_external_uri(uri):
            decision.ignore()
            return True
        if new_window:
            # A page can request a popup, but it cannot create arbitrary browser
            # windows or gain the privileged Surface bridge. Only explicit
            # user-initiated links enter a regular isolated browser tab.
            decision.ignore()
            if not user_gesture or _tab_id not in self.tabs or len(self.tabs) >= MAX_TABS:
                return True
            try:
                self.open_tab(allocate_popup_tab_id(self.tabs), uri)
            except (TypeError, ValueError):
                # The native tab host remains authoritative for the limit and URI.
                return True
            return True
        return False

    def on_resource_load_started(
        self,
        _view: WebKit2.WebView,
        resource: WebKit2.WebResource,
        request: WebKit2.URIRequest,
        tab_id: str,
    ) -> None:
        resource.connect("send-request", self.on_resource_send_request, tab_id)
        try:
            uri = request.get_uri()
        except Exception:
            return
        if not allowed_external_resource_uri(uri):
            # The first request exists before WebResource::send-request. Rewrite
            # it to a non-network URI; redirects are rejected by the callback.
            try:
                request.set_uri("about:blank")
            except Exception:
                pass

    def on_resource_send_request(
        self,
        _resource: WebKit2.WebResource,
        request: WebKit2.URIRequest,
        _redirected_response: object,
        _tab_id: str,
    ) -> bool:
        try:
            uri = request.get_uri()
        except Exception:
            return True
        return not allowed_external_resource_uri(uri)

    def on_permission_request(self, _view: WebKit2.WebView, request: object, _tab_id: str) -> bool:
        try:
            request.deny()
        except Exception:
            pass
        return True
