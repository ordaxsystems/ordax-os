package main

import (
	"archive/tar"
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"hash"
	"io"
	"net/http"
	"net/url"
	"os"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	envelopeSchema   = "prototype-ordax.release-envelope/1"
	manifestSchema   = "prototype-ordax.release-manifest/1"
	manifestSchemaV2 = "prototype-ordax.release-manifest/2"
	manifestSchemaV3 = "prototype-ordax.release-manifest/3"
	manifestSchemaV4 = "prototype-ordax.release-manifest/4"
	trustSchema      = "prototype-ordax.release-trust/1"
	defaultRepo    = "ordaxsystems/ordax-os"
	maxEnvelope    = 1 << 20
	maxPayload     = 512 << 10
	maxArtifact    = int64(16 << 30)
)

var (
	commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	namePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$`)
	rolePattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	revisionPattern = regexp.MustCompile(`^[0-9a-f]{7,64}$`)
	licensePattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$`)
	recipePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$`)
)

type Envelope struct {
	Schema    string `json:"$schema"`
	Payload   []byte `json:"payload"`
	Signature []byte `json:"signature"`
	KeyID     string `json:"key_id"`
}

type Manifest struct {
	Schema              string     `json:"$schema"`
	SourceRepository    string     `json:"source_repository"`
	SourceCommit        string     `json:"source_commit"`
	ReleaseID           string     `json:"release_id"`
	CreatedFromCIRecipe string     `json:"created_from_ci_recipe"`
	ProductMode         string     `json:"product_mode,omitempty"`
	StorageProfile      string     `json:"storage_profile,omitempty"`
	RuntimeFormat       string          `json:"runtime_format,omitempty"`
	Artifacts           []Artifact      `json:"artifacts"`
	LocalAI             *LocalAIBinding `json:"local_ai,omitempty"`
}

type Artifact struct {
	Name   string `json:"name"`
	Role   string `json:"role"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type LocalAIBinding struct {
	Contract              string `json:"contract"`
	SourceLockSchema      string `json:"source_lock_schema"`
	SourceLockSHA256      string `json:"source_lock_sha256"`
	EngineID              string `json:"engine_id"`
	EngineRepository      string `json:"engine_repository"`
	EngineSourceCommit    string `json:"engine_source_commit"`
	EngineLicense         string `json:"engine_license"`
	ModelID               string `json:"model_id"`
	ModelRepository       string `json:"model_repository"`
	ModelFilename         string `json:"model_filename"`
	ModelUpstreamRevision string `json:"model_upstream_revision"`
	ModelSHA256           string `json:"model_sha256"`
	ModelSize             int64  `json:"model_size"`
	ModelLicense          string `json:"model_license"`
}

type TrustAnchor struct {
	Schema       string `json:"$schema"`
	KeyID        string `json:"key_id"`
	PublicKeyB64 string `json:"public_key_base64"`
}

type Receipt struct {
	Status       string   `json:"status"`
	SourceCommit string   `json:"source_commit"`
	ReleasePath  string   `json:"release_path"`
	CurrentPath  string   `json:"current_path"`
	Artifacts    []string `json:"artifacts"`
	Idempotent   bool     `json:"idempotent"`
}

type MaterializeReceipt struct {
	Status       string   `json:"status"`
	SourceCommit string   `json:"source_commit"`
	ReleasePath  string   `json:"release_path"`
	Artifacts    []string `json:"artifacts"`
	Idempotent   bool     `json:"idempotent"`
}

type InspectReceipt struct {
	Status              string          `json:"status"`
	ManifestSchema      string          `json:"manifest_schema"`
	SourceCommit        string          `json:"source_commit"`
	ReleaseID           string          `json:"release_id"`
	CreatedFromCIRecipe string          `json:"created_from_ci_recipe"`
	ProductMode         string          `json:"product_mode,omitempty"`
	StorageProfile      string          `json:"storage_profile,omitempty"`
	RuntimeFormat       string          `json:"runtime_format,omitempty"`
	ArtifactName        string          `json:"artifact_name"`
	ArtifactRole        string          `json:"artifact_role"`
	ArtifactURL         string          `json:"artifact_url"`
	ArtifactSHA256      string          `json:"artifact_sha256"`
	ArtifactSize        int64           `json:"artifact_size"`
	Artifacts           []Artifact      `json:"artifacts,omitempty"`
	LocalAI             *LocalAIBinding `json:"local_ai,omitempty"`
}

type ExactActivationReceipt struct {
	Status         string `json:"status"`
	SourceCommit   string `json:"source_commit"`
	PreviousCommit string `json:"previous_commit"`
	ReleasePath    string `json:"release_path"`
	CurrentPath    string `json:"current_path"`
	Idempotent     bool   `json:"idempotent"`
}

type PortableMaterializeReceipt struct {
	Status            string `json:"status"`
	SourceCommit      string `json:"source_commit"`
	ReleasePath       string `json:"release_path"`
	ArtifactPath      string `json:"artifact_path"`
	RuntimePath       string `json:"runtime_path,omitempty"`
	RuntimeReused     bool   `json:"runtime_reused,omitempty"`
	AIRuntimePath     string `json:"ai_runtime_path,omitempty"`
	AIRuntimeReused   bool   `json:"ai_runtime_reused,omitempty"`
	Idempotent        bool   `json:"idempotent"`
	ActivationAllowed bool   `json:"activation_allowed"`
}

type PortableVerifyReceipt struct {
	Status            string `json:"status"`
	SourceCommit      string `json:"source_commit"`
	ReleasePath       string `json:"release_path"`
	ArtifactPath      string `json:"artifact_path"`
	RuntimePath       string `json:"runtime_path,omitempty"`
	AIRuntimePath     string `json:"ai_runtime_path,omitempty"`
	ActivationAllowed bool   `json:"activation_allowed"`
}

func strictDecode(data []byte, max int, out any) error {
	if len(data) == 0 || len(data) > max {
		return fmt.Errorf("document size outside allowed range: %d", len(data))
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are forbidden")
		}
		return err
	}
	return nil
}

func loadTrust(path string) (TrustAnchor, ed25519.PublicKey, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return TrustAnchor{}, nil, fmt.Errorf("trust anchor: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > 16<<10 {
		return TrustAnchor{}, nil, errors.New("trust anchor must be a small regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return TrustAnchor{}, nil, err
	}
	var trust TrustAnchor
	if err := strictDecode(data, 16<<10, &trust); err != nil {
		return TrustAnchor{}, nil, fmt.Errorf("invalid trust anchor: %w", err)
	}
	if trust.Schema != trustSchema || !rolePattern.MatchString(trust.KeyID) {
		return TrustAnchor{}, nil, errors.New("unsupported trust anchor schema or key id")
	}
	key, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return TrustAnchor{}, nil, errors.New("invalid Ed25519 public key")
	}
	return trust, ed25519.PublicKey(key), nil
}

func verifyEnvelope(data []byte, trust TrustAnchor, key ed25519.PublicKey, expectedRepo string) (Manifest, []byte, error) {
	var envelope Envelope
	if err := strictDecode(data, maxEnvelope, &envelope); err != nil {
		return Manifest{}, nil, fmt.Errorf("invalid envelope: %w", err)
	}
	if envelope.Schema != envelopeSchema {
		return Manifest{}, nil, errors.New("unsupported release envelope schema")
	}
	if envelope.KeyID != trust.KeyID {
		return Manifest{}, nil, errors.New("release key id does not match trust anchor")
	}
	if len(envelope.Payload) == 0 || len(envelope.Payload) > maxPayload {
		return Manifest{}, nil, errors.New("signed manifest payload is outside allowed size")
	}
	if len(envelope.Signature) != ed25519.SignatureSize || !ed25519.Verify(key, envelope.Payload, envelope.Signature) {
		return Manifest{}, nil, errors.New("release manifest signature verification failed")
	}
	var manifest Manifest
	if err := strictDecode(envelope.Payload, maxPayload, &manifest); err != nil {
		return Manifest{}, nil, fmt.Errorf("invalid signed manifest: %w", err)
	}
	if err := validateManifest(manifest, expectedRepo); err != nil {
		return Manifest{}, nil, err
	}
	return manifest, envelope.Payload, nil
}

