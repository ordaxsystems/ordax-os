package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Each fixture uses actual Ed25519-signed release/2 component slots and the
// canonical activation-state.json. No unsigned diagnostic can grant activation.
func activeProviderAndDependentPeer(t *testing.T, fixture activationV2Fixture) activationState {
	t.Helper()
	provider := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	current := healthyPromoteV2(t, fixture, provider)
	peer := addSignedPeer(
		t, fixture, "notes", "2222222222222222222222222222222222222222",
		[]providedCompatibilityContract{{ID: "ordax.notes", Major: 1}},
		[]requiredCompatibilityContract{{ID: "ordax.internet", MinMajor: 1, MaxMajor: 1}},
	)
	healthyPromoteSignedPeer(t, fixture, "notes", peer)
	return current
}

func TestForwardUpgradeRechecksSignedActiveConsumersBeforeArm(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := activeProviderAndDependentPeer(t, fixture)
	next := addActivationV2Candidate(
		t, fixture, "1.1.0", "3333333333333333333333333333333333333333",
	)
	// The prospective replacement preserves its interface, but an unreadable
	// active peer must not be silently excluded from the actual writer gate.
	if err := os.WriteFile(
		filepath.Join(fixture.root, "notes", activationStateName),
		[]byte("{corrupt"), 0o600,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := armPendingStateAtRevision(
		next.slot, fixture.trustPath, fixture.root, &current.Revision,
	); err == nil {
		t.Fatal("forward upgrade ignored a corrupted signed active consumer")
	}
	after, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != current.Revision ||
		!sameSlotIdentity(after.Current, current.Current) || after.Pending != nil {
		t.Fatalf("failed native graph validation mutated current state: %+v", after)
	}
}

func TestForwardUpgradeRechecksSignedActiveConsumersBeforePromotion(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := activeProviderAndDependentPeer(t, fixture)
	next := addActivationV2Candidate(
		t, fixture, "1.1.0", "3333333333333333333333333333333333333333",
	)
	pending, err := armPendingStateAtRevision(
		next.slot, fixture.trustPath, fixture.root, &current.Revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	probationRevision := pending.Revision
	healthy, err := recordPendingHealthAtRevision(
		fixture.root, "internet", *pending.Pending, "healthy", &probationRevision,
	)
	if err != nil {
		t.Fatal(err)
	}
	// The graph can change after arm-pending. Health alone cannot authorize
	// promotion based on the previous graph inspection.
	if err := os.WriteFile(
		filepath.Join(fixture.root, "notes", activationStateName),
		[]byte("{corrupt"), 0o600,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := promotePendingStateAtRevision(
		fixture.root, "internet", *healthy.Pending, healthy.Revision,
		fixture.trustPath,
	); err == nil {
		t.Fatal("healthy promotion ignored a changed/unreadable native graph")
	}
	after, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != healthy.Revision ||
		!sameSlotIdentity(after.Current, current.Current) ||
		!sameSlotIdentity(after.Pending, healthy.Pending) ||
		after.PendingHealth != "healthy" {
		t.Fatalf("rejected promotion mutated canonical activation state: %+v", after)
	}
}

func TestForwardUpgradePreservesHealthySignedDependentPeer(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := activeProviderAndDependentPeer(t, fixture)
	peerBefore, err := readActivationState(fixture.root, "notes")
	if err != nil {
		t.Fatal(err)
	}
	next := addActivationV2Candidate(
		t, fixture, "1.1.0", "3333333333333333333333333333333333333333",
	)
	pending, err := armPendingStateAtRevision(
		next.slot, fixture.trustPath, fixture.root, &current.Revision,
	)
	if err != nil {
		t.Fatalf("compatible signed dependent peer blocked arm: %v", err)
	}
	probationRevision := pending.Revision
	healthy, err := recordPendingHealthAtRevision(
		fixture.root, "internet", *pending.Pending, "healthy", &probationRevision,
	)
	if err != nil {
		t.Fatal(err)
	}
	promoted, err := promotePendingStateAtRevision(
		fixture.root, "internet", *healthy.Pending, healthy.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatalf("compatible signed dependent peer blocked promotion: %v", err)
	}
	peerAfter, err := readActivationState(fixture.root, "notes")
	if err != nil {
		t.Fatal(err)
	}
	if promoted.Revision != healthy.Revision+1 ||
		promoted.Current == nil || promoted.Current.Version != "1.1.0" ||
		!sameSlotIdentity(promoted.Previous, current.Current) ||
		peerAfter.Revision != peerBefore.Revision ||
		!sameSlotIdentity(peerAfter.Current, peerBefore.Current) {
		t.Fatalf("forward upgrade altered dependent native peer: provider=%+v peer=%+v",
			promoted, peerAfter)
	}
}
