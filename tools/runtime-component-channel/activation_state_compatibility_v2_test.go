package main

import (
	"strings"
	"testing"
)

func TestSignedUpgradeWithUnchangedStateFormatRemainsEligibleForPending(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := addActivationV2CandidateWithState(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
	)
	active := healthyPromoteV2(t, fixture, current)
	candidate := addActivationV2CandidateWithState(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
		&compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 2},
	)
	revision := active.Revision
	pending, err := armPendingStateAtRevision(candidate.slot, fixture.trustPath, fixture.root, &revision)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Pending == nil || pending.Pending.Version != "1.1.0" ||
		!sameSlotIdentity(pending.Current, active.Current) || pending.Revision != revision+1 {
		t.Fatalf("stable state upgrade lost activation SSOT: %+v", pending)
	}
}

func TestSignedUpgradeFailClosedWithoutStateMigration(t *testing.T) {
	tests := []struct {
		name  string
		from  *compatibilityState
		to    *compatibilityState
		error string
	}{
		{
			name: "write schema changes", error: "changes state write version",
			from: &compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
			to:   &compatibilityState{ID: "ordax.internet.state", WriteVersion: 2, ReadableFrom: 1, ReadableThrough: 2},
		},
		{
			name: "owner changes", error: "changes state owner",
			from: &compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
			to:   &compatibilityState{ID: "ordax.internet.alternate", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
		},
		{
			name: "owner removed", error: "removes an existing state owner",
			from: &compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
			to:   nil,
		},
		{
			name: "candidate cannot read current schema", error: "cannot read current signed state version",
			from: &compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
			to:   &compatibilityState{ID: "ordax.internet.state", WriteVersion: 1, ReadableFrom: 2, ReadableThrough: 2},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := makeActivationV2Fixture(t)
			current := addActivationV2CandidateWithState(
				t, fixture, "1.0.0", "1111111111111111111111111111111111111111", tt.from,
			)
			original := healthyPromoteV2(t, fixture, current)
			candidate := addActivationV2CandidateWithState(
				t, fixture, "1.1.0", "2222222222222222222222222222222222222222", tt.to,
			)
			revision := original.Revision
			if _, err := armPendingStateAtRevision(
				candidate.slot, fixture.trustPath, fixture.root, &revision,
			); err == nil || !strings.Contains(err.Error(), tt.error) {
				t.Fatalf("unsafe signed state candidate passed or incorrect error: %v", err)
			}
			after, err := readActivationState(fixture.root, "internet")
			if err != nil {
				t.Fatal(err)
			}
			if after.Revision != original.Revision ||
				!sameSlotIdentity(after.Current, original.Current) ||
				after.Pending != nil || after.Rejected != nil {
				t.Fatalf("failed pending state check mutated activation SSOT: %+v", after)
			}
		})
	}
}

func TestSignedUpgradeCanIntroduceNewStateOwnerWithoutRewritingExistingState(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	previous := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	active := healthyPromoteV2(t, fixture, previous)
	next := addActivationV2CandidateWithState(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
		&compatibilityState{ID: "ordax.internet.new", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
	)
	pending, err := armPendingStateAtRevision(
		next.slot, fixture.trustPath, fixture.root, &active.Revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Pending == nil || pending.Pending.Version != "1.1.0" {
		t.Fatalf("new state owner did not reach pending while keeping current: %+v", pending)
	}
}
