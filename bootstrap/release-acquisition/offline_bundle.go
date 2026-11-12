package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// localReleaseBundle is a transport of signed bytes, not a release authority.
// The HTTPS URLs stay in the signed manifest for provenance; when an offline
// bundle is selected they must never be requested over the network.
type localReleaseBundle struct {
	directory string
	envelope  []byte
}

func acquisitionClient(bundle *localReleaseBundle) *http.Client {
	if bundle != nil {
		// A missing offline file must fail, never silently fetch from HTTPS.
		return nil
	}
	return secureClient()
}

func checkRealLocalDirectory(directory string) error {
	for path := directory; ; path = filepath.Dir(path) {
		info, err := os.Lstat(path)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("offline bundle ancestor is not a real directory: %s", path)
		}
		if next := filepath.Dir(path); next == path {
			return nil
		}
	}
}

// checkOfflineDestinationAncestors refuses aliases and non-directory parents
// before the signed source is read. An output reached through a symlink may
// resolve *inside* the bundle despite passing the lexical disjointness test.
// Missing suffixes are valid because the canonical writer creates them later.
func checkOfflineDestinationAncestors(destination string) error {
	for path := destination; ; path = filepath.Dir(path) {
		info, err := os.Lstat(path)
		if err == nil {
			if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("offline destination ancestor is not a real directory: %s", path)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("inspect offline destination ancestor %s: %w", path, err)
		}
		if parent := filepath.Dir(path); parent == path {
			return nil
		}
	}
}

func localDirectoryContains(parent, candidate string) bool {
	relative, err := filepath.Rel(parent, candidate)
	return err == nil && (relative == "." || relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}

func (bundle *localReleaseBundle) openRegular(name string, maxSize int64) (*os.File, int64, error) {
	if name != "release-envelope.json" && (!namePattern.MatchString(name) || filepath.Base(name) != name) {
		return nil, 0, errors.New("offline artifact name is not a canonical filename")
	}
	if err := checkRealLocalDirectory(bundle.directory); err != nil {
		return nil, 0, err
	}
	path := filepath.Join(bundle.directory, name)
	info, err := os.Lstat(path)
	if err != nil {
		return nil, 0, fmt.Errorf("offline source %s: %w", name, err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() <= 0 || info.Size() > maxSize {
		return nil, 0, fmt.Errorf("offline source %s must be a bounded non-symlink regular file", name)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, 0, fmt.Errorf("offline source %s: %w", name, err)
	}
	opened, statErr := file.Stat()
	if statErr != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) || opened.Size() != info.Size() {
		file.Close()
		return nil, 0, fmt.Errorf("offline source %s changed while opening", name)
	}
	return file, info.Size(), nil
}

func (bundle *localReleaseBundle) verifySourceArtifact(artifact Artifact) error {
	file, size, err := bundle.openRegular(artifact.Name, artifact.Size)
	if err != nil {
		return err
	}
	defer file.Close()
	if size != artifact.Size {
		return fmt.Errorf("offline artifact size mismatch: %s", artifact.Name)
	}
	hash := sha256.New()
	count, err := io.Copy(hash, io.LimitReader(file, artifact.Size+1))
	if err != nil {
		return fmt.Errorf("offline artifact read failure: %w", err)
	}
	if count != artifact.Size || hex.EncodeToString(hash.Sum(nil)) != artifact.SHA256 {
		return fmt.Errorf("offline artifact digest/size mismatch: %s", artifact.Name)
	}
	return nil
}

func (bundle *localReleaseBundle) copyArtifact(artifact Artifact, destination string) error {
	file, size, err := bundle.openRegular(artifact.Name, artifact.Size)
	if err != nil {
		return err
	}
	defer file.Close()
	if size != artifact.Size {
		return fmt.Errorf("offline artifact size mismatch: %s", artifact.Name)
	}
	return writeVerifiedArtifact(file, artifact, destination)
}

func readAcquisitionEnvelope(client *http.Client, envelopeURL string, local ...*localReleaseBundle) ([]byte, error) {
	if len(local) != 0 && local[0] != nil {
		return append([]byte(nil), local[0].envelope...), nil
	}
	return fetchBytes(client, envelopeURL, maxEnvelope)
}

// prepareLocalBundle preflights all signed bytes *before* any release-stage
// directory is created. Transport roots must be disjoint to prevent the
// destination staging/cleanup path from modifying the offline input.
func prepareLocalBundle(directory, envelopeURL, root string, trust TrustAnchor, key ed25519.PublicKey, repo, expectedCommit, schema string) (*localReleaseBundle, error) {
	if (directory == "") == (envelopeURL == "") {
		return nil, errors.New("exactly one of --local-bundle or --envelope-url is required")
	}
	if directory == "" {
		return nil, nil
	}
	if !filepath.IsAbs(directory) {
		return nil, errors.New("--local-bundle must be an absolute directory")
	}
	source, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	destination, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if localDirectoryContains(source, destination) || localDirectoryContains(destination, source) {
		return nil, errors.New("offline bundle and destination must be disjoint directories")
	}
	if err := checkRealLocalDirectory(source); err != nil {
		return nil, err
	}
	if err := checkOfflineDestinationAncestors(destination); err != nil {
		return nil, err
	}
	bundle := &localReleaseBundle{directory: source}
	file, _, err := bundle.openRegular("release-envelope.json", maxEnvelope)
	if err != nil {
		return nil, err
	}
	envelope, readErr := io.ReadAll(io.LimitReader(file, maxEnvelope+1))
	closeErr := file.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if int64(len(envelope)) > maxEnvelope {
		return nil, errors.New("offline envelope exceeds maximum size")
	}
	manifest, _, err := verifyEnvelope(envelope, trust, key, repo)
	if err != nil {
		return nil, err
	}
	if manifest.Schema != schema {
		return nil, errors.New("offline release schema does not match the selected materializer")
	}
	if !commitPattern.MatchString(expectedCommit) || manifest.SourceCommit != expectedCommit {
		return nil, errors.New("offline signed source commit does not match expected commit")
	}
	for _, artifact := range manifest.Artifacts {
		if err := bundle.verifySourceArtifact(artifact); err != nil {
			return nil, err
		}
	}
	bundle.envelope = envelope
	return bundle, nil
}
