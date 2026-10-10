package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

const (
	activationStateSchema   = "prototype-ordax.runtime-component-activation-state/1"
	activationStateName     = "activation-state.json"
	activationLockName      = ".activation-state-lock"
	maxActivationStateBytes = 64 << 10
)

type slotIdentity struct {
	Version      string `json:"version"`
	SourceCommit string `json:"source_commit"`
}

type activationState struct {
	Schema        string        `json:"$schema"`
	ComponentID   string        `json:"component_id"`
	Revision      int64         `json:"revision"`
	Current       *slotIdentity `json:"current"`
	Previous      *slotIdentity `json:"previous"`
	Pending       *slotIdentity `json:"pending"`
	Rejected      *slotIdentity `json:"rejected"`
	PendingHealth string        `json:"pending_health"`
	// Same SSOT as the current slot. A user-initiated uninstall must survive
	// reboot and signed image refresh without a parallel Store preference DB.
	UserRemoved bool `json:"user_removed,omitempty"`
}

func emptyActivationState(componentID string) activationState {
	return activationState{
		Schema:        activationStateSchema,
		ComponentID:   componentID,
		Revision:      0,
		PendingHealth: "unknown",
	}
}

func validateSlotIdentity(value *slotIdentity) error {
	if value == nil {
		return nil
	}
	if !semverPattern.MatchString(value.Version) {
		return errors.New("runtime component activation version is invalid")
	}
	if !commitPattern.MatchString(value.SourceCommit) {
		return errors.New("runtime component activation source_commit is invalid")
	}
	return nil
}

func sameSlotIdentity(left, right *slotIdentity) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.Version == right.Version && left.SourceCommit == right.SourceCommit
}

func validateActivationState(value activationState, componentID string) error {
	if value.Schema != activationStateSchema {
		return errors.New("unsupported runtime component activation-state schema")
	}
	if value.ComponentID != componentID || !componentPattern.MatchString(value.ComponentID) {
		return errors.New("runtime component activation-state component is invalid")
	}
	if value.Revision < 0 {
		return errors.New("runtime component activation-state revision is invalid")
	}
	if value.PendingHealth != "unknown" && value.PendingHealth != "healthy" && value.PendingHealth != "failed" {
		return errors.New("runtime component pending health is invalid")
	}
	for _, identity := range []*slotIdentity{value.Current, value.Previous, value.Pending, value.Rejected} {
		if err := validateSlotIdentity(identity); err != nil {
			return err
		}
	}
	if value.UserRemoved && value.Current != nil {
		return errors.New("runtime component explicitly removed cannot have a current slot")
	}
	if value.Pending == nil && value.PendingHealth != "unknown" {
		return errors.New("runtime component pending health exists without a pending slot")
	}
	if sameSlotIdentity(value.Current, value.Previous) && value.Current != nil {
		return errors.New("runtime component current and previous slots must differ")
	}
	if value.Pending != nil && (sameSlotIdentity(value.Pending, value.Current) || sameSlotIdentity(value.Pending, value.Previous)) {
		return errors.New("runtime component pending slot duplicates current or previous")
	}
	if value.Rejected != nil && (sameSlotIdentity(value.Rejected, value.Current) ||
		sameSlotIdentity(value.Rejected, value.Previous) ||
		sameSlotIdentity(value.Rejected, value.Pending)) {
		return errors.New("runtime component rejected slot must remain distinct from active state")
	}
	return nil
}

func secureExistingDirectory(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("runtime component activation path must be a real directory")
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	resolvedAbs, err := filepath.Abs(resolved)
	if err != nil {
		return "", err
	}
	if filepath.Clean(resolvedAbs) != filepath.Clean(absolute) {
		return "", errors.New("runtime component activation path may not traverse symlinks")
	}
	return absolute, nil
}

func componentActivationRoot(root, componentID string, create bool) (string, error) {
	if !componentPattern.MatchString(componentID) {
		return "", errors.New("runtime component activation id is invalid")
	}
	var rootPath string
	var err error
	if create {
		rootPath, err = ensureSecureDirectory(root, 0o755)
	} else {
		rootPath, err = secureExistingDirectory(root)
	}
	if err != nil {
		return "", err
	}
	componentPath := filepath.Join(rootPath, componentID)
	if create {
		return ensureSecureDirectory(componentPath, 0o755)
	}
	return secureExistingDirectory(componentPath)
}

