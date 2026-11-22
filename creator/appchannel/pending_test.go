package appchannel

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func installSignedBaseline(t *testing.T, root string, body []byte, manifest Manifest, envelope []byte) {
	t.Helper()
	directory := filepath.Join(root, "versions", manifest.SourceCommit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ArtifactName), body, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), envelope, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestPendingUpdateKeepsCurrentUntilPromotionAndPreservesPrevious(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)

	oldBody := []byte("old-known-good-app")
	oldManifest := validManifest(oldBody, "1111111111111111111111111111111111111111", 1)
	oldEnvelope := signedEnvelope(t, oldManifest, private)
	installSignedBaseline(t, root, oldBody, oldManifest, oldEnvelope)

	newBody := []byte("new-healthcheck-candidate")
	newManifest := validManifest(newBody, "2222222222222222222222222222222222222222", 2)
	newEnvelope := signedEnvelope(t, newManifest, private)
	client := &http.Client{Transport: staticTransport{envelope: newEnvelope, artifact: newBody}}

	pending, changed, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || pending.SourceCommit != newManifest.SourceCommit {
		t.Fatalf("unexpected pending update: %+v changed=%v", pending, changed)
	}
	current, err := Current(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if current.SourceCommit != oldManifest.SourceCommit {
		t.Fatalf("pending candidate replaced current before health-check: %+v", current)
	}

	promoted, err := PromotePending(root, pending.Manifest, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if promoted.SourceCommit != newManifest.SourceCommit {
		t.Fatalf("wrong promoted app: %+v", promoted)
	}
	current, err = Current(root, trust, trustSHA)
	if err != nil || current.SourceCommit != newManifest.SourceCommit {
		t.Fatalf("new current mismatch: %+v err=%v", current, err)
	}
	previous, err := Previous(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if previous.SourceCommit != oldManifest.SourceCommit || previous.ReleaseSequence != 1 {
		t.Fatalf("previous known-good was not preserved: %+v", previous)
	}
	if _, err := os.Stat(filepath.Join(root, pendingEnvelopeName)); !os.IsNotExist(err) {
		t.Fatalf("pending envelope survived promotion: %v", err)
	}
}

func TestDiscardPendingLeavesCurrentKnownGood(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	oldBody := []byte("stable")
	oldManifest := validManifest(oldBody, "3333333333333333333333333333333333333333", 3)
	installSignedBaseline(t, root, oldBody, oldManifest, signedEnvelope(t, oldManifest, private))

	newBody := []byte("broken-candidate")
	newManifest := validManifest(newBody, "4444444444444444444444444444444444444444", 4)
	client := &http.Client{Transport: staticTransport{envelope: signedEnvelope(t, newManifest, private), artifact: newBody}}
	if _, changed, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA); err != nil || !changed {
		t.Fatalf("AcquirePending changed=%v err=%v", changed, err)
	}
	if err := DiscardPending(root); err != nil {
		t.Fatal(err)
	}
	current, err := LastKnownGood(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if current.SourceCommit != oldManifest.SourceCommit {
		t.Fatalf("discarded candidate changed known-good: %+v", current)
	}
}

func TestLastKnownGoodFallsBackToPreviousAfterCurrentCorruption(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	oldBody := []byte("old-good")
	oldManifest := validManifest(oldBody, "5555555555555555555555555555555555555555", 5)
	installSignedBaseline(t, root, oldBody, oldManifest, signedEnvelope(t, oldManifest, private))

	newBody := []byte("new-good")
	newManifest := validManifest(newBody, "6666666666666666666666666666666666666666", 6)
	client := &http.Client{Transport: staticTransport{envelope: signedEnvelope(t, newManifest, private), artifact: newBody}}
	pending, _, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	promoted, err := PromotePending(root, pending.Manifest, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(promoted.Executable, []byte("tampered-current"), 0o700); err != nil {
		t.Fatal(err)
	}
	fallback, err := LastKnownGood(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if fallback.SourceCommit != oldManifest.SourceCommit {
		t.Fatalf("did not fall back to previous signed app: %+v", fallback)
	}
}

func TestNewerPendingCanRepairCorruptCurrentBytesWithoutForgettingSequence(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	oldBody := []byte("old-good")
	oldManifest := validManifest(oldBody, "7777777777777777777777777777777777777777", 7)
	installSignedBaseline(t, root, oldBody, oldManifest, signedEnvelope(t, oldManifest, private))

	currentBody := []byte("current-before-corruption")
	currentManifest := validManifest(currentBody, "8888888888888888888888888888888888888888", 8)
	currentClient := &http.Client{Transport: staticTransport{envelope: signedEnvelope(t, currentManifest, private), artifact: currentBody}}
	pending, _, err := AcquirePending(currentClient, root, DefaultEnvelopeURL, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	promoted, err := PromotePending(root, pending.Manifest, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(promoted.Executable, []byte("corrupted-current-bytes"), 0o700); err != nil {
		t.Fatal(err)
	}

	reusedBody := []byte("different-sequence-eight")
	reused := validManifest(reusedBody, "9999999999999999999999999999999999999999", 8)
	reusedClient := &http.Client{Transport: staticTransport{envelope: signedEnvelope(t, reused, private), artifact: reusedBody}}
	if _, _, err := AcquirePending(reusedClient, root, DefaultEnvelopeURL, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "reused") {
		t.Fatalf("corrupt executable forgot signed current sequence: %v", err)
	}

	repairBody := []byte("newer-repair")
	repairManifest := validManifest(repairBody, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 9)
	repairClient := &http.Client{Transport: staticTransport{envelope: signedEnvelope(t, repairManifest, private), artifact: repairBody}}
	repair, changed, err := AcquirePending(repairClient, root, DefaultEnvelopeURL, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || repair.ReleaseSequence != 9 {
		t.Fatalf("unexpected repair candidate: %+v changed=%v", repair, changed)
	}
	if _, err := PromotePending(root, repair.Manifest, trust, trustSHA); err != nil {
		t.Fatal(err)
	}
	current, err := Current(root, trust, trustSHA)
	if err != nil || current.ReleaseSequence != 9 {
		t.Fatalf("repair was not promoted: %+v err=%v", current, err)
	}
	previous, err := Previous(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if previous.ReleaseSequence != 7 || previous.SourceCommit != oldManifest.SourceCommit {
		t.Fatalf("corrupt current replaced verified previous LKG: %+v", previous)
	}
}

func TestCorruptCurrentEnvelopeBlocksAutomaticUpdate(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	body := []byte("baseline")
	manifest := validManifest(body, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 10)
	installSignedBaseline(t, root, body, manifest, signedEnvelope(t, manifest, private))
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), []byte("not-a-signed-envelope"), 0o600); err != nil {
		t.Fatal(err)
	}

	candidateBody := []byte("candidate")
	candidate := validManifest(candidateBody, "cccccccccccccccccccccccccccccccccccccccc", 11)
	client := &http.Client{Transport: staticTransport{envelope: signedEnvelope(t, candidate, private), artifact: candidateBody}}
	if _, _, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "identity is invalid") {
		t.Fatalf("invalid signed baseline did not fail closed: %v", err)
	}
}

func TestOfflineAppRejectsOversizedCurrentPreviousAndPendingEnvelopes(t *testing.T) {
	trust, _, trustSHA := testTrust(t)
	for _, name := range []string{currentEnvelopeName, previousEnvelopeName, pendingEnvelopeName} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, name)
			if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Truncate(path, maxEnvelopeBytes+1); err != nil {
				t.Fatal(err)
			}
			var err error
			switch name {
			case currentEnvelopeName:
				_, err = Current(root, trust, trustSHA)
			case previousEnvelopeName:
				_, err = Previous(root, trust, trustSHA)
			case pendingEnvelopeName:
				_, _, err = readVerifiedEnvelope(root, name, trust, trustSHA)
			}
			if err == nil || !strings.Contains(err.Error(), "outside allowed size") {
				t.Fatalf("oversized signed App pointer was accepted: %v", err)
			}
		})
	}
}

func TestAcquirePendingRejectsReboundSignedReleaseWithSameSourceCommit(t *testing.T) {
	for _, mode := range []string{"identical", "same-sequence-different-artifact", "same-source-higher-sequence"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			trust, private, trustSHA := testTrust(t)
			body := []byte("installed-signed-app")
			baseline := validManifest(body, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 10)
			installSignedBaseline(t, root, body, baseline, signedEnvelope(t, baseline, private))
			candidate := baseline
			switch mode {
			case "same-sequence-different-artifact":
				candidate.Artifact.SHA256 = strings.Repeat("b", 64)
			case "same-source-higher-sequence":
				candidate.ReleaseSequence++
			}
			client := &http.Client{Transport: staticTransport{
				envelope: signedEnvelope(t, candidate, private),
				artifact: body,
			}}
			installed, pending, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA)
			if mode == "identical" {
				if err != nil || pending || installed.SourceCommit != baseline.SourceCommit {
					t.Fatalf("unchanged signed release must reuse current: pending=%t installed=%+v err=%v", pending, installed, err)
				}
			} else if err == nil || pending || !strings.Contains(err.Error(), "source commit") {
				t.Fatalf("rebound signed App source accepted: pending=%t installed=%+v err=%v", pending, installed, err)
			}
			current, currentErr := Current(root, trust, trustSHA)
			if currentErr != nil || current.Manifest != baseline {
				t.Fatalf("existing verified App identity was changed: current=%+v err=%v", current, currentErr)
			}
			if _, statErr := os.Stat(filepath.Join(root, pendingEnvelopeName)); !os.IsNotExist(statErr) {
				t.Fatalf("rebound source left pending activation: %v", statErr)
			}
		})
	}
}