func validateManifest(m Manifest, expectedRepo string) error {
	if m.SourceRepository != expectedRepo {
		return fmt.Errorf("unexpected source repository: %q", m.SourceRepository)
	}
	if !commitPattern.MatchString(m.SourceCommit) {
		return errors.New("source_commit must be lowercase 40-hex")
	}
	if m.ReleaseID != m.SourceCommit {
		return errors.New("prototype release_id must equal source_commit")
	}
	if !recipePattern.MatchString(m.CreatedFromCIRecipe) {
		return errors.New("invalid created_from_ci_recipe")
	}

	switch m.Schema {
	case manifestSchema:
		if len(m.Artifacts) != 1 {
			return errors.New("release-manifest/1 requires exactly one system.tar artifact")
		}
		if m.ProductMode != "" || m.StorageProfile != "" || m.RuntimeFormat != "" || m.LocalAI != nil {
			return errors.New("release-manifest/1 forbids portable-v2 and local AI identity fields")
		}
		if m.Artifacts[0].Name != "system.tar" || m.Artifacts[0].Role != "system" {
			return errors.New("release-manifest/1 artifact must be system.tar with role=system")
		}
	case manifestSchemaV2:
		if len(m.Artifacts) != 1 {
			return errors.New("release-manifest/2 requires exactly one system.erofs artifact")
		}
		if m.LocalAI != nil {
			return errors.New("release-manifest/2 forbids local_ai binding")
		}
		if m.ProductMode != "usb" || m.StorageProfile != "portable-usb-v2" || m.RuntimeFormat != "erofs" {
			return errors.New("release-manifest/2 requires usb portable-usb-v2 erofs identity")
		}
		if m.Artifacts[0].Name != "system.erofs" || m.Artifacts[0].Role != "system-image" {
			return errors.New("release-manifest/2 artifact must be system.erofs with role=system-image")
		}
	case manifestSchemaV3:
		if len(m.Artifacts) != 2 {
			return errors.New("release-manifest/3 requires exactly system.erofs and native-surface-runtime.erofs")
		}
		if m.LocalAI != nil {
			return errors.New("release-manifest/3 forbids local_ai binding")
		}
		if m.ProductMode != "usb" || m.StorageProfile != "portable-usb-v2" || m.RuntimeFormat != "erofs" {
			return errors.New("release-manifest/3 requires usb portable-usb-v2 erofs identity")
		}
		if m.Artifacts[0].Name != "system.erofs" || m.Artifacts[0].Role != "system-image" {
			return errors.New("release-manifest/3 first artifact must be system.erofs with role=system-image")
		}
		if m.Artifacts[1].Name != "native-surface-runtime.erofs" || m.Artifacts[1].Role != "surface-runtime" {
			return errors.New("release-manifest/3 second artifact must be native-surface-runtime.erofs with role=surface-runtime")
		}
	case manifestSchemaV4:
		if len(m.Artifacts) != 3 {
			return errors.New("release-manifest/4 requires system, Surface runtime and local AI runtime artifacts")
		}
		if m.ProductMode != "usb" || m.StorageProfile != "portable-usb-v2" || m.RuntimeFormat != "erofs" {
			return errors.New("release-manifest/4 requires usb portable-usb-v2 erofs identity")
		}
		if m.Artifacts[0].Name != "system.erofs" || m.Artifacts[0].Role != "system-image" {
			return errors.New("release-manifest/4 first artifact must be system.erofs with role=system-image")
		}
		if m.Artifacts[1].Name != "native-surface-runtime.erofs" || m.Artifacts[1].Role != "surface-runtime" {
			return errors.New("release-manifest/4 second artifact must be native-surface-runtime.erofs with role=surface-runtime")
		}
		if m.Artifacts[2].Name != "local-ai-runtime.erofs" || m.Artifacts[2].Role != "local-ai-runtime" {
			return errors.New("release-manifest/4 third artifact must be local-ai-runtime.erofs with role=local-ai-runtime")
		}
		if m.LocalAI == nil {
			return errors.New("release-manifest/4 requires local_ai source/model binding")
		}
		binding := m.LocalAI
		if binding.Contract != "ordax.local-ai/1" ||
			binding.SourceLockSchema != "prototype-ordax.local-ai-source-lock/1" ||
			!shaPattern.MatchString(binding.SourceLockSHA256) ||
			binding.EngineID == "" || len(binding.EngineID) > 128 ||
			binding.EngineRepository == "" || len(binding.EngineRepository) > 512 ||
			!commitPattern.MatchString(binding.EngineSourceCommit) ||
			!licensePattern.MatchString(binding.EngineLicense) ||
			binding.ModelID == "" || len(binding.ModelID) > 128 ||
			binding.ModelRepository == "" || len(binding.ModelRepository) > 512 ||
			binding.ModelFilename == "" || filepath.Base(binding.ModelFilename) != binding.ModelFilename ||
			!revisionPattern.MatchString(binding.ModelUpstreamRevision) ||
			!shaPattern.MatchString(binding.ModelSHA256) ||
			binding.ModelSize <= 0 || binding.ModelSize > maxArtifact ||
			!licensePattern.MatchString(binding.ModelLicense) {
			return errors.New("release-manifest/4 contains invalid local_ai source/model binding")
		}
	default:
		return errors.New("unsupported release manifest schema")
	}

	for _, a := range m.Artifacts {
		if !namePattern.MatchString(a.Name) || filepath.Base(a.Name) != a.Name || strings.ContainsAny(a.Name, `/\\`) {
			return fmt.Errorf("unsafe artifact name: %q", a.Name)
		}
		if !rolePattern.MatchString(a.Role) {
			return fmt.Errorf("invalid artifact role: %q", a.Role)
		}
		if !shaPattern.MatchString(a.SHA256) {
			return fmt.Errorf("invalid artifact SHA-256 for %q", a.Name)
		}
		if a.Size <= 0 || a.Size > maxArtifact {
			return fmt.Errorf("artifact size outside allowed range for %q", a.Name)
		}
		if err := validateHTTPSURL(a.URL); err != nil {
			return fmt.Errorf("artifact %q: %w", a.Name, err)
		}
	}
	return nil
}

func validateHTTPSURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return errors.New("URL must be absolute HTTPS without credentials or fragment")
	}
	return nil
}

func secureClient() *http.Client {
	return &http.Client{
		Timeout: 10 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 8 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "https" {
				return errors.New("redirect to non-HTTPS URL refused")
			}
			return nil
		},
	}
}

func fetchBytes(client *http.Client, raw string, max int64) ([]byte, error) {
	if err := validateHTTPSURL(raw); err != nil {
		return nil, err
	}
	resp, err := client.Get(raw)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.Request == nil || resp.Request.URL.Scheme != "https" {
		return nil, errors.New("final response is not HTTPS")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected HTTP status: %s", resp.Status)
	}
	if resp.ContentLength > max {
		return nil, errors.New("response exceeds maximum size")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, errors.New("response exceeds maximum size")
	}
	return data, nil
}

func ensureDir(path string, mode os.FileMode) error {
	if err := os.MkdirAll(path, mode); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("unsafe directory: %s", path)
	}
	return nil
}

func downloadArtifact(client *http.Client, a Artifact, dst string) error {
	resp, err := client.Get(a.URL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.Request == nil || resp.Request.URL.Scheme != "https" {
		return errors.New("artifact final response is not HTTPS")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("artifact HTTP status: %s", resp.Status)
	}
	if resp.ContentLength >= 0 && resp.ContentLength != a.Size {
		return fmt.Errorf("artifact Content-Length mismatch for %s", a.Name)
	}
	file, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	var h hash.Hash = sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(file, h), io.LimitReader(resp.Body, a.Size+1))
	syncErr := file.Sync()
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	if syncErr != nil {
		return syncErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n != a.Size {
		return fmt.Errorf("artifact size mismatch for %s: got=%d expected=%d", a.Name, n, a.Size)
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if actual != a.SHA256 {
		return fmt.Errorf("artifact SHA-256 mismatch for %s", a.Name)
	}
	return nil
}

func systemArchivePathName(header *tar.Header) (string, os.FileMode, error) {
	name := strings.TrimSuffix(header.Name, "/")
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") || pathpkg.Clean(name) != name {
		return "", 0, fmt.Errorf("unsafe system archive path: %q", header.Name)
	}
	if name != "system" && !strings.HasPrefix(name, "system/") {
		return "", 0, fmt.Errorf("system archive entry escapes system/: %q", header.Name)
	}
	mode := os.FileMode(header.Mode) & os.ModePerm
	switch header.Typeflag {
	case tar.TypeDir:
		if mode != 0o755 {
			return "", 0, fmt.Errorf("system archive directory mode must be 0755: %s", name)
		}
	case tar.TypeReg, tar.TypeRegA:
		if name == "system" {
			return "", 0, errors.New("system archive root must be a directory")
		}
		if mode != 0o644 && mode != 0o755 {
			return "", 0, fmt.Errorf("system archive file mode must be 0644 or 0755: %s", name)
		}
		if header.Size < 0 || header.Size > maxArtifact {
			return "", 0, fmt.Errorf("system archive entry size outside allowed range: %s", name)
		}
	default:
		return "", 0, fmt.Errorf("system archive entry type is forbidden: %s", name)
	}
	return name, mode, nil
}

func extractSystemArchive(archivePath, releaseRoot string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	reader := tar.NewReader(file)
	seen := map[string]bool{}
	var total int64
	entrypointSeen := false
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read system archive: %w", err)
		}
		name, mode, err := systemArchivePathName(header)
		if err != nil {
			return err
		}
		if seen[name] {
			return fmt.Errorf("duplicate system archive path: %s", name)
		}
		seen[name] = true
		target := filepath.Join(releaseRoot, filepath.FromSlash(name))
		switch header.Typeflag {
		case tar.TypeDir:
			if err := ensureDir(target, mode); err != nil {
				return err
			}
			if err := os.Chmod(target, mode); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			total += header.Size
			if total > maxArtifact {
				return errors.New("system archive extracted size exceeds allowed maximum")
			}
			if err := ensureDir(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
			if err != nil {
				return err
			}
			n, copyErr := io.Copy(output, reader)
			syncErr := output.Sync()
			closeErr := output.Close()
			if copyErr != nil {
				return copyErr
			}
			if syncErr != nil {
				return syncErr
			}
			if closeErr != nil {
				return closeErr
			}
			if n != header.Size {
				return fmt.Errorf("system archive entry size mismatch: %s", name)
			}
			if name == "system/entrypoint" {
				if mode != 0o755 || header.Size == 0 {
					return errors.New("system/entrypoint must be a non-empty 0755 regular file")
				}
				entrypointSeen = true
			}
		}
	}
	if !entrypointSeen {
		return errors.New("system archive does not contain executable system/entrypoint")
	}
	if err := syncDir(filepath.Join(releaseRoot, "system")); err != nil {
		return err
	}
	return verifySystemArchiveAgainstTree(archivePath, releaseRoot)
}

