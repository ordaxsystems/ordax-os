package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// This exercises the real Ed25519-signed release/2 slots and the canonical
// activation-state.json writer rather than trusting a caller-supplied graph.
func TestSignedFirstInstallRejectsMissingMandatoryNativeProvider(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	consumer := addSignedPeer(
		t, fixture, "notes", "2222222222222222222222222222222222222222",
		[]providedCompatibilityContract{{ID: "ordax.notes", Major: 1}},
		[]requiredCompatibilityContract{{ID: "ordax.internet", MinMajor: 1, MaxMajor: 1}},
	)
	if _, err := armPendingStateAtRevision(
		consumer.slot, fixture.trustPath, fixture.root, nil,
	); err == nil || !strings.Contains(err.Error(), "requires unavailable signed native provider") {
		t.Fatalf("first install accepted unproven required provider: %v", err)
	}
	after, err := readActivationState(fixture.root, "notes")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != 0 || after.Current != nil || after.Pending != nil {
		t.Fatalf("missing provider modified canonical first-install state: %+v", after)
	}
}

func TestSignedFirstInstallAcceptsInstalledProviderAndOptionalUnknown(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	provider := addActivationV2Candidate(t, fixture,
		"1.0.0", "1111111111111111111111111111111111111111")
	active := healthyPromoteV2(t, fixture, provider)
	consumer := addSignedPeer(
		t, fixture, "notes", "2222222222222222222222222222222222222222",
		[]providedCompatibilityContract{{ID: "ordax.notes", Major: 1}},
		[]requiredCompatibilityContract{
			{ID: "ordax.internet", MinMajor: 1, MaxMajor: 1},
			{ID: "ordax.unavailable.optional", MinMajor: 1, MaxMajor: 1, Optional: true},
		},
	)
	installed := healthyPromoteSignedPeer(t, fixture, "notes", consumer)
	original, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if installed.Current == nil || installed.Current.Version != "1.0.0" ||
		original.Revision != active.Revision || !sameSlotIdentity(original.Current, active.Current) {
		t.Fatalf("valid signed provider was not preserved: consumer=%+v provider=%+v", installed, original)
	}
}

func TestSignedFirstInstallPromotionRechecksProviderAfterHealth(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	provider := addActivationV2Candidate(t, fixture,
		"1.0.0", "1111111111111111111111111111111111111111")
	active := healthyPromoteV2(t, fixture, provider)
	consumer := addSignedPeer(
		t, fixture, "notes", "2222222222222222222222222222222222222222",
		[]providedCompatibilityContract{{ID: "ordax.notes", Major: 1}},
		[]requiredCompatibilityContract{{ID: "ordax.internet", MinMajor: 1, MaxMajor: 1}},
	)
	pending, err := armPendingState(consumer.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	healthRevision := pending.Revision
	healthy, err := recordPendingHealthAtRevision(
		fixture.root, "notes", *pending.Pending, "healthy", &healthRevision)
	if err != nil {
		t.Fatal(err)
	}
	// The pending consumer is not installed as current and cannot pin its
	// provider. Removing the provider before promotion invalidates the
	// candidate's earlier compatibility verdict.
	if _, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", *active.Current, active.Revision, fixture.trustPath,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := promotePendingStateAtRevision(
		fixture.root, "notes", *healthy.Pending, healthy.Revision, fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "requires unavailable signed native provider") {
		t.Fatalf("promotion trusted obsolete provider graph after health: %v", err)
	}
	after, err := readActivationState(fixture.root, "notes")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != healthy.Revision || after.Current != nil ||
		!sameSlotIdentity(after.Pending, healthy.Pending) || after.PendingHealth != "healthy" {
		t.Fatalf("failed promotion mutated pending state: %+v", after)
	}
}

func TestSignedFirstInstallRejectsCorruptActiveGraph(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	provider := addActivationV2Candidate(t, fixture,
		"1.0.0", "1111111111111111111111111111111111111111")
	healthyPromoteV2(t, fixture, provider)
	consumer := addSignedPeer(
		t, fixture, "notes", "2222222222222222222222222222222222222222",
		[]providedCompatibilityContract{{ID: "ordax.notes", Major: 1}},
		[]requiredCompatibilityContract{{ID: "ordax.internet", MinMajor: 1, MaxMajor: 1}},
	)
	if err := os.WriteFile(
		filepath.Join(fixture.root, "internet", activationStateName),
		[]byte("{corrupt"), 0o600,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := armPendingState(consumer.slot, fixture.trustPath, fixture.root); err == nil {
		t.Fatal("signed first-install silently omitted an invalid current peer")
	}
	after, err := readActivationState(fixture.root, "notes")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != 0 || after.Pending != nil || after.Current != nil {
		t.Fatalf("corrupt graph affected first-install activation state: %+v", after)
	}
}
