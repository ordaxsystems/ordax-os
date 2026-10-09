package main

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func validManifestBytes() []byte {
	return []byte(`{
  "$schema": "prototype-ordax.release-manifest/1",
  "source_repository": "ordaxsystems/ordax-os",
  "source_commit": "0123456789abcdef0123456789abcdef01234567",
  "release_id": "0123456789abcdef0123456789abcdef01234567",
  "created_from_ci_recipe": "release/native/1",
  "artifacts": [
    {
      "name": "system.tar",
      "role": "system",
      "url": "https://example.invalid/releases/system.tar",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "size": 123
    }
  ]
}
`)
}

func validManifestV2Bytes() []byte {
	return []byte(`{
  "$schema": "prototype-ordax.release-manifest/2",
  "source_repository": "ordaxsystems/ordax-os",
  "source_commit": "0123456789abcdef0123456789abcdef01234567",
  "release_id": "0123456789abcdef0123456789abcdef01234567",
  "created_from_ci_recipe": "release/portable-usb-v2/1",
  "product_mode": "usb",
  "storage_profile": "portable-usb-v2",
  "runtime_format": "erofs",
  "artifacts": [
    {
      "name": "system.erofs",
      "role": "system-image",
      "url": "https://example.invalid/releases/system.erofs",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "size": 4096
    }
  ]
}`)
}

func decodePrivateForTest(t *testing.T, path string) ed25519.PrivateKey {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	block, rest := pem.Decode(data)
	if block == nil || len(rest) != 0 {
		t.Fatal("private PEM did not decode cleanly")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	privateKey, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		t.Fatal("generated key is not Ed25519")
	}
	return privateKey
}

