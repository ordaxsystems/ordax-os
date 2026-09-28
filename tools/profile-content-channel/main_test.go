package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func fixtureManifest(content []byte) profileContentManifest {
	digest := sha256.Sum256(content)
	jurisdiction := "BR"
	return profileContentManifest{
		Schema:      manifestSchema,
		ID:          "knowledge.legal-br-proof",
		Kind:        "knowledge-pack",
		Version:     "0.1.0",
		Publisher:   "ordax",
		ContentHash:   hex.EncodeToString(digest[:]),
		ContentSize:   int64(len(content)),
		ContentFormat: contentFormat,
		Source: sourceDescriptor{
			URI:          "https://example.invalid/ordax/legal-proof",
			Revision:     "fixture-1",
			License:      "test-fixture-only",
			Jurisdiction: &jurisdiction,
		},
		RequestedCapabilities:    []string{},
		RuntimeNetworkAllowed:    false,
		MutableHostAccessAllowed: false,
	}
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	payload = append(payload, '\n')
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestProfileContentRoundTripUsesSeparateTrustDomain(t *testing.T) {
	dir := t.TempDir()
	content := []byte("ordax profile content proof\n")
	contentPath := filepath.Join(dir, "content.pack")
	if err := os.WriteFile(contentPath, content, 0o644); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(dir, "manifest.json")
	writeJSON(t, manifestPath, fixtureManifest(content))

	privatePath := filepath.Join(dir, "private.pem")
	trustPath := filepath.Join(dir, "trust.json")
	if err := generateKey(privatePath, trustPath, "profile-content-test-1"); err != nil {
		t.Fatal(err)
	}
	trustBytes, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(trustBytes), "runtime-component") ||
		strings.Contains(string(trustBytes), "release-trust") {
		t.Fatal("Profile content trust aliases another trust domain")
	}

	envelopePath := filepath.Join(dir, "envelope.json")
	if err := signManifest(
		manifestPath,
		privatePath,
		trustPath,
		envelopePath,
		"profile-content-test-1",
	); err != nil {
		t.Fatal(err)
	}
	verified, err := verify(manifestPath, envelopePath, trustPath, contentPath)
	if err != nil {
		t.Fatal(err)
	}
	if verified.ID != "knowledge.legal-br-proof" || verified.Version != "0.1.0" {
		t.Fatalf("unexpected verified identity: %+v", verified)
	}
}

