#!/usr/bin/env python3
"""Read-only physical evidence collector for OrdaX Internet Native."""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import stat
import sys
import time
from pathlib import Path

SCHEMA = "ordax.internet-native-physical-proof/1"
COMPARE_SCHEMA = "ordax.internet-native-physical-proof-comparison/1"
PROFILE = Path("/var/lib/ordax-user/browser")
PROC = Path("/proc")
RUN = Path("/run/ordax-surface")
EVIDENCE = Path("/var/lib/ordax/internet-proof")
MAX_SESSION = 128 * 1024
MAX_TABS = 16
EVIDENCE_CONTEXTS = {
    ("owner-development", "dynamic-native-runtime"): "development",
    ("owner-development", "verified-erofs-overlay"): "development",
    ("stable-mvp", "verified-erofs-overlay"): "canonical-stable-mvp",
}


def evidence_context_from_environment() -> dict:
    distribution_profile = os.environ.get("ORDAX_PROOF_PROFILE", "owner-development")
    runtime_mode = os.environ.get("ORDAX_PROOF_RUNTIME_MODE", "dynamic-native-runtime")
    evidence_scope = os.environ.get(
        "ORDAX_PROOF_EVIDENCE_SCOPE",
        EVIDENCE_CONTEXTS.get((distribution_profile, runtime_mode), ""),
    )
    runtime_sha256 = os.environ.get("ORDAX_PROOF_RUNTIME_SHA256", "")
    expected_scope = EVIDENCE_CONTEXTS.get((distribution_profile, runtime_mode))
    if expected_scope is None or evidence_scope != expected_scope:
        raise ValueError("physical proof evidence context is invalid")
    if runtime_mode == "verified-erofs-overlay":
        if not (
            len(runtime_sha256) == 64
            and all(char in "0123456789abcdef" for char in runtime_sha256)
        ):
            raise ValueError("Stable/MVP proof runtime digest is invalid")
        normalized_digest = runtime_sha256
    else:
        if runtime_sha256:
            raise ValueError("development proof runtime must not claim a verified digest")
        normalized_digest = None
    return {
        "distribution_profile": distribution_profile,
        "runtime_mode": runtime_mode,
        "evidence_scope": evidence_scope,
        "runtime_sha256": normalized_digest,
    }


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _ck(name: str, ok: bool, detail: str) -> dict:
    return {"id": name, "status": "pass" if ok else "fail", "detail": detail}


def _warn(name: str, detail: str) -> dict:
    return {"id": name, "status": "warn", "detail": detail}


def _timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _slug() -> str:
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def _boot_id(proc_root: Path = PROC) -> str | None:
    try:
        return (proc_root / "sys/kernel/random/boot_id").read_text(encoding="ascii").strip() or None
    except OSError:
        return None


def _cmdline(path: Path) -> list[str]:
    try:
        return [x.decode("utf-8", "replace") for x in path.read_bytes().split(b"\0") if x]
    except OSError:
        return []


def _start_ticks(pid_dir: Path) -> int | None:
    try:
        text = (pid_dir / "stat").read_text(encoding="ascii")
        fields = text[text.rfind(")") + 2 :].split()
        return int(fields[19]) if len(fields) > 19 else None
    except (OSError, ValueError):
        return None


def browser_hosts(proc_root: Path = PROC) -> list[dict]:
    found = []
    try:
        entries = list(proc_root.iterdir())
    except OSError:
        return found
    for entry in entries:
        if not entry.name.isdigit() or not entry.is_dir():
            continue
        argv = _cmdline(entry / "cmdline")
        if not any(x.endswith("/surface/runtime/ordax_browser_host.py") for x in argv):
            continue
        profile = None
        for index, value in enumerate(argv[:-1]):
            if value == "--profile-root":
                profile = argv[index + 1]
                break
        found.append({
            "pid": int(entry.name),
            "start_ticks": _start_ticks(entry),
            "profile_root": profile,
            "argv_sha256": _sha("\0".join(argv).encode()),
        })
    return sorted(found, key=lambda item: item["pid"])