func writeManifestForTest(t *testing.T, root string, data []byte) string {
	t.Helper()
	path := filepath.Join(root, "release-manifest.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestGenerateDeriveAndSignRoundTrip(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "release-private.pem")
	trustPath := filepath.Join(root, "release-trust.json")
	derivedPath := filepath.Join(root, "derived-trust.json")
	manifestPath := writeManifestForTest(t, root, validManifestBytes())
	envelopePath := filepath.Join(root, "release-envelope.json")

	fingerprint, err := generateKeyFiles(privatePath, trustPath, "prototype-1")
	if err != nil {
		t.Fatalf("generateKeyFiles: %v", err)
	}
	if len(fingerprint) != 64 {
		t.Fatalf("fingerprint length = %d, want 64", len(fingerprint))
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(privatePath)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("private mode = %04o, want 0600", info.Mode().Perm())
		}
	}

	derivedFingerprint, err := deriveTrust(privatePath, derivedPath, "prototype-1")
	if err != nil {
		t.Fatalf("deriveTrust: %v", err)
	}
	if derivedFingerprint != fingerprint {
		t.Fatalf("derived fingerprint = %s, generated = %s", derivedFingerprint, fingerprint)
	}
	originalTrust, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	derivedTrust, err := os.ReadFile(derivedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(originalTrust) != string(derivedTrust) {
		t.Fatal("derived trust differs from generated trust")
	}

	commit, err := signManifest(manifestPath, privatePath, trustPath, envelopePath, "prototype-1", defaultRepo)
	if err != nil {
		t.Fatalf("signManifest: %v", err)
	}
	if commit != "0123456789abcdef0123456789abcdef01234567" {
		t.Fatalf("commit = %q", commit)
	}

	envelopeBytes, err := os.ReadFile(envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope Envelope
	if err := json.Unmarshal(envelopeBytes, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Schema != envelopeSchema || envelope.KeyID != "prototype-1" {
		t.Fatalf("unexpected envelope identity: %#v", envelope)
	}
	manifestBytes := validManifestBytes()
	if string(envelope.Payload) != string(manifestBytes) {
		t.Fatal("signed envelope did not preserve exact manifest bytes")
	}

	var trust TrustAnchor
	if err := json.Unmarshal(originalTrust, &trust); err != nil {
		t.Fatal(err)
	}
	publicKey, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(ed25519.PublicKey(publicKey), envelope.Payload, envelope.Signature) {
		t.Fatal("signature did not verify with emitted trust anchor")
	}
}

func TestVerifyEnvelopeRoundTripAndTamper(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	manifestPath := writeManifestForTest(t, root, validManifestBytes())
	envelopePath := filepath.Join(root, "envelope.json")

	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := signManifest(manifestPath, privatePath, trustPath, envelopePath, "prototype-1", defaultRepo); err != nil {
		t.Fatal(err)
	}
	manifest, err := verifyEnvelope(envelopePath, trustPath, defaultRepo)
	if err != nil {
		t.Fatalf("verifyEnvelope: %v", err)
	}
	if manifest.SourceCommit != "0123456789abcdef0123456789abcdef01234567" {
		t.Fatalf("verified source commit = %q", manifest.SourceCommit)
	}

	data, err := os.ReadFile(envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.Payload = append([]byte(nil), envelope.Payload...)
	envelope.Payload[len(envelope.Payload)-2] ^= 1
	tampered, err := marshalJSON(envelope)
	if err != nil {
		t.Fatal(err)
	}
	tamperedPath := filepath.Join(root, "tampered-envelope.json")
	if err := os.WriteFile(tamperedPath, tampered, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyEnvelope(tamperedPath, trustPath, defaultRepo); err == nil || !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("tampered verification error = %v", err)
	}
}

func TestVerifyEnvelopeRejectsDifferentTrust(t *testing.T) {
	root := t.TempDir()
	privateA := filepath.Join(root, "a.pem")
	trustA := filepath.Join(root, "a.json")
	privateB := filepath.Join(root, "b.pem")
	trustB := filepath.Join(root, "b.json")
	manifestPath := writeManifestForTest(t, root, validManifestBytes())
	envelopePath := filepath.Join(root, "envelope.json")

	if _, err := generateKeyFiles(privateA, trustA, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := generateKeyFiles(privateB, trustB, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := signManifest(manifestPath, privateA, trustA, envelopePath, "prototype-1", defaultRepo); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyEnvelope(envelopePath, trustB, defaultRepo); err == nil || !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("different trust verification error = %v", err)
	}
}

func TestSignPreservesWhitespaceInExactPayload(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifest := append([]byte("\n  "), validManifestBytes()...)
	manifest = append(manifest, []byte("\n")...)
	manifestPath := writeManifestForTest(t, root, manifest)
	envelopePath := filepath.Join(root, "envelope.json")
	if _, err := signManifest(manifestPath, privatePath, trustPath, envelopePath, "prototype-1", defaultRepo); err != nil {
		t.Fatal(err)
	}
	var envelope Envelope
	data, _ := os.ReadFile(envelopePath)
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatal(err)
	}
	if string(envelope.Payload) != string(manifest) {
		t.Fatal("payload whitespace changed during signing")
	}
}

func TestStrictManifestMatchesReleaseAgentV1Shape(t *testing.T) {
	if _, err := strictManifest(validManifestBytes(), defaultRepo); err != nil {
		t.Fatal(err)
	}
	var manifest Manifest
	if err := json.Unmarshal(validManifestBytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Artifacts = append(manifest.Artifacts, manifest.Artifacts[0])
	data, _ := json.Marshal(manifest)
	if _, err := strictManifest(data, defaultRepo); err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("multiple artifact error = %v", err)
	}
	manifest.Artifacts = manifest.Artifacts[:1]
	manifest.Artifacts[0].Name = "other.tar"
	data, _ = json.Marshal(manifest)
	if _, err := strictManifest(data, defaultRepo); err == nil || !strings.Contains(err.Error(), "system.tar") {
		t.Fatalf("non-canonical artifact error = %v", err)
	}
}

func TestSigningPrivateKeyMustMatchTrustAnchor(t *testing.T) {
	root := t.TempDir()
	privateA := filepath.Join(root, "a.pem")
	trustA := filepath.Join(root, "a.json")
	privateB := filepath.Join(root, "b.pem")
	trustB := filepath.Join(root, "b.json")
	if _, err := generateKeyFiles(privateA, trustA, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := generateKeyFiles(privateB, trustB, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := writeManifestForTest(t, root, validManifestBytes())
	output := filepath.Join(root, "envelope.json")
	if _, err := signManifest(manifestPath, privateA, trustB, output, "prototype-1", defaultRepo); err == nil || !strings.Contains(err.Error(), "does not match supplied trust anchor") {
		t.Fatalf("private/trust mismatch error = %v", err)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("envelope appeared after private/trust mismatch: %v", err)
	}
}

func TestSigningKeyIDMustMatchTrustAnchor(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := writeManifestForTest(t, root, validManifestBytes())
	output := filepath.Join(root, "envelope.json")
	if _, err := signManifest(manifestPath, privatePath, trustPath, output, "prototype-2", defaultRepo); err == nil || !strings.Contains(err.Error(), "does not match trust anchor key id") {
		t.Fatalf("key-id mismatch error = %v", err)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("envelope appeared after key-id mismatch: %v", err)
	}
}

func TestTrustAnchorSymlinkIsRejected(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "trust-link.json")
	if err := os.Symlink(trustPath, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, _, err := loadTrustAnchor(link); err == nil || !strings.Contains(err.Error(), "non-symlink") {
		t.Fatalf("trust symlink error = %v", err)
	}
}

func TestMalformedTrustAnchorIsRejected(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "trust.json")
	if err := os.WriteFile(path, []byte(`{"$schema":"prototype-ordax.release-trust/1","key_id":"prototype-1","public_key_base64":"bad","unexpected":true}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadTrustAnchor(path); err == nil {
		t.Fatal("malformed trust anchor was accepted")
	}
}

func TestOutputsRefuseOverwrite(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if err := os.WriteFile(trustPath, []byte("sentinel"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("generate overwrite error = %v", err)
	}
	if _, err := os.Stat(privatePath); !os.IsNotExist(err) {
		t.Fatalf("private key appeared despite preflight failure: %v", err)
	}
}

func TestSignRefusesExistingEnvelope(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := writeManifestForTest(t, root, validManifestBytes())
	output := filepath.Join(root, "envelope.json")
	if err := os.WriteFile(output, []byte("sentinel"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := signManifest(manifestPath, privatePath, trustPath, output, "prototype-1", defaultRepo); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("sign overwrite error = %v", err)
	}
	data, _ := os.ReadFile(output)
	if string(data) != "sentinel" {
		t.Fatalf("existing output changed: %q", data)
	}
}

func TestPrivateKeySymlinkIsRejected(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "private-link.pem")
	if err := os.Symlink(privatePath, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := loadPrivateKey(link); err == nil || !strings.Contains(err.Error(), "non-symlink") {
		t.Fatalf("symlink error = %v", err)
	}
}

func TestLoosePrivateKeyPermissionsAreRejectedOnUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission semantics do not apply")
	}
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(privatePath, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := loadPrivateKey(privatePath); err == nil || !strings.Contains(err.Error(), "permissions are too broad") {
		t.Fatalf("permission error = %v", err)
	}
}

func TestInvalidKeyIDRejectedBeforeKeyCreation(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "INVALID KEY"); err == nil {
		t.Fatal("invalid key id unexpectedly accepted")
	}
	if _, err := os.Stat(privatePath); !os.IsNotExist(err) {
		t.Fatalf("private key created for invalid key id: %v", err)
	}
}

func TestManifestRepositoryMismatchIsRejectedBeforeSigning(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := writeManifestForTest(t, root, validManifestBytes())
	output := filepath.Join(root, "envelope.json")
	if _, err := signManifest(manifestPath, privatePath, trustPath, output, "prototype-1", "someone/else"); err == nil || !strings.Contains(err.Error(), "unexpected source repository") {
		t.Fatalf("repository mismatch error = %v", err)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("envelope appeared after repository mismatch: %v", err)
	}
}

func TestDerivedTrustMatchesPrivatePublicKey(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	privateKey := decodePrivateForTest(t, privatePath)
	data, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	var trust TrustAnchor
	if err := json.Unmarshal(data, &trust); err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != string(privateKey.Public().(ed25519.PublicKey)) {
		t.Fatal("trust public key does not match private key")
	}
}

func TestStrictManifestAcceptsPortableV2AndKeepsV1Exact(t *testing.T) {
	v2, err := strictManifest(validManifestV2Bytes(), defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if v2.Schema != manifestSchemaV2 || v2.ProductMode != "usb" || v2.StorageProfile != "portable-usb-v2" || v2.RuntimeFormat != "erofs" {
		t.Fatalf("unexpected v2 manifest: %#v", v2)
	}
	if _, err := strictManifest(validManifestBytes(), defaultRepo); err != nil {
		t.Fatalf("v1 rejected after v2 support: %v", err)
	}

	var invalid Manifest
	if err := json.Unmarshal(validManifestV2Bytes(), &invalid); err != nil {
		t.Fatal(err)
	}
	invalid.StorageProfile = "native-disk"
	data, _ := json.Marshal(invalid)
	if _, err := strictManifest(data, defaultRepo); err == nil || !strings.Contains(err.Error(), "portable-usb-v2") {
		t.Fatalf("v2 wrong storage profile accepted: %v", err)
	}
}

func TestSignAndVerifyPortableV2UsesExistingTrustEnvelopeBoundary(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := writeManifestForTest(t, root, validManifestV2Bytes())
	envelopePath := filepath.Join(root, "portable-envelope.json")
	commit, err := signManifest(
		manifestPath,
		privatePath,
		trustPath,
		envelopePath,
		"prototype-1",
		defaultRepo,
	)
	if err != nil {
		t.Fatal(err)
	}
	if commit != "0123456789abcdef0123456789abcdef01234567" {
		t.Fatalf("unexpected signed commit: %s", commit)
	}
	verified, err := verifyEnvelope(envelopePath, trustPath, defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if verified.Schema != manifestSchemaV2 || verified.Artifacts[0].Name != "system.erofs" {
		t.Fatalf("portable signed envelope lost v2 identity: %#v", verified)
	}
}


func validManifestV3Bytes() []byte {
	return []byte(`{
  "$schema": "prototype-ordax.release-manifest/3",
  "source_repository": "ordaxsystems/ordax-os",
  "source_commit": "0123456789abcdef0123456789abcdef01234567",
  "release_id": "0123456789abcdef0123456789abcdef01234567",
  "created_from_ci_recipe": "release/portable-usb-v2-runtime/1",
  "product_mode": "usb",
  "storage_profile": "portable-usb-v2",
  "runtime_format": "erofs",
  "artifacts": [
    {
      "name": "system.erofs",
      "role": "system-image",
      "url": "https://example.invalid/releases/system.erofs",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "size": 4096
    },
    {
      "name": "native-surface-runtime.erofs",
      "role": "surface-runtime",
      "url": "https://example.invalid/runtime/native-surface-runtime.erofs",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "size": 8192
    }
  ]
}`)
}

func TestStrictManifestAcceptsPortableV3WithoutChangingV1V2(t *testing.T) {
	v3, err := strictManifest(validManifestV3Bytes(), defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if v3.Schema != manifestSchemaV3 || len(v3.Artifacts) != 2 {
		t.Fatalf("unexpected v3 manifest: %#v", v3)
	}
	if v3.Artifacts[0].Name != "system.erofs" ||
		v3.Artifacts[0].Role != "system-image" ||
		v3.Artifacts[1].Name != "native-surface-runtime.erofs" ||
		v3.Artifacts[1].Role != "surface-runtime" {
		t.Fatalf("v3 artifact order or roles drifted: %#v", v3.Artifacts)
	}
	if _, err := strictManifest(validManifestBytes(), defaultRepo); err != nil {
		t.Fatalf("v1 rejected after v3 support: %v", err)
	}
	if _, err := strictManifest(validManifestV2Bytes(), defaultRepo); err != nil {
		t.Fatalf("v2 rejected after v3 support: %v", err)
	}
}

func TestStrictManifestV3RejectsReorderedOrIncompleteArtifacts(t *testing.T) {
	var manifest Manifest
	if err := json.Unmarshal(validManifestV3Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Artifacts[0], manifest.Artifacts[1] = manifest.Artifacts[1], manifest.Artifacts[0]
	data, _ := json.Marshal(manifest)
	if _, err := strictManifest(data, defaultRepo); err == nil {
		t.Fatal("v3 accepted reordered artifacts")
	}

	if err := json.Unmarshal(validManifestV3Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Artifacts = manifest.Artifacts[:1]
	data, _ = json.Marshal(manifest)
	if _, err := strictManifest(data, defaultRepo); err == nil || !strings.Contains(err.Error(), "exactly") {
		t.Fatalf("v3 incomplete artifact set error = %v", err)
	}
}

func TestSignAndVerifyPortableV3UsesExistingTrustEnvelopeBoundary(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := writeManifestForTest(t, root, validManifestV3Bytes())
	envelopePath := filepath.Join(root, "portable-v3-envelope.json")
	commit, err := signManifest(
		manifestPath,
		privatePath,
		trustPath,
		envelopePath,
		"prototype-1",
		defaultRepo,
	)
	if err != nil {
		t.Fatal(err)
	}
	if commit != "0123456789abcdef0123456789abcdef01234567" {
		t.Fatalf("unexpected signed v3 commit: %s", commit)
	}
	verified, err := verifyEnvelope(envelopePath, trustPath, defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if verified.Schema != manifestSchemaV3 ||
		verified.Artifacts[0].Name != "system.erofs" ||
		verified.Artifacts[1].Name != "native-surface-runtime.erofs" {
		t.Fatalf("portable v3 signed envelope lost identity: %#v", verified)
	}
}


func validManifestV4Bytes() []byte {
	return []byte(`{
  "$schema": "prototype-ordax.release-manifest/4",
  "source_repository": "ordaxsystems/ordax-os",
  "source_commit": "0123456789abcdef0123456789abcdef01234567",
  "release_id": "0123456789abcdef0123456789abcdef01234567",
  "created_from_ci_recipe": "release/portable-usb-v2-local-ai/1",
  "product_mode": "usb",
  "storage_profile": "portable-usb-v2",
  "runtime_format": "erofs",
  "artifacts": [
    {
      "name": "system.erofs",
      "role": "system-image",
      "url": "https://example.invalid/releases/system.erofs",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "size": 4096
    },
    {
      "name": "native-surface-runtime.erofs",
      "role": "surface-runtime",
      "url": "https://example.invalid/runtime/native-surface-runtime.erofs",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "size": 8192
    },
    {
      "name": "local-ai-runtime.erofs",
      "role": "local-ai-runtime",
      "url": "https://example.invalid/runtime/local-ai-runtime.erofs",
      "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "size": 12288
    }
  ],
  "local_ai": {
    "contract": "ordax.local-ai/1",
    "source_lock_schema": "prototype-ordax.local-ai-source-lock/1",
    "source_lock_sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "engine_id": "llama.cpp",
    "engine_repository": "https://github.com/ggml-org/llama.cpp",
    "engine_source_commit": "7ab4ee7baad2d920464cbacfad4f4b07cf111fd2",
    "engine_license": "MIT",
    "model_id": "qwen3.5-0.8b-q4_0",
    "model_repository": "ggml-org/Qwen3.5-0.8B-GGUF",
    "model_filename": "Qwen3.5-0.8B-Q4_0.gguf",
    "model_upstream_revision": "9447f74",
    "model_sha256": "57d1997790d1744fba5b40a7317df71ea5e2acee28c47e78f0cce39c0703f8cf",
    "model_size": 563036064,
    "model_license": "Apache-2.0"
  }
}`)
}

func TestStrictManifestAcceptsPortableV4WithoutChangingOlderSchemas(t *testing.T) {
	v4, err := strictManifest(validManifestV4Bytes(), defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if v4.Schema != manifestSchemaV4 || len(v4.Artifacts) != 3 || v4.LocalAI == nil {
		t.Fatalf("unexpected v4 manifest: %#v", v4)
	}
	if v4.Artifacts[2].Name != "local-ai-runtime.erofs" ||
		v4.Artifacts[2].Role != "local-ai-runtime" ||
		v4.LocalAI.EngineID != "llama.cpp" ||
		v4.LocalAI.ModelID != "qwen3.5-0.8b-q4_0" {
		t.Fatalf("v4 local AI identity drifted: %#v", v4)
	}
	for _, older := range [][]byte{validManifestBytes(), validManifestV2Bytes(), validManifestV3Bytes()} {
		if _, err := strictManifest(older, defaultRepo); err != nil {
			t.Fatalf("older schema rejected after v4 support: %v", err)
		}
	}
}

func TestStrictManifestV4RejectsMissingOrInvalidLocalAIBinding(t *testing.T) {
	var manifest Manifest
	if err := json.Unmarshal(validManifestV4Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.LocalAI = nil
	data, _ := json.Marshal(manifest)
	if _, err := strictManifest(data, defaultRepo); err == nil {
		t.Fatal("v4 accepted missing local_ai binding")
	}

	if err := json.Unmarshal(validManifestV4Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.LocalAI.ModelSHA256 = "bad"
	data, _ = json.Marshal(manifest)
	if _, err := strictManifest(data, defaultRepo); err == nil {
		t.Fatal("v4 accepted invalid model SHA-256")
	}

	if err := json.Unmarshal(validManifestV4Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Artifacts[1], manifest.Artifacts[2] = manifest.Artifacts[2], manifest.Artifacts[1]
	data, _ = json.Marshal(manifest)
	if _, err := strictManifest(data, defaultRepo); err == nil {
		t.Fatal("v4 accepted reordered runtime artifacts")
	}
}

func TestSignAndVerifyPortableV4PreservesLocalAIBinding(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := writeManifestForTest(t, root, validManifestV4Bytes())
	envelopePath := filepath.Join(root, "portable-v4-envelope.json")
	commit, err := signManifest(
		manifestPath,
		privatePath,
		trustPath,
		envelopePath,
		"prototype-1",
		defaultRepo,
	)
	if err != nil {
		t.Fatal(err)
	}
	if commit != "0123456789abcdef0123456789abcdef01234567" {
		t.Fatalf("unexpected signed v4 commit: %s", commit)
	}
	verified, err := verifyEnvelope(envelopePath, trustPath, defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if verified.Schema != manifestSchemaV4 ||
		len(verified.Artifacts) != 3 ||
		verified.LocalAI == nil ||
		verified.LocalAI.SourceLockSHA256 != "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" ||
		verified.LocalAI.ModelSHA256 != "57d1997790d1744fba5b40a7317df71ea5e2acee28c47e78f0cce39c0703f8cf" {
		t.Fatalf("portable v4 signed envelope lost identity: %#v", verified)
	}
}
