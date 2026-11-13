#!/usr/bin/env python3
"""OS-owned WebKit download adapter, isolated from the privileged Surface.

The Internet product owns its UI in ordax-apps. This class only handles
explicitly authorized untrusted WebView transfers and filesystem policy.
"""
from __future__ import annotations

import os
import re
import secrets

import gi
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, WebKit2  # type: ignore  # noqa: E402

from browser_download_policy import (
    download_destination,
    ensure_download_space,
    safe_download_name,
    verified_download,
)


class InternetDownloadHost:
    """Callbacks for external WebViews only; never registers a Surface bridge.

    Implementing host supplies downloads, tabs, active_tab_id, emit_host_event,
    download_user_root and the canonical allowed_untrusted_uri predicate.
    """

    def emit_download_state(self, item: dict, status: str) -> None:
        item["status"] = status
        self.emit_host_event({
            "type": "browser-download",
            "id": item["id"],
            "status": status,
            "fileName": item["file_name"],
        })

    def remove_download_timeout(self, item: dict) -> None:
        source = item.pop("timeout", None)
        if source is not None:
            try:
                GLib.source_remove(source)
            except Exception:
                pass

    def cancel_download_item(self, item: dict, status: str = "cancelled") -> None:
        if item["status"] not in {"pending", "downloading", "starting"}:
            return
        self.remove_download_timeout(item)
        self.emit_download_state(item, status)
        try:
            item["download"].cancel()
        except Exception:
            pass

    def timeout_download(self, download_id: str) -> bool:
        item = self.downloads.get(download_id)
        if item and item["status"] == "pending":
            item["timeout"] = None
            self.cancel_download_item(item)
        return False

    def on_download_started(self, _context: WebKit2.WebContext, download: object) -> None:
        try:
            request_uri = download.get_request().get_uri()
            view = download.get_web_view()
            tab = self.tabs.get(self.active_tab_id)
            if (
                not self.allowed_untrusted_uri(request_uri) or tab is None
                or tab.view is not view
                or not self.allowed_untrusted_uri(tab.url)
                or len(self.downloads) >= 4
            ):
                download.cancel()
                return
            download_id = "download-" + secrets.token_hex(8)
            item = {
                "id": download_id, "download": download, "tab_id": tab.tab_id,
                "file_name": "download.bin", "status": "starting",
                "path": None, "created": False, "timeout": None, "declared_bytes": None,
            }
            self.downloads[download_id] = item
            download.connect("decide-destination", self.on_download_decide_destination, download_id)
            download.connect("created-destination", self.on_download_destination_created, download_id)
            download.connect("received-data", self.on_download_received_data, download_id)
            download.connect("failed", self.on_download_failed, download_id)
            download.connect("finished", self.on_download_finished, download_id)
        except Exception:
            try:
                download.cancel()
            except Exception:
                pass

    def on_download_decide_destination(
        self, download: object, suggested_name: str, download_id: str
    ) -> bool:
        item = self.downloads.get(download_id)
        if not item or item["status"] != "starting":
            download.cancel()
            return True
        try:
            response = download.get_response()
            if response is None or not self.allowed_untrusted_uri(response.get_uri()):
                raise ValueError("unsafe download response")
            response_bytes = response.get_content_length()
            # WebKitGTK URIResponse reports 0 when Content-Length is absent
            # or incorrect. Treat 0 as unknown and keep checking free space
            # while the engine streams data to disk.
            if not isinstance(response_bytes, int) or response_bytes < -1:
                raise ValueError("invalid download content length")
            item["declared_bytes"] = response_bytes if response_bytes > 0 else None
            item["file_name"] = safe_download_name(suggested_name)
            item["timeout"] = GLib.timeout_add_seconds(60, self.timeout_download, download_id)
            self.emit_download_state(item, "pending")
        except Exception:
            self.cancel_download_item(item, "failed")
        # WebKit 4.1 permits asynchronous approval here. Returning True
        # prevents its default Downloads-directory handler from running.
        return True

    def handle_download_decision(self, command: str, download_id: object) -> None:
        if not isinstance(download_id, str) or not re.fullmatch(r"download-[0-9a-f]{16}", download_id):
            raise ValueError("invalid download identifier")
        item = self.downloads.get(download_id)
        if item is None or item["status"] not in {"pending", "downloading"}:
            raise ValueError("unknown or no-longer-active download")
        if command == "download.cancel":
            self.cancel_download_item(item)
            return
        if command != "download.approve" or item["status"] != "pending":
            raise ValueError("approval requires a pending download")
        # The website never supplies this path. Only the explicit Surface
        # approval can allocate an opaque no-clobber destination in user Files.
        try:
            path, name = download_destination(
                self.download_user_root, download_id, item["file_name"]
            )
            # Capacity comes from the mounted user volume, not from USB/SSD
            # mode and never from a fixed per-file byte count.
            ensure_download_space(os.path.dirname(path), item["declared_bytes"])
            self.remove_download_timeout(item)
            item["file_name"] = name
            item["path"] = path
            item["download"].set_allow_overwrite(False)
            item["download"].set_destination(GLib.filename_to_uri(path, None))
            self.emit_download_state(item, "downloading")
        except (OSError, TypeError, ValueError):
            self.cancel_download_item(item, "failed")

    def on_download_destination_created(
        self, _download: object, _destination: str, download_id: str
    ) -> None:
        item = self.downloads.get(download_id)
        if item and item["status"] == "downloading":
            item["created"] = True

    def on_download_received_data(
        self, _download: object, _length: int, download_id: str
    ) -> None:
        item = self.downloads.get(download_id)
        if item and item["status"] == "downloading":
            try:
                # Streaming disk-space gate: unknown-size downloads and
                # competing writes must never exhaust the user volume.
                ensure_download_space(os.path.dirname(item["path"]))
            except (OSError, ValueError):
                self.cancel_download_item(item, "failed")

    def on_download_failed(self, _download: object, _error: object, download_id: str) -> None:
        item = self.downloads.get(download_id)
        if item and item["status"] not in {"failed", "cancelled"}:
            self.cancel_download_item(item, "failed")

    def on_download_finished(self, _download: object, download_id: str) -> None:
        item = self.downloads.pop(download_id, None)
        if not item:
            return
        self.remove_download_timeout(item)
        path = item["path"]
        if item["status"] == "downloading" and item["created"] and path:
            try:
                verified_download(path)
                self.emit_download_state(item, "saved")
                return
            except (OSError, ValueError):
                self.emit_download_state(item, "failed")
        elif item["status"] in {"pending", "starting", "downloading"}:
            self.emit_download_state(item, "failed")
        # Remove failed/cancelled partial downloads only when WebKit confirmed
        # creation of this exact opaque destination; never touch other files.
        if item["created"] and path:
            try:
                if os.path.isfile(path) and not os.path.islink(path):
                    os.unlink(path)
            except OSError:
                pass