func hashFile(path string) (string, int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", 0, errors.New("path is not a regular non-symlink file")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	h := sha256.New()
	n, err := io.Copy(h, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func verifySystemArchiveAgainstTree(archivePath, releaseRoot string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	reader := tar.NewReader(file)
	expectedFiles := map[string]bool{}
	expectedDirs := map[string]bool{"system": true}
	entrypointSeen := false
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read system archive for verification: %w", err)
		}
		name, mode, err := systemArchivePathName(header)
		if err != nil {
			return err
		}
		target := filepath.Join(releaseRoot, filepath.FromSlash(name))
		switch header.Typeflag {
		case tar.TypeDir:
			expectedDirs[name] = true
			info, err := os.Lstat(target)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != mode {
				return fmt.Errorf("materialized system directory differs: %s", name)
			}
		case tar.TypeReg, tar.TypeRegA:
			expectedFiles[name] = true
			for parent := pathpkg.Dir(name); parent != "." && strings.HasPrefix(parent, "system"); parent = pathpkg.Dir(parent) {
				expectedDirs[parent] = true
				if parent == "system" {
					break
				}
			}
			expectedHash := sha256.New()
			n, err := io.Copy(expectedHash, reader)
			if err != nil || n != header.Size {
				return fmt.Errorf("cannot hash archive entry %s", name)
			}
			actualHash, actualSize, err := hashFile(target)
			if err != nil || actualSize != header.Size || actualHash != hex.EncodeToString(expectedHash.Sum(nil)) {
				return fmt.Errorf("materialized system file differs: %s", name)
			}
			info, err := os.Lstat(target)
			if err != nil || info.Mode().Perm() != mode {
				return fmt.Errorf("materialized system file mode differs: %s", name)
			}
			if name == "system/entrypoint" {
				if mode != 0o755 || header.Size == 0 {
					return errors.New("materialized system/entrypoint is not bootable")
				}
				entrypointSeen = true
			}
		}
	}
	if !entrypointSeen {
		return errors.New("materialized release lacks system/entrypoint")
	}
	systemRoot := filepath.Join(releaseRoot, "system")
	return filepath.WalkDir(systemRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(releaseRoot, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("materialized system contains symlink: %s", name)
		}
		if entry.IsDir() {
			if !expectedDirs[name] {
				return fmt.Errorf("materialized system contains unexpected directory: %s", name)
			}
			return nil
		}
		if !info.Mode().IsRegular() || !expectedFiles[name] {
			return fmt.Errorf("materialized system contains unexpected file: %s", name)
		}
		return nil
	})
}

func verifyExistingRelease(path string, m Manifest, payload, envelope []byte) error {
	if m.Schema != manifestSchema {
		return errors.New("legacy materialized release verification supports release-manifest/1 only")
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	allowed := map[string]bool{"artifacts": true, "release-envelope.json": true, "release-manifest.json": true, "system": true}
	for _, entry := range entries {
		if !allowed[entry.Name()] {
			return fmt.Errorf("existing release contains unexpected top-level entry: %s", entry.Name())
		}
	}
	manifestPath := filepath.Join(path, "release-manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil || !bytes.Equal(data, payload) {
		return errors.New("existing release manifest differs from signed payload")
	}
	envelopePath := filepath.Join(path, "release-envelope.json")
	storedEnvelope, err := os.ReadFile(envelopePath)
	if err != nil || !bytes.Equal(storedEnvelope, envelope) {
		return errors.New("existing release envelope differs from verified signed envelope")
	}
	artifactRoot := filepath.Join(path, "artifacts")
	artifactEntries, err := os.ReadDir(artifactRoot)
	if err != nil || len(artifactEntries) != len(m.Artifacts) {
		return errors.New("existing release artifact directory differs from signed manifest")
	}
	for _, a := range m.Artifacts {
		p := filepath.Join(artifactRoot, a.Name)
		actualHash, actualSize, err := hashFile(p)
		if err != nil || actualSize != a.Size {
			return fmt.Errorf("existing artifact invalid: %s", a.Name)
		}
		if actualHash != a.SHA256 {
			return fmt.Errorf("existing artifact digest mismatch: %s", a.Name)
		}
		if err := verifySystemArchiveAgainstTree(p, path); err != nil {
			return err
		}
	}
	return nil
}

func verifyEROFSArtifact(path, label string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%s must be a regular non-symlink file", label)
	}
	if info.Size() < 4096 || info.Size() > maxArtifact {
		return fmt.Errorf("%s size is outside allowed range", label)
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	magic := make([]byte, 4)
	if _, err := file.ReadAt(magic, 1024); err != nil {
		return fmt.Errorf("read %s EROFS superblock: %w", label, err)
	}
	if !bytes.Equal(magic, []byte{0xe2, 0xe1, 0xf5, 0xe0}) {
		return fmt.Errorf("%s does not contain the EROFS superblock magic", label)
	}
	return nil
}

func verifyPortableEROFS(path string) error {
	return verifyEROFSArtifact(path, "portable system image")
}

func verifySurfaceRuntimeEROFS(path string) error {
	return verifyEROFSArtifact(path, "Surface runtime image")
}

func verifyLocalAIRuntimeEROFS(path string) error {
	return verifyEROFSArtifact(path, "local AI runtime image")
}

func verifyExistingPortableRelease(path string, m Manifest, payload, envelope []byte) error {
	if m.Schema != manifestSchemaV2 {
		return errors.New("portable materialized release requires release-manifest/2")
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	allowed := map[string]bool{
		"system.erofs": true,
		"release-envelope.json": true,
		"release-manifest.json": true,
	}
	if len(entries) != len(allowed) {
		return errors.New("portable release contains unexpected top-level entry count")
	}
	for _, entry := range entries {
		if !allowed[entry.Name()] {
			return fmt.Errorf("portable release contains unexpected top-level entry: %s", entry.Name())
		}
	}

	manifestPath := filepath.Join(path, "release-manifest.json")
	data, err := readBoundedRegularFile(manifestPath, maxPayload, "stored portable release manifest")
	if err != nil || !bytes.Equal(data, payload) {
		return errors.New("portable release manifest differs from signed payload")
	}
	envelopePath := filepath.Join(path, "release-envelope.json")
	storedEnvelope, err := readBoundedRegularFile(envelopePath, maxEnvelope, "stored portable release envelope")
	if err != nil || !bytes.Equal(storedEnvelope, envelope) {
		return errors.New("portable release envelope differs from verified signed envelope")
	}

	artifact := m.Artifacts[0]
	imagePath := filepath.Join(path, "system.erofs")
	actualHash, actualSize, err := hashFile(imagePath)
	if err != nil || actualSize != artifact.Size {
		return errors.New("portable release image size is invalid")
	}
	if actualHash != artifact.SHA256 {
		return errors.New("portable release image digest mismatch")
	}
	if err := verifyPortableEROFS(imagePath); err != nil {
		return err
	}
	return nil
}

func materializePortable(client *http.Client, envelopeURL, root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo, expectedCommit string) (PortableMaterializeReceipt, error) {
	envelope, err := fetchBytes(client, envelopeURL, maxEnvelope)
	if err != nil {
		return PortableMaterializeReceipt{}, fmt.Errorf("fetch envelope: %w", err)
	}
	manifest, payload, err := verifyEnvelope(envelope, trust, key, expectedRepo)
	if err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if manifest.Schema != manifestSchemaV2 {
		return PortableMaterializeReceipt{}, errors.New("materialize-portable requires release-manifest/2")
	}
	if !commitPattern.MatchString(expectedCommit) {
		return PortableMaterializeReceipt{}, errors.New("expected_commit must be lowercase 40-hex")
	}
	if manifest.SourceCommit != expectedCommit {
		return PortableMaterializeReceipt{}, fmt.Errorf(
			"signed portable release source_commit does not match expected commit: got=%s expected=%s",
			manifest.SourceCommit,
			expectedCommit,
		)
	}
	if err := ensureDir(root, 0o755); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	releases := filepath.Join(root, "releases")
	if err := ensureDir(releases, 0o755); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	target := filepath.Join(releases, manifest.SourceCommit)
	imagePath := filepath.Join(target, "system.erofs")

	if info, err := os.Lstat(target); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return PortableMaterializeReceipt{}, errors.New("portable release target exists but is not a safe directory")
		}
		if err := verifyExistingPortableRelease(target, manifest, payload, envelope); err != nil {
			return PortableMaterializeReceipt{}, err
		}
		return PortableMaterializeReceipt{
			Status: "materialized-portable",
			SourceCommit: manifest.SourceCommit,
			ReleasePath: target,
			ArtifactPath: imagePath,
			Idempotent: true,
			ActivationAllowed: false,
		}, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return PortableMaterializeReceipt{}, err
	}

	stage, err := os.MkdirTemp(releases, ".portable-staging-"+manifest.SourceCommit+"-")
	if err != nil {
		return PortableMaterializeReceipt{}, err
	}
	keepStage := false
	defer func() {
		if !keepStage {
			_ = os.RemoveAll(stage)
		}
	}()

	stageImage := filepath.Join(stage, "system.erofs")
	if err := downloadArtifact(client, manifest.Artifacts[0], stageImage); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := verifyPortableEROFS(stageImage); err != nil {
		return PortableMaterializeReceipt{}, fmt.Errorf("verify portable system image: %w", err)
	}
	if err := writeSynced(filepath.Join(stage, "release-manifest.json"), payload, 0o644); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := writeSynced(filepath.Join(stage, "release-envelope.json"), envelope, 0o644); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := verifyExistingPortableRelease(stage, manifest, payload, envelope); err != nil {
		return PortableMaterializeReceipt{}, fmt.Errorf("verify staged portable release: %w", err)
	}
	if err := syncDir(stage); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := os.Rename(stage, target); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	keepStage = true
	if err := syncDir(releases); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	return PortableMaterializeReceipt{
		Status: "materialized-portable",
		SourceCommit: manifest.SourceCommit,
		ReleasePath: target,
		ArtifactPath: imagePath,
		Idempotent: false,
		ActivationAllowed: false,
	}, nil
}

