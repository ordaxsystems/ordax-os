package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

func sharedReleaseFromV2(release releaseDescriptorV2) releaseDescriptor {
	return releaseDescriptor{
		Schema:            releaseSchema,
		SourceRepository:  release.SourceRepository,
		SourceCommit:      release.SourceCommit,
		CreatedFromRecipe: release.CreatedFromRecipe,
		Component:         release.Component,
		Package:           release.Package,
		Activation:        release.Activation,
	}
}

func inspectPackageV2(packagePath string, release releaseDescriptorV2) (verifiedPackage, error) {
	return inspectPackage(packagePath, sharedReleaseFromV2(release))
}

func materializeSlotV2(
	tempDir string,
	verified verifiedPackage,
	envelopeBytes []byte,
	compatibilityName string,
	compatibilityBytes []byte,
) error {
	if err := materializeSlot(tempDir, verified, envelopeBytes); err != nil {
		return err
	}
	if filepath.Base(compatibilityName) != compatibilityName {
		return errors.New("runtime component compatibility slot filename is unsafe")
	}
	return writeFileSynced(
		filepath.Join(tempDir, compatibilityName),
		compatibilityBytes,
		0o644,
	)
}

func verifySlotV2WithTrustBytes(slot string, trustBytes []byte) (releaseDescriptorV2, error) {
	absolute, err := filepath.Abs(slot)
	if err != nil {
		return releaseDescriptorV2{}, err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return releaseDescriptorV2{}, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return releaseDescriptorV2{}, errors.New("runtime component release/2 slot is not a real directory")
	}

	envelopePath := filepath.Join(absolute, slotEnvelopeName)
	envelopeBytes, err := readRegular(envelopePath, maxEnvelopeBytes, false)
	if err != nil {
		return releaseDescriptorV2{}, err
	}
	signedPayload, err := verifyEnvelopeSignaturePayload(envelopeBytes, trustBytes)
	if err != nil {
		return releaseDescriptorV2{}, err
	}
	var release releaseDescriptorV2
	if err := decodeStrict(signedPayload, maxReleaseBytes, &release); err != nil {
		return releaseDescriptorV2{}, fmt.Errorf("installed signed runtime component release/2: %w", err)
	}
	if err := validateReleaseDescriptorV2(release); err != nil {
		return releaseDescriptorV2{}, err
	}

	compatibilityPath := filepath.Join(absolute, release.Compatibility.Name)
	compatibilityBytes, err := readRegular(compatibilityPath, maxCompatibilityBytes, false)
	if err != nil {
		return releaseDescriptorV2{}, fmt.Errorf("installed runtime component compatibility: %w", err)
	}
	if err := validateCompatibilityBytes(
		release,
		release.Compatibility.Name,
		compatibilityBytes,
	); err != nil {
		return releaseDescriptorV2{}, err
	}

	manifestPath := filepath.Join(absolute, packageManifestName)
	manifestBytes, err := readRegular(manifestPath, maxReleaseBytes, false)
	if err != nil {
		return releaseDescriptorV2{}, err
	}
	manifestDigest := sha256.Sum256(manifestBytes)
	if hex.EncodeToString(manifestDigest[:]) != release.Package.ManifestSHA256 {
		return releaseDescriptorV2{}, errors.New("installed runtime component manifest changed after release/2 staging")
	}
	var manifest componentPackageManifest
	if err := decodeStrict(manifestBytes, maxReleaseBytes, &manifest); err != nil {
		return releaseDescriptorV2{}, err
	}
	if err := validatePackageManifest(manifest, sharedReleaseFromV2(release)); err != nil {
		return releaseDescriptorV2{}, err
	}

	expected := map[string]struct{}{
		packageManifestName:        {},
		slotEnvelopeName:           {},
		release.Compatibility.Name: {},
	}
	for _, record := range manifest.Files {
		expected[record.Path] = struct{}{}
	}

	actual := map[string]struct{}{}
	err = filepath.WalkDir(absolute, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == absolute {
			return nil
		}
		entryInfo, err := entry.Info()
		if err != nil {
			return err
		}
		if entryInfo.Mode()&os.ModeSymlink != 0 {
			return errors.New("installed runtime component release/2 slot contains a symlink")
		}
		if entry.IsDir() {
			return nil
		}
		if !entryInfo.Mode().IsRegular() {
			return errors.New("installed runtime component release/2 slot contains unsafe entry type")
		}
		if runtime.GOOS != "windows" && entryInfo.Mode().Perm()&0o222 != 0 {
			return fmt.Errorf("installed runtime component release/2 file is writable: %s", path)
		}
		relative, err := filepath.Rel(absolute, path)
		if err != nil {
			return err
		}
		actual[filepath.ToSlash(relative)] = struct{}{}
		return nil
	})
	if err != nil {
		return releaseDescriptorV2{}, err
	}
	if len(actual) != len(expected) {
		return releaseDescriptorV2{}, errors.New("installed runtime component release/2 slot file set is not canonical")
	}
	for name := range actual {
		if _, ok := expected[name]; !ok {
			return releaseDescriptorV2{}, fmt.Errorf("installed runtime component release/2 slot contains unexpected file: %s", name)
		}
	}
	for name := range expected {
		if _, ok := actual[name]; !ok {
			return releaseDescriptorV2{}, fmt.Errorf("installed runtime component release/2 slot is missing required file: %s", name)
		}
	}
	for _, record := range manifest.Files {
		payload, err := readRegular(
			filepath.Join(absolute, filepath.FromSlash(record.Path)),
			maxFileBytes,
			false,
		)
		if err != nil {
			return releaseDescriptorV2{}, err
		}
		digest := sha256.Sum256(payload)
		if int64(len(payload)) != record.Size || hex.EncodeToString(digest[:]) != record.SHA256 {
			return releaseDescriptorV2{}, fmt.Errorf("installed runtime component release/2 file integrity mismatch: %s", record.Path)
		}
	}
	return release, nil
}

