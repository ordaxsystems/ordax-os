#!/usr/bin/env python3
"""OS-owned tab identity, order and selection; independent of GTK/WebKit.

The untrusted Internet app owns presentation in ordax-apps. The OS-owned
native adapter alone creates WebViews; this registry owns no native bridge,
website content, engine objects or duplicated session persistence.
"""
from __future__ import annotations

import re
from typing import Any, Pattern


class InternetTabRegistry:
    """Single authoritative tab collection and active selection."""

    def __init__(self, tab_id_pattern: Pattern[str], max_tabs: int) -> None:
        if not isinstance(tab_id_pattern, re.Pattern):
            raise ValueError("invalid tab identifier policy")
        if isinstance(max_tabs, bool) or not isinstance(max_tabs, int) or max_tabs < 1:
            raise ValueError("invalid tab limit")
        self.tab_id_pattern = tab_id_pattern
        self.max_tabs = max_tabs
        self.tabs: dict[str, Any] = {}
        self._active_tab_id: str | None = None

    @property
    def active_tab_id(self) -> str | None:
        return self._active_tab_id

    def validate(self, tab_id: object) -> str:
        if not isinstance(tab_id, str) or self.tab_id_pattern.fullmatch(tab_id) is None:
            raise ValueError("invalid tab id")
        return tab_id

    def set_active(self, tab_id: str | None) -> None:
        if tab_id is not None:
            self.validate(tab_id)
            if tab_id not in self.tabs:
                raise ValueError("unknown tab")
        self._active_tab_id = tab_id

    def attach(self, tab_id: str, view_state: Any) -> None:
        self.validate(tab_id)
        if tab_id in self.tabs:
            raise ValueError("tab already exists")
        if len(self.tabs) >= self.max_tabs:
            raise ValueError("tab limit reached")
        self.tabs[tab_id] = view_state
        self._active_tab_id = tab_id

    def select(self, tab_id: str) -> None:
        self.set_active(tab_id)

    def detach(self, tab_id: str) -> Any | None:
        self.validate(tab_id)
        item = self.tabs.pop(tab_id, None)
        if item is not None and self._active_tab_id == tab_id:
            self._active_tab_id = next(reversed(self.tabs), None)
        return item