func verifyPortableExact(root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo, expectedCommit string) (PortableVerifyReceipt, error) {
	if !commitPattern.MatchString(expectedCommit) {
		return PortableVerifyReceipt{}, errors.New("expected_commit must be lowercase 40-hex")
	}
	releasePath := filepath.Join(root, "releases", expectedCommit)
	info, err := os.Lstat(releasePath)
	if err != nil {
		return PortableVerifyReceipt{}, fmt.Errorf("portable release root: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return PortableVerifyReceipt{}, errors.New("portable release root is not a safe directory")
	}

	envelopePath := filepath.Join(releasePath, "release-envelope.json")
	envelope, err := readBoundedRegularFile(envelopePath, maxEnvelope, "stored portable release envelope")
	if err != nil {
		return PortableVerifyReceipt{}, err
	}
	manifest, payload, err := verifyEnvelope(envelope, trust, key, expectedRepo)
	if err != nil {
		return PortableVerifyReceipt{}, fmt.Errorf("verify stored portable release envelope: %w", err)
	}
	if manifest.Schema != manifestSchemaV2 {
		return PortableVerifyReceipt{}, errors.New("stored portable release is not release-manifest/2")
	}
	if manifest.SourceCommit != expectedCommit {
		return PortableVerifyReceipt{}, fmt.Errorf(
			"stored portable source_commit does not match expected commit: got=%s expected=%s",
			manifest.SourceCommit,
			expectedCommit,
		)
	}
	if err := verifyExistingPortableRelease(releasePath, manifest, payload, envelope); err != nil {
		return PortableVerifyReceipt{}, fmt.Errorf("verify exact portable release: %w", err)
	}
	return PortableVerifyReceipt{
		Status: "verified-portable-exact",
		SourceCommit: manifest.SourceCommit,
		ReleasePath: releasePath,
		ArtifactPath: filepath.Join(releasePath, "system.erofs"),
		ActivationAllowed: false,
	}, nil
}


func verifyRuntimeStoreFile(root string, artifact Artifact) (string, error) {
	runtimeDir := filepath.Join(root, "runtimes", "sha256", artifact.SHA256)
	info, err := os.Lstat(runtimeDir)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("Surface runtime store entry is not a safe directory")
	}
	entries, err := os.ReadDir(runtimeDir)
	if err != nil {
		return "", err
	}
	if len(entries) != 1 || entries[0].Name() != "native-surface-runtime.erofs" {
		return "", errors.New("Surface runtime store entry contains unexpected files")
	}
	runtimePath := filepath.Join(runtimeDir, "native-surface-runtime.erofs")
	actualHash, actualSize, err := hashFile(runtimePath)
	if err != nil || actualSize != artifact.Size {
		return "", errors.New("Surface runtime stored size is invalid")
	}
	if actualHash != artifact.SHA256 {
		return "", errors.New("Surface runtime stored digest mismatch")
	}
	if err := verifySurfaceRuntimeEROFS(runtimePath); err != nil {
		return "", err
	}
	return runtimePath, nil
}

func materializeRuntimeBlob(client *http.Client, root string, artifact Artifact) (string, bool, error) {
	if artifact.Name != "native-surface-runtime.erofs" || artifact.Role != "surface-runtime" {
		return "", false, errors.New("invalid Surface runtime artifact identity")
	}
	digestRoot := filepath.Join(root, "runtimes", "sha256")
	if err := ensureDir(digestRoot, 0o755); err != nil {
		return "", false, err
	}
	targetDir := filepath.Join(digestRoot, artifact.SHA256)
	if info, err := os.Lstat(targetDir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", false, errors.New("Surface runtime digest target exists but is not a safe directory")
		}
		path, err := verifyRuntimeStoreFile(root, artifact)
		return path, true, err
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", false, err
	}

	stage, err := os.MkdirTemp(digestRoot, ".runtime-staging-"+artifact.SHA256[:12]+"-")
	if err != nil {
		return "", false, err
	}
	keepStage := false
	defer func() {
		if !keepStage {
			_ = os.RemoveAll(stage)
		}
	}()

	stagePath := filepath.Join(stage, "native-surface-runtime.erofs")
	if err := downloadArtifact(client, artifact, stagePath); err != nil {
		return "", false, err
	}
	if err := verifySurfaceRuntimeEROFS(stagePath); err != nil {
		return "", false, fmt.Errorf("verify Surface runtime image: %w", err)
	}
	if err := syncDir(stage); err != nil {
		return "", false, err
	}
	if err := os.Rename(stage, targetDir); err != nil {
		return "", false, err
	}
	keepStage = true
	if err := syncDir(digestRoot); err != nil {
		return "", false, err
	}
	path, err := verifyRuntimeStoreFile(root, artifact)
	if err != nil {
		return "", false, err
	}
	return path, false, nil
}

func verifyAIRuntimeStoreFile(root string, artifact Artifact) (string, error) {
	aiRuntimeDir := filepath.Join(root, "ai-runtimes", "sha256", artifact.SHA256)
	info, err := os.Lstat(aiRuntimeDir)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("local AI runtime store entry is not a safe directory")
	}
	entries, err := os.ReadDir(aiRuntimeDir)
	if err != nil {
		return "", err
	}
	if len(entries) != 1 || entries[0].Name() != "local-ai-runtime.erofs" {
		return "", errors.New("local AI runtime store entry contains unexpected files")
	}
	runtimePath := filepath.Join(aiRuntimeDir, "local-ai-runtime.erofs")
	actualHash, actualSize, err := hashFile(runtimePath)
	if err != nil || actualSize != artifact.Size {
		return "", errors.New("local AI runtime stored size is invalid")
	}
	if actualHash != artifact.SHA256 {
		return "", errors.New("local AI runtime stored digest mismatch")
	}
	if err := verifyLocalAIRuntimeEROFS(runtimePath); err != nil {
		return "", err
	}
	return runtimePath, nil
}

func materializeAIRuntimeBlob(client *http.Client, root string, artifact Artifact) (string, bool, error) {
	if artifact.Name != "local-ai-runtime.erofs" || artifact.Role != "local-ai-runtime" {
		return "", false, errors.New("invalid local AI runtime artifact identity")
	}
	digestRoot := filepath.Join(root, "ai-runtimes", "sha256")
	if err := ensureDir(digestRoot, 0o755); err != nil {
		return "", false, err
	}
	targetDir := filepath.Join(digestRoot, artifact.SHA256)
	if info, err := os.Lstat(targetDir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", false, errors.New("local AI runtime digest target exists but is not a safe directory")
		}
		path, err := verifyAIRuntimeStoreFile(root, artifact)
		return path, true, err
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", false, err
	}

	stage, err := os.MkdirTemp(digestRoot, ".ai-runtime-staging-"+artifact.SHA256[:12]+"-")
	if err != nil {
		return "", false, err
	}
	keepStage := false
	defer func() {
		if !keepStage {
			_ = os.RemoveAll(stage)
		}
	}()

	stagePath := filepath.Join(stage, "local-ai-runtime.erofs")
	if err := downloadArtifact(client, artifact, stagePath); err != nil {
		return "", false, err
	}
	if err := verifyLocalAIRuntimeEROFS(stagePath); err != nil {
		return "", false, fmt.Errorf("verify local AI runtime image: %w", err)
	}
	if err := syncDir(stage); err != nil {
		return "", false, err
	}
	if err := os.Rename(stage, targetDir); err != nil {
		return "", false, err
	}
	keepStage = true
	if err := syncDir(digestRoot); err != nil {
		return "", false, err
	}
	path, err := verifyAIRuntimeStoreFile(root, artifact)
	if err != nil {
		return "", false, err
	}
	return path, false, nil
}

