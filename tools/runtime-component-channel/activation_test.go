package main

import (
	"archive/zip"
	"errors"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type activationFixture struct {
	dir          string
	root         string
	privatePath  string
	trustPath    string
	envelopePath string
	packagePath  string
	release      releaseDescriptor
	slot         string
}

func writeComponentSlotCandidate(
	t *testing.T,
	dir string,
	privatePath string,
	trustPath string,
	version string,
	sourceCommit string,
) (string, string, releaseDescriptor) {
	t.Helper()

	runtimePath := "system/apps/internet/runtime.mjs"
	runtimeBytes := []byte("export const componentRuntime = { schema: \"ordax.component-runtime/1\" };\n")
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

	packagePath := filepath.Join(dir, "internet-"+version+".zip")
	file, err := os.OpenFile(packagePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	writeZipEntry(t, writer, packageManifestName, manifestBytes)
	writeZipEntry(t, writer, runtimePath, runtimeBytes)
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	packageHash, packageSize, err := sha256File(packagePath, maxPackageBytes)
	if err != nil {
		t.Fatal(err)
	}
	release := releaseDescriptor{
		Schema:            releaseSchema,
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
			PendingHealthRequired:    true,
		},
	}

	// The canonical signed release requires the package basename to be <component>.zip.
	canonicalPackage := filepath.Join(dir, "internet.zip")
	if err := os.Rename(packagePath, canonicalPackage); err != nil {
		t.Fatal(err)
	}
	packagePath = canonicalPackage

	releasePath := filepath.Join(dir, "release-"+version+".json")
	releaseBytes, err := marshalJSON(release)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(releasePath, releaseBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	envelopePath := filepath.Join(dir, "envelope-"+version+".json")
	if _, err := signRelease(
		releasePath,
		privatePath,
		trustPath,
		envelopePath,
		"runtime-components-activation-test-1",
	); err != nil {
		t.Fatal(err)
	}
	return packagePath, envelopePath, release
}

func makeActivationFixture(t *testing.T, version string, sourceCommit string) activationFixture {
	t.Helper()
	dir := t.TempDir()
	root := filepath.Join(dir, "slots")
	privatePath := filepath.Join(dir, "private.pem")
	trustPath := filepath.Join(dir, "trust.json")
	if _, err := generateKey(
		privatePath,
		trustPath,
		"runtime-components-activation-test-1",
	); err != nil {
		t.Fatal(err)
	}
	packagePath, envelopePath, release := writeComponentSlotCandidate(
		t,
		dir,
		privatePath,
		trustPath,
		version,
		sourceCommit,
	)
	_, slot, _, err := stageComponent(envelopePath, trustPath, packagePath, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { allowTestTreeCleanup(root) })
	return activationFixture{
		dir:          dir,
		root:         root,
		privatePath:  privatePath,
		trustPath:    trustPath,
		envelopePath: envelopePath,
		packagePath:  packagePath,
		release:      release,
		slot:         slot,
	}
}

func addActivationCandidate(
	t *testing.T,
	fixture activationFixture,
	version string,
	sourceCommit string,
) (releaseDescriptor, string) {
	t.Helper()
	// The previous canonical package is no longer needed after immutable staging.
	if err := os.Remove(fixture.packagePath); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	packagePath, envelopePath, release := writeComponentSlotCandidate(
		t,
		fixture.dir,
		fixture.privatePath,
		fixture.trustPath,
		version,
		sourceCommit,
	)
	_, slot, _, err := stageComponent(
		envelopePath,
		fixture.trustPath,
		packagePath,
		fixture.root,
	)
	if err != nil {
		t.Fatal(err)
	}
	return release, slot
}

func promotePendingState(root, componentID, trustPath string) (activationState, error) {
	state, err := readActivationState(root, componentID)
	if err != nil {
		return activationState{}, err
	}
	if state.Pending == nil {
		return activationState{}, errors.New("test helper: no pending slot")
	}
	return promotePendingStateAtRevision(
		root,
		componentID,
		*state.Pending,
		state.Revision,
		trustPath,
	)
}

func rejectPendingState(root, componentID string, identity slotIdentity) (activationState, error) {
	state, err := readActivationState(root, componentID)
	if err != nil {
		return activationState{}, err
	}
	return rejectPendingStateAtRevision(
		root,
		componentID,
		identity,
		state.Revision,
	)
}

func rollbackCurrentState(root, componentID, trustPath string) (activationState, error) {
	state, err := readActivationState(root, componentID)
	if err != nil {
		return activationState{}, err
	}
	if state.Current == nil {
		return activationState{}, errors.New("test helper: no current slot")
	}
	return rollbackCurrentStateAtRevision(
		root,
		componentID,
		*state.Current,
		state.Revision,
		trustPath,
	)
}

func TestActivationRejectsBundledReleaseMode(t *testing.T) {
	fixture := makeFixture(t)
	root := filepath.Join(fixture.dir, "slots")
	t.Cleanup(func() { allowTestTreeCleanup(root) })
	_, slot, _, err := stageComponent(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = armPendingState(slot, fixture.trustPath, root)
	if err == nil || !strings.Contains(err.Error(), "release_mode=component-slot") {
		t.Fatalf("bundled activation error = %v", err)
	}
}

func TestPendingRequiresExactHealthBeforePromotion(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("1", 40))
	state, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	if state.Pending == nil || state.PendingHealth != "unknown" || state.Current != nil {
		t.Fatalf("unexpected armed state: %+v", state)
	}

	if _, err := promotePendingState(fixture.root, "internet", fixture.trustPath); err == nil {
		t.Fatal("promotion succeeded without pending health")
	}
	if _, err := recordPendingHealth(
		fixture.root,
		"internet",
		slotIdentity{Version: "0.4.0", SourceCommit: strings.Repeat("2", 40)},
		"healthy",
	); err == nil {
		t.Fatal("health accepted for wrong source identity")
	}

	state, err = recordPendingHealth(
		fixture.root,
		"internet",
		identityFromRelease(fixture.release),
		"healthy",
	)
	if err != nil {
		t.Fatal(err)
	}
	if state.PendingHealth != "healthy" {
		t.Fatalf("pending health = %q", state.PendingHealth)
	}

	state, err = promotePendingState(fixture.root, "internet", fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if state.Current == nil || !sameSlotIdentity(state.Current, &slotIdentity{
		Version:      "0.4.0",
		SourceCommit: strings.Repeat("1", 40),
	}) {
		t.Fatalf("unexpected current after promotion: %+v", state)
	}
	if state.Previous != nil || state.Pending != nil || state.PendingHealth != "unknown" {
		t.Fatalf("promotion left stale state: %+v", state)
	}
}

func TestFirstRollbackReturnsToBundledFallback(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("3", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	if _, err := recordPendingHealth(
		fixture.root,
		"internet",
		identityFromRelease(fixture.release),
		"healthy",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := promotePendingState(fixture.root, "internet", fixture.trustPath); err != nil {
		t.Fatal(err)
	}

	state, err := rollbackCurrentState(fixture.root, "internet", fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if state.Current != nil || state.Previous != nil || state.Rejected == nil {
		t.Fatalf("rollback did not return to bundled fallback: %+v", state)
	}
	if state.Rejected.Version != "0.4.0" {
		t.Fatalf("rejected version = %q", state.Rejected.Version)
	}

	resolved, slot, bundled, err := resolveCurrentState(
		fixture.root,
		"internet",
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !bundled || slot != "" || resolved.Current != nil {
		t.Fatalf("bundled fallback did not resolve: bundled=%t slot=%q state=%+v", bundled, slot, resolved)
	}
}

func TestSecondPromotionAndRollbackRestoreVerifiedPrevious(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("4", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	if _, err := recordPendingHealth(
		fixture.root,
		"internet",
		identityFromRelease(fixture.release),
		"healthy",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := promotePendingState(fixture.root, "internet", fixture.trustPath); err != nil {
		t.Fatal(err)
	}

	secondRelease, secondSlot := addActivationCandidate(
		t,
		fixture,
		"0.5.0",
		strings.Repeat("5", 40),
	)
	if _, err := armPendingState(secondSlot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	if _, err := recordPendingHealth(
		fixture.root,
		"internet",
		identityFromRelease(secondRelease),
		"healthy",
	); err != nil {
		t.Fatal(err)
	}
	state, err := promotePendingState(fixture.root, "internet", fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if state.Current == nil || state.Current.Version != "0.5.0" {
		t.Fatalf("second version not current: %+v", state)
	}
	if state.Previous == nil || state.Previous.Version != "0.4.0" {
		t.Fatalf("first version not preserved as previous: %+v", state)
	}

	state, err = rollbackCurrentState(fixture.root, "internet", fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if state.Current == nil || state.Current.Version != "0.4.0" {
		t.Fatalf("rollback did not restore previous: %+v", state)
	}
	if state.Rejected == nil || state.Rejected.Version != "0.5.0" || state.Previous != nil {
		t.Fatalf("rollback state is invalid: %+v", state)
	}
}

func TestResolveCurrentReverifiesSlotAndDetectsTampering(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("6", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	if _, err := recordPendingHealth(
		fixture.root,
		"internet",
		identityFromRelease(fixture.release),
		"healthy",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := promotePendingState(fixture.root, "internet", fixture.trustPath); err != nil {
		t.Fatal(err)
	}

	state, slot, bundled, err := resolveCurrentState(fixture.root, "internet", fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if bundled || state.Current == nil || filepath.Clean(slot) != filepath.Clean(fixture.slot) {
		t.Fatalf("current slot did not resolve: bundled=%t slot=%q state=%+v", bundled, slot, state)
	}

	runtimePath := filepath.Join(slot, "system", "apps", "internet", "runtime.mjs")
	if runtime.GOOS != "windows" {
		if err := os.Chmod(runtimePath, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(runtimePath, []byte("tampered\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := resolveCurrentState(fixture.root, "internet", fixture.trustPath); err == nil {
		t.Fatal("tampered current slot unexpectedly resolved")
	}
}

func TestPendingMustBeRejectedBeforeRollback(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("7", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	if _, err := rollbackCurrentState(fixture.root, "internet", fixture.trustPath); err == nil {
		t.Fatal("rollback accepted while a pending candidate exists")
	}

	wrong := slotIdentity{Version: "0.4.0", SourceCommit: strings.Repeat("8", 40)}
	if _, err := rejectPendingState(fixture.root, "internet", wrong); err == nil {
		t.Fatal("reject accepted the wrong pending identity")
	}
	state, err := rejectPendingState(
		fixture.root,
		"internet",
		identityFromRelease(fixture.release),
	)
	if err != nil {
		t.Fatal(err)
	}
	if state.Pending != nil || state.Rejected == nil || state.PendingHealth != "unknown" {
		t.Fatalf("pending rejection state invalid: %+v", state)
	}
}

func TestActivationLockAndCorruptStateFailClosed(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("9", 40))
	componentRoot := filepath.Join(fixture.root, "internet")
	lockPath := filepath.Join(componentRoot, activationLockName)
	if err := os.Mkdir(lockPath, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err == nil ||
		!strings.Contains(err.Error(), "already locked") {
		t.Fatalf("stale lock error = %v", err)
	}
	if err := os.Remove(lockPath); err != nil {
		t.Fatal(err)
	}

	statePath := filepath.Join(componentRoot, activationStateName)
	if err := os.WriteFile(statePath, []byte("{broken\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readActivationState(fixture.root, "internet"); err == nil {
		t.Fatal("corrupt activation state unexpectedly loaded")
	}
}

func TestFailedPendingCannotBecomeHealthyWithoutRejection(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("a", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)
	state, err := recordPendingHealth(
		fixture.root,
		"internet",
		identity,
		"failed",
	)
	if err != nil {
		t.Fatal(err)
	}
	if state.PendingHealth != "failed" {
		t.Fatalf("pending health = %q", state.PendingHealth)
	}
	if _, err := recordPendingHealth(
		fixture.root,
		"internet",
		identity,
		"healthy",
	); err == nil || !strings.Contains(err.Error(), "must be rejected") {
		t.Fatalf("failed -> healthy error = %v", err)
	}
	if _, err := promotePendingState(fixture.root, "internet", fixture.trustPath); err == nil {
		t.Fatal("failed candidate unexpectedly promoted")
	}
}

func TestRejectedIdentityCannotBeRearmed(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("b", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)
	if _, err := rejectPendingState(fixture.root, "internet", identity); err != nil {
		t.Fatal(err)
	}
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err == nil ||
		!strings.Contains(err.Error(), "previously rejected") {
		t.Fatalf("rearm rejected candidate error = %v", err)
	}
}


func TestPendingRuntimeResolutionAndVerifiedFileRead(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("7", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}

	state, slot, manifest, bundled, err := resolveRuntimeSlot(
		fixture.root,
		"internet",
		fixture.trustPath,
		"pending",
	)
	if err != nil {
		t.Fatal(err)
	}
	if bundled {
		t.Fatal("pending runtime unexpectedly resolved as bundled")
	}
	if slot != fixture.slot {
		t.Fatalf("pending slot = %q, want %q", slot, fixture.slot)
	}
	if manifest.Entrypoint != "system/apps/internet/runtime.mjs" {
		t.Fatalf("entrypoint = %q", manifest.Entrypoint)
	}
	if state.Pending == nil || state.Pending.Version != "0.4.0" {
		t.Fatalf("pending state = %+v", state.Pending)
	}

	payload, err := readVerifiedRuntimeFile(
		fixture.root,
		"internet",
		fixture.trustPath,
		"pending",
		manifest.Entrypoint,
	)
	if err != nil {
		t.Fatal(err)
	}
	expected := "export const componentRuntime = { schema: \"ordax.component-runtime/1\" };\n"
	if string(payload) != expected {
		t.Fatalf("runtime payload = %q", payload)
	}
}

func TestVerifiedRuntimeReadRejectsMetadataAndUnboundPaths(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("8", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}

	for _, requested := range []string{
		packageManifestName,
		slotEnvelopeName,
		"system/apps/internet/not-packaged.mjs",
		"../escape.mjs",
	} {
		if _, err := readVerifiedRuntimeFile(
			fixture.root,
			"internet",
			fixture.trustPath,
			"pending",
			requested,
		); err == nil {
			t.Fatalf("unsafe/unbound runtime path unexpectedly read: %s", requested)
		}
	}
}

func TestPromotedCurrentRuntimeRemainsVerifiedAtReadTime(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("9", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)
	if _, err := recordPendingHealth(
		fixture.root,
		"internet",
		identity,
		"healthy",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := promotePendingState(fixture.root, "internet", fixture.trustPath); err != nil {
		t.Fatal(err)
	}

	state, slot, manifest, bundled, err := resolveRuntimeSlot(
		fixture.root,
		"internet",
		fixture.trustPath,
		"current",
	)
	if err != nil {
		t.Fatal(err)
	}
	if bundled || state.Current == nil || slot != fixture.slot {
		t.Fatalf("unexpected current runtime resolution: bundled=%t state=%+v slot=%q", bundled, state.Current, slot)
	}
	if _, err := readVerifiedRuntimeFile(
		fixture.root,
		"internet",
		fixture.trustPath,
		"current",
		manifest.Entrypoint,
	); err != nil {
		t.Fatal(err)
	}

	runtimePath := filepath.Join(
		fixture.slot,
		"system",
		"apps",
		"internet",
		"runtime.mjs",
	)
	if runtime.GOOS != "windows" {
		if err := os.Chmod(runtimePath, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(runtimePath, []byte("tampered\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readVerifiedRuntimeFile(
		fixture.root,
		"internet",
		fixture.trustPath,
		"current",
		manifest.Entrypoint,
	); err == nil {
		t.Fatal("tampered current runtime unexpectedly read")
	}
}

func TestExternalComponentWithoutCurrentSlotResolvesAsAbsent(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "slots")
	if _, err := ensureSecureDirectory(root, 0o755); err != nil {
		t.Fatal(err)
	}

	state, slot, bundled, err := resolveCurrentState(
		root,
		"notes",
		filepath.Join(dir, "missing-trust.json"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if bundled || slot != "" || state.Current != nil {
		t.Fatalf("external absent component resolved incorrectly: bundled=%t slot=%q current=%+v", bundled, slot, state.Current)
	}

	runtimeState, runtimeSlot, _, runtimeBundled, err := resolveRuntimeSlot(
		root,
		"notes",
		filepath.Join(dir, "missing-trust.json"),
		"current",
	)
	if err != nil {
		t.Fatal(err)
	}
	if runtimeBundled || runtimeSlot != "" || runtimeState.Current != nil {
		t.Fatalf("external absent runtime resolved incorrectly: bundled=%t slot=%q current=%+v", runtimeBundled, runtimeSlot, runtimeState.Current)
	}

	if _, err := readVerifiedRuntimeFile(
		root,
		"notes",
		filepath.Join(dir, "missing-trust.json"),
		"current",
		"system/apps/notes/src/runtime.mjs",
	); err == nil || !strings.Contains(err.Error(), "identity is unavailable") {
		t.Fatalf("absent external runtime read error = %v", err)
	}
}

func TestCurrentBundledFallbackIsNotExposedAsSlotBytes(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "slots")
	if _, err := ensureSecureDirectory(root, 0o755); err != nil {
		t.Fatal(err)
	}
	state, slot, _, bundled, err := resolveRuntimeSlot(
		root,
		"internet",
		filepath.Join(dir, "missing-trust.json"),
		"current",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !bundled || slot != "" || state.Current != nil {
		t.Fatalf("unexpected bundled resolution: bundled=%t slot=%q current=%+v", bundled, slot, state.Current)
	}
	if _, err := readVerifiedRuntimeFile(
		root,
		"internet",
		filepath.Join(dir, "missing-trust.json"),
		"current",
		"system/apps/internet/runtime.mjs",
	); err == nil || !strings.Contains(err.Error(), "bundled") {
		t.Fatalf("bundled runtime read error = %v", err)
	}
}


func TestFailedPendingRuntimeCannotBeRead(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("a", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)
	if _, err := recordPendingHealth(
		fixture.root,
		"internet",
		identity,
		"failed",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := readVerifiedRuntimeFile(
		fixture.root,
		"internet",
		fixture.trustPath,
		"pending",
		"system/apps/internet/runtime.mjs",
	); err == nil || !strings.Contains(err.Error(), "failed pending slot") {
		t.Fatalf("failed pending runtime read error = %v", err)
	}
}


func TestPendingHealthExactRevisionAndIdempotentRetry(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("c", 40))
	armed, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)
	expected := armed.Revision

	recorded, err := recordPendingHealthAtRevision(
		fixture.root,
		"internet",
		identity,
		"healthy",
		&expected,
	)
	if err != nil {
		t.Fatal(err)
	}
	if recorded.Revision != expected+1 || recorded.PendingHealth != "healthy" {
		t.Fatalf("recorded state = %+v, expected revision %d healthy", recorded, expected+1)
	}

	retry, err := recordPendingHealthAtRevision(
		fixture.root,
		"internet",
		identity,
		"healthy",
		&expected,
	)
	if err != nil {
		t.Fatal(err)
	}
	if retry.Revision != recorded.Revision || retry.PendingHealth != "healthy" {
		t.Fatalf("idempotent retry changed state: %+v vs %+v", retry, recorded)
	}
}

func TestPendingHealthRejectsStaleProbationRevision(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("d", 40))
	armed, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)
	expected := armed.Revision
	if _, err := recordPendingHealthAtRevision(
		fixture.root,
		"internet",
		identity,
		"healthy",
		&expected,
	); err != nil {
		t.Fatal(err)
	}

	if _, err := recordPendingHealthAtRevision(
		fixture.root,
		"internet",
		identity,
		"failed",
		&expected,
	); err == nil || !strings.Contains(err.Error(), "revision no longer matches") {
		t.Fatalf("stale probation revision error = %v", err)
	}
}


func TestPendingHealthRejectsNonPositiveExpectedRevision(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("e", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)
	for _, expected := range []int64{0, -1} {
		if _, err := recordPendingHealthAtRevision(
			fixture.root,
			"internet",
			identity,
			"healthy",
			&expected,
		); err == nil || !strings.Contains(err.Error(), "revision must be positive") {
			t.Fatalf("expected revision %d error = %v", expected, err)
		}
	}
}


func TestPromotionRequiresExactDecisionRevisionAndIdentity(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("1", 40))
	armed, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)
	healthy, err := recordPendingHealth(
		fixture.root,
		"internet",
		identity,
		"healthy",
	)
	if err != nil {
		t.Fatal(err)
	}
	if healthy.Revision != armed.Revision+1 {
		t.Fatalf("healthy revision = %d, armed = %d", healthy.Revision, armed.Revision)
	}

	if _, err := promotePendingStateAtRevision(
		fixture.root,
		"internet",
		identity,
		armed.Revision,
		fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "revision is stale") {
		t.Fatalf("stale promotion revision error = %v", err)
	}

	wrong := slotIdentity{Version: identity.Version, SourceCommit: strings.Repeat("f", 40)}
	if _, err := promotePendingStateAtRevision(
		fixture.root,
		"internet",
		wrong,
		healthy.Revision,
		fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "identity does not match") {
		t.Fatalf("wrong promotion identity error = %v", err)
	}

	promoted, err := promotePendingStateAtRevision(
		fixture.root,
		"internet",
		identity,
		healthy.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if promoted.Revision != healthy.Revision+1 || !sameSlotIdentity(promoted.Current, &identity) {
		t.Fatalf("promoted state = %+v", promoted)
	}

	retry, err := promotePendingStateAtRevision(
		fixture.root,
		"internet",
		identity,
		healthy.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if retry.Revision != promoted.Revision || !sameSlotIdentity(retry.Current, &identity) {
		t.Fatalf("idempotent promotion retry changed state: %+v", retry)
	}
}

func TestRejectionRequiresExactDecisionRevisionAndIsIdempotent(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("2", 40))
	armed, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)

	if _, err := rejectPendingStateAtRevision(
		fixture.root,
		"internet",
		identity,
		armed.Revision+1,
	); err == nil || !strings.Contains(err.Error(), "revision is stale") {
		t.Fatalf("future rejection revision error = %v", err)
	}

	rejected, err := rejectPendingStateAtRevision(
		fixture.root,
		"internet",
		identity,
		armed.Revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if rejected.Revision != armed.Revision+1 || !sameSlotIdentity(rejected.Rejected, &identity) {
		t.Fatalf("rejected state = %+v", rejected)
	}

	retry, err := rejectPendingStateAtRevision(
		fixture.root,
		"internet",
		identity,
		armed.Revision,
	)
	if err != nil {
		t.Fatal(err)
	}
	if retry.Revision != rejected.Revision || !sameSlotIdentity(retry.Rejected, &identity) {
		t.Fatalf("idempotent rejection retry changed state: %+v", retry)
	}
}

func TestRollbackRequiresExactCurrentIdentityAndRevision(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("3", 40))
	armed, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root)
	if err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)
	healthy, err := recordPendingHealth(
		fixture.root,
		"internet",
		identity,
		"healthy",
	)
	if err != nil {
		t.Fatal(err)
	}
	promoted, err := promotePendingStateAtRevision(
		fixture.root,
		"internet",
		identity,
		healthy.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if promoted.Revision != armed.Revision+2 {
		t.Fatalf("promoted revision = %d", promoted.Revision)
	}

	if _, err := rollbackCurrentStateAtRevision(
		fixture.root,
		"internet",
		identity,
		promoted.Revision-1,
		fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "revision is stale") {
		t.Fatalf("stale rollback revision error = %v", err)
	}

	wrong := slotIdentity{Version: identity.Version, SourceCommit: strings.Repeat("e", 40)}
	if _, err := rollbackCurrentStateAtRevision(
		fixture.root,
		"internet",
		wrong,
		promoted.Revision,
		fixture.trustPath,
	); err == nil || !strings.Contains(err.Error(), "identity does not match") {
		t.Fatalf("wrong rollback identity error = %v", err)
	}

	rolled, err := rollbackCurrentStateAtRevision(
		fixture.root,
		"internet",
		identity,
		promoted.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if rolled.Revision != promoted.Revision+1 || rolled.Current != nil || !sameSlotIdentity(rolled.Rejected, &identity) {
		t.Fatalf("rolled state = %+v", rolled)
	}

	retry, err := rollbackCurrentStateAtRevision(
		fixture.root,
		"internet",
		identity,
		promoted.Revision,
		fixture.trustPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if retry.Revision != rolled.Revision || !sameSlotIdentity(retry.Rejected, &identity) {
		t.Fatalf("idempotent rollback retry changed state: %+v", retry)
	}
}

func TestStateActionCommandsRequireExactRevisionAndIdentity(t *testing.T) {
	for name, invoke := range map[string]func([]string) error{
		"promote": promoteStateCommand,
		"reject": rejectPendingCommand,
		"rollback": rollbackStateCommand,
		"uninstall": uninstallStateCommand,
	} {
		t.Run(name, func(t *testing.T) {
			if err := invoke([]string{"--component", "internet"}); err == nil ||
				!strings.Contains(err.Error(), "requires") {
				t.Fatalf("incomplete command error = %v", err)
			}
		})
	}
}

func TestStateActionsRejectNonPositiveExpectedRevision(t *testing.T) {
	fixture := makeActivationFixture(t, "0.4.0", strings.Repeat("4", 40))
	if _, err := armPendingState(fixture.slot, fixture.trustPath, fixture.root); err != nil {
		t.Fatal(err)
	}
	identity := identityFromRelease(fixture.release)
	for _, revision := range []int64{0, -1} {
		if _, err := rejectPendingStateAtRevision(
			fixture.root,
			"internet",
			identity,
			revision,
		); err == nil || !strings.Contains(err.Error(), "expected revision must be positive") {
			t.Fatalf("revision %d error = %v", revision, err)
		}
	}
}
