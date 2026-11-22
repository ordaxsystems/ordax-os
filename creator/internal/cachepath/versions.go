// Package cachepath defines the Creator's shared verified cache-directory
// boundary. It owns no release, signature, artifact, or authorization policy.
package cachepath

import (
	"errors"
	"os"
	"path/filepath"
)

// validateRoot refuses a redirected cache root before readers follow it or
// installers create children under it. The versions entry is checked separately.
func validateRoot(root string) error {
	info, err := os.Lstat(root)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("Creator cache root must be a real directory")
	}
	return nil
}

// Versions returns the existing versions directory only when both the cache
// root and its versions entry are real directories, not symlinks or files.
func Versions(root string) (string, error) {
	if err := validateRoot(root); err != nil {
		return "", err
	}
	dir := filepath.Join(root, "versions")
	info, err := os.Lstat(dir)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("Creator versions cache must be a real directory")
	}
	return dir, nil
}

// EnsureVersions creates the versions cache when absent, then enforces the
// same boundary used by the offline readers. MkdirAll alone is insufficient:
// it succeeds if an existing versions path is a symlink to a directory.
func EnsureVersions(root string) (string, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", err
	}
	// Do not create versions through a symlinked cache root.
	if err := validateRoot(root); err != nil {
		return "", err
	}
	dir := filepath.Join(root, "versions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return Versions(root)
}
