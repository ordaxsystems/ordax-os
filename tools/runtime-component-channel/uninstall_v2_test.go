package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReleaseV2UninstallClearsActivationRemovesPayloadAndAllowsOfflineReinstall(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t,
		fixture,
		"1.0.0",
		"1111111111111111111111111111111111111111",
	)
	state := healthyPromoteV2(t, fixture, candidate)
	if state.Current == nil {
		t.Fatal("promoted component has no current identity")
	}
	current := *state.Current
	uninstallRevision := state.Revision

	state, err := uninstallCurrentStateAtRevision(
		fixture.root,
		"internet",
		current,
		uninstallRevision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if state.Revision != uninstallRevision+1 ||
		state.Current != nil ||
		state.Previous != nil ||
		state.Pending != nil ||
		state.Rejected != nil ||
		state.PendingHealth != "unknown" {
		t.Fatalf("unexpected uninstalled activation state: %+v", state)
	}
	versionsRoot := filepath.Join(fixture.root, "internet", "versions")
	if _, err := os.Lstat(versionsRoot); !os.IsNotExist(err) {
		t.Fatalf("component payload versions root still exists after uninstall: %v", err)
	}
	resolved, slot, _, bundled, err := resolveRuntimeSlot(
		fixture.root,
		"internet",
		fixture.trustPath,
		"current",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !bundled || slot != "" || resolved.Current != nil {
		t.Fatalf("uninstalled component still resolves from slot: bundled=%t slot=%q state=%+v", bundled, slot, resolved)
	}

	retried, err := uninstallCurrentStateAtRevision(
		fixture.root,
		"internet",
		current,
		uninstallRevision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if retried.Revision != state.Revision {
		t.Fatalf("idempotent uninstall retry advanced revision: before=%d after=%d", state.Revision, retried.Revision)
	}

	_, restagedSlot, changed, err := stageComponentV2(
		candidate.envelopePath,
		fixture.trustPath,
		candidate.packagePath,
		candidate.compatibilityPath,
		fixture.root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("offline reinstall unexpectedly reused removed payload")
	}
	if restagedSlot != candidate.slot {
		t.Fatalf("offline reinstall canonical slot drifted: got=%q want=%q", restagedSlot, candidate.slot)
	}
	reinstalled := healthyPromoteV2(t, fixture, candidate)
	if reinstalled.Current == nil ||
		reinstalled.Current.Version != candidate.release.Component.Version ||
		reinstalled.Current.SourceCommit != candidate.release.SourceCommit {
		t.Fatalf("offline reinstall did not restore the same trusted identity: %+v", reinstalled)
	}
}

func TestReleaseV2UninstallRejectsWrongIdentityAndPendingMutation(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := addActivationV2Candidate(
		t,
		fixture,
		"1.0.0",
		"1111111111111111111111111111111111111111",
	)
	state := healthyPromoteV2(t, fixture, current)
	currentIdentity := *state.Current

	wrong := slotIdentity{
		Version:      currentIdentity.Version,
		SourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}
	if _, err := uninstallCurrentStateAtRevision(
		fixture.root,
		"internet",
		wrong,
		state.Revision,
	); err == nil || !strings.Contains(err.Error(), "identity does not match") {
		t.Fatalf("wrong uninstall identity error = %v", err)
	}

	pending := addActivationV2Candidate(
		t,
		fixture,
		"1.1.0",
		"2222222222222222222222222222222222222222",
	)
	state, err := armPendingState(pending.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := uninstallCurrentStateAtRevision(
		fixture.root,
		"internet",
		currentIdentity,
		state.Revision,
	); err == nil || !strings.Contains(err.Error(), "pending slot must be resolved") {
		t.Fatalf("pending uninstall error = %v", err)
	}
}
