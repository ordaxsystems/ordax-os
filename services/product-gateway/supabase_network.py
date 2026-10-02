"""Supabase server adapter for the read-only Product OAuth Network resource."""

from __future__ import annotations

import hashlib
import importlib.util
import os
from pathlib import Path
import sys
from dataclasses import dataclass
from typing import Mapping, Protocol


def _load_gateway():
    module_name = "ordax_product_network_gateway"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing
    path = Path(__file__).with_name("oauth_network.py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("product Network gateway loader unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    return module


def _load_supabase_oauth_adapter():
    module_name = "ordax_product_oauth_supabase_authority"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing
    path = Path(__file__).resolve().parents[1] / "product-oauth" / "supabase_authority.py"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("product OAuth Supabase adapter loader unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    return module


_gateway = _load_gateway()
_oauth_supabase = _load_supabase_oauth_adapter()
ProductNetworkUnavailable = _gateway.ProductNetworkUnavailable


class RpcTransport(Protocol):
    def call(self, name: str, payload: dict[str, object]) -> object: ...


@dataclass(frozen=True)
class SupabaseProductNetworkConfig:
    base_url: str
    secret_key: str
    enabled: bool = False
    timeout_seconds: float = 10.0

    @classmethod
    def from_environment(cls) -> "SupabaseProductNetworkConfig":
        return cls(
            base_url=os.environ.get("SUPABASE_URL", ""),
            secret_key=os.environ.get("ORDAX_PRODUCT_OAUTH_SECRET_KEY", ""),
            enabled=os.environ.get("ORDAX_PRODUCT_NETWORK_RESOURCE_ENABLED", "") == "1",
        )

    @property
    def configured(self) -> bool:
        return (
            self.enabled
            and self.base_url.startswith("https://")
            and self.secret_key.startswith("sb_secret_")
        )


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def _rows(value: object) -> list[Mapping[str, object]]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ProductNetworkUnavailable("product Network authority returned malformed rows")
    return list(value)


class SupabaseProductNetworkReadAuthority:
    def __init__(
        self,
        config: SupabaseProductNetworkConfig | None = None,
        *,
        transport: RpcTransport | None = None,
    ) -> None:
        self.config = config or SupabaseProductNetworkConfig.from_environment()
        transport_config = _oauth_supabase.SupabaseAuthorityConfig(
            base_url=self.config.base_url,
            secret_key=self.config.secret_key,
            enabled=self.config.enabled,
            timeout_seconds=self.config.timeout_seconds,
        )
        self.transport = transport or _oauth_supabase.SupabaseRestRpcTransport(transport_config)

    @property
    def configured(self) -> bool:
        return self.config.configured

    def _call(self, name: str, payload: dict[str, object]) -> list[Mapping[str, object]]:
        if not self.configured:
            raise ProductNetworkUnavailable("product Network authority disabled")
        try:
            return _rows(self.transport.call(name, payload))
        except _gateway.ProductNetworkUnavailable:
            raise
        except Exception as exc:
            raise ProductNetworkUnavailable("product Network authority request failed") from exc

    def get_space(self, access_token: str) -> list[Mapping[str, object]]:
        return self._call(
            "ordax_product_network_get_space_v1",
            {"p_token_hash": _sha256_hex(access_token)},
        )

    def list_directory(
        self,
        access_token: str,
        *,
        search: str | None,
        category: str | None,
        after_name: str | None,
        after_space_id: str | None,
        limit: int,
    ) -> list[Mapping[str, object]]:
        return self._call(
            "ordax_product_network_list_directory_v1",
            {
                "p_token_hash": _sha256_hex(access_token),
                "p_search": search,
                "p_category": category,
                "p_after_name": after_name,
                "p_after_space_id": after_space_id,
                "p_limit": limit,
            },
        )

    def list_communities(
        self,
        access_token: str,
        *,
        limit: int,
    ) -> list[Mapping[str, object]]:
        return self._call(
            "ordax_product_network_list_communities_v1",
            {
                "p_token_hash": _sha256_hex(access_token),
                "p_limit": limit,
            },
        )