func readActivationState(root, componentID string) (activationState, error) {
	state := emptyActivationState(componentID)
	componentRoot, err := componentActivationRoot(root, componentID, false)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return activationState{}, err
	}
	statePath := filepath.Join(componentRoot, activationStateName)
	info, err := os.Lstat(statePath)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return activationState{}, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return activationState{}, errors.New("runtime component activation-state must be a regular non-symlink file")
	}
	payload, err := readRegular(statePath, maxActivationStateBytes, false)
	if err != nil {
		return activationState{}, err
	}
	if err := decodeStrict(payload, maxActivationStateBytes, &state); err != nil {
		return activationState{}, fmt.Errorf("runtime component activation-state: %w", err)
	}
	if err := validateActivationState(state, componentID); err != nil {
		return activationState{}, err
	}
	return state, nil
}

func syncDirectory(path string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func writeActivationState(root string, state activationState) error {
	if err := validateActivationState(state, state.ComponentID); err != nil {
		return err
	}
	componentRoot, err := componentActivationRoot(root, state.ComponentID, true)
	if err != nil {
		return err
	}
	statePath := filepath.Join(componentRoot, activationStateName)
	if info, statErr := os.Lstat(statePath); statErr == nil {
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("runtime component activation-state target is unsafe")
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return statErr
	}
	payload, err := marshalJSON(state)
	if err != nil {
		return err
	}
	if len(payload) > maxActivationStateBytes {
		return errors.New("runtime component activation-state exceeds size limit")
	}
	temp, err := os.CreateTemp(componentRoot, ".activation-state-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	remove := true
	defer func() {
		_ = temp.Close()
		if remove {
			_ = os.Remove(tempPath)
		}
	}()
	if runtime.GOOS != "windows" {
		if err := temp.Chmod(0o644); err != nil {
			return err
		}
	}
	if _, err := temp.Write(payload); err != nil {
		return err
	}
	if err := temp.Sync(); err != nil {
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, statePath); err != nil {
		return err
	}
	remove = false
	return syncDirectory(componentRoot)
}

func acquireActivationLock(root, componentID string) (func(), error) {
	componentRoot, err := componentActivationRoot(root, componentID, true)
	if err != nil {
		return nil, err
	}
	lockPath := filepath.Join(componentRoot, activationLockName)
	if err := os.Mkdir(lockPath, 0o700); err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, errors.New("runtime component activation mutation is already locked; stale locks require explicit recovery")
		}
		return nil, err
	}
	return func() {
		_ = os.Remove(lockPath)
	}, nil
}

func identityFromRelease(release releaseDescriptor) slotIdentity {
	return slotIdentity{
		Version:      release.Component.Version,
		SourceCommit: release.SourceCommit,
	}
}

