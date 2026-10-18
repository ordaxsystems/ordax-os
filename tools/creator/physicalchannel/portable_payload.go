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

	creatorcore "github.com/ordaxsystems/ordax-os/tools/creator/core"
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

func validPortablePayloadURL(raw, releaseSourceCommit string) error {
	parsed, err := url.Parse(raw)
	if err != nil ||
		parsed.Scheme != "https" ||
		parsed.Host != "github.com" ||
		parsed.User != nil ||
		parsed.Fragment != "" ||
		parsed.RawQuery != "" ||
		parsed.ForceQuery ||
		parsed.EscapedPath() != parsed.Path {
		return errors.New("Portable payload URL must be canonical HTTPS github.com URL")
	}
	// The release source commit, not merely the repository namespace, owns
	// the 17 signed sources. Reject cross-version or nested release paths.
	prefix := "/ordaxsystems/ordax-os/releases/download/ordax-stable-v4-" + releaseSourceCommit + "/"
	if !strings.HasPrefix(parsed.Path, prefix) {
		return errors.New("Portable payload URL differs from the signed release source commit")
	}
	asset := strings.TrimPrefix(parsed.Path, prefix)
	if asset == "" || asset == "." || asset == ".." || strings.Contains(asset, "/") {
		return errors.New("Portable payload URL requires one release asset filename")
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
		if err := validPortablePayloadURL(artifact.URL, payload.ReleaseSourceCommit); err != nil {
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

// reusePortablePayloadArtifact reuses exact signed bytes from an earlier verified
// version. No independent source catalog or mutable shared cache is introduced:
// the signed binding still controls identity, size and digest on every use.
// Corrupt, missing or unsafe old files are ignored; a changed file during copying
// fails closed rather than silently downgrading the trust boundary.
func reusePortablePayloadArtifact(versionsRoot string, binding PortablePayloadArtifactBinding, destination string) (bool, error) {
	rootInfo, err := os.Lstat(versionsRoot)
	if err != nil {
		return false, err
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return false, errors.New("Portable version cache root is not a regular directory")
	}
	versions, err := os.ReadDir(versionsRoot)
	if err != nil {
		return false, err
	}
	for _, version := range versions {
		if !version.IsDir() || !commitPattern.MatchString(version.Name()) {
			continue
		}
		sourceRoot := filepath.Join(versionsRoot, version.Name(), portablePayloadDirectory)
		rootStat, err := os.Lstat(sourceRoot)
		if err != nil || !rootStat.IsDir() || rootStat.Mode()&os.ModeSymlink != 0 {
			continue
		}
		sourcePath := filepath.Join(sourceRoot, binding.ID)
		// Skip oversized, undersized and unsafe donor files before hashing.
		// The final digest and copy-time rehash remain mandatory for a match.
		info, err := os.Lstat(sourcePath)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() != binding.SizeBytes {
			continue
		}
		digest, size, err := fileDigest(sourcePath)
		if err != nil || digest != binding.SHA256 || size != binding.SizeBytes {
			continue
		}
		source, err := os.Open(sourcePath)
		if err != nil {
			return false, err
		}
		dest, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			_ = source.Close()
			return false, err
		}
		h := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(dest, h), io.LimitReader(source, binding.SizeBytes+1))
		closeSourceErr := source.Close()
		syncErr := error(nil)
		if copyErr == nil {
			syncErr = dest.Sync()
		}
		closeDestErr := dest.Close()
		if copyErr != nil || closeSourceErr != nil || syncErr != nil || closeDestErr != nil ||
			n != binding.SizeBytes || hex.EncodeToString(h.Sum(nil)) != binding.SHA256 {
			_ = os.Remove(destination)
			return false, fmt.Errorf("previous Portable artifact changed during verified reuse: %s", binding.ID)
		}
		return true, nil
	}
	return false, nil
}

func installPortablePayload(client *http.Client, directory string, versionsRoot string, manifest Manifest) error {
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
		target := filepath.Join(sourceRoot, artifact.ID)
		reused, err := reusePortablePayloadArtifact(versionsRoot, artifact, target)
		if err != nil {
			return err
		}
		if reused {
			continue
		}
		if err := downloadPortablePayloadArtifact(client, artifact, target); err != nil {
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
	// The Creator Core is the single owner of the exact, flat 17-artifact
	// Portable source boundary. Reuse that validator for both newly acquired
	// releases and cached offline candidates instead of maintaining a second
	// independent file inventory/hash policy here.
	bindings := creatorcore.PortableMediaBindings{
		Schema: creatorcore.PortableMediaBindingsSchema,
		Artifacts: make([]creatorcore.PortableMediaArtifactBinding, 0, len(payload.Artifacts)),
	}
	for _, artifact := range payload.Artifacts {
		bindings.Artifacts = append(bindings.Artifacts, creatorcore.PortableMediaArtifactBinding{
			ID: artifact.ID,
			SHA256: artifact.SHA256,
			SizeBytes: uint64(artifact.SizeBytes),
		})
	}
	if _, err := creatorcore.VerifyPortableSources(bindings, sourceRoot); err != nil {
		return fmt.Errorf("bound Portable payload source changed or unsafe: %w", err)
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
