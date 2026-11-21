#!/usr/bin/env python3
"""Promote a healthy development Base after a real candidate boot.

This coordinator is fail-closed. It first proves that the running boot is the
exact staged candidate and that Base + Surface health belong to the same boot.
Only then does it mount ORDAX-ESP read-write, revalidate layout identity, and
delegate the atomic commit to bootstrap/base-update/promote.py.

It never requests another reboot and never writes LoaderEntryOneShot.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
SOURCE_ROOT = HERE.parents[2]
SCHEMA = "prototype-ordax.dev-base-postboot-promotion/1"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
RW_MOUNT_OPTIONS = {"rw", "nosuid", "nodev", "noexec"}


class PostbootPromotionError(RuntimeError):
    pass


class NotCandidateBoot(PostbootPromotionError):
    pass


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise PostbootPromotionError(f"cannot load dependency: {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_promote = _load(
    SOURCE_ROOT / "bootstrap/base-update/promote.py",
    "ordax_postboot_promote",
)
_discovery = _load(HERE / "esp_discovery.py", "ordax_postboot_discovery")
_layout = _load(HERE / "esp_layout.py", "ordax_postboot_layout")
_readonly = _load(HERE / "esp_readonly.py", "ordax_postboot_readonly")
_channel = _load(HERE / "dev_channel.py", "ordax_postboot_channel")


def _read_text(path: Path, label: str, max_bytes: int = 64 * 1024) -> str:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise PostbootPromotionError(f"{label} is unavailable") from exc
    if len(data) <= 0 or len(data) > max_bytes:
        raise PostbootPromotionError(f"{label} size is invalid")
    try:
        return data.decode("utf-8")
    except UnicodeError as exc:
        raise PostbootPromotionError(f"{label} is not valid UTF-8") from exc


def _candidate_identity(cmdline: str) -> dict:
    has_candidate = "ordax.base_candidate=" in cmdline
    has_slot = "ordax.base_slot=" in cmdline
    if not has_candidate and not has_slot:
        raise NotCandidateBoot("running boot is not a Base candidate")
    if not has_candidate or not has_slot:
        raise PostbootPromotionError("candidate boot identity is incomplete")
    try:
        return _promote.parse_cmdline(cmdline)
    except _promote.PromotionError as exc:
        raise PostbootPromotionError(str(exc)) from exc


def _derive_previous_slot(layout: dict, candidate_slot: str) -> str:
    if layout.get("layout") == "legacy":
        if candidate_slot != "b":
            raise PostbootPromotionError(
                "legacy migration candidate must boot from slot b"
            )
        return "a"
    if layout.get("layout") != "ab":
        raise PostbootPromotionError("ESP layout is unsupported for promotion")
    active = layout.get("active_slot")
    if active not in {"a", "b"}:
        raise PostbootPromotionError("known-good active slot is invalid")
    if active == candidate_slot:
        raise PostbootPromotionError("candidate slot already equals known-good slot")
    return active



def _owner_source_proof(worktree: Path, artifact: str, requested: str, current: str):
    """Reprove the acquisition relation and current checkout before any ESP write."""
    try:
        head = _channel._git_bytes(worktree, "rev-parse", "HEAD").decode("ascii").strip()
        if head != current:
            raise PostbootPromotionError("current checkout changed before Base promotion")
        if not _channel.prove_compatible_source(worktree, artifact, requested):
            raise PostbootPromotionError("Base no longer satisfies the requested revision")
        if not _channel.prove_compatible_source(worktree, requested, current):
            raise PostbootPromotionError("current checkout supersedes the Base request")
        def proof(release, source):
            return _channel.prove_compatible_source(worktree, release, source)
        return proof
    except _channel.DevBaseChannelError as exc:
        raise PostbootPromotionError(str(exc)) from exc


def promote_running_candidate(
    *,
    root_source: Path,
    esp_mount_root: Path,
    state_root: Path,
    cmdline_file: Path,
    boot_id_file: Path,
    base_heartbeat_file: Path,
    surface_heartbeat_file: Path,
    healthy_sha_file: Path,
    source_sha: str,
    expected_release_sha: str,
    owner_worktree: Path | None = None,
    requested_source_sha: str | None = None,
    dev_root: Path = Path("/dev"),
    by_label_root: Path = Path("/dev/disk/by-label"),
    sys_class_block: Path = Path("/sys/class/block"),
    mountinfo: Path = Path("/proc/self/mountinfo"),
    mount_command: Path = Path("/bin/mount"),
    umount_command: Path = Path("/bin/umount"),
) -> dict:
    if SHA40_RE.fullmatch(source_sha) is None:
        raise PostbootPromotionError("current checkout SHA is invalid")
    if SHA40_RE.fullmatch(expected_release_sha) is None:
        raise PostbootPromotionError("expected staged SHA is invalid")

    if (owner_worktree is None) != (requested_source_sha is None):
        raise PostbootPromotionError("owner promotion requires both checkout and request")
    proof = None
    if owner_worktree is not None:
        if SHA40_RE.fullmatch(requested_source_sha) is None:
            raise PostbootPromotionError("requested source SHA is invalid")
        pending = _read_text(state_root / "boot-refresh-required", "Base request", 1024).strip()
        if pending != requested_source_sha:
            raise PostbootPromotionError("Base request was superseded before promotion")
        proof = _owner_source_proof(
            owner_worktree, expected_release_sha, requested_source_sha, source_sha,
        )

    cmdline = _read_text(cmdline_file, "kernel cmdline")
    identity = _candidate_identity(cmdline)
    if identity["release_sha"] != expected_release_sha:
        raise PostbootPromotionError(
            "running candidate does not match staged release identity"
        )

    try:
        preflight = _readonly.readonly_preflight(
            root_source=root_source,
            mount_root=esp_mount_root,
            dev_root=dev_root,
            by_label_root=by_label_root,
            sys_class_block=sys_class_block,
            mountinfo=mountinfo,
            mount_command=mount_command,
            umount_command=umount_command,
        )
    except _readonly.EspReadonlyPreflightError as exc:
        raise PostbootPromotionError(str(exc)) from exc

    layout = preflight["layout"]
    if not layout["candidate_entry_present"]:
        raise PostbootPromotionError("candidate boot entry is missing from live ESP")
    if layout["candidate_release_sha"] != expected_release_sha:
        raise PostbootPromotionError("live ESP candidate release differs from running boot")
    if layout["candidate_slot"] != identity["slot"]:
        raise PostbootPromotionError("live ESP candidate slot differs from running boot")
    previous_slot = _derive_previous_slot(layout, identity["slot"])

    try:
        health = _promote.evaluate_health(
            cmdline=cmdline,
            boot_id=_read_text(boot_id_file, "Base boot id", 1024).strip(),
            source_sha=source_sha,
            healthy_sha=_read_text(
                healthy_sha_file,
                "Surface health SHA",
                1024,
            ).strip(),
            base_heartbeat=_promote.load_json(base_heartbeat_file),
            surface_heartbeat=_promote.load_json(surface_heartbeat_file),
            expected_release_sha=expected_release_sha,
            expected_candidate_slot=identity["slot"],
            previous_slot=previous_slot,
            prove_source_compatibility=proof,
        )
    except (_promote.PromotionError, _channel.DevBaseChannelError) as exc:
        raise PostbootPromotionError(str(exc)) from exc

    try:
        discovered = _discovery.discover_esp(
            root_source=root_source,
            dev_root=dev_root,
            by_label_root=by_label_root,
            sys_class_block=sys_class_block,
        )
    except _discovery.EspDiscoveryError as exc:
        raise PostbootPromotionError(str(exc)) from exc

    if discovered["esp_device"] != preflight["esp_device"]:
        raise PostbootPromotionError(
            "ORDAX-ESP identity changed after health validation"
        )

    esp_device = Path(discovered["esp_device"])
    mounted = False
    result = None
    try:
        _readonly._run_mount_command(
            [
                str(mount_command),
                "-t",
                "vfat",
                "-o",
                "rw,nosuid,nodev,noexec,umask=0022",
                str(esp_device),
                str(esp_mount_root),
            ],
            "postboot promotion ESP mount",
        )
        mounted = True

        record = _readonly._mount_record(mountinfo, esp_mount_root)
        if record is None:
            raise PostbootPromotionError("promotion ESP mount is not observable")
        if record["root"] != "/" or record["filesystem"] != "vfat":
            raise PostbootPromotionError("promotion ESP mount identity is invalid")
        if record["source"] != str(esp_device):
            raise PostbootPromotionError("promotion ESP mount source changed")
        if not RW_MOUNT_OPTIONS.issubset(record["options"]):
            raise PostbootPromotionError("promotion ESP mount options are insufficient")

        current = _layout.inspect_layout(esp_mount_root)
        for key in (
            "layout",
            "stage_active_slot",
            "active_slot",
            "recovery_slot",
            "candidate_entry_present",
            "candidate_slot",
            "candidate_release_sha",
        ):
            if current.get(key) != layout.get(key):
                raise PostbootPromotionError(
                    "ESP layout changed between health proof and promotion"
                )

        if owner_worktree is not None:
            # Revalidate after the read-only evidence and before the commit.
            if _read_text(state_root / "boot-refresh-required", "Base request", 1024).strip() != requested_source_sha:
                raise PostbootPromotionError("Base request was superseded before ESP commit")
            head = _channel._git_bytes(owner_worktree, "rev-parse", "HEAD").decode("ascii").strip()
            if head != source_sha:
                raise PostbootPromotionError("current checkout changed before ESP commit")

        try:
            promotion = _promote.promote(
                esp_root=esp_mount_root,
                state_root=state_root,
                health=health,
                clear_refresh_marker=owner_worktree is None,
            )
        except _promote.PromotionError as exc:
            raise PostbootPromotionError(str(exc)) from exc

        if promotion.get("promoted") is not True:
            raise PostbootPromotionError("promotion helper did not commit candidate")
        if promotion.get("active_slot") != identity["slot"]:
            raise PostbootPromotionError("promotion committed the wrong active slot")
        if promotion.get("recovery_slot") != previous_slot:
            raise PostbootPromotionError("promotion committed the wrong recovery slot")
        if promotion.get("reboot_requested") is not False:
            raise PostbootPromotionError("promotion unexpectedly requested reboot")

        if hasattr(os, "sync"):
            os.sync()

        result = {
            "$schema": SCHEMA,
            "status": "promoted",
            "source_commit": expected_release_sha,
            "runtime_source_commit": source_sha,
            "requested_source_commit": requested_source_sha or expected_release_sha,
            "boot_id": health["boot_id"],
            "active_slot": identity["slot"],
            "recovery_slot": previous_slot,
            "health_verified": True,
            "current_entry_promoted": True,
            "recovery_entry_preserved_previous_slot": True,
            "candidate_entry_removed": bool(
                promotion["candidate_entry_removed"]
            ),
            "active_slot_record_written": bool(
                promotion["active_slot_record_written"]
            ),
            "boot_refresh_marker_status": promotion[
                "boot_refresh_marker_status"
            ],
            "reboot_requested": False,
            "efi_variable_written": False,
        }
    except Exception:
        if mounted:
            try:
                _readonly._run_mount_command(
                    [str(umount_command), str(esp_mount_root)],
                    "ESP unmount",
                )
            except _readonly.EspReadonlyPreflightError:
                pass
        raise

    _readonly._run_mount_command(
        [str(umount_command), str(esp_mount_root)],
        "ESP unmount",
    )
    mounted = False
    if _readonly._mount_record(mountinfo, esp_mount_root) is not None:
        raise PostbootPromotionError("ESP remained mounted after promotion")

    try:
        postflight = _readonly.readonly_preflight(
            root_source=root_source,
            mount_root=esp_mount_root,
            dev_root=dev_root,
            by_label_root=by_label_root,
            sys_class_block=sys_class_block,
            mountinfo=mountinfo,
            mount_command=mount_command,
            umount_command=umount_command,
        )
    except _readonly.EspReadonlyPreflightError as exc:
        raise PostbootPromotionError(
            "promoted ESP failed read-only postflight"
        ) from exc

    after = postflight["layout"]
    if after["layout"] != "ab":
        raise PostbootPromotionError("promoted ESP did not converge to A/B layout")
    if after["active_slot"] != identity["slot"]:
        raise PostbootPromotionError("postflight active slot differs from candidate")
    if after["recovery_slot"] != previous_slot:
        raise PostbootPromotionError("postflight recovery slot differs from previous")
    if after["candidate_entry_present"]:
        raise PostbootPromotionError("candidate entry remains after promotion")

    result["postflight_verified"] = True
    result["mount_released"] = True
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root-source", type=Path, required=True)
    parser.add_argument("--esp-mount-root", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--cmdline", type=Path, default=Path("/proc/cmdline"))
    parser.add_argument(
        "--boot-id",
        type=Path,
        default=Path("/run/ordax-update/base-boot-id"),
    )
    parser.add_argument("--base-heartbeat", type=Path, required=True)
    parser.add_argument("--surface-heartbeat", type=Path, required=True)
    parser.add_argument(
        "--healthy-sha",
        type=Path,
        default=Path("/run/ordax-update/healthy-sha"),
    )
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--expected-release-sha", required=True)
    parser.add_argument("--owner-worktree", type=Path)
    parser.add_argument("--requested-source-sha")
    parser.add_argument("--dev-root", type=Path, default=Path("/dev"))
    parser.add_argument(
        "--by-label-root",
        type=Path,
        default=Path("/dev/disk/by-label"),
    )
    parser.add_argument(
        "--sys-class-block",
        type=Path,
        default=Path("/sys/class/block"),
    )
    parser.add_argument(
        "--mountinfo",
        type=Path,
        default=Path("/proc/self/mountinfo"),
    )
    args = parser.parse_args()

    try:
        value = promote_running_candidate(
            root_source=args.root_source,
            esp_mount_root=args.esp_mount_root,
            state_root=args.state_root,
            cmdline_file=args.cmdline,
            boot_id_file=args.boot_id,
            base_heartbeat_file=args.base_heartbeat,
            surface_heartbeat_file=args.surface_heartbeat,
            healthy_sha_file=args.healthy_sha,
            source_sha=args.source_sha,
            expected_release_sha=args.expected_release_sha,
            owner_worktree=args.owner_worktree,
            requested_source_sha=args.requested_source_sha,
            dev_root=args.dev_root,
            by_label_root=args.by_label_root,
            sys_class_block=args.sys_class_block,
            mountinfo=args.mountinfo,
        )
    except NotCandidateBoot:
        return 2
    except (
        OSError,
        UnicodeError,
        PostbootPromotionError,
        _promote.PromotionError,
        _channel.DevBaseChannelError,
        _promote._activate.ActivateError,
    ) as exc:
        print(f"dev-base-postboot-promotion: ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(value, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
