package update

import (
	"archive/zip"
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
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/ordaxsystems/ordax-os/creator/internal/archivebounds"
	"github.com/ordaxsystems/ordax-os/creator/internal/atomicfile"
	"github.com/ordaxsystems/ordax-os/creator/internal/cachepath"
	"github.com/ordaxsystems/ordax-os/creator/internal/safefile"
)

const (
	ChannelSchemaV1        = "prototype-ordax.creator-update-channel/1"
	ChannelSchemaV2        = "prototype-ordax.creator-update-channel/2"
	ChannelSchema          = ChannelSchemaV2
	DevelopmentChannel     = "development"
	DefaultManifestURL     = "https://github.com/ordaxsystems/ordax-os/releases/download/creator-dev/creator-dev-manifest.json"
	maxManifestBytes       = 256 << 10
	maxPayloadBytes        = int64(128 << 20)
	maxExtractedBytes      = int64(256 << 20)
	maxArchiveFileCount    = 128
	maxInstalledPointerBytes = 128 << 10
)

var (
	commitPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern     = regexp.MustCompile(`^[0-9a-f]{64}$`)
	versionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)
)

type Payload struct {
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type Entrypoints struct {
	Inspect string `json:"inspect"`
	Status  string `json:"status"`
}

type Manifest struct {
	Schema       string      `json:"$schema"`
	Channel      string      `json:"channel"`
	Version      string      `json:"version"`
	SourceCommit string      `json:"source_commit"`
	Payload      Payload     `json:"payload"`
	Entrypoints  Entrypoints `json:"entrypoints"`
}

type legacyEntrypointsV1 struct {
	Inspect string `json:"inspect"`
	Trust   string `json:"trust"`
	Status  string `json:"status"`
}

type legacyManifestV1 struct {
	Schema       string              `json:"$schema"`
	Channel      string              `json:"channel"`
	Version      string              `json:"version"`
	SourceCommit string              `json:"source_commit"`
	Payload      Payload             `json:"payload"`
	Entrypoints  legacyEntrypointsV1 `json:"entrypoints"`
}

type InstalledFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type Installed struct {
	Schema        string          `json:"$schema"`
	Channel       string          `json:"channel"`
	Version       string          `json:"version"`
	SourceCommit  string          `json:"source_commit"`
	Directory     string          `json:"directory"`
	PayloadSHA256 string          `json:"payload_sha256"`
	Files         []InstalledFile `json:"files"`
}

func installRoot() (string, error) {
	if runtime.GOOS == "windows" {
		if profile := strings.TrimSpace(os.Getenv("USERPROFILE")); profile != "" {
			return filepath.Join(profile, "OrdaX-Creator"), nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ordax-creator"), nil
}

func safeRelative(name string) bool {
	// The development payload is unpacked on Windows. Validate Windows path
	// semantics even when CI runs on Linux, before touching the filesystem.
	if name == "" || filepath.IsAbs(name) || strings.HasPrefix(name, "/") ||
		strings.ContainsAny(name, "\\:<>\"|?*\x00") {
		return false
	}
	for _, ch := range name {
		if ch < 0x20 {
			return false
		}
	}
	for _, segment := range strings.Split(name, "/") {
		if segment == "" || segment == "." || segment == ".." ||
			strings.HasSuffix(segment, ".") || strings.HasSuffix(segment, " ") {
			return false
		}
		base := strings.ToUpper(strings.TrimRight(strings.SplitN(segment, ".", 2)[0], " "))
		switch base {
		case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
			"COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³":
			return false
		}
		if len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) &&
			base[3] >= '1' && base[3] <= '9' {
			return false
		}
	}
	clean := filepath.Clean(filepath.FromSlash(name))
	return clean == filepath.FromSlash(name)
}

func validateAssetURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" ||
		parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" ||
		parsed.ForceQuery || parsed.Opaque != "" || parsed.EscapedPath() != parsed.Path {
		return errors.New("payload URL must be a canonical HTTPS github.com release asset URL")
	}
	const prefix = "/ordaxsystems/ordax-os/releases/download/creator-dev/"
	if !strings.HasPrefix(parsed.Path, prefix) {
		return errors.New("payload URL must stay inside the OrdaX creator-dev release")
	}
	asset := strings.TrimPrefix(parsed.Path, prefix)
	if !safeRelative(asset) || strings.Contains(asset, "/") || !strings.HasSuffix(strings.ToLower(asset), ".zip") {
		return errors.New("payload URL must name a single canonical ZIP asset")
	}
	return nil
}

func ValidateManifest(m Manifest) error {
	if m.Schema != ChannelSchemaV1 && m.Schema != ChannelSchemaV2 {
		return fmt.Errorf("unsupported update schema %q", m.Schema)
	}
	if m.Channel != DevelopmentChannel {
		return fmt.Errorf("development bootstrap refuses channel %q", m.Channel)
	}
	if !versionPattern.MatchString(m.Version) {
		return errors.New("invalid update version")
	}
	if !commitPattern.MatchString(m.SourceCommit) {
		return errors.New("source_commit must be lowercase 40-hex")
	}
	if !shaPattern.MatchString(m.Payload.SHA256) {
		return errors.New("payload SHA-256 must be lowercase 64-hex")
	}
	if m.Payload.Size <= 0 || m.Payload.Size > maxPayloadBytes {
		return errors.New("payload size outside allowed range")
	}
	if err := validateAssetURL(m.Payload.URL); err != nil {
		return err
	}
	for label, value := range map[string]string{
		"inspect": m.Entrypoints.Inspect,
		"status":  m.Entrypoints.Status,
	} {
		if !safeRelative(value) {
			return fmt.Errorf("unsafe %s entrypoint", label)
		}
	}
	return nil
}

func decodeStrict(data []byte, target any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
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

func decodeManifest(data []byte) (Manifest, error) {
	if len(data) == 0 || len(data) > maxManifestBytes {
		return Manifest{}, errors.New("update manifest size outside allowed range")
	}
	var header struct {
		Schema string `json:"$schema"`
	}
	if err := json.Unmarshal(data, &header); err != nil {
		return Manifest{}, err
	}

	var manifest Manifest
	switch header.Schema {
	case ChannelSchemaV2:
		if err := decodeStrict(data, &manifest); err != nil {
			return Manifest{}, err
		}
	case ChannelSchemaV1:
		var legacy legacyManifestV1
		if err := decodeStrict(data, &legacy); err != nil {
			return Manifest{}, err
		}
		if !safeRelative(legacy.Entrypoints.Trust) {
			return Manifest{}, errors.New("unsafe legacy compatibility entrypoint")
		}
		manifest = Manifest{
			Schema: legacy.Schema, Channel: legacy.Channel, Version: legacy.Version,
			SourceCommit: legacy.SourceCommit, Payload: legacy.Payload,
			Entrypoints: Entrypoints{Inspect: legacy.Entrypoints.Inspect, Status: legacy.Entrypoints.Status},
		}
	default:
		return Manifest{}, fmt.Errorf("unsupported update schema %q", header.Schema)
	}
	if err := ValidateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func fetchBytes(client *http.Client, raw string, limit int64) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Updater/2")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from update source", resp.StatusCode)
	}
	reader := io.LimitReader(resp.Body, limit+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("download exceeded allowed size")
	}
	return data, nil
}