func TestPromotePendingRequiresExactHealthCheckedSignedManifest(t *testing.T) {
	for _, mode := range []string{"version", "release-sequence"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			trust, private, trustSHA := testTrust(t)
			oldBody := []byte("signed-known-good-app")
			old := validManifest(oldBody, "1111111111111111111111111111111111111111", 1)
			installSignedBaseline(t, root, oldBody, old, signedEnvelope(t, old, private))

			body := []byte("new-healthchecked-app")
			candidate := validManifest(body, "2222222222222222222222222222222222222222", 2)
			client := &http.Client{Transport: staticTransport{
				envelope: signedEnvelope(t, candidate, private),
				artifact: body,
			}}
			pending, changed, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA)
			if err != nil || !changed {
				t.Fatalf("valid candidate not staged: changed=%t err=%v", changed, err)
			}

			// Simulate a different legitimately signed envelope appearing in
			// the pending slot after candidate A passed its health check. The
			// executable and source commit remain exactly the same; signature,
			// SHA-256 of the installed bytes, and rollback checks all pass.
			swapped := candidate
			switch mode {
			case "version":
				swapped.Version = "0.1.1"
			case "release-sequence":
				swapped.ReleaseSequence = candidate.ReleaseSequence + 1
			}
			if err := os.WriteFile(filepath.Join(root, pendingEnvelopeName), signedEnvelope(t, swapped, private), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, _, err := readInstalledEnvelope(root, pendingEnvelopeName, trust, trustSHA); err != nil {
				t.Fatalf("swapped manifest must still be validly signed and locally installed: %v", err)
			}
			if _, err := PromotePending(root, pending.Manifest, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "health-checked candidate") {
				t.Fatalf("signed pending manifest changed between health check and promotion: %v", err)
			}
			current, err := Current(root, trust, trustSHA)
			if err != nil || current.Manifest != old {
				t.Fatalf("known-good current was changed on failed promotion: current=%+v err=%v", current, err)
			}
			if _, err := Previous(root, trust, trustSHA); !os.IsNotExist(err) {
				t.Fatalf("previous pointer unexpectedly modified: %v", err)
			}
			// Correct candidate can be restored and promoted without
			// inventing a second activation path or requiring redownload.
			if err := os.WriteFile(filepath.Join(root, pendingEnvelopeName), signedEnvelope(t, candidate, private), 0o600); err != nil {
				t.Fatal(err)
			}
			promoted, err := PromotePending(root, pending.Manifest, trust, trustSHA)
			if err != nil || promoted.Manifest != candidate {
				t.Fatalf("original health-checked candidate not promoted: promoted=%+v err=%v", promoted, err)
			}
		})
	}
}
