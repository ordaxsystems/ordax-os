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
INTELLIGENCE_WORKFLOW = ".github/workflows/intelligence-foundation.yml"
LEGACY_PROFILE_DOC = "PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md"
CURRENT_PROFILE_KNOWLEDGE_DOC = "docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md"
LEGACY_PROFILE_TRIGGER = f"      - '{LEGACY_PROFILE_DOC}'"
CURRENT_PROFILE_TRIGGER = f"      - '{CURRENT_PROFILE_KNOWLEDGE_DOC}'"
DESKTOP_TRIGGER_WORKFLOW = ".github/workflows/external-source-lock-integration.yml"
DESKTOP_DISTRIBUTION_CONTRACT = "docs/contracts/distribution-profiles.json"
RETIRED_DESKTOP_ROOT = "tools/windows-desktop/"

LIGHT_EXACT = frozenset({
    "docs/BUILD-AUTONOMY.md",
    # Desktop-only owner cutover documentation and isolated contract regressions.
    "docs/EXTERNAL-SOURCE-INTEGRATION.md",
    "tests/test_desktop_source_owner.py",
    "tests/test_desktop_update_status.mjs",
    "tests/test_distribution_profiles_contract.py",
    "tests/test_windows_desktop_observation_grants.mjs",
    "docs/DEV-USB-GIT.md",
    "docs/DECISIONS.md",
    "docs/CURRENT-STATE.md",
    "docs/DEVELOPMENT-WORKFLOW.md",
    "tests/test_desktop_product_runtime_status_port.mjs",
    "tests/test_desktop_surface_runtime_bridge.mjs",
    "tests/test_desktop_surface_state_report.mjs",
    "tests/test_windows_desktop_client_diagnostics.mjs",
    # Existing docs index + UX owner and archived historical reference:
    # no executable Native, USB, release, kernel or signing producer bytes.
    # Keep this exact allowlist; docs/contracts/** cannot be skipped wholesale.
    "docs/README.md",
    "docs/SPACES-AND-PROFILES.md",
    "README.md",
    # Removed Profile plan is only eligible through a verified deletion.
    "00-PLANOS-PRIORITARIOS/REGISTRY.md",
    "00-PLANOS-PRIORITARIOS/README.md",
    "PLANO-04-FUNDACAO-ECOSSISTEMA-PRE-MVP.md",
    "00-PLANOS-PRIORITARIOS/ROADMAP.md",
    "00-PLANOS-PRIORITARIOS/plans/MODE-001-WEB-CLOUD-DEVICE-RUNTIME.md",
    "00-PLANOS-PRIORITARIOS/plans/FOOD-001-ORDAX-FOOD-PIZZA-PILOT.md",
    "00-PLANOS-PRIORITARIOS/plans/FAB-001-ORDAX-FABRICATION-3D-PRINTING-PILOT.md",
    "docs/contracts/build-autonomy.json",
    # Dedicated Desktop command contract, adapter and proof. Neither is
    # imported by the Linux Native boot composition/USB host.
    "system/contracts/space-create-port.mjs",
    "tests/test_space_create_bridge.mjs",
    "system/adapters/desktop/local-ai-host.mjs",
    # Windows-only signed-component bridge and Windows installer producer
    # are proven in the installed NSIS/Native gates, not the Linux Creator.
    # These exact files contain no bootable USB payload or signing authority.
    # Shared Native composition, component runtime and OS host paths are
    # deliberately NOT excluded; a change to those remains a real USB build.
    ".github/workflows/windows-desktop-dev.yml",
    "system/adapters/desktop/verified-component-slot-host.mjs",
    "system/adapters/native/signed-current-compatibility.mjs",
    "tests/test_native_signed_current_compatibility.mjs",
    "tests/test_native_verified_installed_apps.mjs",
    "tools/windows-emulator/desktop-verified-component-slot.test.mjs",
    "tools/surface-web/browser-smoke.mjs",
    "tests/test_windows_desktop_local_ai_host.mjs",
    "tests/test_creator_owner_external_source.py",
    "tools/ci/portable_qemu_impact.py",
    "tests/test_portable_qemu_impact.py",
    "tools/ci/creator_owner_impact.py",
    "tests/test_creator_owner_impact.py",
    # This tool and test govern only CI publication freshness; neither is
    # installed in the physical USB image. QEMU cannot validate these bytes.
    "tools/ci/creator_owner_publish_freshness.py",
    "tests/test_creator_owner_publish_freshness.py",
})
# Self-contained artifact consumers. Changes in these owners are validated
# by installed Windows Desktop / Chromium Web gates, never the USB producer.
# Do not include system/adapters/web/**: Native imports some of those modules.
# Do not include system/composition/native/**: it is the real USB boot entry.
CLIENT_ONLY_PREFIXES = (
    "system/adapters/desktop/",
    "system/composition/web/",
    "tools/windows-emulator/",
)
# Narrow, content-proven DEV Windows Product bridge delta (OS #2400).
# These additions are WindowsDesktopHost-guarded and data-only. Any other
# shared Native/USB edit, unknown dependency or modified attestation blob
# immediately restores the mandatory Creator gate. No broad Native allowlist.
WINDOWS_PRODUCT_SHARED_ADDITIONS = {
    "system/composition/native/main.mjs": (
        "import { createNativeDesktopProductRuntimeStatus } from \"../../adapters/native/desktop-product-runtime-status.mjs\";",
        "import { mountNativeDesktopSurfaceStateReport } from \"../../adapters/native/desktop-surface-state-report.mjs\";",
        "  const desktopProductRuntimeStatus = windowsDesktopHost",
        "    ? createNativeDesktopProductRuntimeStatus(window)",
        "    : null;",
        "    desktopProductRuntimeStatus,",
        "  const desktopSurfaceReporter = windowsDesktopHost",
        "    ? mountNativeDesktopSurfaceStateReport(window, root, surface, appActivation)",
        "    : null;",
        "      desktopSurfaceReporter?.dispose();",
    ),
    "system/services/i18n/catalog/system.mjs": (
        "  \"system.overview.mcp.card\": \"MCP do OrdaX Desktop\",",
        "  \"system.overview.mcp.checking\": \"Verificando...\",",
        "  \"system.overview.mcp.unavailable\": \"Status indisponível\",",
        "  \"system.overview.mcp.noObservation\": \"Sem leitura local do Supervisor.\",",
        "  \"system.overview.mcp.attested\": \"Conectado e atestado\",",
        "  \"system.overview.mcp.attestedDetail\": \"A sessão e as capacidades foram atestadas pelo Runtime.\",",
        "  \"system.overview.mcp.notEnrolled\": \"Sem matrícula\",",
        "  \"system.overview.mcp.notEnrolledDetail\": \"Este Desktop precisa de sua própria identidade na Platform.\",",
        "  \"system.overview.mcp.running\": \"Runtime em execução\",",
        "  \"system.overview.mcp.runningDetail\": \"Processo Native ativo. A sessão do GPT é verificada separadamente.\",",
        "  \"system.overview.mcp.blocked\": \"Runtime bloqueado\",",
        "  \"system.overview.mcp.blockedDetail\": \"Verifique a identidade e a política do componente.\",",
        "  \"system.overview.mcp.stopped\": \"Runtime parado\",",
        "  \"system.overview.mcp.stoppedDetail\": \"O Supervisor não mantém um processo ativo.\",",
        "  \"system.overview.mcp.card\": \"OrdaX Desktop MCP\",",
        "  \"system.overview.mcp.checking\": \"Checking...\",",
        "  \"system.overview.mcp.unavailable\": \"Status unavailable\",",
        "  \"system.overview.mcp.noObservation\": \"No local Supervisor observation available.\",",
        "  \"system.overview.mcp.attested\": \"Connected and attested\",",
        "  \"system.overview.mcp.attestedDetail\": \"The Runtime has attested the session and capabilities.\",",
        "  \"system.overview.mcp.notEnrolled\": \"Not enrolled\",",
        "  \"system.overview.mcp.notEnrolledDetail\": \"This Desktop needs its own Platform device identity.\",",
        "  \"system.overview.mcp.running\": \"Runtime running\",",
        "  \"system.overview.mcp.runningDetail\": \"Native process is active. GPT session attestation is verified separately.\",",
        "  \"system.overview.mcp.blocked\": \"Runtime blocked\",",
        "  \"system.overview.mcp.blockedDetail\": \"Check the device identity and component policy.\",",
        "  \"system.overview.mcp.stopped\": \"Runtime stopped\",",
        "  \"system.overview.mcp.stoppedDetail\": \"The Supervisor has no active process.\",",
    ),
}
WINDOWS_PRODUCT_PINNED_BLOBS = {
    "docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json": "5f26c8d88b579fcaed95baceab0d197fdea31441",
    "system/adapters/native/desktop-product-runtime-status.mjs": "1aa2dfb66bbb60ea3feab0c28ec5cc076dd29da1",
    "system/adapters/native/desktop-surface-state-report.mjs": "175f000801fd7953cec693e441a7ceb5107e9227",
}

