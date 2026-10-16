from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "bootstrap" / "dev-base" / "ordax-run"


def test_ordax_run_recovers_only_explicit_automatic_rollback_pin():
    text = RUN.read_text(encoding="utf-8")
    recovery = text.split("recover_automatic_rollback_pin() {", 1)[1].split("\n}", 1)[0]

    assert 'PINNED_FILE=$STATE_DIR/pinned-commit' in text
    assert 'BOOT_REJECTED_FILE=$STATE_DIR/boot-rejected-commit' in text
    assert '[ -s "$PINNED_FILE" ] && [ ! -L "$PINNED_FILE" ] || return 0' in recovery
    assert '[ -s "$BOOT_REJECTED_FILE" ] && [ ! -L "$BOOT_REJECTED_FILE" ] || return 0' in recovery
    assert '[ "$current" = "$pinned" ] || return 0' in recovery
    assert '[ "$rejected" != "$pinned" ] || return 0' in recovery
    assert '"$PULL_BIN"' in recovery
    assert '[ ! -e "$PINNED_FILE" ]' in recovery
    assert 'rm -f "$BOOT_REJECTED_FILE"' in recovery


def test_failed_automatic_recovery_preserves_known_good_runtime_start():
    text = RUN.read_text(encoding="utf-8")
    recovery_call = text.index("recover_automatic_rollback_pin\n")
    source_read = text.index('source_sha=$("$GIT_BIN" -C "$WORKTREE" rev-parse HEAD')
    entry_start = text.index('ORDAX_DISTRIBUTION_PROFILE=owner-development')

    assert recovery_call < source_read < entry_start
    assert "main ainda indisponivel; mantendo known-good" in text
    assert "return 0" in text.split("main ainda indisponivel; mantendo known-good", 1)[1]


def test_ordax_run_shell_syntax():
    completed = subprocess.run(["sh", "-n", str(RUN)], capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr
