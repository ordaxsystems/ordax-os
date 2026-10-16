from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "bootstrap" / "dev-base" / "ordax-run"
PULL = ROOT / "bootstrap" / "dev-base" / "ordax-pull"


def test_ordax_run_recovers_only_explicit_automatic_rollback_pin():
    text = RUN.read_text(encoding="utf-8")
    recovery = text.split("recover_automatic_rollback_pin() {", 1)[1].split("\n}", 1)[0]

    assert 'PINNED_FILE=$STATE_DIR/pinned-commit' in text
    assert 'BOOT_REJECTED_FILE=$STATE_DIR/boot-rejected-commit' in text
    assert '[ -s "$PINNED_FILE" ] && [ ! -L "$PINNED_FILE" ] || return 0' in recovery
    assert '[ -s "$BOOT_REJECTED_FILE" ] && [ ! -L "$BOOT_REJECTED_FILE" ] || return 0' in recovery
    assert '[ "$current" = "$pinned" ] || return 0' in recovery
    assert '[ "$rejected" != "$pinned" ] || return 0' in recovery
    assert 'ORDAX_AUTOMATIC_ROLLBACK_RECOVERY=1' in recovery
    assert '"$PULL_BIN"' in recovery
    assert '[ "$refreshed" != "$pinned" ]' in recovery
    assert '[ "$refreshed" != "$rejected" ]' in recovery
    assert '[ ! -e "$PINNED_FILE" ]' in recovery
    assert '[ ! -e "$BOOT_REJECTED_FILE" ]' in recovery


def test_automatic_pull_refuses_same_known_good_or_rejected_delivery():
    text = PULL.read_text(encoding="utf-8")
    assert 'AUTOMATIC_ROLLBACK_RECOVERY=${ORDAX_AUTOMATIC_ROLLBACK_RECOVERY:-0}' in text
    assert 'BOOT_REJECTED_FILE=$STATE_DIR/boot-rejected-commit' in text
    assert '[ "$remote_sha" = "$recovery_pinned" ]' in text
    assert "main ainda aponta para o known-good fixado" in text
    assert '[ "$remote_sha" = "$recovery_rejected" ]' in text
    assert "main ainda aponta para a entrega rejeitada" in text
    assert '[ "$current" = "$recovery_pinned" ] || [ "$current" = "$recovery_rejected" ]' in text
    assert 'rm -f "$PINNED_FILE" "$BOOT_REJECTED_FILE"' in text


def test_manual_pull_keeps_explicit_manual_unpin_semantics():
    text = PULL.read_text(encoding="utf-8")
    final = text.rsplit('if [ "$AUTOMATIC_ROLLBACK_RECOVERY" -eq 1 ]; then', 1)[1]
    assert 'else\n    rm -f "$PINNED_FILE"\nfi' in final


def test_failed_automatic_recovery_preserves_known_good_runtime_start():
    text = RUN.read_text(encoding="utf-8")
    recovery_call = text.index("recover_automatic_rollback_pin\n")
    source_read = text.index('source_sha=$("$GIT_BIN" -C "$WORKTREE" rev-parse HEAD')
    entry_start = text.index('ORDAX_DISTRIBUTION_PROFILE=owner-development')

    assert recovery_call < source_read < entry_start
    assert "main ainda indisponivel ou sem entrega nova segura; mantendo known-good" in text
    assert "return 0" in text.split(
        "main ainda indisponivel ou sem entrega nova segura; mantendo known-good", 1
    )[1]


def test_dev_helpers_shell_syntax():
    for script in (RUN, PULL):
        completed = subprocess.run(["sh", "-n", str(script)], capture_output=True, text=True)
        assert completed.returncode == 0, f"{script}: {completed.stderr}"
