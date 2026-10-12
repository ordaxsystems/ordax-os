package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectActivationCompatibilityV2BindsExactPendingState(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	trust, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inspectActiveCompatibilityV2(
		fixture.root, "internet", "pending", 1, trust,
	); err == nil {
		t.Fatal("staged but not armed slot was reported pending")
	}
	state, err := armPendingState(candidate.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	report, err := inspectActiveCompatibilityV2(
		fixture.root, "internet", "pending", state.Revision, trust,
	)
	if err != nil {
		t.Fatal(err)
	}
	if report.Schema != activationCompatibilitySnapshotSchema ||
		report.Authority != "none" ||
		report.Target != "pending" ||
		report.Revision != state.Revision ||
		report.PendingHealth != "unknown" ||
		report.TrustSHA256 != report.VerifiedSlot.TrustSHA256 ||
		report.VerifiedSlot.ComponentID != "internet" ||
		report.VerifiedSlot.Version != candidate.release.Component.Version ||
		report.VerifiedSlot.SourceCommit != candidate.release.SourceCommit {
		t.Fatalf("diagnostic does not bind signed release to activation identity: %+v", report)
	}
	after, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if !sameSlotIdentity(after.Pending, state.Pending) ||
		after.Revision != state.Revision || after.Current != nil {
		t.Fatalf("read-only compatibility inspection altered activation: %+v", after)
	}
}

func TestInspectActivationCompatibilityV2CurrentAndStaleRevision(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	trust, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	state := healthyPromoteV2(t, fixture, candidate)
	report, err := inspectActiveCompatibilityV2(
		fixture.root, "internet", "current", state.Revision, trust,
	)
	if err != nil {
		t.Fatal(err)
	}
	if report.Target != "current" || report.Revision != state.Revision ||
		report.VerifiedSlot.Version != "1.0.0" ||
		report.VerifiedSlot.ActivationStatus != "not-evaluated" {
		t.Fatalf("readout falsely granted activation or wrong identity: %+v", report)
	}
	if _, err := inspectActiveCompatibilityV2(
		fixture.root, "internet", "pending", state.Revision, trust,
	); err == nil || !strings.Contains(err.Error(), "absent") {
		t.Fatalf("pending status should be absent after promotion: %v", err)
	}
	if _, err := inspectActiveCompatibilityV2(
		fixture.root, "internet", "current", state.Revision-1, trust,
	); err == nil || !strings.Contains(err.Error(), "revision is stale") {
		t.Fatalf("stale activation revision accepted: %v", err)
	}
	if _, err := inspectActiveCompatibilityV2(
		fixture.root, "internet", "current", state.Revision+1, trust,
	); err == nil {
		t.Fatal("future activation revision accepted")
	}
}

func TestInspectActivationCompatibilityV2CannotMixTrustOrTamperedState(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	state, err := armPendingState(candidate.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	wrong := makeActivationV2Fixture(t)
	wrongTrust, err := readRegular(wrong.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inspectActiveCompatibilityV2(
		fixture.root, "internet", "pending", state.Revision, wrongTrust,
	); err == nil {
		t.Fatal("foreign public trust passed signed activation inspection")
	}
	trust, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	// Bad JSON or a false identity must not be treated as a valid
	// activation state, even if a legitimate staged slot remains cached.
	activationPath := filepath.Join(fixture.root, "internet", activationStateName)
	if err := os.WriteFile(activationPath, []byte("{corrupt"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectActiveCompatibilityV2(
		fixture.root, "internet", "pending", state.Revision, trust,
	); err == nil {
		t.Fatal("corrupt canonical activation state was accepted")
	}
}

func TestInspectActivationCompatibilityV2RespectsExplicitUninstallIntent(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	trust, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	state := healthyPromoteV2(t, fixture, candidate)
	removed, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", *state.Current, state.Revision, fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !removed.UserRemoved {
		t.Fatal("canonical uninstall intent was not recorded")
	}
	if _, err := inspectActiveCompatibilityV2(
		fixture.root, "internet", "current", removed.Revision, trust,
	); err == nil {
		t.Fatal("uninstalled app was falsely reported as installed")
	}
	// A previously verified immutable slot may remain as a cache; it must
	// never be confused with active installed state after uninstall.
	if _, err := inspectVerifiedSlotCompatibilityV2(candidate.slot, trust); err != nil {
		t.Fatalf("uninstall corrupted existing signed slot cache: %v", err)
	}
}

func TestInspectActivationCompatibilityV2RejectsWrongTargetAndMissingRevision(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	trust, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, choice := range []struct {
		id       string
		target   string
		revision int64
	}{
		{"internet", "previous", 1},
		{"internet", "current", 0},
		{"INVALID", "current", 1},
	} {
		if _, err := inspectActiveCompatibilityV2(
			fixture.root, choice.id, choice.target, choice.revision, trust,
		); err == nil {
			t.Fatalf("accepted invalid inspection choice: %+v", choice)
		}
	}
	for _, args := range [][]string{
		nil,
		{"--component", "internet", "--target", "current", "--trust", "trust"},
		{"--component", "internet", "--target", "current", "--trust", "trust", "--expected-revision", "1", "extra"},
	} {
		if err := inspectActiveCompatibilityV2Command(args); err == nil {
			t.Fatalf("CLI accepted incomplete or extra arguments: %v", args)
		}
	}
}

func TestArmPendingRevisionCASFailsClosedBeforeMutation(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	first := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	second := addActivationV2Candidate(
		t, fixture, "2.0.0", "2222222222222222222222222222222222222222",
	)
	zero := int64(0)
	pending, err := armPendingStateAtRevision(first.slot, fixture.trustPath, fixture.root, &zero)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Revision != 1 || pending.Current != nil || pending.Pending == nil {
		t.Fatalf("first installation CAS did not commit exactly once: %+v", pending)
	}
	if _, err := armPendingStateAtRevision(second.slot, fixture.trustPath, fixture.root, &zero); err == nil {
		t.Fatal("stale arm revision was accepted")
	}
	unchanged, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Revision != pending.Revision || !sameSlotIdentity(unchanged.Pending, pending.Pending) {
		t.Fatalf("stale arm mutated canonical activation state: %+v", unchanged)
	}
	if _, err := armPendingStateAtRevision(second.slot, fixture.trustPath, fixture.root, nil); err == nil {
		t.Fatal("different pending candidate bypassed existing slot check")
	}
}

func TestArmPendingRevisionCASRejectsStaleUpgradeAndHonorsLock(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	first := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	current := healthyPromoteV2(t, fixture, first)
	next := addActivationV2Candidate(
		t, fixture, "2.0.0", "2222222222222222222222222222222222222222",
	)
	stale := current.Revision - 1
	if _, err := armPendingStateAtRevision(next.slot, fixture.trustPath, fixture.root, &stale); err == nil {
		t.Fatal("old upgrade preflight revision was accepted")
	}
	releaseLock, err := acquireActivationLock(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := armPendingStateAtRevision(next.slot, fixture.trustPath, fixture.root, &current.Revision); err == nil {
		releaseLock()
		t.Fatal("arm bypassed canonical activation mutation lock")
	}
	releaseLock()
	pending, err := armPendingStateAtRevision(next.slot, fixture.trustPath, fixture.root, &current.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Revision != current.Revision+1 ||
		!sameSlotIdentity(pending.Current, current.Current) ||
		pending.Pending == nil || pending.Pending.Version != "2.0.0" ||
		pending.PendingHealth != "unknown" {
		t.Fatalf("signed candidate arm has wrong activation identity: %+v", pending)
	}
	if _, err := armPendingStateAtRevision(next.slot, fixture.trustPath, fixture.root, &current.Revision); err == nil {
		t.Fatal("same stale revision was accepted after arm")
	}
}

func TestArmPendingRevisionCASRejectsNegativeExpectedRevision(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	first := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	negative := int64(-1)
	if _, err := armPendingStateAtRevision(first.slot, fixture.trustPath, fixture.root, &negative); err == nil {
		t.Fatal("negative expected revision accepted")
	}
	if _, err := armPendingCommand([]string{"--slot", first.slot, "--trust", fixture.trustPath, "--root", fixture.root, "--expected-revision=-2"}); err == nil {
		t.Fatal("arm CLI accepted illegal revision")
	}
}
