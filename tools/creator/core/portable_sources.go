package creatorcore

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
)

type PortableVerifiedSource struct {
	ArtifactID string
	Path       string
	SHA256     string
	SizeBytes  uint64
}

func validatePortableSourceBindings(bindings PortableMediaBindings) (map[string]PortableMediaArtifactBinding, error) {
	if bindings.Schema != PortableMediaBindingsSchema {
		return nil, errors.New("portable source verification requires canonical bindings schema")
	}
	if len(bindings.Artifacts) != len(portableMediaTargets) {
		return nil, fmt.Errorf(
			"portable source verification requires exactly %d artifact bindings; got=%d",
			len(portableMediaTargets),
			len(bindings.Artifacts),
		)
	}
	byID := make(map[string]PortableMediaArtifactBinding, len(bindings.Artifacts))
	for _, binding := range bindings.Artifacts {
		if _, ok := portableMediaTargets[binding.ID]; !ok {
			return nil, fmt.Errorf("unknown portable source artifact id %q", binding.ID)
		}
		if _, duplicate := byID[binding.ID]; duplicate {
			return nil, fmt.Errorf("duplicate portable source artifact id %q", binding.ID)
		}
		if !validPortableMediaSHA256(binding.SHA256) {
			return nil, fmt.Errorf("portable source artifact %q has invalid SHA-256", binding.ID)
		}
		if binding.SizeBytes == 0 || binding.SizeBytes > portableMediaMaxArtifact {
			return nil, fmt.Errorf("portable source artifact %q size is outside allowed range", binding.ID)
		}
		byID[binding.ID] = binding
	}
	for id := range portableMediaTargets {
		if _, ok := byID[id]; !ok {
			return nil, fmt.Errorf("missing portable source artifact id %q", id)
		}
	}
	return byID, nil
}

func verifyPortableSourceFile(path string, binding PortableMediaArtifactBinding) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("source must be a regular non-symlink file")
	}
	if info.Size() < 0 || uint64(info.Size()) != binding.SizeBytes {
		return fmt.Errorf("source size mismatch: expected=%d actual=%d", binding.SizeBytes, info.Size())
	}

	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	opened, err := file.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(info, opened) || !opened.Mode().IsRegular() {
		return errors.New("source identity changed while opening")
	}

	digest := sha256.New()
	read, err := io.CopyN(digest, file, int64(binding.SizeBytes))
	if err != nil {
		return fmt.Errorf("read exact source bytes: %w", err)
	}
	if uint64(read) != binding.SizeBytes {
		return fmt.Errorf("source read size mismatch: expected=%d actual=%d", binding.SizeBytes, read)
	}
	var extra [1]byte
	n, extraErr := file.Read(extra[:])
	if n != 0 || (extraErr != nil && !errors.Is(extraErr, io.EOF)) {
		return errors.New("source grew while verifying")
	}
	if actual := hex.EncodeToString(digest.Sum(nil)); actual != binding.SHA256 {
		return fmt.Errorf("source SHA-256 mismatch: expected=%s actual=%s", binding.SHA256, actual)
	}
	return nil
}

// VerifyPortableSources validates a complete prebuilt Portable source set without
// touching a physical device. The directory is deliberately flat and accepts
// exactly the 17 canonical artifact IDs as file names. The elevated Windows
// writer independently reopens, locks and revalidates these sources during
// apply; this preflight is not destructive authorization.
func VerifyPortableSources(bindings PortableMediaBindings, sourcesRoot string) ([]PortableVerifiedSource, error) {
	byID, err := validatePortableSourceBindings(bindings)
	if err != nil {
		return nil, err
	}
	if sourcesRoot == "" {
		return nil, errors.New("portable sources root is required")
	}
	root, err := filepath.Abs(sourcesRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve portable sources root: %w", err)
	}
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return nil, fmt.Errorf("inspect portable sources root: %w", err)
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("portable sources root must be a real directory")
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("list portable sources root: %w", err)
	}
	if len(entries) != len(portableMediaTargets) {
		return nil, fmt.Errorf(
			"portable sources root must contain exactly %d files; got=%d",
			len(portableMediaTargets),
			len(entries),
		)
	}
	for _, entry := range entries {
		if _, ok := byID[entry.Name()]; !ok {
			return nil, fmt.Errorf("unexpected file in portable sources root: %q", entry.Name())
		}
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("portable source %q is not a regular file", entry.Name())
		}
	}

	ids := make([]string, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	verified := make([]PortableVerifiedSource, 0, len(ids))
	for _, id := range ids {
		binding := byID[id]
		path := filepath.Join(root, id)
		if err := verifyPortableSourceFile(path, binding); err != nil {
			return nil, fmt.Errorf("verify portable source %q: %w", id, err)
		}
		verified = append(verified, PortableVerifiedSource{
			ArtifactID: id,
			Path:       path,
			SHA256:     binding.SHA256,
			SizeBytes:  binding.SizeBytes,
		})
	}
	return verified, nil
}