func FetchManifest(client *http.Client, manifestURL string) (Manifest, error) {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	if manifestURL == "" {
		manifestURL = DefaultManifestURL
	}
	separator := "?"
	if strings.Contains(manifestURL, "?") {
		separator = "&"
	}
	data, err := fetchBytes(client, manifestURL+separator+"ordax_nocache="+fmt.Sprint(time.Now().UnixNano()), maxManifestBytes)
	if err != nil {
		return Manifest{}, err
	}
	return decodeManifest(data)
}

func downloadPayload(client *http.Client, payload Payload, out string) error {
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	req, err := http.NewRequest(http.MethodGet, payload.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Updater/2")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d while downloading Creator payload", resp.StatusCode)
	}
	file, err := os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		_ = file.Close()
		if remove {
			_ = os.Remove(out)
		}
	}()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(file, h), io.LimitReader(resp.Body, payload.Size+1))
	if err != nil {
		return err
	}
	if n != payload.Size {
		return fmt.Errorf("payload size mismatch: expected=%d actual=%d", payload.Size, n)
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if actual != payload.SHA256 {
		return fmt.Errorf("payload SHA-256 mismatch: expected=%s actual=%s", payload.SHA256, actual)
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

func verifyEntrypoints(directory string, manifest Manifest) error {
	for label, entry := range map[string]string{
		"inspect": manifest.Entrypoints.Inspect,
		"status":  manifest.Entrypoints.Status,
	} {
		info, err := os.Lstat(filepath.Join(directory, filepath.FromSlash(entry)))
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("required %s entrypoint missing or unsafe", label)
		}
	}
	return nil
}

func extractPayload(zipPath, destination string, manifest Manifest) error {
	archive, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer archive.Close()
	if len(archive.File) == 0 || len(archive.File) > maxArchiveFileCount {
		return errors.New("archive file count outside allowed range")
	}
	seen := make(map[string]struct{}, len(archive.File))
	var total int64
	for _, item := range archive.File {
		name := item.Name
		// ZIP directories conventionally end in "/"; validate the normalized
		// path, not the marker, on Linux and Windows alike.
		if item.FileInfo().IsDir() {
			name = strings.TrimSuffix(name, "/")
		}
		if !safeRelative(name) {
			return fmt.Errorf("unsafe archive path %q", item.Name)
		}
		cleanName := filepath.Clean(filepath.FromSlash(name))
		// Windows paths are case-insensitive; reject aliases even in Linux CI.
		caseFolded := strings.ToLower(cleanName)
		if _, exists := seen[caseFolded]; exists {
			return fmt.Errorf("duplicate archive path %q", item.Name)
		}
		seen[caseFolded] = struct{}{}
		if item.FileInfo().Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink is forbidden in update archive: %q", item.Name)
		}
		total, err = archivebounds.Add(total, item.UncompressedSize64, maxExtractedBytes)
		if err != nil {
			return fmt.Errorf("development ZIP entry %q: %w", item.Name, err)
		}
		target := filepath.Join(destination, cleanName)
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		r, err := item.Open()
		if err != nil {
			return err
		}
		w, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
		if err != nil {
			_ = r.Close()
			return err
		}
		_, copyErr := archivebounds.CopyExact(w, r, item.UncompressedSize64)
		closeWriteErr := w.Close()
		closeReadErr := r.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeWriteErr != nil {
			return closeWriteErr
		}
		if closeReadErr != nil {
			return closeReadErr
		}
	}
	return verifyEntrypoints(destination, manifest)
}

