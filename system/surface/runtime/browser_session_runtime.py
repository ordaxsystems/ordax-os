#!/usr/bin/env python3
"""OS-owned Internet session lifecycle; never imports Surface, GTK or WebKit.

The Internet app owns its UI in ordax-apps; this unprivileged browser state
is activated on demand and persists only public navigation state.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable

from browser_session_store import StoredBrowserSession, load_browser_session, save_browser_session


class InternetBrowserSession:
    """Lazy, durable session owner independent of the privileged desktop."""

    def __init__(self, path: str, allow_url: Callable[[str], bool], max_tabs: int) -> None:
        if not isinstance(max_tabs, int) or isinstance(max_tabs, bool) or max_tabs < 1:
            raise ValueError("invalid browser tab capacity")
        self.path = path
        self.allow_url = allow_url
        self.max_tabs = max_tabs
        self.activated = False
        self.restoring = False
        self._last_persisted: tuple[tuple[str, ...], int | None] | None = None

    def begin_restore(self) -> StoredBrowserSession | None:
        if self.activated:
            return None
        state = load_browser_session(
            self.path, allow_url=self.allow_url, max_tabs=self.max_tabs
        )
        self.activated = True
        self.restoring = True
        self._last_persisted = (state.urls, state.active_index) if state.urls else None
        return state

    def finish_restore(self) -> None:
        if not self.activated or not self.restoring:
            raise RuntimeError("Internet session restore was not active")
        self.restoring = False

    def abort_restore(self) -> None:
        self.activated = False
        self.restoring = False
        self._last_persisted = None

    def persist(
        self, tabs: Iterable[tuple[str, str]], active_tab_id: str | None
    ) -> None:
        if not self.activated or self.restoring:
            return
        persisted_tabs = tuple(
            (tab_id, url) for tab_id, url in tabs if url and self.allow_url(url)
        )
        active_index = next(
            (index for index, (tab_id, _) in enumerate(persisted_tabs)
             if tab_id == active_tab_id),
            None,
        )
        key = (tuple(url for _, url in persisted_tabs), active_index)
        if key == self._last_persisted:
            return
        saved = save_browser_session(
            self.path, key[0], active_index,
            allow_url=self.allow_url, max_tabs=self.max_tabs,
        )
        self._last_persisted = (saved.urls, saved.active_index)
