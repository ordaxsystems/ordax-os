#!/usr/bin/env python3
"""Unprivileged web-content context, independent of the trusted Surface boot.

The OrdaX OS owns the engine/security boundary. This module does not install,
activate or own the removable Internet product. In particular, no WebContext
for external sites is created until a user-initiated browser or account action.
"""
from __future__ import annotations

import os
from typing import Callable


class ExternalWebContent:
    """Lazy WebKit context with independent, private data and cache roots."""

    def __init__(self, profile_root: str, cache_root: str, download_started: Callable) -> None:
        self.profile_root = os.path.abspath(profile_root)
        self.cache_root = os.path.abspath(cache_root)
        self.download_started = download_started
        self._context = None

    def context(self):
        if self._context is not None:
            return self._context

        # The privileged Surface uses a completely separate context/profile.
        # Never attach the Surface's user-content manager or native bridge.
        from gi.repository import WebKit2

        profile_data = os.path.join(self.profile_root, "default", "data")
        profile_cache = os.path.join(self.cache_root, "default")
        os.makedirs(profile_data, mode=0o700, exist_ok=True)
        os.makedirs(profile_cache, mode=0o700, exist_ok=True)
        manager = WebKit2.WebsiteDataManager(
            base_data_directory=profile_data,
            base_cache_directory=profile_cache,
        )
        context = WebKit2.WebContext.new_with_website_data_manager(manager)
        context.set_preferred_languages(["pt-BR", "en-US"])
        context.connect("download-started", self.download_started)
        self._context = context
        return context
