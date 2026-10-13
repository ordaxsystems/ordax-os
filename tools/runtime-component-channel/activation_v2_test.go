package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type activationV2Fixture struct {
	dir         string
	root        string
	privatePath string
	trustPath   string
}

type activationV2Candidate struct {
	packagePath       string
	compatibilityPath string
	envelopePath      string
	release           releaseDescriptorV2
	slot              string
	runtimePath       string
	runtimeBytes      []byte
}

func makeActivationV2Fixture(t *testing.T) activationV2Fixture {
	t.Helper()
	dir := t.TempDir()
	root := filepath.Join(dir, "slots")
	privatePath := filepath.Join(dir, "private.pem")
	trustPath := filepath.Join(dir, "trust.json")
	if _, err := generateKey(
		privatePath,
		trustPath,
		"runtime-components-activation-v2-test-1",
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { allowTestTreeCleanup(root) })
	return activationV2Fixture{
		dir:         dir,
		root:        root,
		privatePath: privatePath,
		trustPath:   trustPath,
	}
}

func addActivationV2Candidate(
	t *testing.T,
	fixture activationV2Fixture,
	version string,
	sourceCommit string,
) activationV2Candidate {
	return addActivationV2CandidateWithState(t, fixture, version, sourceCommit, nil)
}

func addActivationV2CandidateWithState(
	t *testing.T,
	fixture activationV2Fixture,
	version string,
	sourceCommit string,
	state *compatibilityState,
) activationV2Candidate {
	return addActivationV2CandidateWithContracts(
		t, fixture, version, sourceCommit, state,
		[]providedCompatibilityContract{{ID: "ordax.internet", Major: 1}},
	)
}

// Contract alterations in these fixtures must be separately signed, not
// injected into already verified JSON or the activation state.
func addActivationV2CandidateWithContracts(
	t *testing.T,
	fixture activationV2Fixture,
	version string,
	sourceCommit string,
	state *compatibilityState,
	provided []providedCompatibilityContract,
) activationV2Candidate {
	return addActivationV2CandidateWithFullContracts(
		t, fixture, version, sourceCommit, state, provided, nil,
	)
}

func addActivationV2CandidateWithFullContracts(
	t *testing.T,
	fixture activationV2Fixture,
	version string,
	sourceCommit string,
	state *compatibilityState,
	provided []providedCompatibilityContract,
	requires []requiredCompatibilityContract,
) activationV2Candidate {
	return addActivationV2CandidateForComponent(
		t, fixture, "internet", version, sourceCommit, state, provided, requires,
	)
}

