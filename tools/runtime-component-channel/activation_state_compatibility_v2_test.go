package main

import (
	"strings"
	"testing"
)

func TestSignedUpgradeWithUnchangedStateFormatRequiresRecoveryProof(t *testing.T) {
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
	if _, err := armPendingStateAtRevision(
		candidate.slot, fixture.trustPath, fixture.root, &active.Revision,
	); err == nil || !strings.Contains(err.Error(), "requires verified device-state recovery checkpoint") {
		t.Fatalf("same-state signed upgrade bypassed the missing recovery proof: %v", err)
	}
	unchanged, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Revision != active.Revision ||
		!sameSlotIdentity(unchanged.Current, active.Current) ||
		unchanged.Pending != nil || unchanged.Rejected != nil {
		t.Fatalf("blocked stateful upgrade mutated activation SSOT: %+v", unchanged)
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

func TestSignedUpgradeCannotIntroducePersistentStateWithoutRollbackProof(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	previous := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	active := healthyPromoteV2(t, fixture, previous)
	next := addActivationV2CandidateWithState(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
		&compatibilityState{ID: "ordax.internet.new", WriteVersion: 1, ReadableFrom: 1, ReadableThrough: 1},
	)
	if _, err := armPendingStateAtRevision(
		next.slot, fixture.trustPath, fixture.root, &active.Revision,
	); err == nil || !strings.Contains(err.Error(), "without verified rollback") {
		t.Fatalf("stateless-to-stateful update bypassed recovery gate: %v", err)
	}
	unchanged, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Revision != active.Revision || !sameSlotIdentity(unchanged.Current, active.Current) ||
		unchanged.Pending != nil || unchanged.Rejected != nil {
		t.Fatalf("unrecoverable new state owner mutated activation SSOT: %+v", unchanged)
	}
}

func TestSignedUpgradeCannotDropExistingProvidedABI(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := addActivationV2CandidateWithContracts(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111", nil,
		[]providedCompatibilityContract{{ID: "ordax.internet", Major: 1}},
	)
	active := healthyPromoteV2(t, fixture, current)
	removed := addActivationV2CandidateWithContracts(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222", nil,
		[]providedCompatibilityContract{{ID: "ordax.internet", Major: 2}},
	)
	if _, err := armPendingStateAtRevision(
		removed.slot, fixture.trustPath, fixture.root, &active.Revision,
	); err == nil || !strings.Contains(err.Error(), "drops an existing signed provided contract") {
		t.Fatalf("signed major-breaking API replacement reached pending: %v", err)
	}
	state, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if state.Revision != active.Revision || !sameSlotIdentity(state.Current, active.Current) ||
		state.Pending != nil {
		t.Fatalf("dropped ABI mutated activation state: %+v", state)
	}
	additive := addActivationV2CandidateWithContracts(
		t, fixture, "1.2.0", "3333333333333333333333333333333333333333", nil,
		[]providedCompatibilityContract{
			{ID: "ordax.internet", Major: 1},
			{ID: "ordax.internet.extended", Major: 2},
		},
	)
	armed, err := armPendingStateAtRevision(
		additive.slot, fixture.trustPath, fixture.root, &active.Revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if armed.Pending == nil || armed.Pending.Version != "1.2.0" ||
		!sameSlotIdentity(armed.Current, active.Current) {
		t.Fatalf("additive ABI release lost current during staging: %+v", armed)
	}
}

func TestSignedUpgradeCannotIntroduceOrTightenMandatoryRequirements(t *testing.T) {
	const provider = "ordax.network"
	cases := []struct {
		name    string
		current []requiredCompatibilityContract
		next    []requiredCompatibilityContract
		blocked bool
	}{
		{
			name:    "new mandatory provider",
			current: nil,
			next:    []requiredCompatibilityContract{{ID: provider, MinMajor: 1, MaxMajor: 1}},
			blocked: true,
		},
		{
			name:    "optional made mandatory",
			current: []requiredCompatibilityContract{{ID: provider, MinMajor: 1, MaxMajor: 2, Optional: true}},
			next:    []requiredCompatibilityContract{{ID: provider, MinMajor: 1, MaxMajor: 2}},
			blocked: true,
		},
		{
			name:    "range narrowed",
			current: []requiredCompatibilityContract{{ID: provider, MinMajor: 1, MaxMajor: 2}},
			next:    []requiredCompatibilityContract{{ID: provider, MinMajor: 2, MaxMajor: 2}},
			blocked: true,
		},
		{
			name:    "existing mandatory range widened",
			current: []requiredCompatibilityContract{{ID: provider, MinMajor: 2, MaxMajor: 2}},
			next:    []requiredCompatibilityContract{{ID: provider, MinMajor: 1, MaxMajor: 3}},
		},
		{
			name:    "new optional dependency",
			current: nil,
			next:    []requiredCompatibilityContract{{ID: provider, MinMajor: 1, MaxMajor: 2, Optional: true}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fixture := makeActivationV2Fixture(t)
			// A signed first install requiring a provider must include an
			// actually installed signed provider. These upgrade regression
			// fixtures may not pre-install an already broken required graph.
			for _, required := range tc.current {
				if required.Optional {
					continue
				}
				provider := addSignedPeer(
					t, fixture, "network", "4444444444444444444444444444444444444444",
					[]providedCompatibilityContract{{ID: required.ID, Major: required.MaxMajor}}, nil,
				)
				healthyPromoteSignedPeer(t, fixture, "network", provider)
			}
			existing := addActivationV2CandidateWithFullContracts(
				t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
				nil, []providedCompatibilityContract{{ID: "ordax.internet", Major: 1}}, tc.current,
			)
			active := healthyPromoteV2(t, fixture, existing)
			candidate := addActivationV2CandidateWithFullContracts(
				t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
				nil, []providedCompatibilityContract{{ID: "ordax.internet", Major: 1}}, tc.next,
			)
			next, err := armPendingStateAtRevision(
				candidate.slot, fixture.trustPath, fixture.root, &active.Revision,
			)
			if tc.blocked {
				if err == nil || !strings.Contains(err.Error(), "adds or tightens a mandatory signed dependency") {
					t.Fatalf("unsafe mandatory requirement reached pending: %v", err)
				}
				after, err := readActivationState(fixture.root, "internet")
				if err != nil {
					t.Fatal(err)
				}
				if after.Revision != active.Revision ||
					!sameSlotIdentity(after.Current, active.Current) ||
					after.Pending != nil {
					t.Fatalf("blocked dependency changed canonical activation state: %+v", after)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if next.Pending == nil || next.Pending.Version != "1.1.0" ||
					!sameSlotIdentity(next.Current, active.Current) {
					t.Fatalf("compatible signed dependency update lost current state: %+v", next)
				}
			}
		})
	}
}

func TestSignedStatefulUninstallRequiresRealQuiescenceAndRecovery(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2CandidateWithState(
		t, fixture, "1.0.0", strings.Repeat("1", 40),
		&compatibilityState{
			ID: "ordax.internet.state", WriteVersion: 1,
			ReadableFrom: 1, ReadableThrough: 1,
		},
	)
	active := healthyPromoteV2(t, fixture, candidate)
	current := *active.Current

	for attempt := 0; attempt < 2; attempt++ {
		if _, err := uninstallCurrentStateAtRevision(
			fixture.root, "internet", current, active.Revision, fixture.trustPath,
		); err == nil || !strings.Contains(err.Error(), "requires verified Supervisor quiescence and device-state recovery transaction") {
			t.Fatalf("stateful uninstall attempt %d escaped the canonical writer gate: %v", attempt, err)
		}
		got, err := readActivationState(fixture.root, "internet")
		if err != nil {
			t.Fatal(err)
		}
		if got.Revision != active.Revision ||
			!sameSlotIdentity(got.Current, &current) ||
			got.UserRemoved || got.Removed != nil ||
			got.Pending != nil || got.Rejected != nil {
			t.Fatalf("rejected stateful uninstall mutated installed state: %+v", got)
		}
	}

	// Even if caller supplies a valid signature and stale revision for a
	// historical stateful uninstall, an idempotent acknowledgment cannot
	// invent missing quiescence/restore proof. This is a persisted-state
	// regression fixture, not a production writer bypass.
	historical := active
	historical.Revision++
	historical.Current = nil
	historical.Previous = nil
	historical.Pending = nil
	historical.Rejected = nil
	historical.PendingHealth = "unknown"
	historical.UserRemoved = true
	historical.Removed = &current
	if err := writeActivationState(fixture.root, historical); err != nil {
		t.Fatal(err)
	}
	if _, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", current, active.Revision, fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "requires verified Supervisor quiescence and device-state recovery transaction") {
		t.Fatalf("historical stateful uninstall retry incorrectly claimed a safe transaction: %v", err)
	}
	after, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != historical.Revision || after.Current != nil ||
		!after.UserRemoved || !sameSlotIdentity(after.Removed, &current) {
		t.Fatalf("blocked historical retry changed durable state: %+v", after)
	}
}

func TestSignedStatelessUninstallPreservesExistingPath(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2CandidateWithState(
		t, fixture, "1.0.0", strings.Repeat("2", 40), nil,
	)
	active := healthyPromoteV2(t, fixture, candidate)
	current := *active.Current
	removed, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", current, active.Revision, fixture.trustPath,
	)
	if err != nil {
		t.Fatalf("stateless signed uninstall unexpectedly blocked: %v", err)
	}
	if removed.Current != nil || !removed.UserRemoved ||
		!sameSlotIdentity(removed.Removed, &current) ||
		removed.Revision != active.Revision+1 {
		t.Fatalf("stateless uninstall did not preserve removal semantics: %+v", removed)
	}
	retry, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", current, active.Revision, fixture.trustPath,
	)
	if err != nil || retry.Revision != removed.Revision {
		t.Fatalf("stateless exact signed uninstall retry = %+v, %v", retry, err)
	}
}