func canonicalSlotPath(root, componentID string, identity slotIdentity) (string, error) {
	if !componentPattern.MatchString(componentID) {
		return "", errors.New("runtime component slot component id is invalid")
	}
	if err := validateSlotIdentity(&identity); err != nil {
		return "", err
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	return filepath.Join(
		rootAbs,
		componentID,
		"versions",
		identity.Version,
		identity.SourceCommit,
	), nil
}

func verifyIdentitySlot(root, componentID string, identity slotIdentity, trustBytes []byte) (releaseDescriptor, string, error) {
	slot, err := canonicalSlotPath(root, componentID, identity)
	if err != nil {
		return releaseDescriptor{}, "", err
	}
	release, err := verifyActivationSlotWithTrustBytes(slot, trustBytes)
	if err != nil {
		return releaseDescriptor{}, "", err
	}
	if release.Component.ID != componentID ||
		release.Component.Version != identity.Version ||
		release.SourceCommit != identity.SourceCommit {
		return releaseDescriptor{}, "", errors.New("runtime component activation slot identity mismatch")
	}
	if release.Component.ReleaseMode != "component-slot" {
		return releaseDescriptor{}, "", errors.New("runtime component activation requires release_mode=component-slot")
	}
	return release, slot, nil
}

func verifiedRuntimeManifest(slot string, release releaseDescriptor, trustBytes []byte) (componentPackageManifest, error) {
	verifiedRelease, err := verifyActivationSlotWithTrustBytes(slot, trustBytes)
	if err != nil {
		return componentPackageManifest{}, err
	}
	if verifiedRelease.Component.ID != release.Component.ID ||
		verifiedRelease.Component.Version != release.Component.Version ||
		verifiedRelease.SourceCommit != release.SourceCommit {
		return componentPackageManifest{}, errors.New("runtime component verified slot release identity changed")
	}
	manifestPath := filepath.Join(slot, packageManifestName)
	payload, err := readRegular(manifestPath, maxFileBytes, false)
	if err != nil {
		return componentPackageManifest{}, err
	}
	var manifest componentPackageManifest
	if err := decodeStrict(payload, int(maxFileBytes), &manifest); err != nil {
		return componentPackageManifest{}, fmt.Errorf("runtime component installed manifest: %w", err)
	}
	if err := validatePackageManifest(manifest, verifiedRelease); err != nil {
		return componentPackageManifest{}, err
	}
	return manifest, nil
}

func resolveRuntimeSlot(root, componentID, trustPath, target string) (activationState, string, componentPackageManifest, bool, error) {
	state, err := readActivationState(root, componentID)
	if err != nil {
		return activationState{}, "", componentPackageManifest{}, false, err
	}

	var identity *slotIdentity
	switch target {
	case "current":
		identity = state.Current
		if identity == nil {
			bundledFallback := !state.UserRemoved && canonicalSourceRepository(componentID) == sourceRepository
			return state, "", componentPackageManifest{}, bundledFallback, nil
		}
	case "pending":
		identity = state.Pending
		if identity == nil {
			return activationState{}, "", componentPackageManifest{}, false, errors.New("runtime component has no pending slot")
		}
	default:
		return activationState{}, "", componentPackageManifest{}, false, errors.New("runtime component slot target must be current or pending")
	}

	trustBytes, err := readRegular(trustPath, maxTrustBytes, false)
	if err != nil {
		return activationState{}, "", componentPackageManifest{}, false, err
	}
	release, slot, err := verifyIdentitySlot(root, componentID, *identity, trustBytes)
	if err != nil {
		return activationState{}, "", componentPackageManifest{}, false, err
	}
	manifest, err := verifiedRuntimeManifest(slot, release, trustBytes)
	if err != nil {
		return activationState{}, "", componentPackageManifest{}, false, err
	}
	return state, slot, manifest, false, nil
}

func readVerifiedRuntimeFileExact(
	root, componentID, trustPath, target, requestedPath string,
	expected *slotIdentity,
) ([]byte, error) {
	state, slot, manifest, bundled, err := resolveRuntimeSlot(root, componentID, trustPath, target)
	if err != nil {
		return nil, err
	}
	if bundled {
		return nil, errors.New("runtime component current source is bundled")
	}
	var resolved *slotIdentity
	switch target {
	case "current":
		resolved = state.Current
	case "pending":
		resolved = state.Pending
	default:
		return nil, errors.New("runtime component file state must be current or pending")
	}
	if resolved == nil {
		return nil, errors.New("runtime component file identity is unavailable")
	}
	if expected != nil && !sameSlotIdentity(resolved, expected) {
		return nil, errors.New("runtime component file identity no longer matches requested slot")
	}
	if target == "pending" && state.PendingHealth == "failed" {
		return nil, errors.New("runtime component failed pending slot is not runtime-readable")
	}
	requested, err := safePackagePath(requestedPath)
	if err != nil {
		return nil, err
	}
	if requested == packageManifestName || requested == slotEnvelopeName {
		return nil, errors.New("runtime component metadata files are not runtime-readable")
	}
	var record *packageFile
	for index := range manifest.Files {
		if manifest.Files[index].Path == requested {
			record = &manifest.Files[index]
			break
		}
	}
	if record == nil {
		return nil, errors.New("runtime component requested file is not bound by package manifest")
	}
	filePath := filepath.Join(slot, filepath.FromSlash(requested))
	relative, err := filepath.Rel(slot, filePath)
	if err != nil || relative == ".." || filepath.IsAbs(relative) ||
		len(relative) >= 3 && relative[:3] == ".."+string(os.PathSeparator) {
		return nil, errors.New("runtime component requested file escaped verified slot")
	}
	payload, err := readRegular(filePath, maxFileBytes, false)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(payload)
	if int64(len(payload)) != record.Size || hex.EncodeToString(digest[:]) != record.SHA256 {
		return nil, errors.New("runtime component requested file changed after slot verification")
	}
	return payload, nil
}

func readVerifiedRuntimeFile(root, componentID, trustPath, target, requestedPath string) ([]byte, error) {
	return readVerifiedRuntimeFileExact(root, componentID, trustPath, target, requestedPath, nil)
}

func mutateActivationState(root, componentID string, mutate func(activationState) (activationState, error)) (activationState, error) {
	releaseLock, err := acquireActivationLock(root, componentID)
	if err != nil {
		return activationState{}, err
	}
	defer releaseLock()
	state, err := readActivationState(root, componentID)
	if err != nil {
		return activationState{}, err
	}
	next, err := mutate(state)
	if err != nil {
		return activationState{}, err
	}
	if err := validateActivationState(next, componentID); err != nil {
		return activationState{}, err
	}
	if err := writeActivationState(root, next); err != nil {
		return activationState{}, err
	}
	return next, nil
}

func armPendingState(slot, trustPath, root string) (activationState, error) {
	trustBytes, err := readRegular(trustPath, maxTrustBytes, false)
	if err != nil {
		return activationState{}, err
	}
	release, err := verifyActivationSlotWithTrustBytes(slot, trustBytes)
	if err != nil {
		return activationState{}, err
	}
	if release.Component.ReleaseMode != "component-slot" {
		return activationState{}, errors.New("runtime component activation requires release_mode=component-slot")
	}
	identity := identityFromRelease(release)
	expected, err := canonicalSlotPath(root, release.Component.ID, identity)
	if err != nil {
		return activationState{}, err
	}
	actual, err := filepath.Abs(slot)
	if err != nil {
		return activationState{}, err
	}
	if filepath.Clean(actual) != filepath.Clean(expected) {
		return activationState{}, errors.New("runtime component slot is outside its canonical activation location")
	}

	return mutateActivationState(root, release.Component.ID, func(state activationState) (activationState, error) {
		if sameSlotIdentity(state.Current, &identity) {
			return activationState{}, errors.New("runtime component candidate already matches current slot")
		}
		if sameSlotIdentity(state.Rejected, &identity) {
			return activationState{}, errors.New("runtime component candidate was previously rejected; a new signed identity is required")
		}
		if state.Pending != nil {
			if sameSlotIdentity(state.Pending, &identity) {
				return state, nil
			}
			return activationState{}, errors.New("runtime component already has a different pending slot")
		}
		candidate := identity
		state.Pending = &candidate
		state.PendingHealth = "unknown"
		state.Revision++
		return state, nil
	})
}

func recordPendingHealth(root, componentID string, identity slotIdentity, health string) (activationState, error) {
	return recordPendingHealthAtRevision(root, componentID, identity, health, nil)
}

func recordPendingHealthAtRevision(
	root, componentID string,
	identity slotIdentity,
	health string,
	expectedRevision *int64,
) (activationState, error) {
	if health != "healthy" && health != "failed" {
		return activationState{}, errors.New("runtime component pending health must be healthy or failed")
	}
	if expectedRevision != nil && *expectedRevision <= 0 {
		return activationState{}, errors.New("runtime component probation revision must be positive")
	}
	return mutateActivationState(root, componentID, func(state activationState) (activationState, error) {
		if state.Pending == nil || !sameSlotIdentity(state.Pending, &identity) {
			return activationState{}, errors.New("runtime component health identity does not match pending slot")
		}
		if expectedRevision != nil {
			switch {
			case state.Revision == *expectedRevision:
				// First application of this exact probation receipt.
			case state.Revision > 0 && state.Revision-1 == *expectedRevision && state.PendingHealth == health:
				// Safe idempotent retry: the only accepted change is the same
				// health value for the same still-pending identity.
				return state, nil
			default:
				return activationState{}, errors.New("runtime component health revision no longer matches pending probation receipt")
			}
		}
		if state.PendingHealth == health {
			return state, nil
		}
		if state.PendingHealth == "failed" && health == "healthy" {
			return activationState{}, errors.New("runtime component failed candidate must be rejected before a new health attempt")
		}
		state.PendingHealth = health
		state.Revision++
		return state, nil
	})
}

func validateActionRevision(expectedRevision int64) error {
	if expectedRevision <= 0 {
		return errors.New("runtime component action expected revision must be positive")
	}
	return nil
}

func promotePendingStateAtRevision(
	root,
	componentID string,
	identity slotIdentity,
	expectedRevision int64,
	trustPath string,
) (activationState, error) {
	if err := validateSlotIdentity(&identity); err != nil {
		return activationState{}, err
	}
	if err := validateActionRevision(expectedRevision); err != nil {
		return activationState{}, err
	}
	trustBytes, err := readRegular(trustPath, maxTrustBytes, false)
	if err != nil {
		return activationState{}, err
	}
	return mutateActivationState(root, componentID, func(state activationState) (activationState, error) {
		if state.Revision == expectedRevision+1 &&
			state.Pending == nil &&
			sameSlotIdentity(state.Current, &identity) {
			// Safe idempotent retry of the exact promotion receipt.
			return state, nil
		}
		if state.Revision != expectedRevision {
			return activationState{}, errors.New("runtime component promotion revision is stale")
		}
		if state.Pending == nil || !sameSlotIdentity(state.Pending, &identity) {
			return activationState{}, errors.New("runtime component promotion identity does not match pending slot")
		}
		if state.PendingHealth != "healthy" {
			return activationState{}, errors.New("runtime component pending slot must be healthy before promotion")
		}
		if _, _, err := verifyIdentitySlot(root, componentID, identity, trustBytes); err != nil {
			return activationState{}, err
		}
		promoted := identity
		state.Previous = state.Current
		state.Current = &promoted
		// A verified, explicitly requested install becomes the new current owner.
		state.UserRemoved = false
		state.Pending = nil
		state.Rejected = nil
		state.PendingHealth = "unknown"
		state.Revision++
		return state, nil
	})
}

func rejectPendingStateAtRevision(
	root,
	componentID string,
	identity slotIdentity,
	expectedRevision int64,
) (activationState, error) {
	if err := validateSlotIdentity(&identity); err != nil {
		return activationState{}, err
	}
	if err := validateActionRevision(expectedRevision); err != nil {
		return activationState{}, err
	}
	return mutateActivationState(root, componentID, func(state activationState) (activationState, error) {
		if state.Revision == expectedRevision+1 &&
			state.Pending == nil &&
			sameSlotIdentity(state.Rejected, &identity) {
			// Safe idempotent retry of the exact rejection receipt.
			return state, nil
		}
		if state.Revision != expectedRevision {
			return activationState{}, errors.New("runtime component rejection revision is stale")
		}
		if state.Pending == nil || !sameSlotIdentity(state.Pending, &identity) {
			return activationState{}, errors.New("runtime component reject identity does not match pending slot")
		}
		rejected := identity
		state.Rejected = &rejected
		state.Pending = nil
		state.PendingHealth = "unknown"
		state.Revision++
		return state, nil
	})
}

func rollbackCurrentStateAtRevision(
	root,
	componentID string,
	identity slotIdentity,
	expectedRevision int64,
	trustPath string,
) (activationState, error) {
	if err := validateSlotIdentity(&identity); err != nil {
		return activationState{}, err
	}
	if err := validateActionRevision(expectedRevision); err != nil {
		return activationState{}, err
	}
	trustBytes, err := readRegular(trustPath, maxTrustBytes, false)
	if err != nil {
		return activationState{}, err
	}
	return mutateActivationState(root, componentID, func(state activationState) (activationState, error) {
		if state.Revision == expectedRevision+1 &&
			state.Pending == nil &&
			sameSlotIdentity(state.Rejected, &identity) {
			// Safe idempotent retry of the exact rollback receipt.
			return state, nil
		}
		if state.Revision != expectedRevision {
			return activationState{}, errors.New("runtime component rollback revision is stale")
		}
		if state.Pending != nil {
			return activationState{}, errors.New("runtime component pending slot must be rejected before rollback")
		}
		if state.Current == nil || !sameSlotIdentity(state.Current, &identity) {
			return activationState{}, errors.New("runtime component rollback identity does not match current slot")
		}
		if state.Previous != nil {
			if _, _, err := verifyIdentitySlot(root, componentID, *state.Previous, trustBytes); err != nil {
				return activationState{}, err
			}
		}
		rejected := identity
		if state.Previous == nil {
			state.Current = nil
		} else {
			previous := *state.Previous
			state.Current = &previous
		}
		state.Previous = nil
		state.Rejected = &rejected
		state.PendingHealth = "unknown"
		state.Revision++
		return state, nil
	})
}

func uninstallCurrentStateAtRevision(
	root,
	componentID string,
	identity slotIdentity,
	expectedRevision int64,
	trustPath string,
) (activationState, error) {
	if err := validateSlotIdentity(&identity); err != nil {
		return activationState{}, err
	}
	if err := validateActionRevision(expectedRevision); err != nil {
		return activationState{}, err
	}
	trustBytes, err := readRegular(trustPath, maxTrustBytes, false)
	if err != nil {
		return activationState{}, err
	}
	return mutateActivationState(root, componentID, func(state activationState) (activationState, error) {
		if state.Revision == expectedRevision+1 &&
			state.Current == nil &&
			state.Previous == nil &&
			state.Pending == nil &&
			state.Rejected == nil &&
			state.PendingHealth == "unknown" &&
			state.UserRemoved {
			// Safe idempotent retry after the exact uninstall transition.
			return state, nil
		}
		if state.Revision != expectedRevision {
			return activationState{}, errors.New("runtime component uninstall revision is stale")
		}
		if state.Pending != nil {
			return activationState{}, errors.New("runtime component pending slot must be rejected before uninstall")
		}
		if state.Current == nil || !sameSlotIdentity(state.Current, &identity) {
			return activationState{}, errors.New("runtime component uninstall identity does not match current slot")
		}
		if _, _, err := verifyIdentitySlot(root, componentID, identity, trustBytes); err != nil {
			return activationState{}, err
		}

		state.Current = nil
		state.Previous = nil
		state.Pending = nil
		state.Rejected = nil
		state.PendingHealth = "unknown"
		// Persist with the same atomic activation-state revision as removal.
		state.UserRemoved = true
		state.Revision++
		return state, nil
	})
}

func resolveCurrentState(root, componentID, trustPath string) (activationState, string, bool, error) {
	state, err := readActivationState(root, componentID)
	if err != nil {
		return activationState{}, "", false, err
	}
	if state.Current == nil {
		bundledFallback := !state.UserRemoved && canonicalSourceRepository(componentID) == sourceRepository
		return state, "", bundledFallback, nil
	}
	trustBytes, err := readRegular(trustPath, maxTrustBytes, false)
	if err != nil {
		return activationState{}, "", false, err
	}
	_, slot, err := verifyIdentitySlot(root, componentID, *state.Current, trustBytes)
	if err != nil {
		return activationState{}, "", false, err
	}
	return state, slot, false, nil
}

func printActivationState(state activationState) error {
	payload, err := marshalJSON(state)
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(payload)
	return err
}

func armPendingCommand(args []string) error {
	flags := flag.NewFlagSet("arm-pending", flag.ContinueOnError)
	slot := flags.String("slot", "", "verified runtime component slot")
	trust := flags.String("trust", "", "runtime component public trust")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *slot == "" || *trust == "" || flags.NArg() != 0 {
		return errors.New("arm-pending requires --slot and --trust")
	}
	state, err := armPendingState(*slot, *trust, *root)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_PENDING_ARMED=YES\nCOMPONENT_ID=%s\nREVISION=%d\nPENDING_VERSION=%s\nPENDING_SOURCE_COMMIT=%s\nPENDING_HEALTH=%s\nRUNTIME_ACTIVATED=NO\n",
		state.ComponentID, state.Revision, state.Pending.Version, state.Pending.SourceCommit, state.PendingHealth,
	)
	return nil
}