func verifyExistingPortableV3Release(path, root string, m Manifest, payload, envelope []byte) error {
	if m.Schema != manifestSchemaV3 {
		return errors.New("portable v3 materialized release requires release-manifest/3")
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	allowed := map[string]bool{
		"system.erofs": true,
		"surface-runtime.sha256": true,
		"release-envelope.json": true,
		"release-manifest.json": true,
	}
	if len(entries) != len(allowed) {
		return errors.New("portable v3 release contains unexpected top-level entry count")
	}
	for _, entry := range entries {
		if !allowed[entry.Name()] {
			return fmt.Errorf("portable v3 release contains unexpected top-level entry: %s", entry.Name())
		}
	}

	manifestPath := filepath.Join(path, "release-manifest.json")
	data, err := readBoundedRegularFile(manifestPath, maxPayload, "stored portable v3 release manifest")
	if err != nil || !bytes.Equal(data, payload) {
		return errors.New("portable v3 release manifest differs from signed payload")
	}
	envelopePath := filepath.Join(path, "release-envelope.json")
	storedEnvelope, err := readBoundedRegularFile(envelopePath, maxEnvelope, "stored portable v3 release envelope")
	if err != nil || !bytes.Equal(storedEnvelope, envelope) {
		return errors.New("portable v3 release envelope differs from verified signed envelope")
	}

	systemArtifact := m.Artifacts[0]
	systemPath := filepath.Join(path, "system.erofs")
	actualHash, actualSize, err := hashFile(systemPath)
	if err != nil || actualSize != systemArtifact.Size {
		return errors.New("portable v3 system image size is invalid")
	}
	if actualHash != systemArtifact.SHA256 {
		return errors.New("portable v3 system image digest mismatch")
	}
	if err := verifyPortableEROFS(systemPath); err != nil {
		return err
	}

	runtimeArtifact := m.Artifacts[1]
	refPath := filepath.Join(path, "surface-runtime.sha256")
	refBytes, err := readBoundedRegularFile(refPath, 128, "stored Surface runtime reference")
	if err != nil {
		return err
	}
	if string(refBytes) != runtimeArtifact.SHA256+"\n" {
		return errors.New("portable v3 Surface runtime reference differs from signed manifest")
	}
	if _, err := verifyRuntimeStoreFile(root, runtimeArtifact); err != nil {
		return fmt.Errorf("verify portable v3 Surface runtime store: %w", err)
	}
	return nil
}

func materializePortableV3(client *http.Client, envelopeURL, root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo, expectedCommit string) (PortableMaterializeReceipt, error) {
	envelope, err := fetchBytes(client, envelopeURL, maxEnvelope)
	if err != nil {
		return PortableMaterializeReceipt{}, fmt.Errorf("fetch envelope: %w", err)
	}
	manifest, payload, err := verifyEnvelope(envelope, trust, key, expectedRepo)
	if err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if manifest.Schema != manifestSchemaV3 {
		return PortableMaterializeReceipt{}, errors.New("materialize-portable-v3 requires release-manifest/3")
	}
	if !commitPattern.MatchString(expectedCommit) {
		return PortableMaterializeReceipt{}, errors.New("expected_commit must be lowercase 40-hex")
	}
	if manifest.SourceCommit != expectedCommit {
		return PortableMaterializeReceipt{}, fmt.Errorf(
			"signed portable v3 release source_commit does not match expected commit: got=%s expected=%s",
			manifest.SourceCommit,
			expectedCommit,
		)
	}
	if err := ensureDir(root, 0o755); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	releases := filepath.Join(root, "releases")
	if err := ensureDir(releases, 0o755); err != nil {
		return PortableMaterializeReceipt{}, err
	}

	runtimePath, runtimeReused, err := materializeRuntimeBlob(client, root, manifest.Artifacts[1])
	if err != nil {
		return PortableMaterializeReceipt{}, err
	}

	target := filepath.Join(releases, manifest.SourceCommit)
	systemPath := filepath.Join(target, "system.erofs")
	if info, err := os.Lstat(target); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return PortableMaterializeReceipt{}, errors.New("portable v3 release target exists but is not a safe directory")
		}
		if err := verifyExistingPortableV3Release(target, root, manifest, payload, envelope); err != nil {
			return PortableMaterializeReceipt{}, err
		}
		return PortableMaterializeReceipt{
			Status: "materialized-portable-v3",
			SourceCommit: manifest.SourceCommit,
			ReleasePath: target,
			ArtifactPath: systemPath,
			RuntimePath: runtimePath,
			RuntimeReused: true,
			Idempotent: true,
			ActivationAllowed: false,
		}, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return PortableMaterializeReceipt{}, err
	}

	stage, err := os.MkdirTemp(releases, ".portable-v3-staging-"+manifest.SourceCommit+"-")
	if err != nil {
		return PortableMaterializeReceipt{}, err
	}
	keepStage := false
	defer func() {
		if !keepStage {
			_ = os.RemoveAll(stage)
		}
	}()

	stageSystem := filepath.Join(stage, "system.erofs")
	if err := downloadArtifact(client, manifest.Artifacts[0], stageSystem); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := verifyPortableEROFS(stageSystem); err != nil {
		return PortableMaterializeReceipt{}, fmt.Errorf("verify portable v3 system image: %w", err)
	}
	if err := writeSynced(filepath.Join(stage, "surface-runtime.sha256"), []byte(manifest.Artifacts[1].SHA256+"\n"), 0o644); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := writeSynced(filepath.Join(stage, "release-manifest.json"), payload, 0o644); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := writeSynced(filepath.Join(stage, "release-envelope.json"), envelope, 0o644); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := verifyExistingPortableV3Release(stage, root, manifest, payload, envelope); err != nil {
		return PortableMaterializeReceipt{}, fmt.Errorf("verify staged portable v3 release: %w", err)
	}
	if err := syncDir(stage); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := os.Rename(stage, target); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	keepStage = true
	if err := syncDir(releases); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	return PortableMaterializeReceipt{
		Status: "materialized-portable-v3",
		SourceCommit: manifest.SourceCommit,
		ReleasePath: target,
		ArtifactPath: systemPath,
		RuntimePath: runtimePath,
		RuntimeReused: runtimeReused,
		Idempotent: false,
		ActivationAllowed: false,
	}, nil
}