# The installed Linux Git updater is a source file, not a Creator build dependency.
# Its PR regressions are covered by Owner Development Preflight. Preserve the
# actual USB producer on main and on mixed boot/Base/native-helper changes.
# Never broad-exclude bootstrap/dev-base/** or any installed native helper.
PULL_REVIEW_ONLY_PATHS = frozenset({
    "bootstrap/dev-base/ordax-pull",
    "tests/test_dev_pull_expected_sha.py",
    "tests/test_dev_git_flow.py",
    "tests/test_dev_checkout_exchange.py",
    "docs/DEV-USB-GIT.md",
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
      required: __DOLLAR__{{ steps.scope.outputs.required == 'true' && steps.freshness.outputs.publish_allowed != 'false' }}
      reason: __DOLLAR__{{ steps.freshness.outputs.reason || steps.scope.outputs.reason }}
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
          case "$ORDAX_EVENT_NAME" in
            pull_request|push)
              git fetch --no-tags --depth=1 origin "$ORDAX_BASE_SHA"
              python3 tools/ci/creator_owner_impact.py classify --base "$ORDAX_BASE_SHA" --head "$ORDAX_HEAD_SHA"
              ;;
            workflow_dispatch)
              python3 tools/ci/creator_owner_impact.py classify --base "$ORDAX_BASE_SHA" --head "$ORDAX_HEAD_SHA" --force
              ;;
            *)
              echo 'Unsupported Owner USB event: fail closed' >&2
              exit 1
              ;;
          esac
      # On a queued main push, avoid an expensive build that is already
      # obsolete. PR proofs and explicit manual dispatch remain unaffected.
      - name: Skip superseded main USB production
        id: freshness
        if: github.event_name == 'push' && steps.scope.outputs.required == 'true'
        env:
          ORDAX_SOURCE_SHA: __DOLLAR__{{ github.sha }}
        run: |
          set -euo pipefail
          python3 tools/ci/creator_owner_publish_freshness.py \\
            --source "$ORDAX_SOURCE_SHA" --github-output "$GITHUB_OUTPUT"