func recordHealthCommand(args []string) error {
	flags := flag.NewFlagSet("record-health", flag.ContinueOnError)
	component := flags.String("component", "", "runtime component id")
	version := flags.String("version", "", "pending semantic version")
	sourceCommit := flags.String("source-commit", "", "pending source commit")
	expectedRevision := flags.Int64("expected-revision", 0, "exact probation metadata revision")
	health := flags.String("health", "", "healthy or failed")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *component == "" || *version == "" || *sourceCommit == "" || *expectedRevision <= 0 || *health == "" || flags.NArg() != 0 {
		return errors.New("record-health requires --component, --version, --source-commit, --expected-revision and --health")
	}
	state, err := recordPendingHealthAtRevision(
		*root,
		*component,
		slotIdentity{Version: *version, SourceCommit: *sourceCommit},
		*health,
		expectedRevision,
	)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_PENDING_HEALTH_RECORDED=YES\nCOMPONENT_ID=%s\nREVISION=%d\nPENDING_VERSION=%s\nPENDING_SOURCE_COMMIT=%s\nPENDING_HEALTH=%s\nRUNTIME_ACTIVATED=NO\n",
		state.ComponentID, state.Revision, state.Pending.Version, state.Pending.SourceCommit, state.PendingHealth,
	)
	return nil
}

