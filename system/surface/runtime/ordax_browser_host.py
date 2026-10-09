#!/usr/bin/env python3
"""Native OrdaX graphical host with an isolated WebKit browser plane.

The privileged OrdaX Surface lives in one WebView that alone owns the native
message bridge. Arbitrary Internet content lives in separate WebViews created
from a separate persistent WebContext and never receives that bridge.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import math
import os
import re
import socket
import secrets
import sys
import threading
from dataclasses import dataclass
from urllib.parse import urlsplit

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # type: ignore  # noqa: E402

from browser_session_store import load_browser_session, save_browser_session
from native_app_data_port_bootstrap import (
    DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH,
    NativeAppDataPortBootstrapError,
    consume_app_data_port_bootstrap,
)
from native_component_probation import (
    ComponentProbationReceiptError,
    record_system_component_probation,
)
from native_profile_consent_ipc import (
    DECISION_SCHEMA as PROFILE_CONSENT_DECISION_SCHEMA,
    ProfileConsentIpcServer,
)
from native_security_prompt_i18n import (
    profile_consent_messages,
    read_native_security_locale,
)

BRIDGE_NAME = "ordaxBrowser"
APP_DATA_COMPOSITION_BOOTSTRAP_SCHEMA = "ordax.native-app-data-composition-bootstrap/1"
TRUSTED_STATE_UID = 0
TAB_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
MAX_TABS = 16
MAX_PAGE_FIND_CHARS = 256
MAX_PAGE_FIND_MATCHES = 1000
PAGE_SELECTION_MAX_CHARS = 4096
PAGE_SELECTION_REQUEST_RE = re.compile(r"^selection-[1-9][0-9]{0,8}$")
MAX_URI_LENGTH = 8192
SUPPORTED_PROBATION_COMPONENTS = ("internet", "notes")
MAX_VIEWPORT_DIMENSION = 16384
TOP_LEVEL_NETWORK_SCHEMES = frozenset({"http", "https"})
RESOURCE_NETWORK_SCHEMES = frozenset({"http", "https", "ws", "wss"})
INTERNAL_RESOURCE_SCHEMES = frozenset({"about", "blob", "data"})
LOCAL_HOST_SUFFIXES = (".localhost", ".local", ".home.arpa")
HOST_SHORTCUTS = (
    ("<Primary>l", "focus-address", True),
    ("<Primary>f", "focus-page-find", True),
    ("<Primary>t", "new-tab", True),
    ("<Primary>w", "close-tab", False),
    ("<Primary>r", "reload", False),
    ("<Alt>Left", "back", False),
    ("<Alt>Right", "forward", False),
)


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


class OrdaXBrowserHost:
    def __init__(
        self,
        start_uri: str,
        profile_root: str,
        component_channel_bin: str,
        component_slot_root: str,
        cache_root: str,
        distribution_profile: str,
    ) -> None:
        self.start_uri = start_uri
        self.profile_root = os.path.abspath(profile_root)
        self.component_channel_bin = component_channel_bin
        self.component_slot_root = component_slot_root
        self.cache_root = os.path.abspath(cache_root)
        self.distribution_profile = distribution_profile
        if self.distribution_profile not in {"owner-development", "stable-mvp"}:
            raise ValueError("invalid OrdaX distribution profile")
        if self.distribution_profile == "stable-mvp":
            if os.geteuid() != TRUSTED_STATE_UID:
                raise PermissionError("Stable App Data browser bootstrap requires root-owned runtime state")
            self.app_data_bootstrap_bindings = consume_app_data_port_bootstrap(
                DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH,
                expected_uid=TRUSTED_STATE_UID,
            )
        else:
            self.app_data_bootstrap_bindings = ()
        self.app_data_bootstrap_served = False
        self.component_probation_started = False
        self.component_probation_nonces: dict[str, str] = {}
        self.component_probation_rerun_requested: set[str] = set()
        self.session_path = os.path.join(self.profile_root, "session.json")
        self.tabs: dict[str, BrowserTab] = {}
        self.active_tab_id: str | None = None
        self.find_active_tab_id: str | None = None
        self.find_query = ""
        self.viewport = {"visible": False, "x": 0, "y": 0, "width": 0, "height": 0}
        self.restoring_session = False
        self.last_persisted_session: tuple[tuple[str, ...], int | None] | None = None
        self.accelerator_callbacks = []
        self.profile_consent_ipc = ProfileConsentIpcServer()
        self.profile_consent_listener = None
        self.profile_consent_thread = None
        self.profile_consent_stopping = threading.Event()

        os.makedirs(self.profile_root, mode=0o700, exist_ok=True)
        profile_data = os.path.join(self.profile_root, "default", "data")
        profile_cache = os.path.join(self.cache_root, "default")
        os.makedirs(profile_data, mode=0o700, exist_ok=True)
        os.makedirs(profile_cache, mode=0o700, exist_ok=True)

        data_manager = WebKit2.WebsiteDataManager(
            base_data_directory=profile_data,
            base_cache_directory=profile_cache,
        )
        self.external_context = WebKit2.WebContext.new_with_website_data_manager(data_manager)
        self.external_context.set_preferred_languages(["pt-BR", "en-US"])
        self.external_context.connect("download-started", self.on_download_started)

        self.manager = WebKit2.UserContentManager.new()
        self.manager.connect(f"script-message-received::{BRIDGE_NAME}", self.on_surface_message)
        if not self.manager.register_script_message_handler(BRIDGE_NAME):
            raise RuntimeError("failed to register OrdaX browser bridge")

        self.surface_view = WebKit2.WebView.new_with_user_content_manager(self.manager)
        self.surface_view.set_hexpand(True)
        self.surface_view.set_vexpand(True)
        self.surface_view.connect("load-changed", self.on_surface_load_changed)
        self.surface_view.load_uri(self.start_uri)

        self.overlay = Gtk.Overlay()
        self.overlay.add(self.surface_view)

        self.window = Gtk.Window(title="OrdaX")
        self.window.set_default_size(1366, 768)
        self.window.add(self.overlay)
        self.window.connect("destroy", self.on_window_destroy)
        self.accel_group = Gtk.AccelGroup()
        self.window.add_accel_group(self.accel_group)
        for accelerator, action, focus_surface in HOST_SHORTCUTS:
            self.register_shortcut(accelerator, action, focus_surface)
        self.window.fullscreen()
        self.window.show_all()
        if self.distribution_profile == "owner-development":
            self.start_profile_consent_listener()
        self.restore_session()

    def start_profile_consent_listener(self) -> None:
        self.profile_consent_listener = self.profile_consent_ipc.open()
        self.profile_consent_listener.settimeout(1.0)

        def serve() -> None:
            while not self.profile_consent_stopping.is_set():
                try:
                    connection, _ = self.profile_consent_listener.accept()
                except socket.timeout:
                    continue
                except OSError:
                    if self.profile_consent_stopping.is_set():
                        return
                    raise
                with connection:
                    try:
                        request = self.profile_consent_ipc.receive_request(connection)
                        decision = self.present_profile_consent_from_worker(request)
                        self.profile_consent_ipc.send_decision(
                            connection,
                            decision,
                            expected_request_id=request["requestId"],
                        )
                    except (ConnectionError, OSError, PermissionError, TypeError, ValueError) as exc:
                        print(
                            f"ordax-browser-host: Profile consent request rejected: {exc}",
                            file=sys.stderr,
                            flush=True,
                        )

        self.profile_consent_thread = threading.Thread(
            target=serve,
            name="ordax-profile-consent",
            daemon=True,
        )
        self.profile_consent_thread.start()

    def present_profile_consent_from_worker(self, request: dict) -> dict:
        finished = threading.Event()
        result: dict[str, bool] = {}

        def present() -> bool:
            try:
                result["approved"] = self.present_profile_consent_dialog(request)
            finally:
                finished.set()
            return False

        GLib.idle_add(present)
        if not finished.wait(timeout=120):
            raise TimeoutError("Profile consent Native dialog timed out")
        return {
            "schema": PROFILE_CONSENT_DECISION_SCHEMA,
            "requestId": request["requestId"],
            "approved": bool(result.get("approved", False)),
        }

    def present_profile_consent_dialog(self, request: dict) -> bool:
        profile = request["profile"]
        permission_diff = request["permissionDiff"]
        additions = permission_diff.get("componentAdds", [])
        authorities = permission_diff.get("authorityChanges", [])
        messages = profile_consent_messages(read_native_security_locale())

        dialog = Gtk.Dialog(
            title=messages["windowTitle"],
            transient_for=self.window,
            modal=True,
            destroy_with_parent=True,
        )
        dialog.add_button(messages["cancel"], Gtk.ResponseType.CANCEL)
        approve_button = dialog.add_button(messages["approve"], Gtk.ResponseType.OK)
        approve_button.get_style_context().add_class("suggested-action")
        dialog.set_default_response(Gtk.ResponseType.CANCEL)
        dialog.set_resizable(False)

        content = dialog.get_content_area()
        content.set_spacing(12)
        content.set_border_width(24)

        title = Gtk.Label()
        title.set_markup(f"<b>{messages['heading']}</b>")
        title.set_xalign(0.0)
        content.pack_start(title, False, False, 0)

        detail = Gtk.Label(
            label=(
                f"{messages['profile']}: {profile['slug']} v{profile['version']}\n"
                f"{messages['space']}: {request['spaceId']}\n"
                f"{messages['componentsAdded']}: {len(additions)}\n"
                f"{messages['authorityChanges']}: {len(authorities)}"
            )
        )
        detail.set_xalign(0.0)
        detail.set_selectable(True)
        content.pack_start(detail, False, False, 0)

        if additions:
            component_lines = "\n".join(
                f"• {entry.get('id', messages['component'])} "
                f"({entry.get('kind', messages['unknown'])})"
                for entry in additions
            )
            component_label = Gtk.Label(label=component_lines)
            component_label.set_xalign(0.0)
            component_label.set_selectable(True)
            content.pack_start(component_label, False, False, 0)

        warning = Gtk.Label(
            label=messages["warning"]
        )
        warning.set_xalign(0.0)
        warning.set_line_wrap(True)
        content.pack_start(warning, False, False, 0)

        dialog.show_all()
        response = dialog.run()
        dialog.destroy()
        return response == Gtk.ResponseType.OK

    def start_component_probation(self, component_ids: tuple[str, ...]) -> bool:
        attempts: dict[str, str] = {}
        for component_id in component_ids:
            if component_id not in SUPPORTED_PROBATION_COMPONENTS:
                raise ValueError("unsupported component probation request")
            if component_id in self.component_probation_nonces:
                self.component_probation_rerun_requested.add(component_id)
                continue
            nonce = secrets.token_urlsafe(32)
            self.component_probation_nonces[component_id] = nonce
            attempts[component_id] = nonce

        if not attempts:
            return False

        encoded_attempts = json.dumps(
            attempts,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        script = f"""
