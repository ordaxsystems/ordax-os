#!/usr/bin/env python3
"""Audit Owner rootfs command closure against explicit Buildroot inputs."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import sys

ROOT = Path(__file__).resolve().parents[2]
# Runtime helper sources belong only to DEV_HELPER_MANIFEST, not this list.
OWNER_NON_HELPER_SHELL_SOURCES = (
    "bootstrap/dev/entrypoint",
    "system/entrypoint",
    "system/supervisor",
)
SHELL_ONLY = {
    ".", ":", "[", "alias", "break", "cd", "continue", "echo", "eval", "exec",
    "exit", "export", "getopts", "hash", "printf", "pwd", "read", "readonly",
    "return", "set", "shift", "test", "trap", "type", "umask", "unalias", "unset",
    "wait", "case", "do", "done", "elif", "else", "esac", "fi", "for", "function",
    "if", "in", "then", "until", "while", "!", "{", "}",
}
INTERNAL_COMMANDS = {
    "ordax-dev-init", "ordax-network", "ordax-pull", "ordax-rollback",
    "ordax-run", "ordax-diagnose", "ordax-main-watch", "ordax-release-agent",
    "ordax-portable-state", "ordax-remote", "entrypoint",
}
BUILDROOT_PROGRAMS = {
    "git": "BR2_PACKAGE_GIT",
    "ip": "BR2_PACKAGE_IPROUTE2",
    "iw": "BR2_PACKAGE_IW",
    "wpa_supplicant": "BR2_PACKAGE_WPA_SUPPLICANT",
    "wpa_cli": "BR2_PACKAGE_WPA_SUPPLICANT_CLI",
    "wpa_passphrase": "BR2_PACKAGE_WPA_SUPPLICANT",
}
BUSYBOX_SYMBOLS = {
    "awk": "CONFIG_AWK", "cat": "CONFIG_CAT", "chmod": "CONFIG_CHMOD",
    "chroot": "CONFIG_CHROOT", "cmp": "CONFIG_CMP", "cp": "CONFIG_CP",
    "cut": "CONFIG_CUT", "date": "CONFIG_DATE", "df": "CONFIG_DF",
    "dirname": "CONFIG_DIRNAME", "echo": "CONFIG_ECHO", "flock": "CONFIG_FLOCK", "grep": "CONFIG_GREP",
    "head": "CONFIG_HEAD", "kill": "CONFIG_KILL", "killall": "CONFIG_KILLALL",
    "mkdir": "CONFIG_MKDIR", "mkfifo": "CONFIG_MKFIFO", "modprobe": "CONFIG_MODPROBE",
    "mount": "CONFIG_MOUNT", "mv": "CONFIG_MV", "nslookup": "CONFIG_NSLOOKUP", "ntpd": "CONFIG_NTPD",
    "od": "CONFIG_OD", "pivot_root": "CONFIG_PIVOT_ROOT", "poweroff": "CONFIG_POWEROFF",
    "printf": "CONFIG_PRINTF",
    "readlink": "CONFIG_READLINK", "reboot": "CONFIG_REBOOT", "rm": "CONFIG_RM",
    "sha256sum": "CONFIG_SHA256SUM",
    "rmdir": "CONFIG_RMDIR", "sed": "CONFIG_SED", "setsid": "CONFIG_SETSID",
    "sh": "CONFIG_ASH", "sleep": "CONFIG_SLEEP", "stat": "CONFIG_STAT",
    "stty": "CONFIG_STTY", "switch_root": "CONFIG_SWITCH_ROOT", "sync": "CONFIG_SYNC",
    "tail": "CONFIG_TAIL", "tar": "CONFIG_TAR", "test": "CONFIG_TEST", "timeout": "CONFIG_TIMEOUT",
    "tr": "CONFIG_TR", "true": "CONFIG_TRUE", "udhcpc": "CONFIG_UDHCPC",
    "wget": "CONFIG_WGET",
    "touch": "CONFIG_TOUCH", "umount": "CONFIG_UMOUNT", "wc": "CONFIG_WC",
}
_FUNCTION_RE = re.compile(r"(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{")
_DEFAULT_PATH_RE = re.compile(r"(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)=\$\{[A-Za-z_][A-Za-z0-9_]*:-(/[^}\s]+)\}")
_DIRECT_PATH_RE = re.compile(r"(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)=(/[^\s#]+)")
_DYNAMIC_TOOL_LOOP_RE = re.compile(r"for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]+);\s*do")
_COMMAND_RE = re.compile(r"^[A-Za-z_.][A-Za-z0-9_.+-]*$")
_ASSIGNMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_VAR_RE = re.compile(r"^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$")
CONTROL = {";", ";;", "&&", "||", "|", "(", "{"}
CLOSERS = {")", "}"}



DEV_HELPER_MANIFEST = "system/services/base-update/dev-helper-manifest.tsv"


def owner_runtime_helpers(root: Path = ROOT) -> tuple[tuple[str, str], ...]:
    """Canonical, fail-closed Owner helper source/target map for initial seed and refresh."""
    manifest = root / DEV_HELPER_MANIFEST
    if manifest.is_symlink() or not manifest.is_file():
        raise ValueError("canonical Owner helper manifest is missing or unsafe")
    entries: list[tuple[str, str]] = []
    sources: set[str] = set()
    targets: set[str] = set()
    for lineno, raw in enumerate(manifest.read_text(encoding="utf-8").splitlines(), 1):
        if not raw or raw.startswith("#"):
            continue
        parts = raw.split("\t")
        if len(parts) != 2:
            raise ValueError(f"malformed Owner helper manifest line {lineno}")
        source, target = parts
        for value in (source, target):
            if (not value or value.startswith("/") or "\\" in value
                    or any(part in ("", ".", "..") for part in value.split("/"))):
                raise ValueError(f"unsafe Owner helper path on line {lineno}")
        name = source.rsplit("/", 1)[-1]
        if source == "bootstrap/recovery/entrypoint":
            expected_target = "ordax/bootstrap/recovery/entrypoint"
        elif source == "bootstrap/dev-base/ordax-dev-init":
            expected_target = "sbin/ordax-dev-init"
        elif (source.startswith(("bootstrap/dev-base/", "bootstrap/base-update/owner-development/"))
              and name.startswith("ordax-")):
            expected_target = "usr/local/bin/" + name
        else:
            raise ValueError(f"Owner helper source outside canonical policy on line {lineno}")
        if target != expected_target or source in sources or target in targets:
            raise ValueError(f"conflicting Owner helper mapping on line {lineno}")
        path = root / source
        if path.is_symlink() or not path.is_file() or not (0 < path.stat().st_size <= 1048576):
            raise ValueError(f"Owner helper source missing, unsafe or oversized: {source}")
        sources.add(source)
        targets.add(target)
        entries.append((source, target))
    if not entries:
        raise ValueError("canonical Owner helper manifest must not be empty")
    return tuple(entries)

def _strip_heredocs(text: str) -> str:
    out: list[str] = []
    end: str | None = None
    for raw in text.splitlines(keepends=True):
        if end is not None:
            if raw.strip() == end:
                end = None
            continue
        match = re.search(r"<<-?['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?", raw)
        if match:
            end = match.group(1)
        out.append(raw)
    return "".join(out)


def _normalize_shell(text: str) -> str:
    """Turn unquoted newlines into ';' while preserving quoted shell words."""
    text = _strip_heredocs(text)
    text = re.sub(r"(?m)^[ \t]*[^ \t(){};]+\)[ \t]*", "", text)
    out: list[str] = []
    quote: str | None = None
    escaped = False
    comment = False
    i = 0
    while i < len(text):
        ch = text[i]
        if comment:
            if ch == "\n":
                comment = False
                out.append(";")
            i += 1
            continue
        if escaped:
            if ch != "\n":
                out.extend(("\\", ch))
            else:
                out.append(" ")
            escaped = False
            i += 1
            continue
        if ch == "\\" and quote != "'":
            escaped = True
            i += 1
            continue
        if quote is None:
            if ch in {"'", '"'}:
                quote = ch
                out.append(ch)
            elif ch == "#" and (i == 0 or text[i - 1].isspace()):
                comment = True
            elif ch == "\n":
                out.append(";")
            else:
                out.append(ch)
        elif ch == quote:
            quote = None
            out.append(ch)
        else:
            out.append(" " if ch == "\n" else ch)
        i += 1
    return "".join(out)


def _tokens(text: str) -> list[str]:
    lexer = shlex.shlex(_normalize_shell(text), posix=True, punctuation_chars=";&|()<>")
    lexer.whitespace_split = True
    lexer.commenters = ""
    return list(lexer)


def _defaults(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for regex in (_DEFAULT_PATH_RE, _DIRECT_PATH_RE):
        for match in regex.finditer(text):
            result[match.group(1)] = match.group(2).strip("\"'")
    return result


def _dynamic_tools(text: str) -> set[str]:
    result: set[str] = set()
    for match in _DYNAMIC_TOOL_LOOP_RE.finditer(text):
        var, values = match.group(1), match.group(2)
        window = text[match.end(): match.end() + 800]
        if not re.search(rf"command\s+-v\s+[\"']?\$\{{?{re.escape(var)}\}}?[\"']?", window):
            continue
        for value in values.split():
            if _COMMAND_RE.fullmatch(value):
                result.add(value)
    return result


def _resolve_command(token: str, defaults: dict[str, str]) -> str | None:
    token = token.strip()
    if not token:
        return None
    variable = _VAR_RE.fullmatch(token)
    if variable:
        path = defaults.get(variable.group(1))
        return Path(path).name if path else None
    if "/" in token:
        if token.startswith("$"):
            return token.rsplit("/", 1)[-1]
        if token.startswith("/") or token.startswith("./") or token.startswith("../"):
            return Path(token).name
        return None
    return token if _COMMAND_RE.fullmatch(token) else None


def explicit_busybox_applets(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    defaults = _defaults(text)
    tokens = _tokens(text)
    result: set[str] = set()
    for index, token in enumerate(tokens[:-1]):
        resolved = _resolve_command(token, defaults)
        if resolved not in {"busybox", "bb"}:
            continue
        applet = _resolve_command(tokens[index + 1], defaults)
        if applet and _COMMAND_RE.fullmatch(applet) and not applet.startswith("-"):
            result.add(applet)
    return result


def extract_commands(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    functions = set(_FUNCTION_RE.findall(text))
    defaults = _defaults(text)
    tokens = _tokens(text)
    commands = set(_dynamic_tools(text))

    # Absolute/default paths and literal BusyBox applets remain requirements even
    # when nested under timeout/chroot/setsid wrappers.
    for index, token in enumerate(tokens):
        resolved = _resolve_command(token, defaults)
        if resolved in BUILDROOT_PROGRAMS or resolved in INTERNAL_COMMANDS or resolved in BUSYBOX_SYMBOLS:
            commands.add(resolved)
        if resolved == "busybox" and index + 1 < len(tokens):
            applet = _resolve_command(tokens[index + 1], defaults)
            if applet and _COMMAND_RE.fullmatch(applet):
                commands.add(applet)
        if resolved == "bb" and index + 1 < len(tokens):
            applet = _resolve_command(tokens[index + 1], defaults)
            if applet and _COMMAND_RE.fullmatch(applet):
                commands.add(applet)

    expect = True
    grammar: str | None = None
    skip_redirection_target = False
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token in {">", ">>", "<", "<<", "<>"}:
            skip_redirection_target = True
            index += 1
            continue
        if skip_redirection_target:
            skip_redirection_target = False
            index += 1
            continue
        if token in CONTROL:
            if grammar == "case-label":
                index += 1
                continue
            expect = True
            index += 1
            continue
        if token in CLOSERS:
            if grammar == "case-label":
                grammar = "case-command"
                expect = True
            else:
                expect = True
            index += 1
            continue
        if token == ";;":
            if grammar == "case-command":
                grammar = "case-label"
                expect = False
            else:
                expect = True
            index += 1
            continue
        if grammar == "for-header":
            if token == "do":
                grammar = None
                expect = True
            index += 1
            continue
        if grammar == "case-header":
            if token == "in":
                grammar = "case-label"
                expect = False
            index += 1
            continue
        if grammar == "case-label":
            if token == "esac":
                grammar = None
            index += 1
            continue
        if not expect:
            index += 1
            continue
        if token.startswith("-"):
            index += 1
            continue
        if token.isdigit() and index + 1 < len(tokens) and tokens[index + 1].startswith((">", "<")):
            index += 1
            continue
        if _ASSIGNMENT_RE.match(token):
            index += 1
            continue
        if token == "for":
            grammar = "for-header"
            expect = False
            index += 1
            continue
        if token == "case":
            grammar = "case-header"
            expect = False
            index += 1
            continue
        if token in {"if", "elif", "while", "until", "then", "do", "else", "!"}:
            expect = True
            index += 1
            continue
        if token in {"exec", "command"}:
            expect = True
            index += 1
            while index < len(tokens) and tokens[index].startswith("-"):
                index += 1
            continue
        resolved = _resolve_command(token, defaults)
        if resolved and resolved not in SHELL_ONLY and resolved not in functions:
            commands.add(resolved)
        expect = False
        index += 1

    explicit = explicit_busybox_applets(path)
    commands.discard("busybox")
    commands.discard("bb")
    commands.difference_update(SHELL_ONLY)
    commands.difference_update(functions)
    commands.update(explicit)
    return commands


def owner_inventory(root: Path = ROOT) -> dict[str, object]:
    per_source: dict[str, list[str]] = {}
    all_commands: set[str] = set()
    explicit_busybox: set[str] = set()
    missing_sources: list[str] = []
    runtime_helpers = owner_runtime_helpers(root)
    sources = (*OWNER_NON_HELPER_SHELL_SOURCES, *(source for source, _ in runtime_helpers))
    for relative in sources:
        path = root / relative
        if path.is_symlink() or not path.is_file():
            missing_sources.append(relative)
            continue
        found = extract_commands(path)
        per_source[relative] = sorted(found)
        all_commands.update(found)
        explicit_busybox.update(explicit_busybox_applets(path))
    internal = sorted(all_commands & INTERNAL_COMMANDS)
    programs = sorted(all_commands & BUILDROOT_PROGRAMS.keys())
    busybox = sorted(all_commands & BUSYBOX_SYMBOLS.keys())
    known = set(internal) | set(programs) | set(busybox)
    return {
        "$schema": "prototype-ordax.owner-rootfs-capabilities/1",
        "sources": per_source,
        "commands": sorted(all_commands),
        "internal_commands": internal,
        "buildroot_programs": programs,
        "busybox_applets": busybox,
        "explicit_busybox_applets": sorted(explicit_busybox),
        "unknown_commands": sorted(all_commands - known),
        "missing_sources": missing_sources,
        "runtime_helpers": [
            {"source": source, "target": target} for source, target in runtime_helpers
        ],
    }



def verify_owner_stage(stage: Path, root: Path = ROOT) -> dict[str, object]:
    """Prove that the final Creator stage contains exact canonical Owner helpers.

    This runs after the real rootfs and source checkout have been copied to the
    release staging tree. It performs only read-only local checks.
    """
    base = stage / "ORDAX" / "dev-base"
    checkout = base / "workspace" / "ordax"
    for directory in (stage, stage / "ORDAX", base, base / "workspace", checkout):
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError(f"unsafe or missing Owner stage directory: {directory}")
    expected = owner_runtime_helpers(root)
    actual = owner_runtime_helpers(checkout)
    if actual != expected:
        raise ValueError("staged Owner helper manifest differs from canonical SSOT")
    manifest = checkout / DEV_HELPER_MANIFEST
    canonical_manifest = root / DEV_HELPER_MANIFEST
    if manifest.read_bytes() != canonical_manifest.read_bytes():
        raise ValueError("staged Owner manifest bytes differ from canonical SSOT")

    def checked_file(base_path: Path, relative: str) -> Path:
        candidate = base_path
        for component in relative.split("/"):
            candidate = candidate / component
            if candidate.is_symlink():
                raise ValueError(f"unsafe symlink in staged Owner helper path: {relative}")
        if not candidate.is_file():
            raise ValueError(f"staged Owner helper is missing: {relative}")
        return candidate

    for source, target in expected:
        origin = checked_file(root, source)
        staged_source = checked_file(checkout, source)
        installed = checked_file(base, target)
        if installed.stat().st_mode & 0o111 == 0:
            raise ValueError(f"staged Owner helper is not executable: {target}")
        expected_sha = hashlib.sha256(origin.read_bytes()).digest()
        if (hashlib.sha256(staged_source.read_bytes()).digest() != expected_sha
                or hashlib.sha256(installed.read_bytes()).digest() != expected_sha):
            raise ValueError(f"staged Owner helper bytes differ from canonical source: {target}")
    return {
        "$schema": "prototype-ordax.owner-staged-helper-proof/1",
        "status": "pass",
        "verified_helper_count": len(expected),
        "manifest": DEV_HELPER_MANIFEST,
        "physical_write_authorized": False,
    }


def _enabled_symbols(path: Path, prefix: str) -> set[str]:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"configuration is missing or unsafe: {path}")
    return {
        line.strip()[:-2]
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip().startswith(prefix) and line.strip().endswith("=y")
    }


def check_buildroot(defconfig: Path, busybox_fragment: Path, root: Path = ROOT) -> dict[str, object]:
    inventory = owner_inventory(root)
    if inventory["missing_sources"] or inventory["unknown_commands"]:
        return {**inventory, "status": "source-inventory-invalid", "missing_buildroot_program_symbols": [], "missing_busybox_symbols": []}
    br_enabled = _enabled_symbols(defconfig, "BR2_")
    bb_enabled = _enabled_symbols(busybox_fragment, "CONFIG_")
    missing_programs = sorted({BUILDROOT_PROGRAMS[c] for c in inventory["buildroot_programs"] if BUILDROOT_PROGRAMS[c] not in br_enabled})
    missing_applets = sorted({BUSYBOX_SYMBOLS[c] for c in inventory["busybox_applets"] if BUSYBOX_SYMBOLS[c] not in bb_enabled})
    status = "pass" if not missing_programs and not missing_applets else "missing-capabilities"
    return {
        **inventory,
        "status": status,
        "defconfig": str(defconfig.relative_to(root)) if defconfig.is_relative_to(root) else str(defconfig),
        "busybox_fragment": str(busybox_fragment.relative_to(root)) if busybox_fragment.is_relative_to(root) else str(busybox_fragment),
        "missing_buildroot_program_symbols": missing_programs,
        "missing_busybox_symbols": missing_applets,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("inventory")
    stage_check = sub.add_parser("verify-owner-stage")
    stage_check.add_argument("--stage-root", required=True, type=Path)
    check = sub.add_parser("check-buildroot")
    check.add_argument("--defconfig", type=Path, default=ROOT / "bootstrap/independent-base/configs/ordax_minimal_defconfig")
    check.add_argument("--busybox-fragment", type=Path, default=ROOT / "bootstrap/independent-base/configs/portable-handoff.busybox.fragment")
    args = parser.parse_args()
    try:
        if args.command == "inventory":
            result = owner_inventory(ROOT)
            ok = not result["missing_sources"] and not result["unknown_commands"]
        elif args.command == "verify-owner-stage":
            result = verify_owner_stage(args.stage_root, ROOT)
            ok = result["status"] == "pass"
        else:
            result = check_buildroot(args.defconfig.resolve(), args.busybox_fragment.resolve(), ROOT)
            ok = result["status"] == "pass"
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if ok else 1
    except (OSError, ValueError) as exc:
        print(f"owner-rootfs-capabilities: ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