func promoteStateCommand(args []string) error {
	flags := flag.NewFlagSet("promote-state", flag.ContinueOnError)
	component := flags.String("component", "", "runtime component id")
	version := flags.String("version", "", "pending semantic version")
	sourceCommit := flags.String("source-commit", "", "pending source commit")
	expectedRevision := flags.Int64("expected-revision", 0, "exact policy decision revision")
	trust := flags.String("trust", "", "runtime component public trust")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *component == "" || *version == "" || *sourceCommit == "" || *expectedRevision <= 0 || *trust == "" || flags.NArg() != 0 {
		return errors.New("promote-state requires --component, --version, --source-commit, --expected-revision and --trust")
	}
	state, err := promotePendingStateAtRevision(
		*root,
		*component,
		slotIdentity{Version: *version, SourceCommit: *sourceCommit},
		*expectedRevision,
		*trust,
	)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_STATE_PROMOTED=YES\nCOMPONENT_ID=%s\nREVISION=%d\nCURRENT_VERSION=%s\nCURRENT_SOURCE_COMMIT=%s\nRUNTIME_ACTIVATED=NO\n",
		state.ComponentID, state.Revision, state.Current.Version, state.Current.SourceCommit,
	)
	return nil
}

func rejectPendingCommand(args []string) error {
	flags := flag.NewFlagSet("reject-pending", flag.ContinueOnError)
	component := flags.String("component", "", "runtime component id")
	version := flags.String("version", "", "pending semantic version")
	sourceCommit := flags.String("source-commit", "", "pending source commit")
	expectedRevision := flags.Int64("expected-revision", 0, "exact policy decision revision")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *component == "" || *version == "" || *sourceCommit == "" || *expectedRevision <= 0 || flags.NArg() != 0 {
		return errors.New("reject-pending requires --component, --version, --source-commit and --expected-revision")
	}
	state, err := rejectPendingStateAtRevision(
		*root,
		*component,
		slotIdentity{Version: *version, SourceCommit: *sourceCommit},
		*expectedRevision,
	)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_PENDING_REJECTED=YES\nCOMPONENT_ID=%s\nREVISION=%d\nREJECTED_VERSION=%s\nREJECTED_SOURCE_COMMIT=%s\nRUNTIME_ACTIVATED=NO\n",
		state.ComponentID, state.Revision, state.Rejected.Version, state.Rejected.SourceCommit,
	)
	return nil
}

