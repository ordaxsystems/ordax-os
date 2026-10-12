package main

import (
	"strings"
	"testing"
)

func healthyPendingV2(t *testing.T, fixture activationV2Fixture, candidate activationV2Candidate) activationState {
	t.Helper()
	state, err := armPendingState(candidate.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	revision := state.Revision
	state, err = recordPendingHealthAtRevision(
		fixture.root, "internet", *state.Pending, "healthy", &revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

// The official writer's revision compares the pending component's state.
// It must ALSO re-evaluate actual signed current contracts when promoting,
// even if the pending release was compatible at the earlier arm-pending step.
func TestPromotionRejectsReplacedCurrentSignedVersionWithoutMutation(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	old := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	healthyPromoteV2(t, fixture, old)
	candidate := addActivationV2Candidate(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
	)
	healthy := healthyPendingV2(t, fixture, candidate)
	later := addActivationV2Candidate(
		t, fixture, "1.2.0", "3333333333333333333333333333333333333333",
	)
	// Model a current-state change outside the native writer between the
	// two public CLI calls, retaining the prior pending identity/revision.
	// Production cannot trust a stale preflight receipt after such a change.
	current := identityFromRelease(sharedReleaseFromV2(later.release))
	healthy.Current = &current
	if err := writeActivationState(fixture.root, healthy); err != nil {
		t.Fatal(err)
	}
	if _, err := promotePendingStateAtRevision(
		fixture.root, "internet", *healthy.Pending, healthy.Revision, fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "no longer newer than current") {
		t.Fatalf("promotion accepted stale forward-only decision: %v", err)
	}
	after, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != healthy.Revision ||
		!sameSlotIdentity(after.Current, healthy.Current) ||
		!sameSlotIdentity(after.Pending, healthy.Pending) ||
		after.PendingHealth != "healthy" {
		t.Fatalf("rejected promotion changed canonical pending or current state: %+v", after)
	}
}

func TestPromotionRejectsNewSignedStateOwnerAfterPendingHealth(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	old := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	healthyPromoteV2(t, fixture, old)
	candidate := addActivationV2Candidate(
		t, fixture, "1.2.0", "2222222222222222222222222222222222222222",
	)
	healthy := healthyPendingV2(t, fixture, candidate)
	stateful := addActivationV2CandidateWithState(
		t, fixture, "1.1.0", "3333333333333333333333333333333333333333",
		&compatibilityState{
			ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1,
		},
	)
	actual := identityFromRelease(sharedReleaseFromV2(stateful.release))
	healthy.Current = &actual
	if err := writeActivationState(fixture.root, healthy); err != nil {
		t.Fatal(err)
	}
	if _, err := promotePendingStateAtRevision(
		fixture.root, "internet", *healthy.Pending, healthy.Revision, fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "removes an existing state owner") {
		t.Fatalf("promotion accepted newly stateful current despite missing migration: %v", err)
	}
	after, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != healthy.Revision ||
		!sameSlotIdentity(after.Current, healthy.Current) ||
		!sameSlotIdentity(after.Pending, healthy.Pending) ||
		after.PendingHealth != "healthy" {
		t.Fatalf("rejected promotion modified activation SSOT: %+v", after)
	}
}

func TestPromotionContinuesWithSignedCompatibleCurrentUnderLock(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := addActivationV2CandidateWithState(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
		&compatibilityState{
			ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1,
		},
	)
	healthyPromoteV2(t, fixture, current)
	candidate := addActivationV2CandidateWithState(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
		&compatibilityState{
			ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 2,
		},
	)
	healthy := healthyPendingV2(t, fixture, candidate)
	promoted, err := promotePendingStateAtRevision(
		fixture.root, "internet", *healthy.Pending, healthy.Revision, fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if promoted.Revision != healthy.Revision+1 ||
		promoted.Pending != nil ||
		!sameSlotIdentity(promoted.Previous, healthy.Current) ||
		promoted.Current == nil || promoted.Current.Version != "1.1.0" {
		t.Fatalf("compatible release failed atomic healthy promotion: %+v", promoted)
	}
}

func TestPromotionDoesNotTrustStaleHealthyStatusForChangedSignedAPI(t *testing.T) {
	cases := []struct {
		name       string
		provided   []providedCompatibilityContract
		required   []requiredCompatibilityContract
		errorMatch string
	}{
		{
			name: "provided major changed",
			provided: []providedCompatibilityContract{
				{ID: "ordax.internet", Major: 2},
			},
			errorMatch: "drops an existing signed provided contract",
		},
		{
			name: "mandatory provider introduced",
			provided: []providedCompatibilityContract{
				{ID: "ordax.internet", Major: 1},
			},
			required: []requiredCompatibilityContract{
				{ID: "ordax.network", MinMajor: 1, MaxMajor: 1},
			},
			errorMatch: "adds or tightens a mandatory signed dependency",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fixture := makeActivationV2Fixture(t)
			current := addActivationV2Candidate(
				t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
			)
			healthyPromoteV2(t, fixture, current)
			originalPending := addActivationV2Candidate(
				t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
			)
			state := healthyPendingV2(t, fixture, originalPending)
			replaced := addActivationV2CandidateWithFullContracts(
				t, fixture, "1.2.0", "3333333333333333333333333333333333333333",
				nil, tc.provided, tc.required,
			)
			next := identityFromRelease(sharedReleaseFromV2(replaced.release))
			state.Pending = &next
			// Keep the old health receipt and exact revision on purpose:
			// the writer cannot accept it as proof for a different
			// authenticated pending contract.
			if err := writeActivationState(fixture.root, state); err != nil {
				t.Fatal(err)
			}
			_, err := promotePendingStateAtRevision(
				fixture.root, "internet", *state.Pending, state.Revision, fixture.trustPath,
			)
			if err == nil || !strings.Contains(err.Error(), tc.errorMatch) {
				t.Fatalf("changed signed API passed old healthy receipt: %v", err)
			}
			after, err := readActivationState(fixture.root, "internet")
			if err != nil {
				t.Fatal(err)
			}
			if after.Revision != state.Revision ||
				!sameSlotIdentity(after.Current, state.Current) ||
				!sameSlotIdentity(after.Pending, state.Pending) ||
				after.PendingHealth != "healthy" {
				t.Fatalf("rejected signed pending API changed activation state: %+v", after)
			}
		})
	}
}
