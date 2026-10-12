package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestActiveSignedCompatibilityCatalogUsesOnlyCanonicalCurrentSlots(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	state := healthyPromoteV2(t, fixture, current)
	staged := addActivationV2Candidate(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
	)
	trustBytes, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	report, err := inspectActiveCompatibilityCatalogV2(fixture.root, trustBytes)
	if err != nil {
		t.Fatal(err)
	}
	if report.Schema != activeCompatibilityCatalogSchema ||
		report.Authority != "none" || report.CompleteForActivation ||
		report.Scope != "signed-independent-current-slots-only" ||
		report.TrustScope != "caller-supplied-public-anchor" ||
		len(report.Components) != 1 {
		t.Fatalf("audit falsely claimed global completeness or staged installation: %+v", report)
	}
	only := report.Components[0]
	if only.ComponentID != "internet" || only.Target != "current" ||
		only.Revision != state.Revision || only.VerifiedSlot.Version != "1.0.0" {
		t.Fatalf("signed active current slot is not exact: %+v", only)
	}
	if only.VerifiedSlot.SourceCommit == staged.release.SourceCommit {
		t.Fatal("staged-only release was falsely treated as installed")
	}
	after, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != state.Revision || !sameSlotIdentity(after.Current, state.Current) {
		t.Fatalf("read-only audit modified activation state: %+v", after)
	}
}

func TestActiveSignedCompatibilityCatalogRejectsInvalidTrustAndUnsafeTree(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	healthyPromoteV2(t, fixture, current)
	trustBytes, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	other := makeActivationV2Fixture(t)
	foreign, err := readRegular(other.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inspectActiveCompatibilityCatalogV2(fixture.root, foreign); err == nil {
		t.Fatal("foreign public key verified the current signed slot")
	}
	unsafePath := filepath.Join(fixture.root, "unexpected.legacy")
	if err := os.WriteFile(unsafePath, []byte("unmanaged"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectActiveCompatibilityCatalogV2(fixture.root, trustBytes); err == nil ||
		!strings.Contains(err.Error(), "unsupported or unsafe") {
		t.Fatalf("unexpected root entry silently excluded from audit: %v", err)
	}
}

func TestActiveSignedCompatibilityCatalogRespectsUninstallAndCorruptState(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	state := healthyPromoteV2(t, fixture, current)
	trustBytes, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	uninstalled, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", *state.Current, state.Revision, fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !uninstalled.UserRemoved || uninstalled.Current != nil {
		t.Fatal("canonical uninstall intent is absent")
	}
	report, err := inspectActiveCompatibilityCatalogV2(fixture.root, trustBytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Components) != 0 || report.CompleteForActivation {
		t.Fatalf("uninstalled cached release was shown as active: %+v", report)
	}
	if _, err := inspectVerifiedSlotCompatibilityV2(current.slot, trustBytes); err != nil {
		t.Fatalf("uninstall corrupted immutable verified slot cache: %v", err)
	}
	stateFile := filepath.Join(fixture.root, "internet", activationStateName)
	if err := os.WriteFile(stateFile, []byte("{corrupted"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectActiveCompatibilityCatalogV2(fixture.root, trustBytes); err == nil {
		t.Fatal("audit treated invalid installation state as absence")
	}
}

func TestActiveSignedCompatibilityCatalogRejectsIncompleteRequest(t *testing.T) {
	for _, args := range [][]string{
		nil, {"--root", "somewhere"},
		{"--trust", "something", "unexpected"},
	} {
		if err := inspectActiveCompatibilityCatalogV2Command(args); err == nil {
			t.Fatalf("accepted incomplete active audit CLI arguments: %v", args)
		}
	}
}