(async () => {{
  const attempts = {encoded_attempts};
  let module;
  let moduleError;
  try {{
    module = await import('/composition/native/component-probation.mjs');
  }} catch (error) {{
    moduleError = error;
  }}
  for (const [componentId, nonce] of Object.entries(attempts)) {{
    let result;
    try {{
      if (moduleError) {{
        throw moduleError;
      }}
      result = await module.runNativePendingComponentProbation({{
        componentId,
      }});
    }} catch (error) {{
      result = {{
        schema: 'ordax.component-probation-result/1',
        componentId,
        version: null,
        sourceCommit: null,
        revision: null,
        health: 'failed',
        probeMode: 'import-contract',
        error: error instanceof Error ? error.message : 'System component probation failed',
      }};
    }}
    window.webkit.messageHandlers.ordaxBrowser.postMessage(JSON.stringify({{
      type: 'component.probation.result',
      nonce,
      result,
    }}));
  }}
}})();
"""
        try:
            self.surface_view.run_javascript(script, None, None, None)
        except Exception as exc:  # pragma: no cover - native runtime diagnostic
            for component_id, nonce in attempts.items():
                if self.component_probation_nonces.get(component_id) == nonce:
                    self.component_probation_nonces.pop(component_id, None)
                self.component_probation_rerun_requested.discard(component_id)
            print(
                f"ordax-browser-host: failed to start component probation: {exc}",
                file=sys.stderr,
                flush=True,
            )
            return False
        return True

    def on_surface_load_changed(self, _view: object, load_event: object) -> None:
        if load_event != WebKit2.LoadEvent.FINISHED or self.component_probation_started:
            return
        self.component_probation_started = True
        self.start_component_probation(SUPPORTED_PROBATION_COMPONENTS)

    def handle_component_probation_request(self, payload: dict) -> None:
        if set(payload) != {"type", "componentId"}:
            raise ValueError("component probation request fields are invalid")
        component_id = payload.get("componentId")
        if component_id not in SUPPORTED_PROBATION_COMPONENTS:
            raise ValueError("unsupported component probation request")
        self.start_component_probation((component_id,))

    def handle_component_probation_result(self, payload: dict) -> None:
        result = payload.get("result") if isinstance(payload, dict) else None
        component_id = result.get("componentId") if isinstance(result, dict) else None
        expected_nonce = (
            self.component_probation_nonces.get(component_id)
            if isinstance(component_id, str)
            else None
        )
        if expected_nonce is None:
            raise ValueError(
                "component probation receipt arrived without active component nonce"
            )

        try:
            outcome = record_system_component_probation(
                payload=payload,
                expected_nonce=expected_nonce,
                helper_path=self.component_channel_bin,
                slot_root=self.component_slot_root,
            )
        except ComponentProbationReceiptError as exc:
            raise ValueError(str(exc)) from exc

        # Consume only the nonce bound to the validated component receipt.
        self.component_probation_nonces.pop(component_id, None)
        rerun_requested = component_id in self.component_probation_rerun_requested
        if rerun_requested:
            self.component_probation_rerun_requested.discard(component_id)

        if not outcome.actionable:
            print(
                f"ordax-browser-host: component probation produced no actionable pending receipt "
                f"(component={component_id})",
                file=sys.stderr,
                flush=True,
            )
            if rerun_requested:
                self.start_component_probation((component_id,))
            return
        if outcome.recorded is None:
            print(
                f"ordax-browser-host: pending component health rejected safely: {outcome.reason}",
                file=sys.stderr,
                flush=True,
            )
            if rerun_requested:
                self.start_component_probation((component_id,))
            return

        print(
            "ordax-browser-host: pending component health recorded "
            f"(component={outcome.recorded.component_id}, "
            f"revision={outcome.recorded.revision}, "
            f"health={outcome.recorded.health})",
            file=sys.stderr,
            flush=True,
        )
        if rerun_requested:
            self.start_component_probation((component_id,))

    def emit_app_data_bootstrap(self) -> None:
        if self.app_data_bootstrap_served:
            raise ValueError("App Data bootstrap was already consumed by Native composition")
        payload = {
            "schema": APP_DATA_COMPOSITION_BOOTSTRAP_SCHEMA,
            "bindings": [entry.as_payload() for entry in self.app_data_bootstrap_bindings],
        }
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        script = (
            "(async()=>{const module=await import('/composition/native/app-data-bootstrap.mjs');"
            "module.acceptTrustedNativeAppDataBootstrap("
            + encoded
            + ");})().catch((error)=>console.error('OrdaX App Data bootstrap delivery failed',error));"
        )
        self.surface_view.run_javascript(script, None, None, None)
        self.app_data_bootstrap_served = True
        self.app_data_bootstrap_bindings = ()

    def emit_host_event(self, payload: dict) -> None:
        encoded = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
        script = (
            "window.dispatchEvent(new CustomEvent('ordax-browser-host',{detail:"
            + encoded
            + "}));"
        )
        try:
            self.surface_view.run_javascript(script, None, None, None)
        except Exception as exc:  # pragma: no cover - native runtime diagnostic
            print(f"ordax-browser-host: failed to emit host event: {exc}", file=sys.stderr, flush=True)

    def emit_snapshot(self) -> None:
        snapshot = {
            "supported": True,
            "reason": "",
            "activeTabId": self.active_tab_id,
            "tabs": [tab.snapshot() for tab in self.tabs.values()],
        }
        self.emit_host_event({"type": "snapshot", "snapshot": snapshot})

    def register_shortcut(self, accelerator: str, action: str, focus_surface: bool) -> None:
        keyval, modifiers = Gtk.accelerator_parse(accelerator)
        if not keyval:
            raise RuntimeError(f"invalid browser accelerator {accelerator!r}")

        def callback(*_args) -> bool:
            if focus_surface:
                self.surface_view.grab_focus()
            self.emit_host_event({"type": "shortcut", "action": action})
            return True

        self.accelerator_callbacks.append(callback)
        self.accel_group.connect(
            keyval,
            modifiers,
            Gtk.AccelFlags.VISIBLE,
            callback,
        )

    def decode_message(self, result: object) -> dict | None:
        try:
            js_value = result.get_js_value()
            raw = js_value.to_string()
            payload = json.loads(raw)
        except Exception as exc:
            print(f"ordax-browser-host: rejected malformed bridge message: {exc}", file=sys.stderr, flush=True)
            return None
        return payload if isinstance(payload, dict) else None

    def on_surface_message(self, _manager: object, result: object) -> None:
        payload = self.decode_message(result)
        if payload is None:
            return
        command = payload.get("type")
        try:
            if command == "app-data.bootstrap.request":
                if set(payload) != {"type"}:
                    raise ValueError("App Data bootstrap request fields are invalid")
                self.emit_app_data_bootstrap()
            elif command == "snapshot.request":
                self.emit_snapshot()
            elif command == "tab.open":
                self.open_tab(payload.get("tabId"), payload.get("url", ""))
            elif command == "page-selection.capture":
                if set(payload) != {"type", "requestId", "tabId"}:
                    raise ValueError("Page selection request fields are invalid")
                self.capture_page_selection(payload.get("requestId"), payload.get("tabId"))
            elif command in {"page-find.search", "page-find.next", "page-find.previous", "page-find.finish"}:
                expected = {"type", "tabId", "query"} if command == "page-find.search" else {"type", "tabId"}
                if set(payload) != expected:
                    raise ValueError("Page find command fields are invalid")
                self.handle_page_find(command, payload.get("tabId"), payload.get("query"))
            elif command == "tab.close":
                self.close_tab(payload.get("tabId"))
            elif command == "tab.activate":
                self.activate_tab(payload.get("tabId"))
            elif command == "tab.navigate":
                self.navigate(payload.get("tabId"), payload.get("url"))
            elif command == "tab.back":
                self.history_action(payload.get("tabId"), "back")
            elif command == "tab.forward":
                self.history_action(payload.get("tabId"), "forward")
            elif command == "tab.reload":
                self.history_action(payload.get("tabId"), "reload")
            elif command == "viewport.set":
                self.set_viewport(payload.get("viewport"))
            elif command == "component.probation.request":
                self.handle_component_probation_request(payload)
            elif command == "component.probation.result":
                self.handle_component_probation_result(payload)
        except (TypeError, ValueError) as exc:
            print(f"ordax-browser-host: rejected {command!r}: {exc}", file=sys.stderr, flush=True)

    def valid_tab_id(self, tab_id: object) -> str:
        if not isinstance(tab_id, str) or TAB_ID_RE.fullmatch(tab_id) is None:
            raise ValueError("invalid tab id")
        return tab_id

    def persist_session(self) -> None:
        if self.restoring_session:
            return
        persisted_tabs = [
            (tab_id, tab.url)
            for tab_id, tab in self.tabs.items()
            if tab.url and allowed_external_uri(tab.url)
        ]
        active_index = next(
            (
                index
                for index, (tab_id, _url) in enumerate(persisted_tabs)
                if tab_id == self.active_tab_id
            ),
            None,
        )
        session_key = (
            tuple(url for _tab_id, url in persisted_tabs),
            active_index,
        )
        if session_key == self.last_persisted_session:
            return
        try:
            saved = save_browser_session(
                self.session_path,
                session_key[0],
                active_index,
                allow_url=allowed_external_uri,
                max_tabs=MAX_TABS,
            )
            self.last_persisted_session = (saved.urls, saved.active_index)
        except (OSError, ValueError) as exc:
            print(f"ordax-browser-host: could not persist tab session: {exc}", file=sys.stderr, flush=True)

    def restore_session(self) -> None:
        state = load_browser_session(
            self.session_path,
            allow_url=allowed_external_uri,
            max_tabs=MAX_TABS,
        )
        if not state.urls:
            return
        self.last_persisted_session = (state.urls, state.active_index)
        self.restoring_session = True
        try:
            for index, url in enumerate(state.urls, start=1):
                self.open_tab(f"tab-{index}", url)
            if state.active_index is not None:
                self.activate_tab(f"tab-{state.active_index + 1}")
        finally:
            self.restoring_session = False
        self.persist_session()

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
        if tab_id in self.tabs:
            self.activate_tab(tab_id)
            return
        if len(self.tabs) >= MAX_TABS:
            raise ValueError("tab limit reached")
        view = self.create_external_view(tab_id)
        tab = BrowserTab(tab_id=tab_id, view=view)
        self.tabs[tab_id] = tab
        self.active_tab_id = tab_id
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
        tab = self.tabs.pop(tab_id, None)
        if tab is None:
            return
        self.overlay.remove(tab.view)
        if self.active_tab_id == tab_id:
            self.active_tab_id = next(reversed(self.tabs), None) if self.tabs else None
        self.update_visibility()
        self.emit_snapshot()
        self.persist_session()

    def activate_tab(self, tab_id_value: object) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        if tab_id not in self.tabs:
            raise ValueError("unknown tab")
        if self.find_active_tab_id != tab_id:
            self.finish_page_find()
        self.active_tab_id = tab_id
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

    def on_download_started(self, _context: WebKit2.WebContext, download: object) -> None:
        try:
            download.cancel()
        except Exception:
            pass

    def on_window_destroy(self, _window: Gtk.Window) -> None:
        self.app_data_bootstrap_bindings = ()
        self.persist_session()
        self.profile_consent_stopping.set()
        self.profile_consent_ipc.close()
        if self.profile_consent_thread is not None:
            self.profile_consent_thread.join(timeout=2)
        Gtk.main_quit()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OrdaX native Surface/browser host")
    parser.add_argument("--start-uri", required=True)
    parser.add_argument("--profile-root", default="/var/lib/ordax-user/browser")
    parser.add_argument("--cache-root", default="/run/ordax/browser-cache")
    parser.add_argument(
        "--component-channel-bin",
        default="/srv/ordax-system/bin/ordax-runtime-component-channel",
    )
    parser.add_argument("--component-slot-root", default="/var/lib/ordax/components")
    parser.add_argument(
        "--distribution-profile",
        choices=("owner-development", "stable-mvp"),
        required=True,
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.start_uri.startswith("http://127.0.0.1:"):
        print("ordax-browser-host: Surface start URI must stay on loopback", file=sys.stderr)
        return 2
    try:
        OrdaXBrowserHost(
            args.start_uri,
            args.profile_root,
            args.component_channel_bin,
            args.component_slot_root,
            args.cache_root,
            args.distribution_profile,
        )
    except NativeAppDataPortBootstrapError as exc:
        print(f"ordax-browser-host: App Data bootstrap failed closed: {exc}", file=sys.stderr, flush=True)
        return 3
    except Exception as exc:
        print(f"ordax-browser-host: startup failed: {exc}", file=sys.stderr, flush=True)
        return 1
    Gtk.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())