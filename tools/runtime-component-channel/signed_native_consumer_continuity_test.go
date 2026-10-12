package main

import (
	"strings"
	"testing"
)

// These are real Ed25519 signed release/2 slots in distinct component roots.
// A synthetic catalog would not prove that the writer reads installed current
// identities and their authenticated peer contracts under the graph lock.
func healthyPromoteSignedPeer(
	t *testing.T, fixture activationV2Fixture,
	componentID string, candidate activationV2Candidate,
) activationState {
	t.Helper()
	state, err := armPendingState(candidate.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	revision := state.Revision
	state, err = recordPendingHealthAtRevision(
		fixture.root, componentID, *state.Pending, "healthy", &revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	state, err = promotePendingStateAtRevision(
		fixture.root, componentID, *state.Pending, state.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func addSignedPeer(
	t *testing.T, f activationV2Fixture,
	id string, commit string,
	provides []providedCompatibilityContract,
	requires []requiredCompatibilityContract,
) activationV2Candidate {
	t.Helper()
	return addActivationV2CandidateForComponent(
		t, f, id, "1.0.0", commit, nil, provides, requires,
	)
}

func TestUninstallPreservesSignedActiveConsumerRequirement(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	provider := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	active := healthyPromoteV2(t, fixture, provider)
	consumer := addSignedPeer(
		t, fixture, "notes", "2222222222222222222222222222222222222222",
		[]providedCompatibilityContract{{ID: "ordax.notes", Major: 1}},
		[]requiredCompatibilityContract{{ID: "ordax.internet", MinMajor: 1, MaxMajor: 1}},
	)
	peer := healthyPromoteSignedPeer(t, fixture, "notes", consumer)
	_, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", *active.Current,
		active.Revision, fixture.trustPath,
	)
	if err == nil || !strings.Contains(err.Error(), "required by active component notes") {
		t.Fatalf("uninstall stranded signed native consumer: %v", err)
	}
	current, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	notes, err := readActivationState(fixture.root, "notes")
	if err != nil {
		t.Fatal(err)
	}
	if current.Revision != active.Revision ||
		!sameSlotIdentity(current.Current, active.Current) || current.UserRemoved ||
		notes.Revision != peer.Revision || !sameSlotIdentity(notes.Current, peer.Current) {
		t.Fatalf("rejected uninstall mutated canonical graph: provider=%+v consumer=%+v", current, notes)
	}
}

func TestUninstallAllowsOptionalConsumerAndSignedAlternativeProvider(t *testing.T) {
	for _, tc := range []struct {
		name        string
		optional    bool
		alternative bool
	}{
		{name: "optional requirement", optional: true},
		{name: "second active signed provider", alternative: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := makeActivationV2Fixture(t)
			provider := addActivationV2Candidate(
				t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
			)
			active := healthyPromoteV2(t, fixture, provider)
			consumer := addSignedPeer(
				t, fixture, "notes", "2222222222222222222222222222222222222222",
				[]providedCompatibilityContract{{ID: "ordax.notes", Major: 1}},
				[]requiredCompatibilityContract{{ID: "ordax.internet", MinMajor: 1, MaxMajor: 1, Optional: tc.optional}},
			)
			healthyPromoteSignedPeer(t, fixture, "notes", consumer)
			if tc.alternative {
				backup := addSignedPeer(
					t, fixture, "backup", "3333333333333333333333333333333333333333",
					[]providedCompatibilityContract{{ID: "ordax.internet", Major: 1}}, nil,
				)
				healthyPromoteSignedPeer(t, fixture, "backup", backup)
			}
			removed, err := uninstallCurrentStateAtRevision(
				fixture.root, "internet", *active.Current,
				active.Revision, fixture.trustPath,
			)
			if err != nil {
				t.Fatal(err)
			}
			if removed.Current != nil || !removed.UserRemoved ||
				removed.Revision != active.Revision+1 {
				t.Fatalf("safe signed uninstall did not update SSOT: %+v", removed)
			}
		})
	}
}

func TestRollbackCannotReplaceRequiredSignedNativeProviderWithIncompatiblePrevious(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	first := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	healthyPromoteV2(t, fixture, first)
	second := addActivationV2Candidate(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
	)
	active := healthyPromoteV2(t, fixture, second)
	consumer := addSignedPeer(
		t, fixture, "notes", "3333333333333333333333333333333333333333",
		[]providedCompatibilityContract{{ID: "ordax.notes", Major: 1}},
		[]requiredCompatibilityContract{{ID: "ordax.internet", MinMajor: 1, MaxMajor: 1}},
	)
	healthyPromoteSignedPeer(t, fixture, "notes", consumer)
	// Simulate a previously signed but ABI-incompatible fallback becoming
	// the selected previous identity. Rollback must recheck actual peers,
	// not treat a verified signature or a saved previous pointer as enough.
	unsafePrevious := addActivationV2CandidateWithContracts(
		t, fixture, "0.9.0", "4444444444444444444444444444444444444444",
		nil, []providedCompatibilityContract{},
	)
	replacement := identityFromRelease(sharedReleaseFromV2(unsafePrevious.release))
	active.Previous = &replacement
	if err := writeActivationState(fixture.root, active); err != nil {
		t.Fatal(err)
	}
	_, err := rollbackCurrentStateAtRevision(
		fixture.root, "internet", *active.Current,
		active.Revision, fixture.trustPath,
	)
	if err == nil || !strings.Contains(err.Error(), "required by active component notes") {
		t.Fatalf("rollback stranded signed consumer: %v", err)
	}
	after, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != active.Revision ||
		!sameSlotIdentity(after.Current, active.Current) ||
		!sameSlotIdentity(after.Previous, active.Previous) ||
		after.Rejected != nil {
		t.Fatalf("rejected rollback mutated canonical graph: %+v", after)
	}
}
