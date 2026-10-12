package main

import (
	"strings"
	"testing"
)

func TestReleaseV2RollbackRejectsUnreadableMigratedStateWithoutMutation(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	previous := addActivationV2CandidateWithState(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
	)
	healthyPromoteV2(t, fixture, previous)
	current := addActivationV2CandidateWithState(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 2, ReadableFrom: 1, ReadableThrough: 2},
	)
	state := healthyPromoteV2(t, fixture, current)
	if _, err := rollbackCurrentStateAtRevision(
		fixture.root, "internet", *state.Current, state.Revision, fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "cannot read current signed state contract") {
		t.Fatalf("rollback accepted incompatible signed state: %v", err)
	}
	unchanged, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Revision != state.Revision ||
		!sameSlotIdentity(unchanged.Current, state.Current) ||
		!sameSlotIdentity(unchanged.Previous, state.Previous) ||
		unchanged.Rejected != nil {
		t.Fatalf("incompatible rollback mutated canonical state: %+v", unchanged)
	}
}

func TestReleaseV2RollbackCanRestorePriorVersionThatReadsCurrentState(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	previous := addActivationV2CandidateWithState(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 2},
	)
	healthyPromoteV2(t, fixture, previous)
	current := addActivationV2CandidateWithState(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 2, ReadableFrom: 1, ReadableThrough: 2},
	)
	state := healthyPromoteV2(t, fixture, current)
	rolled, err := rollbackCurrentStateAtRevision(
		fixture.root, "internet", *state.Current, state.Revision, fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if rolled.Revision != state.Revision+1 ||
		!sameSlotIdentity(rolled.Current, state.Previous) ||
		rolled.Previous != nil ||
		!sameSlotIdentity(rolled.Rejected, state.Current) {
		t.Fatalf("compatible signed state rollback was not atomic: %+v", rolled)
	}
}

func TestReleaseV2RollbackRejectsStateOwnerChangeAndUnknownBundledFallback(t *testing.T) {
	t.Run("changed state owner", func(t *testing.T) {
		fixture := makeActivationV2Fixture(t)
		old := addActivationV2CandidateWithState(
			t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
			&compatibilityState{ID: "ordax.internet.old", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
		)
		healthyPromoteV2(t, fixture, old)
		newRelease := addActivationV2CandidateWithState(
			t, fixture, "2.0.0", "2222222222222222222222222222222222222222",
			&compatibilityState{ID: "ordax.internet.new", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
		)
		state := healthyPromoteV2(t, fixture, newRelease)
		if _, err := rollbackCurrentStateAtRevision(
			fixture.root, "internet", *state.Current, state.Revision, fixture.trustPath,
		); err == nil {
			t.Fatal("rollback bypassed state-owner schema change")
		}
	})
	t.Run("unknown bundled state format", func(t *testing.T) {
		fixture := makeActivationV2Fixture(t)
		current := addActivationV2CandidateWithState(
			t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
			&compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
		)
		state := healthyPromoteV2(t, fixture, current)
		if state.Previous != nil {
			t.Fatal("fixture unexpectedly includes prior slot")
		}
		if _, err := rollbackCurrentStateAtRevision(
			fixture.root, "internet", *state.Current, state.Revision, fixture.trustPath,
		); err == nil || !strings.Contains(err.Error(), "cannot prove state readability") {
			t.Fatalf("stateful component rolled back to unknown bundled state: %v", err)
		}
	})
}