func verifyPortableV3Exact(root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo, expectedCommit string) (PortableVerifyReceipt, error) {
	if !commitPattern.MatchString(expectedCommit) {
		return PortableVerifyReceipt{}, errors.New("expected_commit must be lowercase 40-hex")
	}
	releasePath := filepath.Join(root, "releases", expectedCommit)
	info, err := os.Lstat(releasePath)
	if err != nil {
		return PortableVerifyReceipt{}, fmt.Errorf("portable v3 release root: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return PortableVerifyReceipt{}, errors.New("portable v3 release root is not a safe directory")
	}

	envelopePath := filepath.Join(releasePath, "release-envelope.json")
	envelope, err := readBoundedRegularFile(envelopePath, maxEnvelope, "stored portable v3 release envelope")
	if err != nil {
		return PortableVerifyReceipt{}, err
	}
	manifest, payload, err := verifyEnvelope(envelope, trust, key, expectedRepo)
	if err != nil {
		return PortableVerifyReceipt{}, fmt.Errorf("verify stored portable v3 release envelope: %w", err)
	}
	if manifest.Schema != manifestSchemaV3 {
		return PortableVerifyReceipt{}, errors.New("stored portable v3 release is not release-manifest/3")
	}
	if manifest.SourceCommit != expectedCommit {
		return PortableVerifyReceipt{}, fmt.Errorf(
			"stored portable v3 source_commit does not match expected commit: got=%s expected=%s",
			manifest.SourceCommit,
			expectedCommit,
		)
	}
	if err := verifyExistingPortableV3Release(releasePath, root, manifest, payload, envelope); err != nil {
		return PortableVerifyReceipt{}, fmt.Errorf("verify exact portable v3 release: %w", err)
	}
	runtimePath, err := verifyRuntimeStoreFile(root, manifest.Artifacts[1])
	if err != nil {
		return PortableVerifyReceipt{}, err
	}
	return PortableVerifyReceipt{
		Status: "verified-portable-v3-exact",
		SourceCommit: manifest.SourceCommit,
		ReleasePath: releasePath,
		ArtifactPath: filepath.Join(releasePath, "system.erofs"),
		RuntimePath: runtimePath,
		ActivationAllowed: false,
	}, nil
}

func verifyExistingPortableV4Release(path, root string, m Manifest, payload, envelope []byte) error {
	if m.Schema != manifestSchemaV4 {
		return errors.New("portable v4 materialized release requires release-manifest/4")
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	allowed := map[string]bool{
		"system.erofs": true,
		"surface-runtime.sha256": true,
		"local-ai-runtime.sha256": true,
		"release-envelope.json": true,
		"release-manifest.json": true,
	}
	if len(entries) != len(allowed) {
		return errors.New("portable v4 release contains unexpected top-level entry count")
	}
	for _, entry := range entries {
		if !allowed[entry.Name()] {
			return fmt.Errorf("portable v4 release contains unexpected top-level entry: %s", entry.Name())
		}
	}

	manifestPath := filepath.Join(path, "release-manifest.json")
	data, err := readBoundedRegularFile(manifestPath, maxPayload, "stored portable v4 release manifest")
	if err != nil || !bytes.Equal(data, payload) {
		return errors.New("portable v4 release manifest differs from signed payload")
	}
	envelopePath := filepath.Join(path, "release-envelope.json")
	storedEnvelope, err := readBoundedRegularFile(envelopePath, maxEnvelope, "stored portable v4 release envelope")
	if err != nil || !bytes.Equal(storedEnvelope, envelope) {
		return errors.New("portable v4 release envelope differs from verified signed envelope")
	}

	systemArtifact := m.Artifacts[0]
	systemPath := filepath.Join(path, "system.erofs")
	actualHash, actualSize, err := hashFile(systemPath)
	if err != nil || actualSize != systemArtifact.Size {
		return errors.New("portable v4 system image size is invalid")
	}
	if actualHash != systemArtifact.SHA256 {
		return errors.New("portable v4 system image digest mismatch")
	}
	if err := verifyPortableEROFS(systemPath); err != nil {
		return err
	}

	runtimeArtifact := m.Artifacts[1]
	runtimeRefPath := filepath.Join(path, "surface-runtime.sha256")
	runtimeRefBytes, err := readBoundedRegularFile(runtimeRefPath, 128, "stored Surface runtime reference")
	if err != nil {
		return err
	}
	if string(runtimeRefBytes) != runtimeArtifact.SHA256+"\n" {
		return errors.New("portable v4 Surface runtime reference differs from signed manifest")
	}
	if _, err := verifyRuntimeStoreFile(root, runtimeArtifact); err != nil {
		return fmt.Errorf("verify portable v4 Surface runtime store: %w", err)
	}

	aiArtifact := m.Artifacts[2]
	aiRefPath := filepath.Join(path, "local-ai-runtime.sha256")
	aiRefBytes, err := readBoundedRegularFile(aiRefPath, 128, "stored local AI runtime reference")
	if err != nil {
		return err
	}
	if string(aiRefBytes) != aiArtifact.SHA256+"\n" {
		return errors.New("portable v4 local AI runtime reference differs from signed manifest")
	}
	if _, err := verifyAIRuntimeStoreFile(root, aiArtifact); err != nil {
		return fmt.Errorf("verify portable v4 local AI runtime store: %w", err)
	}
	return nil
}

func materializePortableV4(client *http.Client, envelopeURL, root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo, expectedCommit string) (PortableMaterializeReceipt, error) {
	envelope, err := fetchBytes(client, envelopeURL, maxEnvelope)
	if err != nil {
		return PortableMaterializeReceipt{}, fmt.Errorf("fetch envelope: %w", err)
	}
	manifest, payload, err := verifyEnvelope(envelope, trust, key, expectedRepo)
	if err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if manifest.Schema != manifestSchemaV4 {
		return PortableMaterializeReceipt{}, errors.New("materialize-portable-v4 requires release-manifest/4")
	}
	if !commitPattern.MatchString(expectedCommit) {
		return PortableMaterializeReceipt{}, errors.New("expected_commit must be lowercase 40-hex")
	}
	if manifest.SourceCommit != expectedCommit {
		return PortableMaterializeReceipt{}, fmt.Errorf(
			"signed portable v4 release source_commit does not match expected commit: got=%s expected=%s",
			manifest.SourceCommit,
			expectedCommit,
		)
	}
	if err := ensureDir(root, 0o755); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	releases := filepath.Join(root, "releases")
	if err := ensureDir(releases, 0o755); err != nil {
		return PortableMaterializeReceipt{}, err
	}

	runtimePath, runtimeReused, err := materializeRuntimeBlob(client, root, manifest.Artifacts[1])
	if err != nil {
		return PortableMaterializeReceipt{}, err
	}
	aiRuntimePath, aiRuntimeReused, err := materializeAIRuntimeBlob(client, root, manifest.Artifacts[2])
	if err != nil {
		return PortableMaterializeReceipt{}, err
	}

	target := filepath.Join(releases, manifest.SourceCommit)
	systemPath := filepath.Join(target, "system.erofs")
	if info, err := os.Lstat(target); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return PortableMaterializeReceipt{}, errors.New("portable v4 release target exists but is not a safe directory")
		}
		if err := verifyExistingPortableV4Release(target, root, manifest, payload, envelope); err != nil {
			return PortableMaterializeReceipt{}, err
		}
		return PortableMaterializeReceipt{
			Status: "materialized-portable-v4",
			SourceCommit: manifest.SourceCommit,
			ReleasePath: target,
			ArtifactPath: systemPath,
			RuntimePath: runtimePath,
			RuntimeReused: true,
			AIRuntimePath: aiRuntimePath,
			AIRuntimeReused: true,
			Idempotent: true,
			ActivationAllowed: false,
		}, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return PortableMaterializeReceipt{}, err
	}

	stage, err := os.MkdirTemp(releases, ".portable-v4-staging-"+manifest.SourceCommit+"-")
	if err != nil {
		return PortableMaterializeReceipt{}, err
	}
	keepStage := false
	defer func() {
		if !keepStage {
			_ = os.RemoveAll(stage)
		}
	}()

	stageSystem := filepath.Join(stage, "system.erofs")
	if err := downloadArtifact(client, manifest.Artifacts[0], stageSystem); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := verifyPortableEROFS(stageSystem); err != nil {
		return PortableMaterializeReceipt{}, fmt.Errorf("verify portable v4 system image: %w", err)
	}
	if err := writeSynced(filepath.Join(stage, "surface-runtime.sha256"), []byte(manifest.Artifacts[1].SHA256+"\n"), 0o644); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := writeSynced(filepath.Join(stage, "local-ai-runtime.sha256"), []byte(manifest.Artifacts[2].SHA256+"\n"), 0o644); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := writeSynced(filepath.Join(stage, "release-manifest.json"), payload, 0o644); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := writeSynced(filepath.Join(stage, "release-envelope.json"), envelope, 0o644); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := verifyExistingPortableV4Release(stage, root, manifest, payload, envelope); err != nil {
		return PortableMaterializeReceipt{}, fmt.Errorf("verify staged portable v4 release: %w", err)
	}
	if err := syncDir(stage); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	if err := os.Rename(stage, target); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	keepStage = true
	if err := syncDir(releases); err != nil {
		return PortableMaterializeReceipt{}, err
	}
	return PortableMaterializeReceipt{
		Status: "materialized-portable-v4",
		SourceCommit: manifest.SourceCommit,
		ReleasePath: target,
		ArtifactPath: systemPath,
		RuntimePath: runtimePath,
		RuntimeReused: runtimeReused,
		AIRuntimePath: aiRuntimePath,
		AIRuntimeReused: aiRuntimeReused,
		Idempotent: false,
		ActivationAllowed: false,
	}, nil
}