func samePath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// An unsigned development receipt detects cached byte changes only; it is
// never evidence of publisher trust or physical-write authorization.
func installedFileInventory(directory string) ([]InstalledFile, error) {
	info, err := os.Lstat(directory)
	if err != nil { return nil, err }
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("Creator development directory is unsafe")
	}
	files := make([]InstalledFile, 0, 8)
	var total int64
	err = filepath.WalkDir(directory, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil { return walkErr }
		if path == directory { return nil }
		rel, err := filepath.Rel(directory, path)
		if err != nil { return err }
		name := filepath.ToSlash(rel)
		if !safeRelative(name) { return fmt.Errorf("unsafe cached Creator path %q", name) }
		if entry.IsDir() { return nil }
		if !entry.Type().IsRegular() || entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("unsafe cached Creator file %q", name)
		}
		if len(files) >= maxArchiveFileCount { return errors.New("Creator cache exceeds file limit") }
		fileInfo, err := entry.Info()
		if err != nil { return err }
		if fileInfo.Size() < 0 || fileInfo.Size() > maxExtractedBytes-total {
			return errors.New("Creator cache exceeds size limit")
		}
		hash, n, err := safefile.DigestInventoryRegular(path, fileInfo.Size())
		if err != nil { return fmt.Errorf("verify cached Creator file %q: %w", name, err) }
		total += n
		files = append(files, InstalledFile{Path:name, Size:n, SHA256:hash})
		return nil
	})
	if err != nil { return nil, err }
	if len(files) == 0 { return nil, errors.New("Creator cache has no files") }
	sort.Slice(files, func(i,j int) bool { return files[i].Path < files[j].Path })
	return files, nil
}

func sameInstalledFiles(a,b []InstalledFile) bool {
	if len(a) == 0 || len(a) != len(b) { return false }
	for i := range a { if a[i] != b[i] { return false } }
	return true
}

func verifyInstalledFiles(installed Installed) error {
	if !shaPattern.MatchString(installed.PayloadSHA256) ||
		len(installed.Files) == 0 || len(installed.Files) > maxArchiveFileCount {
		return errors.New("Creator development cache lacks verified payload receipt")
	}
	actual, err := installedFileInventory(installed.Directory)
	if err != nil { return err }
	if !sameInstalledFiles(installed.Files,actual) {
		return errors.New("Creator development cache file integrity mismatch")
	}
	return nil
}