""".replace("__DOLLAR__", "$")


# The current Buildroot Owner branch retains its lightweight contract job.
# Adding main's exact impact classifier must not delete that job or trigger
# expensive Creator builds for draft PRs.
BUILD_GUARD_OLD = (
    "\n  build-and-publish:\n"
    "    needs: owner-dev-contract\n"
    "    # Draft PRs use fast contracts; full USB/QEMU only for a release candidate.\n"
    "    # workflow_dispatch and main push remain explicit/full delivery entrypoints.\n"
    "    if: github.event_name != 'pull_request' || !github.event.pull_request.draft\n"
)
BUILD_GUARD_NEW = (
    "\n  build-and-publish:\n"
    "    needs: [owner-dev-contract, impact]\n"
    "    # Draft PRs use fast contracts; full USB/QEMU only for a release candidate.\n"
    "    # workflow_dispatch and main push remain explicit/full delivery entrypoints.\n"
    "    if: needs.impact.outputs.required == 'true' && (github.event_name != 'pull_request' || !github.event.pull_request.draft)\n"
)

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
            end = body.find("\n  owner-dev-contract:\n", start)
            if start < 0 or end < 0 or "\n  impact:\n" in old_body:
                return False
            if body[start:end] != EXPECTED_IMPACT_JOB.rstrip("\n"):
                return False
            reduced = body[:start] + body[end:]
            if reduced.count(BUILD_GUARD_NEW) != 1:
                return False
            if reduced.replace(BUILD_GUARD_NEW, BUILD_GUARD_OLD) != old_body:
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



def verified_creator_freshness_wiring_only(base, head, *, root=ROOT):
    """Only add a monotonic, fail-closed latest-main guard to existing CI.

    This proof does not waive real USB production: it admits exactly three
    reviewed workflow edits (impact output, early skip, pre-upload veto).
    Packaging, signing, test steps, permissions, release upload, and source
    selection must remain byte-identical.
    """
    try:
        before = _git_show(base, WORKFLOW, root)
        after = _git_show(head, WORKFLOW, root)
        replacements = (
            (
                """    outputs:
      required: __DOLLAR__{{ steps.scope.outputs.required }}
      reason: __DOLLAR__{{ steps.scope.outputs.reason }}
    steps:""",
                """    outputs:
      required: __DOLLAR__{{ steps.scope.outputs.required == 'true' && steps.freshness.outputs.publish_allowed != 'false' }}
      reason: __DOLLAR__{{ steps.freshness.outputs.reason || steps.scope.outputs.reason }}
    steps:""",
            ),
            (
                """          esac
  owner-dev-contract:""",
                r"""          esac
      # On a queued main push, avoid an expensive build that is already
      # obsolete. PR proofs and explicit manual dispatch remain unaffected.
      - name: Skip superseded main USB production
        id: freshness
        if: github.event_name == 'push' && steps.scope.outputs.required == 'true'
        env:
          ORDAX_SOURCE_SHA: __DOLLAR__{{ github.sha }}
        run: |
          set -euo pipefail
          python3 tools/ci/creator_owner_publish_freshness.py \
            --source "$ORDAX_SOURCE_SHA" --github-output "$GITHUB_OUTPUT"
  owner-dev-contract:""",
            ),
            (
                """          repo='ordaxsystems/ordax-os'
          release="$GITHUB_WORKSPACE/out/owner-prototype/release"
          if ! gh release view creator-owner-prototype --repo "$repo" >/dev/null 2>&1; then""",
                r"""          repo='ordaxsystems/ordax-os'
          release="$GITHUB_WORKSPACE/out/owner-prototype/release"
          # Recheck immediately before mutating the rolling channel: main can
          # advance during a long Creator/QEMU build after the first CI gate.
          # A newer non-producer-only main revision may reuse the proved USB.
          freshness="$(python3 tools/ci/creator_owner_publish_freshness.py \
            --source "$ORDAX_OWNER_SOURCE_COMMIT")"
          echo "$freshness"
          case "$freshness" in
            'CREATOR_MAIN_FRESHNESS=SKIP '*)
              echo 'OWNER_CREATOR_PUBLICATION=SKIPPED_SUPERSEDED_SOURCE'
              exit 0
              ;;
            'CREATOR_MAIN_FRESHNESS=ALLOW '*) ;;
            *)
              echo 'Creator main freshness result is unrecognized: fail closed' >&2
              exit 1
              ;;
          esac
          if ! gh release view creator-owner-prototype --repo "$repo" >/dev/null 2>&1; then""",
            ),
        )
        for old, new in replacements:
            old = old.replace("__DOLLAR__", "$")
            new = new.replace("__DOLLAR__", "$")
            if before.count(old) != 1 or new in before:
                return False
            before = before.replace(old, new)
        return before == after
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        return False


def verified_legacy_profile_trigger_migration(base, head, *, root=ROOT):
    """Only an exact two-entry Intelligence CI documentation path migration is light."""
    try:
        before = _git_show(base, INTELLIGENCE_WORKFLOW, root)
        after = _git_show(head, INTELLIGENCE_WORKFLOW, root)
        return (before.count(LEGACY_PROFILE_TRIGGER) == 2
                and CURRENT_PROFILE_TRIGGER not in before
                and after == before.replace(LEGACY_PROFILE_TRIGGER,
                                             CURRENT_PROFILE_TRIGGER))
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        return False


def verified_legacy_profile_deletion(base, head, *, root=ROOT):
    """An archived root plan may be deleted, never edited/reintroduced as authority."""
    try:
        before = _git_show(base, LEGACY_PROFILE_DOC, root)
        if not before.startswith("# OrdaX") or "ARCHIVED / SUPERSEDED" not in before:
            return False
        # cat-file -e returns 128 for both absent paths and corrupt refs.
        # ls-tree must succeed against the verified commit and yield no path.
        probe = subprocess.run(
            ["git", "-C", str(root), "ls-tree", "-r", "--name-only",
             head, "--", LEGACY_PROFILE_DOC],
            check=True, capture_output=True, text=True, timeout=20,
        )
        return not probe.stdout.strip()
    except (OSError, UnicodeError, ValueError, subprocess.SubprocessError):
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


def verified_windows_product_additions(base, head, path, *, root=ROOT):
    """Only the exact additive, Windows-guarded Native and translation delta."""
    expected = WINDOWS_PRODUCT_SHARED_ADDITIONS.get(path)
    if expected is None:
        return False
    try:
        original = _git_show(base, path, root).splitlines()
        modified = _git_show(head, path, root).splitlines()
        pos, additions = 0, []
        for line in modified:
            if pos < len(original) and line == original[pos]:
                pos += 1
            else:
                additions.append(line)
        return pos == len(original) and tuple(additions) == expected
    except (OSError, UnicodeError, ValueError, subprocess.SubprocessError):
        return False


def verified_windows_semantic_surface_mount(base, head, *, root=ROOT):
    """Prove only the existing Windows-guarded call uses Surface's read port.

    No Native/Linux entrypoint, import, branch, boot path or other byte may
    change under this exception. Unknown Native changes still require USB.
    """
    path = "system/composition/native/main.mjs"
    original_call = (
        "  const desktopSurfaceReporter = windowsDesktopHost\n"
        "    ? mountNativeDesktopSurfaceStateReport(window, root, surface, appActivation)\n"
        "    : null;"
    )
    semantic_call = (
        "  const desktopSurfaceReporter = windowsDesktopHost\n"
        "    ? mountNativeDesktopSurfaceStateReport(window, surface, appActivation)\n"
        "    : null;"
    )
    try:
        before = _git_show(base, path, root)
        after = _git_show(head, path, root)
        return before.count(original_call) == 1 and (
            after == before.replace(original_call, semantic_call)
        )
    except (OSError, UnicodeError, ValueError, subprocess.SubprocessError):
        return False


def verified_windows_product_blob(head, path, *, root=ROOT):
    """Pin actual Native sidecar and DEV evidence bytes, not a filename claim."""
    expected = WINDOWS_PRODUCT_PINNED_BLOBS.get(path)
    if not expected:
        return False
    try:
        actual = subprocess.run(
            ["git", "-C", str(root), "rev-parse", f"{head}:{path}"],
            check=True, capture_output=True, text=True, timeout=20,
        ).stdout.strip()
        return actual == expected
    except (OSError, UnicodeError, ValueError, subprocess.SubprocessError):
        return False


def verified_desktop_trigger_detachment(base, head, *, root=ROOT):
    """Allow ONLY removing Windows NSIS from an unrelated Surface lock trigger."""
    previous = "              workflows+=(surface-source-consumer.yml owner-surface-source.yml windows-desktop-dev.yml)"
    current = "              workflows+=(surface-source-consumer.yml owner-surface-source.yml)"
    try:
        before = _git_show(base, DESKTOP_TRIGGER_WORKFLOW, root)
        after = _git_show(head, DESKTOP_TRIGGER_WORKFLOW, root)
        return before.count(previous) == 1 and after == before.replace(previous, current)
    except (OSError, UnicodeError, ValueError, subprocess.SubprocessError):
        return False


def verified_desktop_distribution_owner_cutover(base, head, *, root=ROOT):
    """Retarget only three Windows Electron ownership fields, not USB hosts."""
    replacements = (
        ('"git_main_materializer": "tools/windows-desktop/dev-update.cjs"',
         '"git_main_materializer": "ordaxsystems/ordax-desktop/dev-update.cjs"'),
        ('"health_promotion_owner": "tools/windows-desktop/dev-update.cjs"',
         '"health_promotion_owner": "ordaxsystems/ordax-desktop/dev-update.cjs"'),
        ('"application_relaunch_owner": "tools/windows-desktop/main.cjs"',
         '"application_relaunch_owner": "ordaxsystems/ordax-desktop/main.cjs"'),
    )
    try:
        before = _git_show(base, DESKTOP_DISTRIBUTION_CONTRACT, root)
        after = _git_show(head, DESKTOP_DISTRIBUTION_CONTRACT, root)
        expected = before
        for old, new in replacements:
            if expected.count(old) != 1:
                return False
            expected = expected.replace(old, new)
        return after == expected
    except (OSError, UnicodeError, ValueError, subprocess.SubprocessError):
        return False


def verified_retired_desktop_shell_deletion(base, head, name, *, root=ROOT):
    """Deleted Git-tracked Electron source cannot become a USB producer.

    Modifying, adding or resurrecting ANY file in this owner still requires
    a full Creator gate. Git operations are argv-only, no shell evaluation.
    """
    if not name.startswith(RETIRED_DESKTOP_ROOT):
        return False
    try:
        def exists(revision):
            result = subprocess.run(
                ["git", "-C", str(root), "cat-file", "-e", f"{revision}:{name}"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=20, check=False,
            )
            return result.returncode == 0
        return exists(base) and not exists(head)
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def classify(base, head, *, root=ROOT, event="push"):
    try:
        if event not in ("pull_request", "push"):
            return True, "unsupported-event"
        paths = changed_paths(base, head, root=root)
        if not paths:
            return False, "no-changes"
        # The Owner preflight already tests Git transactions, power loss,
        # recovery and the actual ordax-pull script on a PR. PR-only isolation
        # is safe because the main push still builds the changed physical USB.
        # A mixed change to boot, Base, Supervisor, native helper, signer or
        # unknown path never qualifies for this fast path.
        if (event == "pull_request"
                and "bootstrap/dev-base/ordax-pull" in paths
                and set(paths).issubset(PULL_REVIEW_ONLY_PATHS | LIGHT_EXACT)):
            return False, "pull-pr-owner-preflight"
        for path in paths:
            if path == WORKFLOW:
                if not (workflow_trigger_only(base, head, root=root)
                        or verified_creator_freshness_wiring_only(base, head, root=root)):
                    return True, "creator-workflow-producer-or-unknown-change"
            elif path == SURFACE_LOCK:
                if not verified_surface_visual_source_lock_delta(base, head, root=root):
                    return True, "surface-lock-not-proven-visual-only"
            elif path == INTELLIGENCE_WORKFLOW:
                if not verified_legacy_profile_trigger_migration(base, head, root=root):
                    return True, "intelligence-workflow-not-exact-profile-doc-migration"
            elif path == DESKTOP_TRIGGER_WORKFLOW:
                if not verified_desktop_trigger_detachment(base, head, root=root):
                    return True, "desktop-trigger-detachment-unverified"
            elif path == DESKTOP_DISTRIBUTION_CONTRACT:
                if not verified_desktop_distribution_owner_cutover(base, head, root=root):
                    return True, "desktop-owner-cutover-unverified"
            elif path.startswith(RETIRED_DESKTOP_ROOT):
                if not verified_retired_desktop_shell_deletion(base, head, path, root=root):
                    return True, "retired-desktop-source-not-deletion:" + path
            elif path == LEGACY_PROFILE_DOC:
                if not verified_legacy_profile_deletion(base, head, root=root):
                    return True, "legacy-profile-doc-not-verified-deletion"
            elif path in WINDOWS_PRODUCT_SHARED_ADDITIONS:
                # Existing Windows additions and this exact guarded semantic
                # port migration have independent content proofs.
                proven = verified_windows_product_additions(base, head, path, root=root)
                if path == "system/composition/native/main.mjs" and not proven:
                    proven = verified_windows_semantic_surface_mount(base, head, root=root)
                if not proven:
                    return True, "windows-product-shared-delta-not-proven:" + path
            elif path in WINDOWS_PRODUCT_PINNED_BLOBS:
                if not verified_windows_product_blob(head, path, root=root):
                    return True, "windows-product-untrusted-blob:" + path
            elif path not in LIGHT_EXACT and not any(
                path.startswith(prefix) for prefix in CLIENT_ONLY_PREFIXES
            ):
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
    # GitHub Actions sets this host-owned variable for each workflow event.
    # Local classifier invocations retain conservative push behavior.
    event = os.environ.get("GITHUB_EVENT_NAME", "push")
    required, reason = ((True, "manual-dispatch-producer-proof") if args.force
                        else classify(args.base, args.head, event=event))
    result = f"required={'true' if required else 'false'}\nreason={reason}\n"
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(result)
    print("CREATOR_OWNER_USB_REQUIRED=" + ("YES" if required else "NO") + " reason=" + reason)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
