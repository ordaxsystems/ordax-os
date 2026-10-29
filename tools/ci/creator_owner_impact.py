#!/usr/bin/env python3
"""Fail-closed Owner USB impact: separate CI/visual contracts from physical producer bytes."""
import argparse
import os
from pathlib import Path
import re
import subprocess

if __package__:
    from .portable_qemu_impact import verified_surface_visual_source_lock_delta
else:
    from portable_qemu_impact import verified_surface_visual_source_lock_delta

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ".github/workflows/creator-owner-dev-git.yml"
SURFACE_LOCK = "docs/contracts/surface-source.json"
LIGHT_EXACT = frozenset({
    "docs/BUILD-AUTONOMY.md",
    "system/adapters/desktop/local-ai-host.mjs",
    "tests/test_windows_desktop_local_ai_host.mjs",
    "tests/test_creator_owner_external_source.py",
    "tools/ci/portable_qemu_impact.py",
    "tests/test_portable_qemu_impact.py",
    "tools/ci/creator_owner_impact.py",
    "tests/test_creator_owner_impact.py",
})
PUSH_EXCLUDES = ("!system/adapters/desktop/**", "!system/surface/ui/**", "!system/surface/workspace/**")
PR_REMOVED = ("docs/contracts/surface-source.json", "system/surface/ui/**", "system/surface/workspace/**")
PR_ADDED = ("tools/ci/creator_owner_impact.py", "tests/test_creator_owner_impact.py")
REQUIRED_PR = (
    "bootstrap/dev/**", "bootstrap/dev-base/**", "bootstrap/surface-runtime/**",
    "system/entrypoint", "system/supervisor", "system/surface/bin/ordax-surface",
    "system/surface/runtime/ordax_browser_host.py",
    ".github/actions/prepare-verified-surface/**", WORKFLOW,
)
REQUIRED_PUSH = (
    "boot/esp/**", "bootstrap/kernel/**", "bootstrap/initramfs/**",
    "bootstrap/dev/**", "bootstrap/dev-base/**",
    "bootstrap/surface-runtime/**", "system/**", "tools/creator/**",
)
# This exact read-only impact job is the only authorized workflow-body difference
# for the inaugural split. Any other producer or permission edit stays heavy.
EXPECTED_IMPACT_JOB = """
  impact:
    permissions:
      contents: read
    runs-on: ubuntu-24.04
    outputs:
      required: __DOLLAR__{{ steps.scope.outputs.required }}
      reason: __DOLLAR__{{ steps.scope.outputs.reason }}
    steps:
      - name: Checkout exact Creator candidate
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: __DOLLAR__{{ github.event.pull_request.head.sha || github.sha }}
          persist-credentials: false
      - name: Fail-closed causal Owner USB impact classification
        id: scope
        shell: bash
        env:
          ORDAX_EVENT_NAME: __DOLLAR__{{ github.event_name }}
          ORDAX_BASE_SHA: __DOLLAR__{{ github.event.pull_request.base.sha || github.event.before }}
          ORDAX_HEAD_SHA: __DOLLAR__{{ github.event.pull_request.head.sha || github.sha }}
        run: |
          set -euo pipefail
          if [[ "$ORDAX_EVENT_NAME" == 'pull_request' ]]; then
            git fetch --no-tags --depth=1 origin "$ORDAX_BASE_SHA"
            python3 tools/ci/creator_owner_impact.py classify --base "$ORDAX_BASE_SHA" --head "$ORDAX_HEAD_SHA"
          else
            python3 tools/ci/creator_owner_impact.py classify --base "$ORDAX_BASE_SHA" --head "$ORDAX_HEAD_SHA" --force
          fi
""".replace("__DOLLAR__", "$")


def _git_show(sha, path, root):
    raw = subprocess.run(["git", "-C", str(root), "show", f"{sha}:{path}"],
                         check=True, capture_output=True, timeout=20).stdout
    if len(raw) > 1024 * 1024:
        raise ValueError("oversized workflow")
    return raw.decode("utf-8")


