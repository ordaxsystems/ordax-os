"""One canonical immutable legal-document snapshot ledger validator.

The active consent policy remains server-owned. This ledger binds source bytes
of approved historical/public snapshots; it never activates a policy.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
LEGAL_SNAPSHOTS = ROOT / "docs/contracts/public-legal-snapshots.json"


class LegalSnapshotError(ValueError):
    pass


def validate_immutable_legal_snapshots(root: Path, ledger_path: Path = LEGAL_SNAPSHOTS) -> None:
    """Require a reviewed SHA/size entry for every immutable consent artifact."""
    try:
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise LegalSnapshotError("immutable legal snapshot ledger unavailable") from exc
    if (not isinstance(ledger, dict)
            or ledger.get("$schema") != "prototype-ordax.public-legal-snapshots/1"
            or ledger.get("status") not in {"no-approved-snapshots", "approved-versioned-snapshots"}
            or not isinstance(ledger.get("snapshots"), list)):
        raise LegalSnapshotError("invalid immutable legal snapshot ledger")
    seen = set()
    items = ledger["snapshots"]
    if bool(items) != (ledger["status"] == "approved-versioned-snapshots"):
        raise LegalSnapshotError("immutable legal snapshot ledger status mismatch")
    for entry in items:
        if not isinstance(entry, dict):
            raise LegalSnapshotError("invalid immutable legal snapshot entry")
        version, kind = entry.get("version"), entry.get("kind")
        if (not isinstance(version, str)
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", version)
                or kind not in ("privacy", "terms")):
            raise LegalSnapshotError("invalid immutable legal snapshot identity")
        slug = {"privacy": "privacidade", "terms": "termos"}[kind]
        relative = f"legal/{version}/{slug}/index.html"
        if relative in seen:
            raise LegalSnapshotError("duplicate immutable legal snapshot entry")
        seen.add(relative)
        path = root / relative
        if not path.is_file() or path.is_symlink():
            raise LegalSnapshotError("approved immutable legal snapshot is missing or linked")
        data = path.read_bytes()
        if (len(data) == 0 or len(data) > 2 * 1024 * 1024
                or type(entry.get("size")) is not int or entry["size"] != len(data)
                or not isinstance(entry.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"])
                or hashlib.sha256(data).hexdigest() != entry["sha256"]):
            raise LegalSnapshotError("immutable legal snapshot bytes differ from reviewed digest")
        try:
            data.decode("utf-8")
        except UnicodeError as exc:
            raise LegalSnapshotError("immutable legal snapshot is not UTF-8") from exc
    found = {
        p.relative_to(root).as_posix()
        for p in (root / "legal").rglob("*")
        if p.is_file() or p.is_symlink()
    } if (root / "legal").exists() else set()
    if found != seen:
        raise LegalSnapshotError("unreviewed immutable legal snapshot source files present")