func rollbackStateCommand(args []string) error {
	flags := flag.NewFlagSet("rollback-state", flag.ContinueOnError)
	component := flags.String("component", "", "runtime component id")
	version := flags.String("version", "", "current semantic version")
	sourceCommit := flags.String("source-commit", "", "current source commit")
	expectedRevision := flags.Int64("expected-revision", 0, "exact rollback decision revision")
	trust := flags.String("trust", "", "runtime component public trust")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *component == "" || *version == "" || *sourceCommit == "" || *expectedRevision <= 0 || *trust == "" || flags.NArg() != 0 {
		return errors.New("rollback-state requires --component, --version, --source-commit, --expected-revision and --trust")
	}
	state, err := rollbackCurrentStateAtRevision(
		*root,
		*component,
		slotIdentity{Version: *version, SourceCommit: *sourceCommit},
		*expectedRevision,
		*trust,
	)
	if err != nil {
		return err
	}
	target := "bundled"
	versionOut := ""
	commitOut := ""
	if state.Current != nil {
		target = "slot"
		versionOut = state.Current.Version
		commitOut = state.Current.SourceCommit
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_STATE_ROLLED_BACK=YES\nCOMPONENT_ID=%s\nREVISION=%d\nTARGET=%s\nCURRENT_VERSION=%s\nCURRENT_SOURCE_COMMIT=%s\nRUNTIME_ACTIVATED=NO\n",
		state.ComponentID, state.Revision, target, versionOut, commitOut,
	)
	return nil
}