def session_snapshot(profile: Path = PROFILE) -> tuple[dict, list[dict]]:
    path = profile / "session.json"
    out = {"present": False, "url_count": 0, "active_index": None,
           "semantic_sha256": None, "file_sha256": None, "mode": None, "size": None}
    checks = []
    try:
        meta = path.lstat()
    except FileNotFoundError:
        return out, [_warn("browser_session_present", "session.json ainda não existe")]
    except OSError as exc:
        return out, [_ck("browser_session_present", False, f"lstat falhou: {exc}")]
    out.update(present=True, mode=stat.S_IMODE(meta.st_mode), size=meta.st_size)
    regular = stat.S_ISREG(meta.st_mode) and not stat.S_ISLNK(meta.st_mode)
    checks.append(_ck("browser_session_regular", regular, "session.json é arquivo regular" if regular else "session.json não é arquivo regular"))
    checks.append(_ck("browser_session_permissions", out["mode"] == 0o600, f"modo {out['mode']:04o}; esperado 0600"))
    bounded = 0 <= meta.st_size <= MAX_SESSION
    checks.append(_ck("browser_session_bounded", bounded, f"{meta.st_size} bytes; limite {MAX_SESSION}"))
    if not regular or not bounded:
        return out, checks
    try:
        raw = path.read_bytes()
        payload = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        checks.append(_ck("browser_session_schema", False, f"JSON inválido: {exc}"))
        return out, checks
    urls = payload.get("urls") if isinstance(payload, dict) else None
    active = payload.get("activeIndex") if isinstance(payload, dict) else None
    valid = (
        isinstance(payload, dict) and payload.get("version") == 1
        and isinstance(urls, list) and len(urls) <= MAX_TABS
        and all(isinstance(value, str) for value in urls)
        and (active is None or (isinstance(active, int) and not isinstance(active, bool) and 0 <= active < len(urls)))
    )
    checks.append(_ck("browser_session_schema", valid, "schema v1 limitado a 16 abas" if valid else "schema v1 inválido"))
    out["file_sha256"] = _sha(raw)
    if valid:
        semantic = json.dumps({"version": 1, "urls": urls, "activeIndex": active}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        out.update(url_count=len(urls), active_index=active, semantic_sha256=_sha(semantic))
    return out, checks


def profile_snapshot(profile: Path = PROFILE) -> tuple[dict, list[dict]]:
    root_ok = profile.is_dir()
    data_ok = (profile / "default/data").is_dir()
    cache_ok = (profile / "default/cache").is_dir()
    checks = [_ck("browser_profile_root", root_ok, "profile root presente" if root_ok else "profile root ausente")]
    checks.append(_ck("browser_profile_data", data_ok, "WebKit data presente") if data_ok else _warn("browser_profile_data", "WebKit data ainda não materializado"))
    checks.append(_ck("browser_profile_cache", cache_ok, "WebKit cache presente") if cache_ok else _warn("browser_profile_cache", "WebKit cache ainda não materializado"))
    return {"root_present": root_ok, "data_present": data_ok, "cache_present": cache_ok}, checks


def _http_status(host: str, port: int, target: str, headers: dict[str, str], timeout: float) -> int:
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    connection.putrequest("GET", target, skip_host=True, skip_accept_encoding=True)
    for name, value in headers.items():
        connection.putheader(name, value)
    connection.endheaders()
    response = connection.getresponse()
    response.read()
    connection.close()
    return response.status


def live_http_checks(host: str = "127.0.0.1", port: int = 8765, timeout: float = 1.5) -> list[dict]:
    authority = f"127.0.0.1:{port}"
    probes = [
        ("loopback_exact_host", "/composition/native/index.html", {"Host": authority}, 200),
        ("loopback_alias_host_rejected", "/composition/native/index.html", {"Host": f"rebind.invalid:{port}"}, 403),
        ("loopback_absolute_target_rejected", f"http://{authority}/composition/native/index.html", {"Host": authority}, 403),
        ("privileged_foreign_origin_rejected", "/__ordax/native/metrics", {"Host": authority, "Origin": "https://attacker.invalid"}, 403),
        ("privileged_cross_site_rejected", "/__ordax/native/metrics", {"Host": authority, "Sec-Fetch-Site": "cross-site"}, 403),
    ]
    checks = []
    for name, target, headers, expected in probes:
        try:
            status = _http_status(host, port, target, headers, timeout)
            checks.append(_ck(name, status == expected, f"HTTP {status}; esperado {expected}"))
        except OSError as exc:
            checks.append(_ck(name, False, f"probe falhou: {exc}"))
    return checks


def _log_snapshot(run_root: Path = RUN) -> dict:
    path = run_root / "host.log"
    try:
        data = path.read_bytes()[-64 * 1024 :]
    except OSError:
        return {"present": False, "tail_sha256": None, "error_markers": None}
    lower = data.lower()
    return {"present": True, "tail_sha256": _sha(data), "error_markers": sum(lower.count(x) for x in (b"traceback", b"segmentation", b"fatal"))}


def _summary(checks: list[dict]) -> dict:
    return {name: sum(item["status"] == name for item in checks) for name in ("pass", "warn", "fail")}


def collect(label: str, host: str = "127.0.0.1", port: int = 8765,
            profile: Path = PROFILE, proc_root: Path = PROC, run_root: Path = RUN) -> dict:
    checks = []
    processes = browser_hosts(proc_root)
    process_ok = len(processes) == 1 and processes[0].get("profile_root") == str(profile)
    checks.append(_ck("browser_host_process", process_ok, f"{len(processes)} host(s); profile canônico={process_ok}"))
    profile_state, profile_checks = profile_snapshot(profile)
    session, session_checks = session_snapshot(profile)
    checks.extend(profile_checks)
    checks.extend(session_checks)
    checks.extend(live_http_checks(host, port))
    report = {
        "schema": SCHEMA, "captured_at": _timestamp(), "label": label,
        "boot_id": _boot_id(proc_root), "loopback": {"host": host, "port": port},
        "evidence_context": evidence_context_from_environment(),
        "browser_host_processes": processes, "profile": profile_state,
        "session": session, "host_log": _log_snapshot(run_root), "checks": checks,
    }
    report["summary"] = _summary(checks)
    return report


def _evidence_context(report: dict) -> tuple[str, str, str, str | None] | None:
    context = report.get("evidence_context")
    if not isinstance(context, dict):
        return None
    distribution_profile = context.get("distribution_profile")
    runtime_mode = context.get("runtime_mode")
    evidence_scope = context.get("evidence_scope")
    runtime_sha256 = context.get("runtime_sha256")
    expected_scope = EVIDENCE_CONTEXTS.get((distribution_profile, runtime_mode))
    if expected_scope is None or evidence_scope != expected_scope:
        return None
    if runtime_mode == "verified-erofs-overlay":
        if not (
            isinstance(runtime_sha256, str)
            and len(runtime_sha256) == 64
            and all(char in "0123456789abcdef" for char in runtime_sha256)
        ):
            return None
    elif runtime_sha256 is not None:
        return None
    return distribution_profile, runtime_mode, evidence_scope, runtime_sha256


def compare(before: dict, after: dict) -> dict:
    checks = []
    checks.append(_ck("report_schema", before.get("schema") == SCHEMA and after.get("schema") == SCHEMA, "ambas as coletas usam o schema esperado"))
    before_context = _evidence_context(before)
    after_context = _evidence_context(after)
    same_context = before_context is not None and before_context == after_context
    checks.append(_ck(
        "same_evidence_context",
        same_context,
        "mesmo perfil/runtime de evidência"
        if same_context
        else "perfil/runtime de evidência ausente, inválido ou diferente",
    ))
    checks.append(_ck("same_boot", bool(before.get("boot_id")) and before.get("boot_id") == after.get("boot_id"), "boot_id permaneceu igual"))
    bp = before.get("browser_host_processes") or []
    ap = after.get("browser_host_processes") or []
    restarted = len(bp) == len(ap) == 1 and (bp[0].get("pid"), bp[0].get("start_ticks")) != (ap[0].get("pid"), ap[0].get("start_ticks"))
    checks.append(_ck("surface_browser_host_restarted", restarted, "browser host mudou de identidade" if restarted else "browser host não mudou de identidade"))
    bs = before.get("session") or {}
    ass = after.get("session") or {}
    digest_ok = bool(bs.get("semantic_sha256")) and bs.get("semantic_sha256") == ass.get("semantic_sha256")
    checks.append(_ck("tab_session_persisted", digest_ok, "hash semântico da sessão permaneceu igual"))
    shape_ok = isinstance(bs.get("url_count"), int) and bs.get("url_count") > 0 and bs.get("url_count") == ass.get("url_count") and bs.get("active_index") == ass.get("active_index")
    checks.append(_ck("tab_shape_persisted", shape_ok, "quantidade de abas e índice ativo permaneceram iguais"))
    report = {
        "schema": COMPARE_SCHEMA,
        "compared_at": _timestamp(),
        "evidence_context": (
            {
                "distribution_profile": before_context[0],
                "runtime_mode": before_context[1],
                "evidence_scope": before_context[2],
                "runtime_sha256": before_context[3],
            }
            if same_context else None
        ),
        "checks": checks,
    }
    report["summary"] = _summary(checks)
    return report


find_browser_host_processes = browser_hosts
compare_reports = compare


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    data = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    with temporary.open("w", encoding="utf-8") as handle:
        os.chmod(temporary, 0o600)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _load(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} não contém objeto JSON")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Coleta read-only da prova física do OrdaX Internet Native")
    commands = parser.add_subparsers(dest="command", required=True)
    collect_parser = commands.add_parser("collect")
    collect_parser.add_argument("--label", default="physical-check")
    collect_parser.add_argument("--output")
    compare_parser = commands.add_parser("compare")
    compare_parser.add_argument("before")
    compare_parser.add_argument("after")
    compare_parser.add_argument("--output")
    args = parser.parse_args(argv)
    try:
        if args.command == "collect":
            report = collect(args.label)
            path = Path(args.output) if args.output else EVIDENCE / f"collect-{_slug()}.json"
        else:
            report = compare(_load(Path(args.before)), _load(Path(args.after)))
            path = Path(args.output) if args.output else EVIDENCE / f"compare-{_slug()}.json"
        _write(path, report)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ordax-internet-proof: {exc}", file=sys.stderr)
        return 2
    summary = report["summary"]
    print(f"PASS={summary['pass']} WARN={summary['warn']} FAIL={summary['fail']} · {path}")
    for item in report["checks"]:
        print(f"[{item['status'].upper():4}] {item['id']}: {item['detail']}")
    return 1 if summary["fail"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
