package physicalchannel

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testTrust(t *testing.T) ([]byte, ed25519.PrivateKey, string) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	trust := TrustAnchor{
		Schema:       TrustSchema,
		KeyID:        "ordax-prototype-release-v1",
		PublicKeyB64: base64.StdEncoding.EncodeToString(public),
	}
	data, err := json.Marshal(trust)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	return data, private, hex.EncodeToString(digest[:])
}

func validManifest() Manifest {
	files := []FileBinding{
		{Name: "ordax-creator-physical-test.exe", SHA256: strings.Repeat("1", 64), Size: 11},
		{Name: "release-ed25519.json", SHA256: strings.Repeat("2", 64), Size: 22},
		{Name: "minimal-bootstrap.json", SHA256: strings.Repeat("3", 64), Size: 33},
		{Name: "portable-usb-v2.json", SHA256: strings.Repeat("4", 64), Size: 44},
		{Name: "creator-portable-media-plan.json", SHA256: strings.Repeat("5", 64), Size: 55},
		{Name: "physical-write-authorization.json", SHA256: strings.Repeat("6", 64), Size: 66},
		{Name: "provenance.json", SHA256: strings.Repeat("7", 64), Size: 77},
		{Name: "SHA256SUMS", SHA256: strings.Repeat("8", 64), Size: 88},
	}
	return Manifest{
		Schema:            ManifestSchema,
		Purpose:           Purpose,
		SourceRepository:  SourceRepository,
		SourceCommit:      "0123456789abcdef0123456789abcdef01234567",
		CreatedFromRecipe: Recipe,
		Bundle: Bundle{
			URL:    "https://github.com/ordaxsystems/ordax-os/releases/download/creator-physical/ordax-creator-physical-windows-amd64.zip",
			SHA256: strings.Repeat("a", 64),
			Size:   1234,
		},
		Files: files,
	}
}


func validPortablePayload() PortablePayloadManifest {
	ids := []string{
		"systemd-boot", "loader-config", "loader-normal", "loader-recovery",
		"kernel", "initramfs", "bootstrap-capsule", "release-trust",
		"stable-base", "persistent-state", "system-image",
		"surface-runtime-image", "surface-runtime-ref",
		"local-ai-runtime-image", "local-ai-runtime-ref",
		"release-manifest", "release-envelope",
	}
	artifacts := make([]PortablePayloadArtifactBinding, 0, len(ids))
	for i, id := range ids {
		artifacts = append(artifacts, PortablePayloadArtifactBinding{
			ID: id,
			URL: "https://github.com/ordaxsystems/ordax-os/releases/download/ordax-stable-v4-0123456789abcdef0123456789abcdef01234567/" + id,
			SHA256: strings.Repeat(fmt.Sprintf("%x", (i%15)+1), 64),
			SizeBytes: int64(i + 1),
		})
	}
	return PortablePayloadManifest{
		Schema: PortablePayloadSchema,
		ReleaseSourceCommit: "0123456789abcdef0123456789abcdef01234567",
		Artifacts: artifacts,
	}
}

