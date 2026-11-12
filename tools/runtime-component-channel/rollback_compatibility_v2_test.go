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
	state := healthyPromoteV2(t, fixture, previous)
	future := addActivationV2CandidateWithState(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 2, ReadableFrom: 1, ReadableThrough: 2},
	)
	trust, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	// This rollback contract is deliberately checked directly: a forward
	// migration from 1 to 2 cannot be installed without the data migration
	// authority, so making it current just for a test would be a bypass.
	if err := verifyRollbackStateReadable(
		fixture.root, "internet", identityFromRelease(sharedReleaseFromV2(future.release)),
		state.Current, trust,
	); err == nil || !strings.Contains(err.Error(), "cannot read current signed state contract") {
		t.Fatalf("rollback accepted incompatible signed state: %v", err)
	}
	if _, err := armPendingState(future.slot, fixture.trustPath, fixture.root); err == nil {
		t.Fatal("unproven state migration reached pending activation")
	}
	unchanged, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Revision != state.Revision ||
		!sameSlotIdentity(unchanged.Current, state.Current) ||
		!sameSlotIdentity(unchanged.Previous, state.Previous) ||
		unchanged.Pending != nil || unchanged.Rejected != nil {
		t.Fatalf("invalid forward migration or rollback check mutated canonical state: %+v", unchanged)
	}
}

func TestReleaseV2RollbackReadabilityDoesNotAuthorizeRecovery(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	previous := addActivationV2CandidateWithState(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 2},
	)
	state := healthyPromoteV2(t, fixture, previous)
	future := addActivationV2CandidateWithState(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 2, ReadableFrom: 1, ReadableThrough: 2},
	)
	trust, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyRollbackStateReadable(
		fixture.root, "internet", identityFromRelease(sharedReleaseFromV2(future.release)),
		state.Current, trust,
	); err == nil || !strings.Contains(err.Error(), "requires verified device-state recovery checkpoint") {
		t.Fatalf("signed readable range was mistaken for a verified data checkpoint: %v", err)
	}
	// A signed readable range cannot prove a live state generation. It also
	// cannot authorize transitioning to a new writer without migration.
	if _, err := armPendingState(future.slot, fixture.trustPath, fixture.root); err == nil {
		t.Fatal("backward-readable state accidentally granted an unproven forward migration")
	}
}

func TestStatefulReleaseV2UpgradeCannotBecomeOneWayWithoutRecovery(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	first := addActivationV2CandidateWithState(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
	)
	original := healthyPromoteV2(t, fixture, first)
	candidate := addActivationV2CandidateWithState(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
	)
	if _, err := armPendingStateAtRevision(
		candidate.slot, fixture.trustPath, fixture.root, &original.Revision,
	); err == nil || !strings.Contains(err.Error(), "requires verified device-state recovery checkpoint") {
		t.Fatalf("unrecoverable stateful upgrade was accepted: %v", err)
	}
	after, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != original.Revision ||
		!sameSlotIdentity(after.Current, original.Current) ||
		!sameSlotIdentity(after.Previous, original.Previous) ||
		after.Pending != nil || after.Rejected != nil {
		t.Fatalf("unproven state recovery modified canonical activation state: %+v", after)
	}
}

func TestRollbackReceiptUsesActualSourceResolution(t *testing.T) {
	cases := []struct {
		componentID string
		want        string
	}{
		{componentID: "internet", want: "absent"},
		{componentID: "notes", want: "absent"},
		{componentID: "studio", want: "absent"},
	}
	for _, tc := range cases {
		t.Run(tc.componentID, func(t *testing.T) {
			state := emptyActivationState(tc.componentID)
			if got := rollbackResolutionTarget(state); got != tc.want {
				t.Fatalf("rollback receipt target = %q, want %q", got, tc.want)
			}
			state.Current = &slotIdentity{
				Version: "1.0.0", SourceCommit: "1111111111111111111111111111111111111111",
			}
			if got := rollbackResolutionTarget(state); got != "slot" {
				t.Fatalf("installed slot receipt target = %q", got)
			}
		})
	}
}

func TestReleaseV2RollbackRejectsStateOwnerChangeAndUnknownBundledFallback(t *testing.T) {
	t.Run("changed state owner", func(t *testing.T) {
		fixture := makeActivationV2Fixture(t)
		old := addActivationV2CandidateWithState(
			t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
			&compatibilityState{ID: "ordax.internet.old", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
		)
		state := healthyPromoteV2(t, fixture, old)
		next := addActivationV2CandidateWithState(
			t, fixture, "2.0.0", "2222222222222222222222222222222222222222",
			&compatibilityState{ID: "ordax.internet.new", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
		)
		trust, err := readRegular(fixture.trustPath, maxTrustBytes, false)
		if err != nil {
			t.Fatal(err)
		}
		if err := verifyRollbackStateReadable(
			fixture.root, "internet", identityFromRelease(sharedReleaseFromV2(next.release)),
			state.Current, trust,
		); err == nil {
			t.Fatal("rollback accepted a different state owner")
		}
		if _, err := armPendingState(next.slot, fixture.trustPath, fixture.root); err == nil {
			t.Fatal("state owner change was armed without an actual migration")
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