func verifyPortableV4Exact(root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo, expectedCommit string) (PortableVerifyReceipt, error) {
	if !commitPattern.MatchString(expectedCommit) {
		return PortableVerifyReceipt{}, errors.New("expected_commit must be lowercase 40-hex")
	}
	releasePath := filepath.Join(root, "releases", expectedCommit)
	info, err := os.Lstat(releasePath)
	if err != nil {
		return PortableVerifyReceipt{}, fmt.Errorf("portable v4 release root: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return PortableVerifyReceipt{}, errors.New("portable v4 release root is not a safe directory")
	}

	envelopePath := filepath.Join(releasePath, "release-envelope.json")
	envelope, err := readBoundedRegularFile(envelopePath, maxEnvelope, "stored portable v4 release envelope")
	if err != nil {
		return PortableVerifyReceipt{}, err
	}
	manifest, payload, err := verifyEnvelope(envelope, trust, key, expectedRepo)
	if err != nil {
		return PortableVerifyReceipt{}, fmt.Errorf("verify stored portable v4 release envelope: %w", err)
	}
	if manifest.Schema != manifestSchemaV4 {
		return PortableVerifyReceipt{}, errors.New("stored portable v4 release is not release-manifest/4")
	}
	if manifest.SourceCommit != expectedCommit {
		return PortableVerifyReceipt{}, fmt.Errorf(
			"stored portable v4 source_commit does not match expected commit: got=%s expected=%s",
			manifest.SourceCommit,
			expectedCommit,
		)
	}
	if err := verifyExistingPortableV4Release(releasePath, root, manifest, payload, envelope); err != nil {
		return PortableVerifyReceipt{}, fmt.Errorf("verify exact portable v4 release: %w", err)
	}
	// verifyExistingPortableV4Release already validates the exact signed SHA-256,
	// size, safe content-addressed store layout and EROFS identity for both
	// runtimes. Re-hashing the same large immutable blobs again here adds no new
	// authority and doubles removable-media I/O on the exact boot path.
	runtimePath := filepath.Join(
		root,
		"runtimes",
		"sha256",
		manifest.Artifacts[1].SHA256,
		"native-surface-runtime.erofs",
	)
	aiRuntimePath := filepath.Join(
		root,
		"ai-runtimes",
		"sha256",
		manifest.Artifacts[2].SHA256,
		"local-ai-runtime.erofs",
	)
	return PortableVerifyReceipt{
		Status: "verified-portable-v4-exact",
		SourceCommit: manifest.SourceCommit,
		ReleasePath: releasePath,
		ArtifactPath: filepath.Join(releasePath, "system.erofs"),
		RuntimePath: runtimePath,
		AIRuntimePath: aiRuntimePath,
		ActivationAllowed: false,
	}, nil
}

func syncDir(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func writeSynced(path string, data []byte, mode os.FileMode) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func readBoundedRegularFile(path string, maximum int64, label string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() <= 0 || info.Size() > maximum {
		return nil, fmt.Errorf("%s must be a bounded regular non-symlink file", label)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}
	return data, nil
}

func safeCurrentCommit(root string) (string, error) {
	current := filepath.Join(root, "current")
	info, err := os.Lstat(current)
	if err != nil {
		return "", fmt.Errorf("current pointer: %w", err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return "", errors.New("current exists and is not a symlink")
	}
	target, err := os.Readlink(current)
	if err != nil {
		return "", fmt.Errorf("read current pointer: %w", err)
	}
	if filepath.IsAbs(target) || filepath.Clean(target) != target {
		return "", errors.New("current pointer target is not canonical")
	}
	prefix := "releases" + string(filepath.Separator)
	if !strings.HasPrefix(target, prefix) {
		return "", errors.New("current pointer is outside releases")
	}
	commit := strings.TrimPrefix(target, prefix)
	if !commitPattern.MatchString(commit) || strings.Contains(commit, string(filepath.Separator)) {
		return "", errors.New("current pointer does not name an exact release commit")
	}
	releasePath := filepath.Join(root, "releases", commit)
	releaseInfo, err := os.Lstat(releasePath)
	if err != nil {
		return "", fmt.Errorf("current release root: %w", err)
	}
	if !releaseInfo.IsDir() || releaseInfo.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("current release root is not a safe directory")
	}
	entrypoint := filepath.Join(releasePath, "system", "entrypoint")
	entryInfo, err := os.Lstat(entrypoint)
	if err != nil {
		return "", fmt.Errorf("current system entrypoint: %w", err)
	}
	if !entryInfo.Mode().IsRegular() || entryInfo.Mode()&os.ModeSymlink != 0 || entryInfo.Mode().Perm()&0o111 == 0 {
		return "", errors.New("current release is not bootable")
	}
	return commit, nil
}

func verifyMaterializedExact(root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo, expectedCommit string) (Manifest, error) {
	if !commitPattern.MatchString(expectedCommit) {
		return Manifest{}, errors.New("expected_commit must be lowercase 40-hex")
	}
	releasePath := filepath.Join(root, "releases", expectedCommit)
	info, err := os.Lstat(releasePath)
	if err != nil {
		return Manifest{}, fmt.Errorf("materialized release root: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return Manifest{}, errors.New("materialized release root is not a safe directory")
	}

	envelopePath := filepath.Join(releasePath, "release-envelope.json")
	envelope, err := readBoundedRegularFile(envelopePath, maxEnvelope, "stored release envelope")
	if err != nil {
		return Manifest{}, err
	}
	manifest, payload, err := verifyEnvelope(envelope, trust, key, expectedRepo)
	if err != nil {
		return Manifest{}, fmt.Errorf("verify stored release envelope: %w", err)
	}
	if manifest.Schema != manifestSchema {
		return Manifest{}, errors.New("activate-exact supports release-manifest/1 only; portable USB v2 activation requires the dedicated boot handoff")
	}
	if manifest.SourceCommit != expectedCommit {
		return Manifest{}, fmt.Errorf(
			"stored signed release source_commit does not match expected commit: got=%s expected=%s",
			manifest.SourceCommit,
			expectedCommit,
		)
	}
	if err := verifyExistingRelease(releasePath, manifest, payload, envelope); err != nil {
		return Manifest{}, fmt.Errorf("verify materialized exact release: %w", err)
	}
	return manifest, nil
}

func activateExact(root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo, expectedCommit string) (ExactActivationReceipt, error) {
	manifest, err := verifyMaterializedExact(root, trust, key, expectedRepo, expectedCommit)
	if err != nil {
		return ExactActivationReceipt{}, err
	}
	previousCommit, err := safeCurrentCommit(root)
	if err != nil {
		return ExactActivationReceipt{}, err
	}
	idempotent := previousCommit == expectedCommit
	if !idempotent {
		if err := activate(root, expectedCommit); err != nil {
			return ExactActivationReceipt{}, err
		}
		activatedCommit, err := safeCurrentCommit(root)
		if err != nil {
			return ExactActivationReceipt{}, err
		}
		if activatedCommit != expectedCommit {
			return ExactActivationReceipt{}, errors.New("current pointer does not match exact activated commit")
		}
	}
	return ExactActivationReceipt{
		Status:         "activated-exact",
		SourceCommit:   manifest.SourceCommit,
		PreviousCommit: previousCommit,
		ReleasePath:    filepath.Join(root, "releases", expectedCommit),
		CurrentPath:    filepath.Join(root, "current"),
		Idempotent:     idempotent,
	}, nil
}

func activate(root, commit string) error {
	current := filepath.Join(root, "current")
	if info, err := os.Lstat(current); err == nil {
		if info.Mode()&os.ModeSymlink == 0 {
			return errors.New("current exists and is not a symlink")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	tmpFile, err := os.CreateTemp(root, ".current-next-")
	if err != nil {
		return err
	}
	tmp := tmpFile.Name()
	if err := tmpFile.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Remove(tmp); err != nil {
		return err
	}
	defer os.Remove(tmp)
	if err := os.Symlink(filepath.Join("releases", commit), tmp); err != nil {
		return err
	}
	if err := os.Rename(tmp, current); err != nil {
		return err
	}
	return syncDir(root)
}

func inspectRelease(client *http.Client, envelopeURL string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo string) (InspectReceipt, error) {
	envelope, err := fetchBytes(client, envelopeURL, maxEnvelope)
	if err != nil {
		return InspectReceipt{}, fmt.Errorf("fetch envelope: %w", err)
	}
	manifest, _, err := verifyEnvelope(envelope, trust, key, expectedRepo)
	if err != nil {
		return InspectReceipt{}, err
	}
	artifact := manifest.Artifacts[0]
	receipt := InspectReceipt{
		Status:              "verified",
		ManifestSchema:      manifest.Schema,
		SourceCommit:        manifest.SourceCommit,
		ReleaseID:           manifest.ReleaseID,
		CreatedFromCIRecipe: manifest.CreatedFromCIRecipe,
		ProductMode:         manifest.ProductMode,
		StorageProfile:      manifest.StorageProfile,
		RuntimeFormat:       manifest.RuntimeFormat,
		ArtifactName:        artifact.Name,
		ArtifactRole:        artifact.Role,
		ArtifactURL:         artifact.URL,
		ArtifactSHA256:      artifact.SHA256,
		ArtifactSize:        artifact.Size,
	}
	if manifest.Schema == manifestSchemaV3 || manifest.Schema == manifestSchemaV4 {
		receipt.Artifacts = append([]Artifact(nil), manifest.Artifacts...)
	}
	if manifest.Schema == manifestSchemaV4 {
		binding := *manifest.LocalAI
		receipt.LocalAI = &binding
	}
	return receipt, nil
}

func materialize(client *http.Client, envelopeURL, root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo, expectedCommit string) (MaterializeReceipt, error) {
	envelope, err := fetchBytes(client, envelopeURL, maxEnvelope)
	if err != nil {
		return MaterializeReceipt{}, fmt.Errorf("fetch envelope: %w", err)
	}
	manifest, payload, err := verifyEnvelope(envelope, trust, key, expectedRepo)
	if err != nil {
		return MaterializeReceipt{}, err
	}
	if manifest.Schema != manifestSchema {
		return MaterializeReceipt{}, errors.New("materialize supports release-manifest/1 only; use materialize-portable for v2, materialize-portable-v3 for v3 or materialize-portable-v4 for v4")
	}
	if expectedCommit != "" {
		if !commitPattern.MatchString(expectedCommit) {
			return MaterializeReceipt{}, errors.New("expected_commit must be lowercase 40-hex")
		}
		if manifest.SourceCommit != expectedCommit {
			return MaterializeReceipt{}, fmt.Errorf(
				"signed release source_commit does not match expected commit: got=%s expected=%s",
				manifest.SourceCommit,
				expectedCommit,
			)
		}
	}
	if err := ensureDir(root, 0o755); err != nil {
		return MaterializeReceipt{}, err
	}
	releases := filepath.Join(root, "releases")
	if err := ensureDir(releases, 0o755); err != nil {
		return MaterializeReceipt{}, err
	}
	target := filepath.Join(releases, manifest.SourceCommit)
	artifactNames := make([]string, 0, len(manifest.Artifacts))
	for _, a := range manifest.Artifacts {
		artifactNames = append(artifactNames, a.Name)
	}
	if info, err := os.Lstat(target); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return MaterializeReceipt{}, errors.New("release target exists but is not a safe directory")
		}
		if err := verifyExistingRelease(target, manifest, payload, envelope); err != nil {
			return MaterializeReceipt{}, err
		}
		return MaterializeReceipt{"materialized", manifest.SourceCommit, target, artifactNames, true}, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return MaterializeReceipt{}, err
	}

	stage, err := os.MkdirTemp(releases, ".staging-"+manifest.SourceCommit+"-")
	if err != nil {
		return MaterializeReceipt{}, err
	}
	keepStage := false
	defer func() {
		if !keepStage {
			_ = os.RemoveAll(stage)
		}
	}()
	artifactRoot := filepath.Join(stage, "artifacts")
	if err := os.Mkdir(artifactRoot, 0o755); err != nil {
		return MaterializeReceipt{}, err
	}
	for _, a := range manifest.Artifacts {
		archivePath := filepath.Join(artifactRoot, a.Name)
		if err := downloadArtifact(client, a, archivePath); err != nil {
			return MaterializeReceipt{}, err
		}
		if err := extractSystemArchive(archivePath, stage); err != nil {
			return MaterializeReceipt{}, fmt.Errorf("materialize %s: %w", a.Name, err)
		}
	}
	if err := writeSynced(filepath.Join(stage, "release-manifest.json"), payload, 0o644); err != nil {
		return MaterializeReceipt{}, err
	}
	if err := writeSynced(filepath.Join(stage, "release-envelope.json"), envelope, 0o644); err != nil {
		return MaterializeReceipt{}, err
	}
	if err := verifyExistingRelease(stage, manifest, payload, envelope); err != nil {
		return MaterializeReceipt{}, fmt.Errorf("verify staged release: %w", err)
	}
	if err := syncDir(stage); err != nil {
		return MaterializeReceipt{}, err
	}
	if err := os.Rename(stage, target); err != nil {
		return MaterializeReceipt{}, err
	}
	keepStage = true
	if err := syncDir(releases); err != nil {
		return MaterializeReceipt{}, err
	}
	return MaterializeReceipt{"materialized", manifest.SourceCommit, target, artifactNames, false}, nil
}

func install(client *http.Client, envelopeURL, root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo string) (Receipt, error) {
	materialized, err := materialize(
		client,
		envelopeURL,
		root,
		trust,
		key,
		expectedRepo,
		"",
	)
	if err != nil {
		return Receipt{}, err
	}
	if err := activate(root, materialized.SourceCommit); err != nil {
		return Receipt{}, err
	}
	return Receipt{
		"activated",
		materialized.SourceCommit,
		materialized.ReleasePath,
		filepath.Join(root, "current"),
		materialized.Artifacts,
		materialized.Idempotent,
	}, nil
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func verifyCommand(args []string) error {
	fs := flag.NewFlagSet("verify-envelope", flag.ContinueOnError)
	envelopePath := fs.String("envelope", "", "signed release envelope file")
	trustPath := fs.String("trust", "", "release trust anchor file")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || fs.NArg() != 0 {
		return errors.New("verify-envelope requires --envelope and --trust")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(*envelopePath)
	if err != nil {
		return err
	}
	manifest, _, err := verifyEnvelope(data, trust, key, *repository)
	if err != nil {
		return err
	}
	return printJSON(map[string]any{"status": "verified", "source_commit": manifest.SourceCommit, "artifact_count": len(manifest.Artifacts)})
}

func inspectCommand(args []string) error {
	fs := flag.NewFlagSet("inspect", flag.ContinueOnError)
	envelopeURL := fs.String("envelope-url", "", "HTTPS URL for signed release envelope")
	trustPath := fs.String("trust", "", "release trust anchor file")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopeURL == "" || *trustPath == "" || fs.NArg() != 0 {
		return errors.New("inspect requires --envelope-url and --trust")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := inspectRelease(
		secureClient(),
		*envelopeURL,
		trust,
		key,
		*repository,
	)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}

func materializePortableCommand(args []string) error {
	fs := flag.NewFlagSet("materialize-portable", flag.ContinueOnError)
	envelopeURL := fs.String("envelope-url", "", "HTTPS URL for signed portable release envelope")
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/ordax-data/.ordax", "portable OrdaX internal root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	expectedCommit := fs.String("expected-commit", "", "required exact portable source commit")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopeURL == "" || *trustPath == "" || *expectedCommit == "" || fs.NArg() != 0 {
		return errors.New("materialize-portable requires --envelope-url, --trust and --expected-commit")
	}
	if !commitPattern.MatchString(*expectedCommit) {
		return errors.New("expected_commit must be lowercase 40-hex")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := materializePortable(
		secureClient(),
		*envelopeURL,
		*root,
		trust,
		key,
		*repository,
		*expectedCommit,
	)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}

func verifyPortableExactCommand(args []string) error {
	fs := flag.NewFlagSet("verify-portable-exact", flag.ContinueOnError)
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/ordax-data/.ordax", "portable OrdaX internal root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	expectedCommit := fs.String("expected-commit", "", "required exact portable source commit")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *trustPath == "" || *expectedCommit == "" || fs.NArg() != 0 {
		return errors.New("verify-portable-exact requires --trust and --expected-commit")
	}
	if !commitPattern.MatchString(*expectedCommit) {
		return errors.New("expected_commit must be lowercase 40-hex")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := verifyPortableExact(*root, trust, key, *repository, *expectedCommit)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}

func materializePortableV3Command(args []string) error {
	fs := flag.NewFlagSet("materialize-portable-v3", flag.ContinueOnError)
	envelopeURL := fs.String("envelope-url", "", "HTTPS URL for signed portable v3 release envelope")
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/ordax-data/.ordax", "portable OrdaX internal root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	expectedCommit := fs.String("expected-commit", "", "required exact portable v3 source commit")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopeURL == "" || *trustPath == "" || *expectedCommit == "" || fs.NArg() != 0 {
		return errors.New("materialize-portable-v3 requires --envelope-url, --trust and --expected-commit")
	}
	if !commitPattern.MatchString(*expectedCommit) {
		return errors.New("expected_commit must be lowercase 40-hex")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := materializePortableV3(
		secureClient(),
		*envelopeURL,
		*root,
		trust,
		key,
		*repository,
		*expectedCommit,
	)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}

func verifyPortableV3ExactCommand(args []string) error {
	fs := flag.NewFlagSet("verify-portable-v3-exact", flag.ContinueOnError)
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/ordax-data/.ordax", "portable OrdaX internal root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	expectedCommit := fs.String("expected-commit", "", "required exact portable v3 source commit")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *trustPath == "" || *expectedCommit == "" || fs.NArg() != 0 {
		return errors.New("verify-portable-v3-exact requires --trust and --expected-commit")
	}
	if !commitPattern.MatchString(*expectedCommit) {
		return errors.New("expected_commit must be lowercase 40-hex")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := verifyPortableV3Exact(*root, trust, key, *repository, *expectedCommit)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}

func materializePortableV4Command(args []string) error {
	fs := flag.NewFlagSet("materialize-portable-v4", flag.ContinueOnError)
	envelopeURL := fs.String("envelope-url", "", "HTTPS URL for signed portable v4 release envelope")
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/ordax-data/.ordax", "portable OrdaX internal root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	expectedCommit := fs.String("expected-commit", "", "required exact portable v4 source commit")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopeURL == "" || *trustPath == "" || *expectedCommit == "" || fs.NArg() != 0 {
		return errors.New("materialize-portable-v4 requires --envelope-url, --trust and --expected-commit")
	}
	if !commitPattern.MatchString(*expectedCommit) {
		return errors.New("expected_commit must be lowercase 40-hex")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := materializePortableV4(
		secureClient(),
		*envelopeURL,
		*root,
		trust,
		key,
		*repository,
		*expectedCommit,
	)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}

func verifyPortableV4ExactCommand(args []string) error {
	fs := flag.NewFlagSet("verify-portable-v4-exact", flag.ContinueOnError)
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/ordax-data/.ordax", "portable OrdaX internal root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	expectedCommit := fs.String("expected-commit", "", "required exact portable v4 source commit")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *trustPath == "" || *expectedCommit == "" || fs.NArg() != 0 {
		return errors.New("verify-portable-v4-exact requires --trust and --expected-commit")
	}
	if !commitPattern.MatchString(*expectedCommit) {
		return errors.New("expected_commit must be lowercase 40-hex")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := verifyPortableV4Exact(*root, trust, key, *repository, *expectedCommit)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}

func activateExactCommand(args []string) error {
	fs := flag.NewFlagSet("activate-exact", flag.ContinueOnError)
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/ordax", "OrdaX root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	expectedCommit := fs.String("expected-commit", "", "required exact materialized source commit")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *trustPath == "" || *expectedCommit == "" || fs.NArg() != 0 {
		return errors.New("activate-exact requires --trust and --expected-commit")
	}
	if !commitPattern.MatchString(*expectedCommit) {
		return errors.New("expected_commit must be lowercase 40-hex")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := activateExact(*root, trust, key, *repository, *expectedCommit)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}

func installCommand(args []string) error {
	fs := flag.NewFlagSet("install", flag.ContinueOnError)
	envelopeURL := fs.String("envelope-url", "", "HTTPS URL for signed release envelope")
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/ordax", "OrdaX root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopeURL == "" || *trustPath == "" || fs.NArg() != 0 {
		return errors.New("install requires --envelope-url and --trust")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := install(secureClient(), *envelopeURL, *root, trust, key, *repository)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}
func materializeCommand(args []string) error {
	fs := flag.NewFlagSet("materialize", flag.ContinueOnError)
	envelopeURL := fs.String("envelope-url", "", "HTTPS URL for signed release envelope")
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/ordax", "OrdaX root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	expectedCommit := fs.String("expected-commit", "", "required exact source commit")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopeURL == "" || *trustPath == "" || *expectedCommit == "" || fs.NArg() != 0 {
		return errors.New("materialize requires --envelope-url, --trust and --expected-commit")
	}
	if !commitPattern.MatchString(*expectedCommit) {
		return errors.New("expected_commit must be lowercase 40-hex")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := materialize(
		secureClient(),
		*envelopeURL,
		*root,
		trust,
		key,
		*repository,
		*expectedCommit,
	)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}


func usage() {
	fmt.Fprintln(os.Stderr, "usage: ordax-release-agent <verify-envelope|verify-trust-transition|inspect|materialize|materialize-portable|verify-portable-exact|materialize-portable-v3|verify-portable-v3-exact|materialize-portable-v4|verify-portable-v4-exact|activate-exact|install> [options]")
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "verify-envelope":
		err = verifyCommand(os.Args[2:])
	case "verify-trust-transition":
		err = verifyTrustTransitionCommand(os.Args[2:])
	case "inspect":
		err = inspectCommand(os.Args[2:])
	case "materialize":
		err = materializeCommand(os.Args[2:])
	case "materialize-portable":
		err = materializePortableCommand(os.Args[2:])
	case "verify-portable-exact":
		err = verifyPortableExactCommand(os.Args[2:])
	case "materialize-portable-v3":
		err = materializePortableV3Command(os.Args[2:])
	case "verify-portable-v3-exact":
		err = verifyPortableV3ExactCommand(os.Args[2:])
	case "materialize-portable-v4":
		err = materializePortableV4Command(os.Args[2:])
	case "verify-portable-v4-exact":
		err = verifyPortableV4ExactCommand(os.Args[2:])
	case "activate-exact":
		err = activateExactCommand(os.Args[2:])
	case "install":
		err = installCommand(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-release-agent: ERROR:", err)
		os.Exit(1)
	}
}