func Current(root string) (Installed, error) {
	if root == "" {
		var err error
		root, err = installRoot()
		if err != nil {
			return Installed{}, err
		}
	}
	pointer := filepath.Join(root, "current.json")
	// The development receipt is unsigned but still a local integrity
	// boundary: reject a switched or symlinked pointer on its opened handle.
	data, err := safefile.ReadBoundedRegular(pointer, maxInstalledPointerBytes)
	if err != nil {
		return Installed{}, err
	}
	var current Installed
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&current); err != nil {
		return Installed{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return Installed{}, errors.New("invalid installed Creator metadata")
	}
	if current.Schema != "prototype-ordax.creator-installed/1" || current.Channel != DevelopmentChannel || !versionPattern.MatchString(current.Version) || !commitPattern.MatchString(current.SourceCommit) {
		return Installed{}, errors.New("invalid installed Creator metadata")
	}
	if _, err := cachepath.Versions(root); err != nil {
		return Installed{}, err
	}
	expected := filepath.Join(root, "versions", current.SourceCommit)
	if !samePath(current.Directory, expected) {
		return Installed{}, errors.New("installed Creator directory is outside its version slot")
	}
	info, err := os.Lstat(current.Directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return Installed{}, errors.New("installed Creator directory is unavailable or unsafe")
	}
	if err := verifyInstalledFiles(current); err != nil {
		return Installed{}, err
	}
	return current, nil
}

func Ensure(client *http.Client, root, manifestURL string) (Installed, bool, error) {
	if root == "" {
		var err error
		root, err = installRoot()
		if err != nil { return Installed{}, false, err }
	}
	manifest, err := FetchManifest(client, manifestURL)
	if err != nil { return Installed{}, false, err }
	if current, err := Current(root); err == nil && current.SourceCommit == manifest.SourceCommit {
		if current.Version != manifest.Version || current.PayloadSHA256 != manifest.Payload.SHA256 {
			return Installed{}, false, errors.New("cached Creator metadata conflicts with published source/payload")
		}
		if err := verifyEntrypoints(current.Directory, manifest); err != nil {
			return Installed{}, false, fmt.Errorf("installed Creator payload failed validation: %w", err)
		}
		return current, false, nil
	}

	versionsDir, err := cachepath.EnsureVersions(root)
	if err != nil { return Installed{}, false, err }
	finalDir := filepath.Join(versionsDir, manifest.SourceCommit)
	existingSlot := false
	if info, err := os.Lstat(finalDir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return Installed{}, false, errors.New("existing Creator version slot is unsafe")
		}
		existingSlot = true
	} else if !errors.Is(err, os.ErrNotExist) {
		return Installed{}, false, err
	}
	// Legacy or unverified slots require a fresh exact ZIP verification before
	// adoption; never trust the existence of two expected executables alone.
	tempDir, err := os.MkdirTemp(versionsDir, ".install-*")
	if err != nil { return Installed{}, false, err }
	defer os.RemoveAll(tempDir)
	zipPath := filepath.Join(tempDir, "payload.zip")
	if err := downloadPayload(client, manifest.Payload, zipPath); err != nil { return Installed{}, false, err }
	extracted := filepath.Join(tempDir, "payload")
	if err := os.Mkdir(extracted, 0o755); err != nil { return Installed{}, false, err }
	if err := extractPayload(zipPath, extracted, manifest); err != nil { return Installed{}, false, err }
	files, err := installedFileInventory(extracted)
	if err != nil { return Installed{}, false, err }
	changed := !existingSlot
	if existingSlot {
		localFiles, err := installedFileInventory(finalDir)
		if err != nil || !sameInstalledFiles(files,localFiles) {
			return Installed{}, false, errors.New("existing Creator version slot differs from verified development payload")
		}
	} else if err := os.Rename(extracted, finalDir); err != nil {
		return Installed{}, false, err
	}
	installed := Installed{
		Schema:"prototype-ordax.creator-installed/1", Channel:manifest.Channel,
		Version:manifest.Version, SourceCommit:manifest.SourceCommit,
		Directory:finalDir, PayloadSHA256:manifest.Payload.SHA256, Files:files,
	}
	if err := verifyInstalledFiles(installed); err != nil { return Installed{}, false, err }
	if err := verifyEntrypoints(finalDir, manifest); err != nil { return Installed{}, false, err }
	data, err := json.MarshalIndent(installed, "", "  ")
	if err != nil { return Installed{}, false, err }
	data = append(data, '\n')
	if len(data) > maxInstalledPointerBytes {
		return Installed{}, false, errors.New("Creator development receipt exceeds size limit")
	}
	if err := atomicfile.Replace(filepath.Join(root,"current.json"),data); err != nil {
		return Installed{}, false, err
	}
	return installed, changed, nil
}
