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

func TestNativeHostABIClassificationDoesNotWeakenSignedDependencyGraph(t *testing.T) {
	graph := activeCompatibilityCatalog{}
	declared := []requiredCompatibilityContract{
		{ID: "ordax.app-activation", MinMajor: 1, MaxMajor: 1},
		{ID: "ordax.app-data", MinMajor: 1, MaxMajor: 1},
		{ID: "ordax.localization", MinMajor: 2, MaxMajor: 2},
		{ID: "ordax.surface-render-lifecycle", MinMajor: 5, MaxMajor: 5},
		{ID: "ordax.personal-runtime", MinMajor: 1, MaxMajor: 1},
	}
	if err := checkSignedNativeCandidateRequirements(graph, "notes", declared); err != nil {
		t.Fatalf("platform-owned interface was misclassified as signed peer: %v", err)
	}
	for _, invalid := range []requiredCompatibilityContract{
		{ID: "ordax.app-activation", MinMajor: 2, MaxMajor: 2},
		{ID: "ordax.surface-render-lifecycle", MinMajor: 1, MaxMajor: 4},
	} {
		err := checkSignedNativeCandidateRequirements(graph, "notes", []requiredCompatibilityContract{invalid})
		if err == nil || !strings.Contains(err.Error(), "unsupported OS host interface") {
			t.Fatalf("host ABI mismatch silently accepted: %v", err)
		}
	}
	err := checkSignedNativeCandidateRequirements(graph, "notes", []requiredCompatibilityContract{
		{ID: "ordax.internet", MinMajor: 1, MaxMajor: 1},
	})
	if err == nil || !strings.Contains(err.Error(), "requires unavailable signed native provider") {
		t.Fatalf("unsigned app dependency was treated as host port: %v", err)
	}
}