func sameReleaseV2(left, right releaseDescriptorV2) bool {
	return left == right
}

func stageComponentV2(
	envelopePath string,
	trustPath string,
	packagePath string,
	compatibilityPath string,
	root string,
) (releaseDescriptorV2, string, bool, error) {
	release, envelopeBytes, trustBytes, compatibilityBytes, err := verifyEnvelopeV2Files(
		envelopePath,
		trustPath,
		compatibilityPath,
	)
	if err != nil {
		return releaseDescriptorV2{}, "", false, err
	}
	verified, err := inspectPackageV2(packagePath, release)
	if err != nil {
		return releaseDescriptorV2{}, "", false, err
	}

	slotRoot, err := ensureSecureDirectory(root, 0o755)
	if err != nil {
		return releaseDescriptorV2{}, "", false, err
	}
	componentRoot, err := ensureSecureDirectory(filepath.Join(slotRoot, release.Component.ID), 0o755)
	if err != nil {
		return releaseDescriptorV2{}, "", false, err
	}
	versionsRoot, err := ensureSecureDirectory(filepath.Join(componentRoot, "versions"), 0o755)
	if err != nil {
		return releaseDescriptorV2{}, "", false, err
	}
	versionRoot, err := ensureSecureDirectory(filepath.Join(versionsRoot, release.Component.Version), 0o755)
	if err != nil {
		return releaseDescriptorV2{}, "", false, err
	}
	finalDir := filepath.Join(versionRoot, release.SourceCommit)
	if info, err := os.Lstat(finalDir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return releaseDescriptorV2{}, "", false, errors.New("existing runtime component release/2 slot is unsafe")
		}
		existing, verifyErr := verifySlotV2WithTrustBytes(finalDir, trustBytes)
		if verifyErr != nil {
			return releaseDescriptorV2{}, "", false, fmt.Errorf(
				"existing runtime component slot is not the exact verified release/2 candidate: %w",
				verifyErr,
			)
		}
		if !sameReleaseV2(existing, release) {
			return releaseDescriptorV2{}, "", false, errors.New("existing runtime component release/2 slot binding conflicts with signed candidate")
		}
		return release, finalDir, false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return releaseDescriptorV2{}, "", false, err
	}

	tempDir, err := os.MkdirTemp(versionRoot, ".slot-v2-stage-*")
	if err != nil {
		return releaseDescriptorV2{}, "", false, err
	}
	remove := true
	defer func() {
		if remove {
			removeStagingTree(tempDir)
		}
	}()

	if err := materializeSlotV2(
		tempDir,
		verified,
		envelopeBytes,
		release.Compatibility.Name,
		compatibilityBytes,
	); err != nil {
		return releaseDescriptorV2{}, "", false, err
	}
	if err := makeSlotReadOnly(tempDir); err != nil {
		return releaseDescriptorV2{}, "", false, err
	}
	staged, err := verifySlotV2WithTrustBytes(tempDir, trustBytes)
	if err != nil {
		return releaseDescriptorV2{}, "", false, fmt.Errorf("staged runtime component release/2 verification failed: %w", err)
	}
	if !sameReleaseV2(staged, release) {
		return releaseDescriptorV2{}, "", false, errors.New("staged runtime component release/2 identity changed before commit")
	}
	if err := os.Rename(tempDir, finalDir); err != nil {
		return releaseDescriptorV2{}, "", false, err
	}
	remove = false
	finalRelease, err := verifySlotV2WithTrustBytes(finalDir, trustBytes)
	if err != nil {
		return releaseDescriptorV2{}, "", false, fmt.Errorf("final runtime component release/2 slot verification failed: %w", err)
	}
	if !sameReleaseV2(finalRelease, release) {
		return releaseDescriptorV2{}, "", false, errors.New("final runtime component release/2 slot identity changed after commit")
	}
	return release, finalDir, true, nil
}
