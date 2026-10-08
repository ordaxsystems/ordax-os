package physicalchannel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	PortablePayloadSchema      = "prototype-ordax.creator-portable-payload/1"
	portablePayloadDirectory   = "portable-sources"
	portablePayloadReceiptName = "portable-payload.json"
	maxPortablePayloadArtifact = int64(16 << 30)
	maxPortablePayloadTotal    = int64(32 << 30)
)

type PortablePayloadArtifactBinding struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"size_bytes"`
}

type PortablePayloadManifest struct {
	Schema              string                           `json:"$schema"`
	ReleaseSourceCommit string                           `json:"release_source_commit"`
	Artifacts           []PortablePayloadArtifactBinding `json:"artifacts"`
}

var portablePayloadArtifactIDs = map[string]struct{}{
	"systemd-boot": {},
	"loader-config": {},
	"loader-normal": {},
	"loader-recovery": {},
	"kernel": {},
	"initramfs": {},
	"bootstrap-capsule": {},
	"release-trust": {},
	"stable-base": {},
	"persistent-state": {},
	"system-image": {},
	"surface-runtime-image": {},
	"surface-runtime-ref": {},
	"local-ai-runtime-image": {},
	"local-ai-runtime-ref": {},
	"release-manifest": {},
	"release-envelope": {},
}

func validPortablePayloadURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil ||
		parsed.Scheme != "https" ||
		parsed.Host != "github.com" ||
		parsed.User != nil ||
		parsed.Fragment != "" ||
		parsed.RawQuery != "" {
		return errors.New("Portable payload URL must be canonical HTTPS github.com URL")
	}
	const prefix = "/ordaxsystems/ordax-os/releases/download/"
	if !strings.HasPrefix(parsed.Path, prefix) {
		return errors.New("Portable payload URL must stay inside the OrdaX release namespace")
	}
	return nil
}

func validatePortablePayloadManifest(payload PortablePayloadManifest) error {
	if payload.Schema != PortablePayloadSchema {
		return errors.New("unsupported Portable payload schema")
	}
	if !commitPattern.MatchString(payload.ReleaseSourceCommit) {
		return errors.New("Portable payload release_source_commit must be lowercase 40-hex")
	}
	if len(payload.Artifacts) != len(portablePayloadArtifactIDs) {
		return fmt.Errorf("Portable payload requires exactly %d artifacts", len(portablePayloadArtifactIDs))
	}
	seen := make(map[string]struct{}, len(payload.Artifacts))
	var total int64
	for _, artifact := range payload.Artifacts {
		if _, ok := portablePayloadArtifactIDs[artifact.ID]; !ok {
			return fmt.Errorf("unexpected Portable payload artifact %q", artifact.ID)
		}
		if _, duplicate := seen[artifact.ID]; duplicate {
			return fmt.Errorf("duplicate Portable payload artifact %q", artifact.ID)
		}
		seen[artifact.ID] = struct{}{}
		if !shaPattern.MatchString(artifact.SHA256) {
			return fmt.Errorf("Portable payload artifact %q has invalid SHA-256", artifact.ID)
		}
		if artifact.SizeBytes <= 0 || artifact.SizeBytes > maxPortablePayloadArtifact {
			return fmt.Errorf("Portable payload artifact %q size is outside allowed range", artifact.ID)
		}
		if total > maxPortablePayloadTotal-artifact.SizeBytes {
			return errors.New("Portable payload total size exceeds allowed range")
		}
		total += artifact.SizeBytes
		if err := validPortablePayloadURL(artifact.URL); err != nil {
			return fmt.Errorf("Portable payload artifact %q URL: %w", artifact.ID, err)
		}
	}
	return nil
}

func canonicalPortablePayloadBytes(payload PortablePayloadManifest) ([]byte, error) {
	if err := validatePortablePayloadManifest(payload); err != nil {
		return nil, err
	}
	normalized := payload
	normalized.Artifacts = append([]PortablePayloadArtifactBinding(nil), payload.Artifacts...)
	sort.Slice(normalized.Artifacts, func(i, j int) bool {
		return normalized.Artifacts[i].ID < normalized.Artifacts[j].ID
	})
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode Portable payload receipt: %w", err)
	}
	return append(data, '\n'), nil
}

func downloadPortablePayloadArtifact(client *http.Client, binding PortablePayloadArtifactBinding, destination string) error {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Minute}
	}
	req, err := http.NewRequest(http.MethodGet, binding.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Portable-Payload/1")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d while downloading Portable payload artifact %s", resp.StatusCode, binding.ID)
	}

	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		_ = file.Close()
		if remove {
			_ = os.Remove(destination)
		}
	}()

	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, digest), io.LimitReader(resp.Body, binding.SizeBytes+1))
	if err != nil {
		return err
	}
	if written != binding.SizeBytes {
		return fmt.Errorf(
			"Portable payload artifact %s size mismatch: expected=%d actual=%d",
			binding.ID,
			binding.SizeBytes,
			written,
		)
	}
	if hex.EncodeToString(digest.Sum(nil)) != binding.SHA256 {
		return fmt.Errorf("Portable payload artifact %s SHA-256 mismatch", binding.ID)
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	remove = false
	return nil
}

func installPortablePayload(client *http.Client, directory string, manifest Manifest) error {
	if manifest.Schema == ManifestSchema {
		return nil
	}
	if manifest.PortablePayload == nil {
		return errors.New("signed Portable payload metadata is unavailable")
	}
	payload := *manifest.PortablePayload
	if err := validatePortablePayloadManifest(payload); err != nil {
		return err
	}

	sourceRoot := filepath.Join(directory, portablePayloadDirectory)
	if err := os.Mkdir(sourceRoot, 0o700); err != nil {
		return err
	}
	for _, artifact := range payload.Artifacts {
		if err := downloadPortablePayloadArtifact(
			client,
			artifact,
			filepath.Join(sourceRoot, artifact.ID),
		); err != nil {
			return err
		}
	}
	receipt, err := canonicalPortablePayloadBytes(payload)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(directory, portablePayloadReceiptName), receipt, 0o600); err != nil {
		return err
	}
	return nil
}

func verifyPortablePayloadInstalled(directory string, manifest Manifest) error {
	if manifest.Schema == ManifestSchema {
		return nil
	}
	if manifest.PortablePayload == nil {
		return errors.New("signed Portable payload metadata is unavailable")
	}
	payload := *manifest.PortablePayload
	expectedReceipt, err := canonicalPortablePayloadBytes(payload)
	if err != nil {
		return err
	}
	receiptPath := filepath.Join(directory, portablePayloadReceiptName)
	info, err := os.Lstat(receiptPath)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("Portable payload receipt is not a regular non-symlink file")
	}
	actualReceipt, err := os.ReadFile(receiptPath)
	if err != nil {
		return err
	}
	if !bytes.Equal(actualReceipt, expectedReceipt) {
		return errors.New("Portable payload receipt differs from signed physical manifest")
	}

	sourceRoot := filepath.Join(directory, portablePayloadDirectory)
	info, err = os.Lstat(sourceRoot)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("Portable payload source directory is unavailable or unsafe")
	}
	for _, artifact := range payload.Artifacts {
		actualHash, actualSize, err := fileDigest(filepath.Join(sourceRoot, artifact.ID))
		if err != nil {
			return fmt.Errorf("verify Portable payload %s: %w", artifact.ID, err)
		}
		if actualSize != artifact.SizeBytes || actualHash != artifact.SHA256 {
			return fmt.Errorf("bound Portable payload artifact changed: %s", artifact.ID)
		}
	}
	return nil
}

func PortablePayloadSourcePath(directory, artifactID string) (string, error) {
	if _, ok := portablePayloadArtifactIDs[artifactID]; !ok {
		return "", fmt.Errorf("unknown Portable payload artifact %q", artifactID)
	}
	root := filepath.Join(directory, portablePayloadDirectory)
	path := filepath.Join(root, artifactID)
	if !samePath(filepath.Dir(path), root) {
		return "", errors.New("Portable payload source escaped canonical directory")
	}
	return path, nil
}
