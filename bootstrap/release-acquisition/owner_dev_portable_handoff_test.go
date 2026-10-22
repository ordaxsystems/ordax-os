package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Tests the exact signed Dev acquisition with the EXISTING portable-state
// transaction engine on a disposable Linux filesystem. This is a boot-state
// handoff test, NOT a Dev USB boot, physical installation or Supervisor switch.
func TestOwnerSignedPreviewPortableStateHandoff(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("portable-state and Owner preview require Linux")
	}
	for _, name := range []string{"cc", "go", "sh", "timeout"} {
		if _, err := exec.LookPath(name); err != nil {
			t.Skipf("%s is unavailable: %v", name, err)
		}
	}
	source, err := filepath.Abs("../../bootstrap/initramfs/portable_state.c")
	if err != nil {
		t.Fatal(err)
	}
	shell, err := filepath.Abs("../../system/services/update/owner-signed-preview.sh")
	if err != nil {
		t.Fatal(err)
	}
	tmp := t.TempDir()
	agent := filepath.Join(tmp, "ordax-release-agent")
	stateHelper := filepath.Join(tmp, "ordax-portable-state")
	for _, build := range []*exec.Cmd{
		exec.Command("go", "build", "-o", agent, "."),
		exec.Command("cc", "-std=c11", "-O2", "-Wall", "-Wextra", "-o", stateHelper, source),
	} {
		if out, err := build.CombinedOutput(); err != nil {
			t.Fatalf("canonical runtime tool build failed: %v\n%s", err, out)
		}
	}

	trust, _, private := testKeys(t)
	trustData, err := json.Marshal(trust)
	if err != nil {
		t.Fatal(err)
	}
	trustPath := filepath.Join(tmp, "trust.json")
	if err := os.WriteFile(trustPath, trustData, 0o600); err != nil {
		t.Fatal(err)
	}
	prev := strings.Repeat("a", 40)
	candidate := testCommit
	system := validPortableEROFS()
	surface := validPortableEROFS()
	surface[len(surface)-1] = 0x36
	ai := validPortableEROFS()
	ai[len(ai)-1] = 0x54
	manifest := manifestForPortableV4(
		"https://example.invalid/system.erofs",
		"https://example.invalid/native-surface-runtime.erofs",
		"https://example.invalid/local-ai-runtime.erofs",
		system, surface, ai,
	)
	payloads := map[string][]byte{
		"system.erofs":                 system,
		"native-surface-runtime.erofs": surface,
		"local-ai-runtime.erofs":       ai,
	}
	previousManifest := manifest
	previousManifest.SourceCommit = prev
	previousManifest.ReleaseID = prev
	previousBundle := offlineFixture(t, trust, private, previousManifest, payloads)
	candidateBundle := offlineFixture(t, trust, private, manifest, payloads)
	root := filepath.Join(tmp, "owner-signed-preview")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	gitCheckout := filepath.Join(tmp, "git-checkout")
	if err := os.Mkdir(gitCheckout, 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(gitCheckout, "running-git")
	if err := os.WriteFile(marker, []byte("known-good"), 0o600); err != nil {
		t.Fatal(err)
	}
	runCommand := func(name string, env []string, args ...string) (string, error) {
		t.Helper()
		cmd := exec.Command(name, args...)
		cmd.Env = env
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	baseEnv := append(os.Environ(),
		"ORDAX_DISTRIBUTION_PROFILE=owner-development",
		"ORDAX_WORKTREE="+gitCheckout,
		"ORDAX_OWNER_SIGNED_AGENT="+agent,
		"ORDAX_OWNER_SIGNED_TRUST_FILE="+trustPath,
		"ORDAX_OWNER_SIGNED_CHANNEL_FILE="+filepath.Join(tmp, "intentionally-absent"),
		"ORDAX_OWNER_SIGNED_STAGE_ROOT="+root,
	)
	for _, v := range []struct{ sha, bundle string }{
		{prev, previousBundle}, {candidate, candidateBundle},
	} {
		env := append(append([]string(nil), baseEnv...), "ORDAX_OWNER_SIGNED_BUNDLE_DIR="+v.bundle)
		got, err := runCommand("sh", env, shell, "stage-offline", v.sha)
		if err != nil || !strings.Contains(got, v.sha) {
			t.Fatalf("signed stage failed for %s: %v\n%s", v.sha, err, got)
		}
	}
	for _, name := range []string{"current", "known-good", "candidate", "activation-transaction.json"} {
		if _, err := os.Lstat(filepath.Join(root, name)); !os.IsNotExist(err) {
			t.Fatalf("Dev signed preflight unexpectedly activated %s: %v", name, err)
		}
	}
	assertGit := func(t *testing.T) {
		t.Helper()
		data, err := os.ReadFile(marker)
		if err != nil || string(data) != "known-good" {
			t.Fatalf("Dev Git known-good was modified: %q %v", data, err)
		}
	}
	mkState := func(t *testing.T) (string, string) {
		t.Helper()
		stateRoot := filepath.Join(t.TempDir(), "owner-signed-state")
		if err := os.Mkdir(stateRoot, 0o700); err != nil {
			t.Fatal(err)
		}
		stateDir := filepath.Join(stateRoot, "ordax", "portable-release")
		if err := os.MkdirAll(stateDir, 0o700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"current", "known-good"} {
			if err := os.WriteFile(filepath.Join(stateDir, name), []byte(prev+"\n"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		return stateRoot, stateDir
	}
	runState := func(t *testing.T, stateRoot string, args ...string) string {
		t.Helper()
		got, err := runCommand(stateHelper, os.Environ(), append([]string{}, args...)...)
		if err != nil {
			t.Fatalf("portable-state %v failed: %v\n%s", args, err, got)
		}
		return strings.TrimSpace(got)
	}
	// Exercise the same Owner preview command with both real authorities:
	// exact signed release validation by Go, state observation by native C.
	// This is a disposable audit, never a Dev boot transport switch.
	audit := func(t *testing.T, stateRoot, expectedPhase, expectedCurrent string) {
		t.Helper()
		env := append(append([]string(nil), baseEnv...),
			"ORDAX_OWNER_SIGNED_STATE_ROOT="+stateRoot,
			"ORDAX_OWNER_SIGNED_STATE_HELPER="+stateHelper,
		)
		raw, err := runCommand("sh", env, shell, "audit-state", candidate)
		if err != nil {
			t.Fatalf("native signed audit failed: %v\n%s", err, raw)
		}
		var receipt struct {
			Schema string `json:"schema"`
			Phase string `json:"phase"`
			Current string `json:"current"`
		}
		if err := json.Unmarshal([]byte(raw), &receipt); err != nil {
			t.Fatalf("invalid signed native audit receipt: %v\n%s", err, raw)
		}
		if receipt.Schema != "ordax.portable-state-inspection/1" ||
			receipt.Phase != expectedPhase || receipt.Current != expectedCurrent {
			t.Fatalf("unexpected signed native audit state: %+v", receipt)
		}
		assertGit(t)
	}
	// The same read-only status primitive will gate future Dev boot handoff.
	// It never authorizes a candidate, signs content or changes activation.
	inspect := func(t *testing.T, stateRoot string, expectedPhase string, expectedCurrent string) {
		t.Helper()
		type status struct {
			Schema                   string `json:"schema"`
			Phase                    string `json:"phase"`
			Current                  string `json:"current"`
			KnownGood                string `json:"knownGood"`
			MaterializedShapeChecked bool   `json:"materializedShapeChecked"`
		}
		var result status
		raw := runState(t, stateRoot, "inspect", stateRoot, root)
		if err := json.Unmarshal([]byte(raw), &result); err != nil {
			t.Fatalf("invalid native inspect receipt: %v\n%s", err, raw)
		}
		if result.Schema != "ordax.portable-state-inspection/1" ||
			result.Phase != expectedPhase || result.Current != expectedCurrent ||
			result.KnownGood != prev || !result.MaterializedShapeChecked {
			t.Fatalf("unexpected native inspect receipt: %+v", result)
		}
	}
	assertAbsent := func(t *testing.T, stateDir string, names ...string) {
		t.Helper()
		for _, name := range names {
			if _, err := os.Lstat(filepath.Join(stateDir, name)); !os.IsNotExist(err) {
				t.Fatalf("unwanted activation state %s: %v", name, err)
			}
		}
	}

	t.Run("one-shot candidate falls back and pins rejected commit", func(t *testing.T) {
		stateRoot, stateDir := mkState(t)
		audit(t, stateRoot, "idle", prev)
		if got := runState(t, stateRoot, "prepare", stateRoot, root, candidate); got != candidate {
			t.Fatalf("prepare receipt: %q", got)
		}
		inspect(t, stateRoot, "armed", prev)
		audit(t, stateRoot, "armed", prev)
		if got := runState(t, stateRoot, "select-boot", stateRoot, root); got != "candidate "+candidate {
			t.Fatalf("first boot selection: %q", got)
		}
		if got := runState(t, stateRoot, "select-boot", stateRoot, root); got != "current "+prev {
			t.Fatalf("fallback boot selection: %q", got)
		}
		if got := runState(t, stateRoot, stateRoot, "current"); got != prev {
			t.Fatalf("fallback changed current: %q", got)
		}
		if got := runState(t, stateRoot, stateRoot, "known-good"); got != prev {
			t.Fatalf("fallback lost known good: %q", got)
		}
		if got := runState(t, stateRoot, stateRoot, "rejected"); got != candidate {
			t.Fatalf("rejection not persisted: %q", got)
		}
		inspect(t, stateRoot, "idle", prev)
		assertAbsent(t, stateDir, "candidate", "activation-transaction.json")
		bad, err := runCommand(stateHelper, os.Environ(), "prepare", stateRoot, root, candidate)
		if err == nil {
			t.Fatalf("rejected candidate rearmed: %s", bad)
		}
		assertGit(t)
	})

	t.Run("cold-health commit path only changes isolated slots after explicit commit", func(t *testing.T) {
		stateRoot, stateDir := mkState(t)
		runState(t, stateRoot, "prepare", stateRoot, root, candidate)
		runState(t, stateRoot, "select-boot", stateRoot, root)
		inspect(t, stateRoot, "armed", prev)
		if got := runState(t, stateRoot, stateRoot, "current"); got != prev {
			t.Fatalf("candidate was committed before health acknowledgement: %q", got)
		}
		if got := runState(t, stateRoot, "commit", stateRoot, root, candidate); got != candidate {
			t.Fatalf("health commit receipt: %q", got)
		}
		if got := runState(t, stateRoot, stateRoot, "current"); got != candidate {
			t.Fatalf("commit was not installed to disposable state: %q", got)
		}
		if got := runState(t, stateRoot, stateRoot, "known-good"); got != prev {
			t.Fatalf("commit destroyed rollback previous: %q", got)
		}
		inspect(t, stateRoot, "idle", candidate)
		audit(t, stateRoot, "idle", candidate)
		assertAbsent(t, stateDir, "candidate", "activation-transaction.json")
		assertGit(t)
	})
	t.Run("signed audit refuses tampered exact candidate before state inspection", func(t *testing.T) {
		stateRoot, _ := mkState(t)
		artifact := filepath.Join(root, "releases", candidate, "system.erofs")
		content, err := os.ReadFile(artifact)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(artifact, append(content, 0), 0o600); err != nil {
			t.Fatal(err)
		}
		env := append(append([]string(nil), baseEnv...),
			"ORDAX_OWNER_SIGNED_STATE_ROOT="+stateRoot,
			"ORDAX_OWNER_SIGNED_STATE_HELPER="+stateHelper,
		)
		raw, err := runCommand("sh", env, shell, "audit-state", candidate)
		if err == nil || strings.Contains(raw, "ordax.portable-state-inspection/1") {
			t.Fatalf("tampered signed release passed audit: %v\n%s", err, raw)
		}
		assertGit(t)
	})

}
