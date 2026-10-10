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
	t.Helper()

	runtimePath := "system/apps/internet/runtime.mjs"
	runtimeBytes := []byte("export const runtimeVersion = \"" + version + "\";\n")
	runtimeDigest := sha256.Sum256(runtimeBytes)
	manifest := componentPackageManifest{
		Schema: packageSchema,
		Status: "candidate",
		Component: packageComponent{
			ID:            "internet",
			Title:         "Internet",
			Kind:          "app",
			Version:       version,
			ReleaseMode:   "component-slot",
			Criticality:   "optional",
			FailureDomain: "app",
			RestartScope:  "component",
			HealthMode:    "runtime",
			Owner:         "system/apps/internet",
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

	packagePath := filepath.Join(fixture.dir, "internet.zip")
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

	compatibility := map[string]any{
		"schema":           compatibilitySchemaV1,
		"componentId":      "internet",
		"componentVersion": version,
		"provides": []any{
			map[string]any{"id": "ordax.internet", "major": 1},
		},
		"requires":  []any{},
		"state":     nil,
		"authority": "none",
	}
	compatibilityBytes, err := marshalJSON(compatibility)
	if err != nil {
		t.Fatal(err)
	}
	compatibilityDigest := sha256.Sum256(compatibilityBytes)
	compatibilityPath := filepath.Join(fixture.dir, "internet.compatibility.json")
	if err := os.WriteFile(compatibilityPath, compatibilityBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	release := releaseDescriptorV2{
		Schema:            releaseSchemaV2,
		SourceRepository:  sourceRepository,
		SourceCommit:      sourceCommit,
		CreatedFromRecipe: createdFromRecipe,
		Component: releaseComponent{
			ID:            "internet",
			Version:       version,
			ReleaseMode:   "component-slot",
			PackageSchema: packageSchema,
		},
		Package: packageBinding{
			Name:           "internet.zip",
			SHA256:         packageHash,
			Size:           packageSize,
			ManifestSHA256: hex.EncodeToString(manifestDigest[:]),
		},
		Activation: activationPolicy{
			DirectActivationAllowed: false,
			PendingHealthRequired:   true,
		},
		Compatibility: compatibilityBinding{
			Name:   "internet.compatibility.json",
			Schema: compatibilitySchemaV1,
			SHA256: hex.EncodeToString(compatibilityDigest[:]),
			Size:   int64(len(compatibilityBytes)),
		},
	}
	releaseBytes, err := marshalJSON(release)
	if err != nil {
		t.Fatal(err)
	}
	releasePath := filepath.Join(fixture.dir, "release-"+version+".json")
	if err := os.WriteFile(releasePath, releaseBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	envelopePath := filepath.Join(fixture.dir, "envelope-"+version+".json")
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