func uninstallStateCommand(args []string) error {
	flags := flag.NewFlagSet("uninstall-state", flag.ContinueOnError)
	component := flags.String("component", "", "runtime component id")
	version := flags.String("version", "", "current semantic version")
	sourceCommit := flags.String("source-commit", "", "current source commit")
	expectedRevision := flags.Int64("expected-revision", 0, "exact uninstall decision revision")
	trust := flags.String("trust", "", "runtime component public trust")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *component == "" || *version == "" || *sourceCommit == "" || *expectedRevision <= 0 || *trust == "" || flags.NArg() != 0 {
		return errors.New("uninstall-state requires --component, --version, --source-commit, --expected-revision and --trust")
	}
	state, err := uninstallCurrentStateAtRevision(
		*root,
		*component,
		slotIdentity{Version: *version, SourceCommit: *sourceCommit},
		*expectedRevision,
		*trust,
	)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_STATE_UNINSTALLED=YES\nCOMPONENT_ID=%s\nREVISION=%d\nCURRENT_PRESENT=NO\nAPP_DATA_TOUCHED=NO\nSLOT_CACHE_PURGED=NO\n",
		state.ComponentID, state.Revision,
	)
	return nil
}

// This classification is derived exclusively from the canonical activation
// state; a user's removal intent outranks any bundled fallback.
func currentResolutionSource(state activationState, bundled bool) string {
	if state.Current != nil {
		return "SLOT"
	}
	if state.UserRemoved {
		return "REMOVED"
	}
	if bundled {
		return "BUNDLED"
	}
	return "ABSENT"
}