func TestTamperedContentAndWrongTrustFailClosed(t *testing.T) {
	dir := t.TempDir()
	content := []byte("trusted bytes\n")
	contentPath := filepath.Join(dir, "content.pack")
	if err := os.WriteFile(contentPath, content, 0o644); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(dir, "manifest.json")
	writeJSON(t, manifestPath, fixtureManifest(content))
	privatePath := filepath.Join(dir, "private.pem")
	trustPath := filepath.Join(dir, "trust.json")
	if err := generateKey(privatePath, trustPath, "profile-content-test-1"); err != nil {
		t.Fatal(err)
	}
	envelopePath := filepath.Join(dir, "envelope.json")
	if err := signManifest(manifestPath, privatePath, trustPath, envelopePath, "profile-content-test-1"); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(contentPath, []byte("tampered bytes\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := verify(manifestPath, envelopePath, trustPath, contentPath); err == nil {
		t.Fatal("tampered Profile content unexpectedly verified")
	}

	otherPrivate := filepath.Join(dir, "other-private.pem")
	otherTrust := filepath.Join(dir, "other-trust.json")
	if err := generateKey(otherPrivate, otherTrust, "profile-content-test-1"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(contentPath, content, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := verify(manifestPath, envelopePath, otherTrust, contentPath); err == nil ||
		!strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("wrong trust error = %v", err)
	}
}

func TestManifestRejectsAuthorityAndUnsupportedKinds(t *testing.T) {
	value := fixtureManifest([]byte("x"))
	value.RequestedCapabilities = []string{"filesystem.user-space"}
	if err := validateManifest(value); err == nil {
		t.Fatal("capability-bearing Profile content accepted")
	}

	value = fixtureManifest([]byte("x"))
	value.RuntimeNetworkAllowed = true
	if err := validateManifest(value); err == nil {
		t.Fatal("network-enabled Profile content accepted")
	}

	value = fixtureManifest([]byte("x"))
	value.MutableHostAccessAllowed = true
	if err := validateManifest(value); err == nil {
		t.Fatal("mutable-host Profile content accepted")
	}

	value = fixtureManifest([]byte("x"))
	value.Kind = "app"
	if err := validateManifest(value); err == nil {
		t.Fatal("unsupported Profile content kind accepted")
	}

	value = fixtureManifest([]byte("x"))
	value.ContentFormat = "unknown/9"
	if err := validateManifest(value); err == nil {
		t.Fatal("unsupported Profile content format accepted")
	}
}


func signedFixture(t *testing.T) (string, string, string, string, string) {
	t.Helper()
	dir := t.TempDir()
	content := []byte("verified profile content slot\n")
	contentPath := filepath.Join(dir, "content.pack")
	if err := os.WriteFile(contentPath, content, 0o644); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(dir, "manifest.json")
	writeJSON(t, manifestPath, fixtureManifest(content))
	privatePath := filepath.Join(dir, "private.pem")
	trustPath := filepath.Join(dir, "trust.json")
	if err := generateKey(privatePath, trustPath, "profile-content-stage-test-1"); err != nil {
		t.Fatal(err)
	}
	envelopePath := filepath.Join(dir, "envelope.json")
	if err := signManifest(
		manifestPath,
		privatePath,
		trustPath,
		envelopePath,
		"profile-content-stage-test-1",
	); err != nil {
		t.Fatal(err)
	}
	return dir, manifestPath, envelopePath, trustPath, contentPath
}

func allowStageCleanup(root string) {
	if runtime.GOOS == "windows" {
		return
	}
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			_ = os.Chmod(path, 0o700)
		} else {
			_ = os.Chmod(path, 0o600)
		}
		return nil
	})
}

func TestStageCreatesImmutableContentAddressedSlotWithoutActivation(t *testing.T) {
	dir, manifestPath, envelopePath, trustPath, contentPath := signedFixture(t)
	root := filepath.Join(dir, "slots")
	t.Cleanup(func() { allowStageCleanup(root) })

	manifest, slot, changed, err := stageContent(
		manifestPath,
		envelopePath,
		trustPath,
		contentPath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("first stage did not create slot")
	}
	expected := filepath.Join(
		"knowledge-pack",
		"knowledge.legal-br-proof",
		"versions",
		"0.1.0",
		manifest.ContentHash,
	)
	if !strings.HasSuffix(slot, expected) {
		t.Fatalf("slot = %q", slot)
	}
	if _, err := verifyStagedSlot(slot, trustPath); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(filepath.Join(slot, stageContentName))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0o222 != 0 {
			t.Fatalf("staged content remains writable: %04o", info.Mode().Perm())
		}
	}

	_, sameSlot, changed, err := stageContent(
		manifestPath,
		envelopePath,
		trustPath,
		contentPath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if changed || sameSlot != slot {
		t.Fatalf("restage should reuse verified slot: changed=%t slot=%q", changed, sameSlot)
	}
}

func TestTamperedInstalledStageIsRejected(t *testing.T) {
	dir, manifestPath, envelopePath, trustPath, contentPath := signedFixture(t)
	root := filepath.Join(dir, "slots")
	t.Cleanup(func() { allowStageCleanup(root) })
	_, slot, _, err := stageContent(
		manifestPath,
		envelopePath,
		trustPath,
		contentPath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}

	stagedContent := filepath.Join(slot, stageContentName)
	if runtime.GOOS != "windows" {
		if err := os.Chmod(stagedContent, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(stagedContent, []byte("tampered\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyStagedSlot(slot, trustPath); err == nil {
		t.Fatal("tampered installed Profile content unexpectedly verified")
	}

	if _, _, _, err := stageContent(
		manifestPath,
		envelopePath,
		trustPath,
		contentPath,
		root,
	); err == nil || !strings.Contains(err.Error(), "existing Profile content slot failed verification") {
		t.Fatalf("restage over tampered slot error = %v", err)
	}
}
