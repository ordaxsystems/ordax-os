"""Shared provider-neutral OrdaX product session contract."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ProductSession:
    authenticated: bool
    user_id: str | None = None
    csrf_token: str | None = None


class SessionResolver(Protocol):
    @property
    def configured(self) -> bool: ...

    def resolve(self, cookie_header: str | None) -> ProductSession: ...