def _sections(source):
    if not source.startswith("name: Creator Owner Development Git USB\n\non:\n"):
        raise ValueError("unrecognized Creator workflow")
    pre, boundary, body = source.partition("\npermissions:\n")
    if not boundary:
        raise ValueError("missing permissions boundary")
    push = pre.split("  push:\n", 1)[1].split("\n  workflow_dispatch:", 1)[0]
    pr = pre.split("  pull_request:\n", 1)[1]
    def paths(section):
        return tuple(line.strip()[3:-1] for line in section.splitlines()
                     if line.strip().startswith("- '") and line.strip().endswith("'"))
    def structure(section):
        return tuple(line for line in section.splitlines()
                     if line.strip() and not line.lstrip().startswith("#")
                     and not line.strip().startswith("- '"))
    return structure(pre), paths(push), paths(pr), body


def workflow_trigger_only(base, head, *, root=ROOT):
    """Reject any producer-body change, unknown path deletion or scope expansion."""
    try:
        a = _sections(_git_show(base, WORKFLOW, root))
        b = _sections(_git_show(head, WORKFLOW, root))
        old_structure, old_push, old_pr, old_body = a
        structure, push, pr, body = b
        if old_structure != structure:
            return False
        if old_body != body:
            start = body.find("\n  impact:\n")
            end = body.find("\n  build-and-publish:\n", start)
            if start < 0 or end < 0 or "\n  impact:\n" in old_body:
                return False
            if body[start:end] != EXPECTED_IMPACT_JOB.rstrip("\n"):
                return False
            reduced = body[:start] + body[end:]
            guard = ("\n  build-and-publish:\n    needs: impact\n"
                     "    if: needs.impact.outputs.required == 'true'\n")
            if reduced.count(guard) != 1:
                return False
            if reduced.replace(guard, "\n  build-and-publish:\n") != old_body:
                return False
        if any(p not in push for p in REQUIRED_PUSH) or any(p not in pr for p in REQUIRED_PR):
            return False
        if tuple(x for x in push if x not in PUSH_EXCLUDES) != tuple(
                x for x in old_push if x not in PUSH_EXCLUDES):
            return False
        if any(x in old_push and x not in push for x in PUSH_EXCLUDES):
            return False
        if any(x not in push for x in PUSH_EXCLUDES):
            return False
        if tuple(x for x in old_pr if x not in PR_REMOVED) != tuple(
                x for x in pr if x not in (*PR_REMOVED, *PR_ADDED)):
            return False
        return not any(x in pr for x in PR_REMOVED) and all(x in pr for x in PR_ADDED)
    except (OSError, ValueError, KeyError, IndexError, UnicodeError, subprocess.SubprocessError):
        return False


def changed_paths(base, head, *, root=ROOT):
    if any(not re.fullmatch(r"[0-9a-f]{40}", x or "") or x == "0" * 40
           for x in (base, head)):
        raise ValueError("invalid Git revision")
    out = subprocess.run(
        ["git", "-C", str(root), "diff", "--name-only", "--no-renames", base, head, "--"],
        check=True, capture_output=True, text=True, timeout=30,
    ).stdout
    return tuple(x for x in out.splitlines() if x)


def classify(base, head, *, root=ROOT):
    try:
        paths = changed_paths(base, head, root=root)
        if not paths:
            return False, "no-changes"
        for path in paths:
            if path == WORKFLOW:
                if not workflow_trigger_only(base, head, root=root):
                    return True, "creator-workflow-producer-or-unknown-change"
            elif path == SURFACE_LOCK:
                if not verified_surface_visual_source_lock_delta(base, head, root=root):
                    return True, "surface-lock-not-proven-visual-only"
            elif path not in LIGHT_EXACT:
                return True, "real-or-unknown-usb-producer:" + path
        return False, "nonproducer-contract-only"
    except (OSError, UnicodeError, ValueError, subprocess.SubprocessError):
        return True, "classification-failed-closed"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("classify",))
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    required, reason = (True, "push-or-manual-producer-proof") if args.force else classify(args.base, args.head)
    result = f"required={'true' if required else 'false'}\nreason={reason}\n"
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(result)
    print("CREATOR_OWNER_USB_REQUIRED=" + ("YES" if required else "NO") + " reason=" + reason)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