// One end-to-end state-machine proof uses actual Ed25519-signed release/2 slots
// and the existing Go activation writer for each transition. It represents a
// disposable native state directory, NOT a physical USB boot or an App Data
// migration/rollback proof.
func TestSignedStoreRoundTripAcrossHealthUpdateRemovalAndOfflineReinstall(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	const componentID = "internet"

	// This sentinel lives outside the component slot graph, like app-owned
	// persistent data. The lifecycle must never erase unrelated user bytes.
	dataRoot := filepath.Join(fixture.dir, "user-app-data")
	if err := os.MkdirAll(dataRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	dataPath := filepath.Join(dataRoot, "retained-data.bin")
	const retainedPayload = "user-owned-bytes-must-survive-store-lifecycle"
	if err := os.WriteFile(dataPath, []byte(retainedPayload), 0o600); err != nil {
		t.Fatal(err)
	}
	assertDataPreserved := func(stage string) {
		t.Helper()
		actual, err := os.ReadFile(dataPath)
		if err != nil || string(actual) != retainedPayload {
			t.Fatalf("%s changed user-owned data: payload=%q error=%v", stage, actual, err)
		}
	}
	readCanonical := func(stage string) activationState {
		t.Helper()
		state, err := readActivationState(fixture.root, componentID)
		if err != nil {
			t.Fatalf("%s cannot reload persisted Go activation state: %v", stage, err)
		}
		assertDataPreserved(stage)
		return state
	}
	promoteHealthy := func(candidate activationV2Candidate, observedRevision int64) activationState {
		t.Helper()
		armed, err := armPendingStateAtRevision(
			candidate.slot, fixture.trustPath, fixture.root, &observedRevision,
		)
		if err != nil {
			t.Fatalf("signed candidate failed to arm at revision %d: %v", observedRevision, err)
		}
		if armed.Revision != observedRevision+1 || armed.Pending == nil ||
			armed.Current != nil && sameSlotIdentity(armed.Current, armed.Pending) ||
			armed.PendingHealth != "unknown" {
			t.Fatalf("signed candidate did not enter pending-health: %+v", armed)
		}
		persistedPending := readCanonical("arm-pending")
		if persistedPending.Revision != armed.Revision ||
			!sameSlotIdentity(persistedPending.Pending, armed.Pending) {
			t.Fatalf("pending state did not survive reload: %+v", persistedPending)
		}
		healthRevision := armed.Revision
		healthy, err := recordPendingHealthAtRevision(
			fixture.root, componentID, *armed.Pending, "healthy", &healthRevision,
		)
		if err != nil {
			t.Fatal(err)
		}
		if healthy.PendingHealth != "healthy" {
			t.Fatalf("probation did not record healthy state: %+v", healthy)
		}
		promoted, err := promotePendingStateAtRevision(
			fixture.root, componentID, *healthy.Pending, healthy.Revision,
			fixture.trustPath,
		)
		if err != nil {
			t.Fatal(err)
		}
		persisted := readCanonical("healthy-promotion")
		if promoted.Revision != persisted.Revision ||
			persisted.Current == nil ||
			!sameSlotIdentity(persisted.Current, promoted.Current) ||
			persisted.Pending != nil || persisted.PendingHealth != "unknown" {
			t.Fatalf("healthy promotion is not durably current: %+v", persisted)
		}
		return persisted
	}

	first := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	initial := readCanonical("initial-state")
	if initial.Revision != 0 || initial.Current != nil || initial.Pending != nil {
		t.Fatalf("initial activation graph is not empty: %+v", initial)
	}
	installed := promoteHealthy(first, initial.Revision)

	// A failed signed update must not replace the current runtime.
	failed := addActivationV2Candidate(
		t, fixture, "1.1.0", "2222222222222222222222222222222222222222",
	)
	revisionBeforeFailedUpdate := installed.Revision
	armedFailed, err := armPendingStateAtRevision(
		failed.slot, fixture.trustPath, fixture.root, &revisionBeforeFailedUpdate,
	)
	if err != nil {
		t.Fatal(err)
	}
	if armedFailed.Current == nil || !sameSlotIdentity(armedFailed.Current, installed.Current) {
		t.Fatalf("failed candidate prematurely replaced healthy current: %+v", armedFailed)
	}
	failedHealthRevision := armedFailed.Revision
	failedHealth, err := recordPendingHealthAtRevision(
		fixture.root, componentID, *armedFailed.Pending, "failed", &failedHealthRevision,
	)
	if err != nil {
		t.Fatal(err)
	}
	rejected, err := rejectPendingStateAtRevision(
		fixture.root, componentID, *failedHealth.Pending, failedHealth.Revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	afterReject := readCanonical("failed-update-rejected")
	if rejected.Revision != afterReject.Revision ||
		afterReject.Pending != nil || !sameSlotIdentity(afterReject.Current, installed.Current) ||
		!sameSlotIdentity(afterReject.Rejected, armedFailed.Pending) {
		t.Fatalf("failed update damaged the installed version: %+v", afterReject)
	}

	// The same already-observed revision cannot arm another generation after
	// probation/rejection changed the Go writer state.
	next := addActivationV2Candidate(
		t, fixture, "1.2.0", "3333333333333333333333333333333333333333",
	)
	if _, err := armPendingStateAtRevision(
		next.slot, fixture.trustPath, fixture.root, &revisionBeforeFailedUpdate,
	); err == nil || !strings.Contains(err.Error(), "revision is stale") {
		t.Fatalf("stale update generation was accepted: %v", err)
	}
	updated := promoteHealthy(next, afterReject.Revision)
	if updated.Current.Version != "1.2.0" ||
		!sameSlotIdentity(updated.Previous, installed.Current) {
		t.Fatalf("healthy signed update lost previous slot or installed wrong version: %+v", updated)
	}

	// A pending/healthy or previously installed generation must not serve as
	// a removal decision for the newly promoted state.
	if _, err := uninstallCurrentStateAtRevision(
		fixture.root, componentID, *installed.Current, installed.Revision,
		fixture.trustPath,
	); err == nil {
		t.Fatal("stale old-version uninstall removed a newer signed installation")
	}
	stillCurrent := readCanonical("stale-uninstall-rejected")
	if !sameSlotIdentity(stillCurrent.Current, updated.Current) ||
		stillCurrent.Revision != updated.Revision {
		t.Fatalf("stale uninstall mutated current release: %+v", stillCurrent)
	}

	removed, err := uninstallCurrentStateAtRevision(
		fixture.root, componentID, *updated.Current, updated.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	persistedRemoved := readCanonical("uninstall-and-reload")
	if removed.Revision != updated.Revision+1 ||
		persistedRemoved.Revision != removed.Revision ||
		persistedRemoved.Current != nil || persistedRemoved.Pending != nil ||
		persistedRemoved.Previous != nil || persistedRemoved.Rejected != nil ||
		!persistedRemoved.UserRemoved ||
		!sameSlotIdentity(persistedRemoved.Removed, updated.Current) {
		t.Fatalf("explicit removal tombstone not durable: %+v", persistedRemoved)
	}
	_, slot, bundled, err := resolveCurrentState(fixture.root, componentID, fixture.trustPath)
	if err != nil || slot != "" || bundled {
		t.Fatalf("explicitly removed release became launchable after reload: slot=%q bundled=%t error=%v", slot, bundled, err)
	}

	// Replaying the exact prior uninstall is allowed only while its signed
	// immutable identity is still the canonical tombstone. No revision bump.
	retried, err := uninstallCurrentStateAtRevision(
		fixture.root, componentID, *updated.Current, updated.Revision,
		fixture.trustPath,
	)
	if err != nil || retried.Revision != persistedRemoved.Revision {
		t.Fatalf("idempotent Go tombstone retry was not stable: %+v error=%v", retried, err)
	}

	// Existing verified slot bytes survive uninstall. Reinstall is an explicit
	// new decision pinned to the removal revision, without downloading a new
	// artifact or resurrecting a silently bundled fallback.
	trustBytes, err := os.ReadFile(fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifySlotV2WithTrustBytes(next.slot, trustBytes); err != nil {
		t.Fatalf("signed cached slot was lost after uninstall: %v", err)
	}
	staleReinstallRevision := updated.Revision
	if _, err := armPendingStateAtRevision(
		next.slot, fixture.trustPath, fixture.root, &staleReinstallRevision,
	); err == nil || !strings.Contains(err.Error(), "revision is stale") {
		t.Fatalf("reinstall ignored removal generation: %v", err)
	}
	reinstalled := promoteHealthy(next, persistedRemoved.Revision)
	if !sameSlotIdentity(reinstalled.Current, updated.Current) ||
		reinstalled.UserRemoved || reinstalled.Removed != nil {
		t.Fatalf("explicit reinstall did not clear tombstone on healthy promotion: %+v", reinstalled)
	}
	if _, err := uninstallCurrentStateAtRevision(
		fixture.root, componentID, *updated.Current, updated.Revision,
		fixture.trustPath,
	); err == nil {
		t.Fatal("old removal request matched a newly reinstalled identical signed release")
	}
	last := readCanonical("reinstall-after-stale-request")
	if !sameSlotIdentity(last.Current, reinstalled.Current) ||
		last.Revision != reinstalled.Revision {
		t.Fatalf("stale replay damaged reinstalled release: %+v", last)
	}
}
