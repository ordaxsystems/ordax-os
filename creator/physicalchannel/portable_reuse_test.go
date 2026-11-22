package physicalchannel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type portableSourceTestTransport struct {
	requests []string
	bodies   map[string][]byte
}

func (transport *portableSourceTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	id := filepath.Base(req.URL.Path)
	transport.requests = append(transport.requests, id)
	body, ok := transport.bodies[id]
	if !ok {
		return nil, errors.New("unexpected Portable network download: " + id)
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     make(http.Header),
		Request:    req,
	}, nil
}

func seedPreviousPortableVersion(t *testing.T, root string) (Manifest, map[string][]byte, string) {
	t.Helper()
	payload := validPortablePayload()
	previous := filepath.Join(root, "versions", strings.Repeat("a", 40), portablePayloadDirectory)
	if err := os.MkdirAll(previous, 0o700); err != nil {
		t.Fatal(err)
	}
	bodies := make(map[string][]byte, len(payload.Artifacts))
	for i := range payload.Artifacts {
		id := payload.Artifacts[i].ID
		body := []byte("original signed portable artifact bytes: " + id)
		digest := sha256.Sum256(body)
		payload.Artifacts[i].SHA256 = hex.EncodeToString(digest[:])
		payload.Artifacts[i].SizeBytes = int64(len(body))
		bodies[id] = body
		if err := os.WriteFile(filepath.Join(previous, id), body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	manifest := validManifest()
	manifest.Schema = ManifestSchemaPortable
	manifest.PortablePayload = &payload
	return manifest, bodies, previous
}

func TestPortablePayloadReusesSignedBytesAcrossReleaseVersionsWithoutNetwork(t *testing.T) {
	root := t.TempDir()
	manifest, _, _ := seedPreviousPortableVersion(t, root)
	transport := &portableSourceTestTransport{}
	dest := filepath.Join(root, "candidate")
	if err := os.Mkdir(dest, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := installPortablePayload(
		&http.Client{Transport: transport}, dest, filepath.Join(root, "versions"), manifest,
	); err != nil {
		t.Fatalf("signed artifact reuse failed: %v", err)
	}
	if len(transport.requests) != 0 {
		t.Fatalf("unchanged signed artifacts should not be downloaded: %v", transport.requests)
	}
	if err := verifyPortablePayloadInstalled(dest, manifest); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dest, portablePayloadReceiptName)); err != nil {
		t.Fatal(err)
	}
}

func TestPortablePayloadDoesNotReuseCorruptOrSymlinkedPreviousSources(t *testing.T) {
	for _, mode := range []string{"corrupt", "symlink"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			manifest, bodies, previous := seedPreviousPortableVersion(t, root)
			kernel := filepath.Join(previous, "kernel")
			if err := os.Remove(kernel); err != nil {
				t.Fatal(err)
			}
			if mode == "symlink" {
				target := filepath.Join(root, "external-kernel")
				if err := os.WriteFile(target, bodies["kernel"], 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, kernel); err != nil {
					t.Skipf("symlinks not available: %v", err)
				}
			} else if err := os.WriteFile(kernel, []byte("corrupt"), 0o600); err != nil {
				t.Fatal(err)
			}
			transport := &portableSourceTestTransport{bodies: bodies}
			dest := filepath.Join(root, "candidate")
			if err := os.Mkdir(dest, 0o700); err != nil {
				t.Fatal(err)
			}
			if err := installPortablePayload(
				&http.Client{Transport: transport}, dest, filepath.Join(root, "versions"), manifest,
			); err != nil {
				t.Fatal(err)
			}
			if len(transport.requests) != 1 || transport.requests[0] != "kernel" {
				t.Fatalf("expected only kernel redownload, got %v", transport.requests)
			}
			if err := verifyPortablePayloadInstalled(dest, manifest); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPortablePayloadMissingSignedSourceFailsClosedWithoutNetwork(t *testing.T) {
	root := t.TempDir()
	manifest, _, previous := seedPreviousPortableVersion(t, root)
	if err := os.Remove(filepath.Join(previous, "kernel")); err != nil {
		t.Fatal(err)
	}
	transport := &portableSourceTestTransport{}
	dest := filepath.Join(root, "candidate")
	if err := os.Mkdir(dest, 0o700); err != nil {
		t.Fatal(err)
	}
	err := installPortablePayload(
		&http.Client{Transport: transport}, dest, filepath.Join(root, "versions"), manifest,
	)
	if err == nil || !strings.Contains(err.Error(), "unexpected Portable network download") {
		t.Fatalf("missing signed bytes should fail closed: %v", err)
	}
	if len(transport.requests) != 1 || transport.requests[0] != "kernel" {
		t.Fatalf("unexpected download requests: %v", transport.requests)
	}
	if _, err := os.Stat(filepath.Join(dest, portablePayloadReceiptName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("an incomplete candidate must never receive a verified receipt: %v", err)
	}
}

func TestPortablePayloadRejectsSymlinkedVersionRoot(t *testing.T) {
	root := t.TempDir()
	manifest, _, _ := seedPreviousPortableVersion(t, root)
	versions := filepath.Join(root, "versions")
	link := filepath.Join(root, "versions-link")
	if err := os.Symlink(versions, link); err != nil {
		t.Skipf("symlinks not available: %v", err)
	}
	dest := filepath.Join(root, "candidate")
	if err := os.Mkdir(dest, 0o700); err != nil {
		t.Fatal(err)
	}
	err := installPortablePayload(&http.Client{Transport: &portableSourceTestTransport{}}, dest, link, manifest)
	if err == nil || !strings.Contains(err.Error(), "cache root") {
		t.Fatalf("symlinked versions root must be rejected: %v", err)
	}
}

func TestPortableReuseSourceIdentityAlwaysComesFromSignedBinding(t *testing.T) {
	root := t.TempDir()
	manifest, bodies, _ := seedPreviousPortableVersion(t, root)
	payload := *manifest.PortablePayload
	payload.Artifacts = append([]PortablePayloadArtifactBinding(nil), payload.Artifacts...)
	for i := range payload.Artifacts {
		if payload.Artifacts[i].ID == "kernel" {
			alternate := []byte("a different signed kernel image")
			sum := sha256.Sum256(alternate)
			payload.Artifacts[i].SHA256 = hex.EncodeToString(sum[:])
			payload.Artifacts[i].SizeBytes = int64(len(alternate))
			bodies["kernel"] = alternate
		}
	}
	manifest.PortablePayload = &payload
	transport := &portableSourceTestTransport{bodies: bodies}
	dest := filepath.Join(root, "candidate")
	if err := os.Mkdir(dest, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := installPortablePayload(
		&http.Client{Transport: transport}, dest, filepath.Join(root, "versions"), manifest,
	); err != nil {
		t.Fatal(err)
	}
	if len(transport.requests) != 1 || transport.requests[0] != "kernel" {
		t.Fatalf("new signed kernel must be fetched, got %v", transport.requests)
	}
	if err := verifyPortablePayloadInstalled(dest, manifest); err != nil {
		t.Fatal(fmt.Errorf("new signed binding was not honored: %w", err))
	}
}

func TestPortablePayloadSkipsOversizedSparseDonorBeforeHashing(t *testing.T) {
	root := t.TempDir()
	manifest, bodies, previous := seedPreviousPortableVersion(t, root)
	kernel := filepath.Join(previous, "kernel")
	// A stale version may contain a very large sparse file under a known ID.
	// The signed size must be checked before reading any cached contents.
	if err := os.Truncate(kernel, 64<<20); err != nil {
		t.Skipf("sparse truncation unavailable: %v", err)
	}
	transport := &portableSourceTestTransport{bodies: bodies}
	dest := filepath.Join(root, "candidate")
	if err := os.Mkdir(dest, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := installPortablePayload(
		&http.Client{Transport: transport}, dest, filepath.Join(root, "versions"), manifest,
	); err != nil {
		t.Fatal(err)
	}
	if len(transport.requests) != 1 || transport.requests[0] != "kernel" {
		t.Fatalf("only the oversized mismatched donor must be downloaded, got %v", transport.requests)
	}
	if err := verifyPortablePayloadInstalled(dest, manifest); err != nil {
		t.Fatal(err)
	}
}

func TestOfflinePortableReceiptRejectsOversizedCacheBeforeReading(t *testing.T) {
	root := t.TempDir()
	manifest := validManifest()
	manifest.Schema = ManifestSchemaPortable
	payload := validPortablePayload()
	manifest.PortablePayload = &payload
	expected, err := canonicalPortablePayloadBytes(payload)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, portablePayloadReceiptName)
	if err := os.WriteFile(path, expected, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(path, 8<<20); err != nil {
		t.Fatal(err)
	}
	if err := verifyPortablePayloadInstalled(root, manifest); err == nil ||
		!strings.Contains(err.Error(), "outside allowed size") {
		t.Fatalf("oversized portable receipt was accepted: %v", err)
	}
}

func TestPortablePayloadSameLengthCorruptDonorFallsBackToSignedDownload(t *testing.T) {
	root := t.TempDir()
	manifest, bodies, previous := seedPreviousPortableVersion(t, root)
	kernel := filepath.Join(previous, "kernel")
	corrupted := bytes.Repeat([]byte("x"), len(bodies["kernel"]))
	if err := os.WriteFile(kernel, corrupted, 0o600); err != nil {
		t.Fatal(err)
	}
	transport := &portableSourceTestTransport{bodies: bodies}
	dest := filepath.Join(root, "candidate")
	if err := os.Mkdir(dest, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := installPortablePayload(
		&http.Client{Transport: transport}, dest, filepath.Join(root, "versions"), manifest,
	); err != nil {
		t.Fatalf("same-sized donor corruption prevented authenticated recovery: %v", err)
	}
	if len(transport.requests) != 1 || transport.requests[0] != "kernel" {
		t.Fatalf("same-size corrupt kernel should be downloaded once, got %v", transport.requests)
	}
	kernelBytes, err := os.ReadFile(filepath.Join(dest, portablePayloadDirectory, "kernel"))
	if err != nil || !bytes.Equal(kernelBytes, bodies["kernel"]) {
		t.Fatalf("staging retained corrupt donor bytes: err=%v", err)
	}
	if err := verifyPortablePayloadInstalled(dest, manifest); err != nil {
		t.Fatalf("new candidate did not verify against signed 17-source manifest: %v", err)
	}
}

func TestPortablePayloadSkipsCorruptDonorAndReusesNextExactSignedCopy(t *testing.T) {
	root := t.TempDir()
	manifest, bodies, previous := seedPreviousPortableVersion(t, root)
	otherVersion := filepath.Join(root, "versions", strings.Repeat("b", 40), portablePayloadDirectory)
	if err := os.MkdirAll(otherVersion, 0o700); err != nil {
		t.Fatal(err)
	}
	for id, body := range bodies {
		if err := os.WriteFile(filepath.Join(otherVersion, id), body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	kernel := filepath.Join(previous, "kernel")
	if err := os.WriteFile(kernel, bytes.Repeat([]byte("x"), len(bodies["kernel"])), 0o600); err != nil {
		t.Fatal(err)
	}
	transport := &portableSourceTestTransport{}
	dest := filepath.Join(root, "candidate")
	if err := os.Mkdir(dest, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := installPortablePayload(
		&http.Client{Transport: transport}, dest, filepath.Join(root, "versions"), manifest,
	); err != nil {
		t.Fatalf("corrupt donor prevented reuse of another exact signed copy: %v", err)
	}
	if len(transport.requests) != 0 {
		t.Fatalf("second valid signed donor should avoid network downloads: %v", transport.requests)
	}
	if err := verifyPortablePayloadInstalled(dest, manifest); err != nil {
		t.Fatalf("recovered Portable candidate failed signed integrity check: %v", err)
	}
}