func signedEnvelope(t *testing.T, manifest Manifest, private ed25519.PrivateKey) []byte {
	t.Helper()
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	envelope := Envelope{
		Schema:    EnvelopeSchema,
		Payload:   payload,
		Signature: ed25519.Sign(private, payload),
		KeyID:     "ordax-prototype-release-v1",
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestVerifyEnvelopeAcceptsBoundPhysicalPurpose(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest, err := VerifyEnvelope(signedEnvelope(t, validManifest(), private), trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Purpose != Purpose || manifest.SourceCommit == "" {
		t.Fatalf("unexpected manifest: %+v", manifest)
	}
}

func TestVerifyEnvelopeRejectsWrongTrustBytes(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	trust = append(append([]byte(nil), trust...), '\n')
	if _, err := VerifyEnvelope(signedEnvelope(t, validManifest(), private), trust, trustSHA); err == nil || !strings.Contains(err.Error(), "pinned SHA-256") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestVerifyEnvelopeRejectsWrongPurpose(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest := validManifest()
	manifest.Purpose = "system-release"
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil || !strings.Contains(err.Error(), "purpose") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestVerifyEnvelopeRejectsTamperedSignature(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	data := signedEnvelope(t, validManifest(), private)
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.Signature[0] ^= 0xff
	data, _ = json.Marshal(envelope)
	if _, err := VerifyEnvelope(data, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestVerifyEnvelopeRejectsMissingOrDuplicateFileBindings(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest := validManifest()
	manifest.Files = manifest.Files[:4]
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil {
		t.Fatal("missing bound file unexpectedly accepted")
	}
	manifest = validManifest()
	manifest.Files[4] = manifest.Files[0]
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil {
		t.Fatal("duplicate bound file unexpectedly accepted")
	}
}

func writeBoundFiles(t *testing.T, dir string) Manifest {
	t.Helper()
	manifest := validManifest()
	for i := range manifest.Files {
		body := []byte("content-for-" + manifest.Files[i].Name)
		path := filepath.Join(dir, manifest.Files[i].Name)
		if err := os.WriteFile(path, body, 0o600); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		manifest.Files[i].SHA256 = hex.EncodeToString(digest[:])
		manifest.Files[i].Size = int64(len(body))
	}
	return manifest
}

func TestVerifyInstalledRehashesCriticalFilesEveryTime(t *testing.T) {
	dir := t.TempDir()
	manifest := writeBoundFiles(t, dir)
	if err := VerifyInstalled(dir, manifest); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "provenance.json"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyInstalled(dir, manifest); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func zipWithEntries(t *testing.T, entries map[string][]byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "candidate.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(file)
	for name, body := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(body); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestExtractBundleRejectsUnexpectedAndTraversalFiles(t *testing.T) {
	manifest := validManifest()
	zipPath := zipWithEntries(t, map[string][]byte{"evil.exe": []byte("x")})
	dest := t.TempDir()
	if err := extractBundle(zipPath, dest, manifest); err == nil || !strings.Contains(err.Error(), "unexpected") {
		t.Fatalf("unexpected error: %v", err)
	}

	path := filepath.Join(t.TempDir(), "traversal.zip")
	var data bytes.Buffer
	zw := zip.NewWriter(&data)
	w, err := zw.Create("../evil")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.Write([]byte("x"))
	_ = zw.Close()
	if err := os.WriteFile(path, data.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := extractBundle(path, t.TempDir(), manifest); err == nil || !strings.Contains(err.Error(), "unsafe") {
		t.Fatalf("unexpected error: %v", err)
	}
}


func TestVerifyEnvelopeAcceptsPortableManifestV3(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest := validManifest()
	manifest.Schema = ManifestSchemaPortable
	payload := validPortablePayload()
	manifest.PortablePayload = &payload
	verified, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if verified.PortablePayload == nil || len(verified.PortablePayload.Artifacts) != 17 {
		t.Fatalf("unexpected Portable payload: %+v", verified.PortablePayload)
	}
}

func TestVerifyEnvelopeRejectsPortablePayloadOnV2AndMissingPayloadOnV3(t *testing.T) {
	trust, private, trustSHA := testTrust(t)

	v2 := validManifest()
	payload := validPortablePayload()
	v2.PortablePayload = &payload
	if _, err := VerifyEnvelope(signedEnvelope(t, v2, private), trust, trustSHA); err == nil ||
		!strings.Contains(err.Error(), "v2 cannot carry") {
		t.Fatalf("v2 Portable payload unexpectedly accepted: %v", err)
	}

	v3 := validManifest()
	v3.Schema = ManifestSchemaPortable
	if _, err := VerifyEnvelope(signedEnvelope(t, v3, private), trust, trustSHA); err == nil ||
		!strings.Contains(err.Error(), "requires a signed Portable payload") {
		t.Fatalf("v3 without Portable payload unexpectedly accepted: %v", err)
	}
}

func TestVerifyPortablePayloadInstalledRejectsTamperedSource(t *testing.T) {
	dir := t.TempDir()
	manifest := writeBoundFiles(t, dir)
	manifest.Schema = ManifestSchemaPortable
	payload := validPortablePayload()
	sourceRoot := filepath.Join(dir, portablePayloadDirectory)
	if err := os.Mkdir(sourceRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := range payload.Artifacts {
		body := []byte("portable-source-" + payload.Artifacts[i].ID)
		path := filepath.Join(sourceRoot, payload.Artifacts[i].ID)
		if err := os.WriteFile(path, body, 0o600); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		payload.Artifacts[i].SHA256 = hex.EncodeToString(digest[:])
		payload.Artifacts[i].SizeBytes = int64(len(body))
	}
	manifest.PortablePayload = &payload
	receipt, err := canonicalPortablePayloadBytes(payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, portablePayloadReceiptName), receipt, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyInstalled(dir, manifest); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceRoot, "kernel"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyInstalled(dir, manifest); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("tampered Portable source unexpectedly accepted: %v", err)
	}
}

