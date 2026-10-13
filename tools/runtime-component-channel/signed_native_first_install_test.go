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

func TestSignedStatefulReinstallAfterRemovalRequiresRecovery(t *testing.T) {
	stateful := &compatibilityState{
		ID: "ordax.internet.state", WriteVersion: 1,
		ReadableFrom: 1, ReadableThrough: 1,
	}
	cases := []struct {
		name      string
		source    *compatibilityState
		reinstall *compatibilityState
		reuseSlot bool
		legacy    bool
	}{
		{
			name:   "same exact signed stateful slot",
			source: stateful, reinstall: stateful, reuseSlot: true,
		},
		{
			name:   "newer compatible signed stateful version",
			source: stateful, reinstall: stateful,
		},
		{
			name:   "stateless removed but new signed persistent state",
			source: nil, reinstall: stateful,
		},
		{
			name:   "old removal record without removed identity",
			source: stateful, reinstall: stateful, legacy: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fixture := makeActivationV2Fixture(t)
			current := addActivationV2CandidateWithState(
				t, fixture, "1.0.0", strings.Repeat("1", 40), tc.source,
			)
			active := healthyPromoteV2(t, fixture, current)
			var removed activationState
			if tc.source == nil {
				// A stateless signed uninstall is still a real supported
				// writer transition.
				var err error
				removed, err = uninstallCurrentStateAtRevision(
					fixture.root, "internet", *active.Current, active.Revision,
					fixture.trustPath,
				)
				if err != nil {
					t.Fatal(err)
				}
			} else {
				// Existing stateful tombstones must stay recoverable and
				// fail closed on reinstall, even though new stateful
				// uninstalls are now blocked by the production writer.
				// This is an injected historical persisted-state fixture,
				// not a bypass or second production activation authority.
				removed = active
				removed.Revision++
				removed.Current = nil
				removed.Previous = nil
				removed.Pending = nil
				removed.Rejected = nil
				removed.PendingHealth = "unknown"
				removed.UserRemoved = true
				removed.Removed = active.Current
				if err := writeActivationState(fixture.root, removed); err != nil {
					t.Fatal(err)
				}
			}
			if !removed.UserRemoved || removed.Current != nil {
				t.Fatalf("uninstall recovery fixture is inconsistent: %+v", removed)
			}
			if tc.legacy {
				removed.Removed = nil
				if err := writeActivationState(fixture.root, removed); err != nil {
					t.Fatal(err)
				}
			}
			candidate := current
			if !tc.reuseSlot {
				candidate = addActivationV2CandidateWithState(
					t, fixture, "1.1.0", strings.Repeat("2", 40), tc.reinstall,
				)
			}
			_, err := armPendingStateAtRevision(
				candidate.slot, fixture.trustPath, fixture.root, &removed.Revision,
			)
			if err == nil || !strings.Contains(err.Error(), "stateful reinstall after uninstall requires verified device-state recovery transaction") {
				t.Fatalf("unproven stateful reinstall accepted or wrong error: %v", err)
			}
			persisted, err := readActivationState(fixture.root, "internet")
			if err != nil {
				t.Fatal(err)
			}
			if persisted.Revision != removed.Revision ||
				persisted.Pending != nil || persisted.Current != nil || !persisted.UserRemoved {
				t.Fatalf("rejected stateful reinstall changed canonical activation state: %+v", persisted)
			}
		})
	}
}

func TestSignedStatefulPromotionRechecksRemovalFence(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2CandidateWithState(
		t, fixture, "1.0.0", strings.Repeat("3", 40),
		&compatibilityState{
			ID: "ordax.internet.state", WriteVersion: 1,
			ReadableFrom: 1, ReadableThrough: 1,
		},
	)
	// A genuine first install is intentionally still allowed; only
	// replay of retained state after explicit removal needs a transaction.
	armed, err := armPendingState(candidate.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	if armed.UserRemoved || armed.Pending == nil {
		t.Fatalf("initial stateful candidate not armed: %+v", armed)
	}
	// Reproduce a persisted post-removal state observed before a delayed
	// probation result; promotion must never trust the earlier arm verdict.
	// This is an injected recovery snapshot, not a second production writer.
	armed.UserRemoved = true
	armed.Removed = &slotIdentity{
		Version: "0.9.0", SourceCommit: strings.Repeat("4", 40),
	}
	if err := writeActivationState(fixture.root, armed); err != nil {
		t.Fatal(err)
	}
	probationRevision := armed.Revision
	healthy, err := recordPendingHealthAtRevision(
		fixture.root, "internet", *armed.Pending, "healthy", &probationRevision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := promotePendingStateAtRevision(
		fixture.root, "internet", *healthy.Pending, healthy.Revision, fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "stateful reinstall after uninstall requires verified device-state recovery transaction") {
		t.Fatalf("promotion bypassed previously removed persistent state: %v", err)
	}
	after, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != healthy.Revision || after.Current != nil ||
		after.PendingHealth != "healthy" || !after.UserRemoved ||
		!sameSlotIdentity(after.Pending, healthy.Pending) {
		t.Fatalf("blocked promotion changed canonical activation state: %+v", after)
	}
}
