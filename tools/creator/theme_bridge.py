#!/usr/bin/env python3
"""Export the Creator's native theme from the OrdaX Surface visual SSOT.

The Surface owns every color and the symbol. This generates only an immutable
distribution artifact; it is not a second source of visual policy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
TOKENS = ROOT / "system/surface/ui/tokens.css"
SYMBOL = ROOT / "system/surface/ui/brand/ordax-symbol.png"
PALETTE = {
    "background": "--ordax-bg",
    "app": "--ordax-app-bg",
    "panel": "--ordax-panel",
    "surface": "--ordax-surface",
    "border": "--ordax-border",
    "text": "--ordax-text",
    "muted": "--ordax-muted",
    "accent": "--ordax-accent",
    "accent_strong": "--ordax-accent-strong",
    "brand_blue": "--ordax-brand-blue",
    "brand_violet": "--ordax-brand-violet",
    "brand_cyan": "--ordax-brand-cyan",
    "success": "--ordax-success",
    "warning": "--ordax-warning",
    "danger": "--ordax-danger",
}


def render_theme(tokens_path: Path = TOKENS, symbol_path: Path = SYMBOL) -> bytes:
    source = tokens_path.read_text(encoding="utf-8")
    # Resolve the canonical dark theme only, before light and preview variants.
    dark = source.split('[data-ordax-theme="light"]', 1)[0]
    colors = {}
    for key, token in PALETTE.items():
        matches = re.findall(
            rf"(?m)^\s*{re.escape(token)}:\s*(#[0-9a-fA-F]{{6}})\s*;",
            dark,
        )
        if len(matches) != 1:
            raise ValueError(f"missing or ambiguous canonical color: {token}")
        colors[key] = matches[0].lower()
    symbol = symbol_path.read_bytes()
    if not symbol.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("the canonical OrdaX symbol is not a PNG")
    document = {
        "$schema": "prototype-ordax.creator-ui-theme/1",
        "source": "system/surface/ui/tokens.css",
        "symbol_sha256": hashlib.sha256(symbol).hexdigest(),
        "colors": colors,
    }
    return (json.dumps(document, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render_theme()
    if args.check:
        if not args.out.is_file() or args.out.read_bytes() != expected:
            parser.error("Creator theme artifact drifted from Surface SSOT")
    else:
        args.out.write_bytes(expected)


if __name__ == "__main__":
    main()