func resolveCurrentCommand(args []string) error {
	flags := flag.NewFlagSet("resolve-current", flag.ContinueOnError)
	component := flags.String("component", "", "runtime component id")
	trust := flags.String("trust", "", "runtime component public trust")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *component == "" || *trust == "" || flags.NArg() != 0 {
		return errors.New("resolve-current requires --component and --trust")
	}
	state, slot, manifest, bundled, err := resolveRuntimeSlot(*root, *component, *trust, "current")
	if err != nil {
		return err
	}
	if state.Current == nil {
		source := currentResolutionSource(state, bundled)
		fmt.Printf(
			"RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\nCOMPONENT_ID=%s\nREVISION=%d\nSOURCE=%s\nRUNTIME_SERVED_FROM_SLOT=NO\n",
			state.ComponentID, state.Revision, source,
		)
		return nil
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\nCOMPONENT_ID=%s\nREVISION=%d\nSOURCE=SLOT\nCURRENT_VERSION=%s\nCURRENT_SOURCE_COMMIT=%s\nSLOT=%s\nENTRYPOINT=%s\nRUNTIME_SERVED_FROM_SLOT=NO\n",
		state.ComponentID, state.Revision, state.Current.Version, state.Current.SourceCommit, slot, manifest.Entrypoint,
	)
	return nil
}

func resolvePendingCommand(args []string) error {
	flags := flag.NewFlagSet("resolve-pending", flag.ContinueOnError)
	component := flags.String("component", "", "runtime component id")
	trust := flags.String("trust", "", "runtime component public trust")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *component == "" || *trust == "" || flags.NArg() != 0 {
		return errors.New("resolve-pending requires --component and --trust")
	}
	state, slot, manifest, _, err := resolveRuntimeSlot(*root, *component, *trust, "pending")
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_PENDING_RESOLVED=YES\nCOMPONENT_ID=%s\nREVISION=%d\nSOURCE=SLOT\nPENDING_VERSION=%s\nPENDING_SOURCE_COMMIT=%s\nPENDING_HEALTH=%s\nSLOT=%s\nENTRYPOINT=%s\nRUNTIME_SERVED_FROM_SLOT=NO\n",
		state.ComponentID, state.Revision, state.Pending.Version, state.Pending.SourceCommit, state.PendingHealth, slot, manifest.Entrypoint,
	)
	return nil
}

func readRuntimeFileCommand(args []string) error {
	flags := flag.NewFlagSet("read-runtime-file", flag.ContinueOnError)
	component := flags.String("component", "", "runtime component id")
	trust := flags.String("trust", "", "runtime component public trust")
	target := flags.String("state", "", "current or pending slot")
	version := flags.String("version", "", "exact runtime component semantic version")
	sourceCommit := flags.String("source-commit", "", "exact runtime component source commit")
	requestedPath := flags.String("path", "", "package-relative runtime file path")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *component == "" || *trust == "" || *target == "" || *version == "" || *sourceCommit == "" || *requestedPath == "" || flags.NArg() != 0 {
		return errors.New("read-runtime-file requires --component, --trust, --state, --version, --source-commit and --path")
	}
	expected := slotIdentity{Version: *version, SourceCommit: *sourceCommit}
	if err := validateSlotIdentity(&expected); err != nil {
		return err
	}
	payload, err := readVerifiedRuntimeFileExact(
		*root,
		*component,
		*trust,
		*target,
		*requestedPath,
		&expected,
	)
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(payload)
	return err
}

func activationStatusCommand(args []string) error {
	flags := flag.NewFlagSet("status", flag.ContinueOnError)
	component := flags.String("component", "", "runtime component id")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *component == "" || flags.NArg() != 0 {
		return errors.New("status requires --component")
	}
	state, err := readActivationState(*root, *component)
	if err != nil {
		return err
	}
	return printActivationState(state)
}