// This fixture writes a real separately signed release/2 for any app ID;
// cross-component regressions must not fabricate active graph descriptors.
func addActivationV2CandidateForComponent(
	t *testing.T,
	fixture activationV2Fixture,
	componentID string,
	version string,
	sourceCommit string,
	state *compatibilityState,
	provided []providedCompatibilityContract,
	requires []requiredCompatibilityContract,
) activationV2Candidate {
	t.Helper()

	runtimePath := "system/apps/" + componentID + "/runtime.mjs"
	runtimeBytes := []byte("export const runtimeVersion = \"" + version + "\";\n")
	runtimeDigest := sha256.Sum256(runtimeBytes)
	manifest := componentPackageManifest{
		Schema: packageSchema,
		Status: "candidate",
		Component: packageComponent{
			ID:            componentID,
			Title:         "Component " + componentID,
			Kind:          "app",
			Version:       version,
			ReleaseMode:   "component-slot",
			Criticality:   "optional",
			FailureDomain: "app",
			RestartScope:  "component",
			HealthMode:    "runtime",
			Owner:         "system/apps/" + componentID,
			Dependencies:  []string{"surface-shell"},
		},
		SourceCommit:                      sourceCommit,
		Entrypoint:                        runtimePath,
		SelfContainedSourceGraph:          true,
		RemoteRuntimeDependencies:         false,
		ActivationAllowed:                 false,
		SignatureRequiredBeforeActivation: true,
		NativeAdaptersPackaged:            false,
		CompositionPackaged:               false,
		Files: []packageFile{
			{
				Path:   runtimePath,
				SHA256: hex.EncodeToString(runtimeDigest[:]),
				Size:   int64(len(runtimeBytes)),
			},
		},
	}
	manifestBytes, err := marshalJSON(manifest)
	if err != nil {
		t.Fatal(err)
	}
	manifestDigest := sha256.Sum256(manifestBytes)

	packagePath := filepath.Join(fixture.dir, componentID+".zip")
	if err := os.Remove(packagePath); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	packageFileHandle, err := os.OpenFile(packagePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(packageFileHandle)
	writeZipEntry(t, writer, packageManifestName, manifestBytes)
	writeZipEntry(t, writer, runtimePath, runtimeBytes)
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := packageFileHandle.Close(); err != nil {
		t.Fatal(err)
	}
	packageHash, packageSize, err := sha256File(packagePath, maxPackageBytes)
	if err != nil {
		t.Fatal(err)
	}

	// Preserve canonical JSON key ordering for the *signed* compatibility
	// sidecar; a Go struct would serialize its fields in declaration order.
	var signedState any
	if state != nil {
		signedState = map[string]any{
			"id":              state.ID,
			"writeVersion":    state.WriteVersion,
			"readableFrom":    state.ReadableFrom,
			"readableThrough": state.ReadableThrough,
		}
	}
	signedProvided := make([]any, 0, len(provided))
	for _, contract := range provided {
		signedProvided = append(signedProvided, map[string]any{
			"id": contract.ID, "major": contract.Major,
		})
	}
	signedRequirements := make([]any, 0, len(requires))
	for _, contract := range requires {
		signedRequirements = append(signedRequirements, map[string]any{
			"id":       contract.ID,
			"minMajor": contract.MinMajor,
			"maxMajor": contract.MaxMajor,
			"optional": contract.Optional,
		})
	}
	compatibility := map[string]any{
		"schema":           compatibilitySchemaV1,
		"componentId":      componentID,
		"componentVersion": version,
		"provides":         signedProvided,
		"requires":         signedRequirements,
		"state":            signedState,
		"authority":        "none",
	}
	compatibilityBytes, err := marshalJSON(compatibility)
	if err != nil {
		t.Fatal(err)
	}
	compatibilityDigest := sha256.Sum256(compatibilityBytes)
	compatibilityPath := filepath.Join(fixture.dir, componentID+".compatibility.json")
	if err := os.WriteFile(compatibilityPath, compatibilityBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	release := releaseDescriptorV2{
		Schema:            releaseSchemaV2,
		SourceRepository:  canonicalSourceRepository(componentID),
		SourceCommit:      sourceCommit,
		CreatedFromRecipe: createdFromRecipe,
		Component: releaseComponent{
			ID:            componentID,
			Version:       version,
			ReleaseMode:   "component-slot",
			PackageSchema: packageSchema,
		},
		Package: packageBinding{
			Name:           componentID + ".zip",
			SHA256:         packageHash,
			Size:           packageSize,
			ManifestSHA256: hex.EncodeToString(manifestDigest[:]),
		},
		Activation: activationPolicy{
			DirectActivationAllowed: false,
			PendingHealthRequired:   true,
		},
		Compatibility: compatibilityBinding{
			Name:   componentID + ".compatibility.json",
			Schema: compatibilitySchemaV1,
			SHA256: hex.EncodeToString(compatibilityDigest[:]),
			Size:   int64(len(compatibilityBytes)),
		},
	}
	releaseBytes, err := marshalJSON(release)
	if err != nil {
		t.Fatal(err)
	}
	releasePath := filepath.Join(fixture.dir, "release-"+componentID+"-"+version+"-"+sourceCommit+".json")
	if err := os.WriteFile(releasePath, releaseBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	envelopePath := filepath.Join(fixture.dir, "envelope-"+componentID+"-"+version+"-"+sourceCommit+".json")
	if _, err := signReleaseV2(
		releasePath,
		compatibilityPath,
		fixture.privatePath,
		fixture.trustPath,
		envelopePath,
		"runtime-components-activation-v2-test-1",
	); err != nil {
		t.Fatal(err)
	}
	_, slot, changed, err := stageComponentV2(
		envelopePath,
		fixture.trustPath,
		packagePath,
		compatibilityPath,
		fixture.root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("new release/2 activation candidate unexpectedly reused a slot")
	}
	return activationV2Candidate{
		packagePath:       packagePath,
		compatibilityPath: compatibilityPath,
		envelopePath:      envelopePath,
		release:           release,
		slot:              slot,
		runtimePath:       runtimePath,
		runtimeBytes:      runtimeBytes,
	}
}

func healthyPromoteV2(
	t *testing.T,
	fixture activationV2Fixture,
	candidate activationV2Candidate,
) activationState {
	t.Helper()
	state, err := armPendingState(candidate.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	if state.Pending == nil || state.PendingHealth != "unknown" {
		t.Fatalf("unexpected armed state: %+v", state)
	}
	probationRevision := state.Revision
	state, err = recordPendingHealthAtRevision(
		fixture.root,
		"internet",
		*state.Pending,
		"healthy",
		&probationRevision,
	)
	if err != nil {
		t.Fatal(err)
	}
	state, err = promotePendingStateAtRevision(
		fixture.root,
		"internet",
		*state.Pending,
		state.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func TestReleaseV2UsesExistingActivationStateMachineHealthyPromoteAndResolve(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t,
		fixture,
		"1.0.0",
		"1111111111111111111111111111111111111111",
	)
	state := healthyPromoteV2(t, fixture, candidate)
	if state.Current == nil || state.Pending != nil || state.PendingHealth != "unknown" {
		t.Fatalf("unexpected promoted release/2 state: %+v", state)
	}
	if state.Current.Version != "1.0.0" || state.Current.SourceCommit != candidate.release.SourceCommit {
		t.Fatalf("unexpected current release/2 identity: %+v", state.Current)
	}

	resolved, slot, manifest, bundled, err := resolveRuntimeSlot(
		fixture.root,
		"internet",
		fixture.trustPath,
		"current",
	)
	if err != nil {
		t.Fatal(err)
	}
	if bundled || slot != candidate.slot || resolved.Current == nil {
		t.Fatalf("unexpected resolved release/2 slot: bundled=%t slot=%q state=%+v", bundled, slot, resolved)
	}
	if manifest.Entrypoint != candidate.runtimePath {
		t.Fatalf("entrypoint = %q", manifest.Entrypoint)
	}
	payload, err := readVerifiedRuntimeFile(
		fixture.root,
		"internet",
		fixture.trustPath,
		"current",
		candidate.runtimePath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != string(candidate.runtimeBytes) {
		t.Fatal("release/2 runtime payload changed after promotion")
	}
}

func TestReleaseV2FailedProbationRejectsWithoutReplacingCurrent(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := addActivationV2Candidate(
		t,
		fixture,
		"1.0.0",
		"1111111111111111111111111111111111111111",
	)
	state := healthyPromoteV2(t, fixture, current)
	candidate := addActivationV2Candidate(
		t,
		fixture,
		"1.1.0",
		"2222222222222222222222222222222222222222",
	)
	state, err := armPendingState(candidate.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	pending := *state.Pending
	probationRevision := state.Revision
	state, err = recordPendingHealthAtRevision(
		fixture.root,
		"internet",
		pending,
		"failed",
		&probationRevision,
	)
	if err != nil {
		t.Fatal(err)
	}
	state, err = rejectPendingStateAtRevision(
		fixture.root,
		"internet",
		pending,
		state.Revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if state.Pending != nil || state.Rejected == nil || state.Current == nil {
		t.Fatalf("unexpected rejected release/2 state: %+v", state)
	}
	if state.Current.Version != current.release.Component.Version ||
		state.Current.SourceCommit != current.release.SourceCommit {
		t.Fatalf("failed candidate replaced current release/2: %+v", state)
	}
	if !sameSlotIdentity(state.Rejected, &pending) {
		t.Fatalf("wrong rejected identity: %+v", state.Rejected)
	}
}

func TestReleaseV2RollbackRestoresPreviousVerifiedSlot(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	previous := addActivationV2Candidate(
		t,
		fixture,
		"1.0.0",
		"1111111111111111111111111111111111111111",
	)
	healthyPromoteV2(t, fixture, previous)
	current := addActivationV2Candidate(
		t,
		fixture,
		"1.1.0",
		"2222222222222222222222222222222222222222",
	)
	state := healthyPromoteV2(t, fixture, current)
	if state.Previous == nil || state.Current == nil {
		t.Fatalf("promotion did not retain previous release/2: %+v", state)
	}
	rolledBackIdentity := *state.Current
	state, err := rollbackCurrentStateAtRevision(
		fixture.root,
		"internet",
		rolledBackIdentity,
		state.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if state.Current == nil || state.Current.Version != previous.release.Component.Version ||
		state.Current.SourceCommit != previous.release.SourceCommit {
		t.Fatalf("rollback did not restore previous release/2: %+v", state)
	}
	if state.Previous != nil || state.Rejected == nil || !sameSlotIdentity(state.Rejected, &rolledBackIdentity) {
		t.Fatalf("rollback release/2 state is invalid: %+v", state)
	}
}

func TestReleaseV2UninstallMakesComponentAbsentAndKeepsVerifiedSlotCache(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t,
		fixture,
		"1.0.0",
		"1111111111111111111111111111111111111111",
	)
	state := healthyPromoteV2(t, fixture, candidate)
	if state.Current == nil {
		t.Fatal("Notes-style release/2 candidate was not current before uninstall")
	}
	current := *state.Current
	uninstallRevision := state.Revision

	state, err := uninstallCurrentStateAtRevision(
		fixture.root,
		"internet",
		current,
		uninstallRevision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if state.Revision != uninstallRevision+1 ||
		state.Current != nil ||
		state.Previous != nil ||
		state.Pending != nil ||
		state.Rejected != nil ||
		state.PendingHealth != "unknown" ||
		!state.UserRemoved {
		t.Fatalf("unexpected uninstall state: %+v", state)
	}

	resolved, slot, bundled, err := resolveCurrentState(
		fixture.root,
		"internet",
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if bundled || slot != "" || resolved.Current != nil || !resolved.UserRemoved {
		t.Fatalf("uninstalled component remained active: bundled=%t slot=%q state=%+v", bundled, slot, resolved)
	}

	trustBytes, err := os.ReadFile(fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifySlotV2WithTrustBytes(candidate.slot, trustBytes); err != nil {
		t.Fatalf("verified slot cache was damaged by uninstall: %v", err)
	}
}

func TestReleaseV2UninstallRejectsPendingStaleAndWrongIdentity(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := addActivationV2Candidate(
		t,
		fixture,
		"1.0.0",
		"1111111111111111111111111111111111111111",
	)
	state := healthyPromoteV2(t, fixture, current)
	currentIdentity := *state.Current

	pending := addActivationV2Candidate(
		t,
		fixture,
		"1.1.0",
		"2222222222222222222222222222222222222222",
	)
	state, err := armPendingState(pending.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := uninstallCurrentStateAtRevision(
		fixture.root,
		"internet",
		currentIdentity,
		state.Revision,
		fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "pending slot") {
		t.Fatalf("uninstall with pending candidate error = %v", err)
	}
	if _, err := rejectPendingStateAtRevision(
		fixture.root,
		"internet",
		*state.Pending,
		state.Revision,
	); err != nil {
		t.Fatal(err)
	}
	state, err = readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}

	wrong := slotIdentity{
		Version:      currentIdentity.Version,
		SourceCommit: "3333333333333333333333333333333333333333",
	}
	if _, err := uninstallCurrentStateAtRevision(
		fixture.root,
		"internet",
		wrong,
		state.Revision,
		fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "identity does not match") {
		t.Fatalf("wrong uninstall identity error = %v", err)
	}

	if _, err := uninstallCurrentStateAtRevision(
		fixture.root,
		"internet",
		currentIdentity,
		state.Revision-1,
		fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "revision is stale") {
		t.Fatalf("stale uninstall revision error = %v", err)
	}
}

func TestReleaseV2OfflineReinstallAfterUninstallReusesVerifiedIdentity(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t,
		fixture,
		"1.0.0",
		"1111111111111111111111111111111111111111",
	)
	state := healthyPromoteV2(t, fixture, candidate)
	installed := *state.Current
	uninstallRevision := state.Revision

	state, err := uninstallCurrentStateAtRevision(
		fixture.root,
		"internet",
		installed,
		uninstallRevision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := uninstallCurrentStateAtRevision(
		fixture.root,
		"internet",
		installed,
		uninstallRevision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatalf("idempotent uninstall retry failed: %v", err)
	}
	if retry.Revision != state.Revision || !retry.UserRemoved {
		t.Fatalf("idempotent uninstall changed removal intent or revision: %+v", retry)
	}
	persisted, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if !persisted.UserRemoved || persisted.Current != nil || persisted.Revision != retry.Revision {
		t.Fatalf("removed app intent lost across state reload: %+v", persisted)
	}
	_, _, bundled, err := resolveCurrentState(fixture.root, "internet", fixture.trustPath)
	if err != nil || bundled {
		t.Fatalf("removed app must not silently restore bundled fallback: bundled=%t err=%v", bundled, err)
	}

	state, err = armPendingState(candidate.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatalf("verified cached release could not be rearmed offline: %v", err)
	}
	if state.Pending == nil || !sameSlotIdentity(state.Pending, &installed) || !state.UserRemoved {
		t.Fatalf("offline reinstall armed wrong identity or erased intent before promotion: %+v", state)
	}
	probationRevision := state.Revision
	state, err = recordPendingHealthAtRevision(
		fixture.root,
		"internet",
		installed,
		"healthy",
		&probationRevision,
	)
	if err != nil {
		t.Fatal(err)
	}
	state, err = promotePendingStateAtRevision(
		fixture.root,
		"internet",
		installed,
		state.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if state.Current == nil || !sameSlotIdentity(state.Current, &installed) || state.UserRemoved {
		t.Fatalf("offline reinstall did not restore current identity or clear intent: %+v", state)
	}
}

// Successful retries must not turn a missing or corrupt signed slot into
// a fresh success verdict; the idempotent path is inside the same Go writer.
func TestSignedDecisionRetriesRejectTamperedSlots(t *testing.T) {
	t.Run("promotion", func(t *testing.T) {
		fixture := makeActivationV2Fixture(t)
		candidate := addActivationV2Candidate(t, fixture, "1.0.0", strings.Repeat("1", 40))
		promoted := healthyPromoteV2(t, fixture, candidate)
		current := *promoted.Current
		tampered := filepath.Join(candidate.slot, candidate.release.Compatibility.Name)
		if err := os.Chmod(tampered, 0o644); err != nil { t.Fatal(err) }
		if err := os.WriteFile(tampered, []byte("{}\n"), 0o644); err != nil { t.Fatal(err) }
		if _, err := promotePendingStateAtRevision(
			fixture.root, "internet", current, promoted.Revision-1, fixture.trustPath,
		); err == nil {
			t.Fatal("promotion retry silently acknowledged a corrupt current slot")
		}
		persisted, err := readActivationState(fixture.root, "internet")
		if err != nil { t.Fatal(err) }
		if persisted.Revision != promoted.Revision || !sameSlotIdentity(persisted.Current, &current) {
			t.Fatalf("rejected retry modified activation state: %+v", persisted)
		}
	})
	t.Run("rollback", func(t *testing.T) {
		fixture := makeActivationV2Fixture(t)
		previous := addActivationV2Candidate(t, fixture, "1.0.0", strings.Repeat("1", 40))
		healthyPromoteV2(t, fixture, previous)
		candidate := addActivationV2Candidate(t, fixture, "1.1.0", strings.Repeat("2", 40))
		promoted := healthyPromoteV2(t, fixture, candidate)
		source := *promoted.Current
		rolled, err := rollbackCurrentStateAtRevision(
			fixture.root, "internet", source, promoted.Revision, fixture.trustPath,
		)
		if err != nil { t.Fatal(err) }
		tampered := filepath.Join(previous.slot, previous.release.Compatibility.Name)
		if err := os.Chmod(tampered, 0o644); err != nil { t.Fatal(err) }
		if err := os.WriteFile(tampered, []byte("{}\n"), 0o644); err != nil { t.Fatal(err) }
		if _, err := rollbackCurrentStateAtRevision(
			fixture.root, "internet", source, promoted.Revision, fixture.trustPath,
		); err == nil {
			t.Fatal("rollback retry acknowledged a corrupt restored current slot")
		}
		persisted, err := readActivationState(fixture.root, "internet")
		if err != nil { t.Fatal(err) }
		if persisted.Revision != rolled.Revision || !sameSlotIdentity(persisted.Current, rolled.Current) {
			t.Fatalf("rejected rollback retry modified activation state: %+v", persisted)
		}
	})
}

// Uninstall removes Current, but the authoritative state retains the exact
// removed slot identity. Otherwise any version could replay the same revision.
func TestUninstallRetryRequiresDurableSignedRemovedIdentity(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(t, fixture, "1.0.0", strings.Repeat("3", 40))
	promoted := healthyPromoteV2(t, fixture, candidate)
	removedIdentity := *promoted.Current
	removed, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", removedIdentity, promoted.Revision, fixture.trustPath,
	)
	if err != nil { t.Fatal(err) }
	if !sameSlotIdentity(removed.Removed, &removedIdentity) || !removed.UserRemoved {
		t.Fatalf("uninstall lost durable removed identity: %+v", removed)
	}
	wrong := slotIdentity{Version: "1.0.1", SourceCommit: strings.Repeat("4", 40)}
	if _, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", wrong, promoted.Revision, fixture.trustPath,
	); err == nil {
		t.Fatal("uninstall retry accepted unrelated removed identity")
	}
	retry, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", removedIdentity, promoted.Revision, fixture.trustPath,
	)
	if err != nil || retry.Revision != removed.Revision {
		t.Fatalf("signed exact uninstall retry = %+v, %v", retry, err)
	}
	// Old state snapshots without the tombstone remain readable and removed;
	// no made-up identity can turn them into an acknowledged retry.
	legacy := removed
	legacy.Removed = nil
	if err := writeActivationState(fixture.root, legacy); err != nil { t.Fatal(err) }
	if _, err := uninstallCurrentStateAtRevision(
		fixture.root, "internet", removedIdentity, promoted.Revision, fixture.trustPath,
	); err == nil {
		t.Fatal("legacy removal without identity claimed a successful retry")
	}
	// A separate fixture proves corruption detection independent of legacy.
	fixture2 := makeActivationV2Fixture(t)
	candidate2 := addActivationV2Candidate(t, fixture2, "1.0.0", strings.Repeat("5", 40))
	promoted2 := healthyPromoteV2(t, fixture2, candidate2)
	identity2 := *promoted2.Current
	if _, err := uninstallCurrentStateAtRevision(
		fixture2.root, "internet", identity2, promoted2.Revision, fixture2.trustPath,
	); err != nil { t.Fatal(err) }
	tampered := filepath.Join(candidate2.slot, candidate2.release.Compatibility.Name)
	if err := os.Chmod(tampered, 0o644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(tampered, []byte("{}\n"), 0o644); err != nil { t.Fatal(err) }
	if _, err := uninstallCurrentStateAtRevision(
		fixture2.root, "internet", identity2, promoted2.Revision, fixture2.trustPath,
	); err == nil {
		t.Fatal("uninstall retry acknowledged corrupt removed signed slot")
	}
}

func TestReleaseV2CompatibilityTamperBlocksArmWithoutCreatingState(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t,
		fixture,
		"1.0.0",
		"1111111111111111111111111111111111111111",
	)
	installedCompatibility := filepath.Join(candidate.slot, candidate.release.Compatibility.Name)
	if runtime.GOOS != "windows" {
		if err := os.Chmod(installedCompatibility, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(installedCompatibility, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := armPendingState(candidate.slot, fixture.trustPath, fixture.root)
	if err == nil {
		t.Fatal("tampered release/2 compatibility unexpectedly armed")
	}
	if !strings.Contains(err.Error(), "compatibility") &&
		!strings.Contains(err.Error(), "size") &&
		!strings.Contains(err.Error(), "SHA-256") &&
		!strings.Contains(err.Error(), "writable") {
		t.Fatalf("unexpected tampered arm error: %v", err)
	}
	state, stateErr := readActivationState(fixture.root, "internet")
	if stateErr != nil {
		t.Fatal(stateErr)
	}
	if state.Revision != 0 || state.Pending != nil || state.Current != nil {
		t.Fatalf("failed arm mutated activation state: %+v", state)
	}
}

func TestReleaseV2CompatibilityTamperBlocksHealthyPromotion(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t,
		fixture,
		"1.0.0",
		"1111111111111111111111111111111111111111",
	)
	state, err := armPendingState(candidate.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	identity := *state.Pending
	probationRevision := state.Revision
	state, err = recordPendingHealthAtRevision(
		fixture.root,
		"internet",
		identity,
		"healthy",
		&probationRevision,
	)
	if err != nil {
		t.Fatal(err)
	}

	installedCompatibility := filepath.Join(candidate.slot, candidate.release.Compatibility.Name)
	if runtime.GOOS != "windows" {
		if err := os.Chmod(installedCompatibility, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(installedCompatibility, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err = promotePendingStateAtRevision(
		fixture.root,
		"internet",
		identity,
		state.Revision,
		fixture.trustPath,
	)
	if err == nil {
		t.Fatal("tampered release/2 compatibility unexpectedly promoted")
	}
	persisted, stateErr := readActivationState(fixture.root, "internet")
	if stateErr != nil {
		t.Fatal(stateErr)
	}
	if persisted.Current != nil || persisted.Pending == nil || persisted.PendingHealth != "healthy" {
		t.Fatalf("failed promotion mutated activation state: %+v", persisted)
	}
}

func TestSchemaAwareActivationVerifierKeepsReleaseV1Working(t *testing.T) {
	fixture := makeActivationFixture(
		t,
		"1.0.0",
		"3333333333333333333333333333333333333333",
	)
	trustBytes, err := os.ReadFile(fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	release, err := verifyActivationSlotWithTrustBytes(fixture.slot, trustBytes)
	if err != nil {
		t.Fatal(err)
	}
	if release.Schema != releaseSchema || release.Component.ID != "internet" {
		t.Fatalf("release/1 activation compatibility regressed: %+v", release)
	}
}

func TestExplicitRemovalCannotCoexistWithCurrentSlot(t *testing.T) {
	state := emptyActivationState("internet")
	state.UserRemoved = true
	state.Current = &slotIdentity{
		Version:      "1.0.0",
		SourceCommit: "1111111111111111111111111111111111111111",
	}
	if err := validateActivationState(state, "internet"); err == nil ||
		!strings.Contains(err.Error(), "explicitly removed cannot have a current slot") {
		t.Fatalf("contradictory installed and removed state was accepted: %v", err)
	}
}

func TestCurrentResolutionSourcePreservesExplicitRemoval(t *testing.T) {
	absent := emptyActivationState("internet")
	removed := emptyActivationState("internet")
	removed.UserRemoved = true
	installed := emptyActivationState("internet")
	installed.Current = &slotIdentity{
		Version:      "1.0.0",
		SourceCommit: "1111111111111111111111111111111111111111",
	}
	for _, tc := range []struct {
		name    string
		state   activationState
		bundled bool
		want    string
	}{
		{"never-installed-bundled", absent, true, "BUNDLED"},
		{"never-installed-external", absent, false, "ABSENT"},
		{"removed-platform-component", removed, false, "REMOVED"},
		{"removed-bundled-fallback", removed, true, "REMOVED"},
		{"installed-current", installed, false, "SLOT"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := currentResolutionSource(tc.state, tc.bundled); got != tc.want {
				t.Fatalf("source = %q, expected %q", got, tc.want)
			}
		})
	}
}
