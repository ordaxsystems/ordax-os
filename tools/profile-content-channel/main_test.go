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

func knowledgePackBytes(t *testing.T, content string) []byte {
	t.Helper()
	normalized := strings.TrimSpace(content)
	digest := sha256.Sum256([]byte(normalized))
	pack := map[string]any{
		"schema": contentFormat,
		"kind": "knowledge-pack",
		"entries": []any{
			map[string]any{
				"id": "legal.example",
				"mediaType": "text/plain",
				"content": normalized,
				"contentSha256": hex.EncodeToString(digest[:]),
				"source": map[string]any{
					"uri": "https://example.invalid/legal/source",
					"revision": "rev-1",
					"license": "test-only",
					"jurisdiction": "BR",
					"title": "Fonte jurídica de teste",
				},
			},
		},
	}
	payload, err := json.Marshal(pack)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func skillPackBytes(t *testing.T, instructions string) []byte {
	t.Helper()
	normalized := strings.TrimSpace(instructions)
	digest := sha256.Sum256([]byte(normalized))
	pack := map[string]any{
		"schema": contentFormat,
		"kind": "skill-pack",
		"entries": []any{
			map[string]any{
				"id": "legal.review",
				"title": "Revisão jurídica",
				"instructions": normalized,
				"instructionsSha256": hex.EncodeToString(digest[:]),
				"authority": "none",
				"toolIds": []string{},
				"source": map[string]any{
					"uri": "https://example.invalid/legal/skill",
					"revision": "rev-1",
					"license": "test-only",
					"jurisdiction": "BR",
					"title": "Skill jurídica de teste",
				},
			},
		},
	}
	payload, err := json.Marshal(pack)
	if err != nil {
		t.Fatal(err)
	}
	return payload
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
	content := knowledgePackBytes(t, "ordax profile content proof")
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


func TestDeriveTrustReproducesGeneratedPublicAnchor(t *testing.T) {
	dir := t.TempDir()
	privatePath := filepath.Join(dir, "private.pem")
	trustPath := filepath.Join(dir, "trust.json")
	derivedPath := filepath.Join(dir, "derived-trust.json")
	const keyID = "ordax-profile-content-v1"

	if err := generateKey(privatePath, trustPath, keyID); err != nil {
		t.Fatal(err)
	}
	if err := deriveTrust(privatePath, derivedPath, keyID); err != nil {
		t.Fatal(err)
	}
	trustBytes, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	derivedBytes, err := os.ReadFile(derivedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(trustBytes) != string(derivedBytes) {
		t.Fatal("independently derived Profile content trust differs from generated public anchor")
	}
	if err := deriveTrust(privatePath, derivedPath, keyID); err == nil ||
		!strings.Contains(err.Error(), "overwrite is forbidden") {
		t.Fatalf("derive-trust overwrite error = %v", err)
	}
}

func TestTamperedContentAndWrongTrustFailClosed(t *testing.T) {
	dir := t.TempDir()
	content := knowledgePackBytes(t, "trusted bytes")
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
	content := knowledgePackBytes(t, "verified profile content slot")
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
	health, err := inspectStagedSlotHealth(slot, trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if health.State != "healthy" || health.EntryCount != 1 ||
		!health.PerEntryHashVerified || !health.PerEntryProvenanceVerified ||
		health.ExecutablePayloadAllowed || health.Authority != "none" {
		t.Fatalf("unsafe structural health: %+v", health)
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


func TestStructuralHealthRejectsInnerHashKindAndSkillAuthority(t *testing.T) {
	knowledge := knowledgePackBytes(t, "trusted")
	var pack map[string]any
	if err := json.Unmarshal(knowledge, &pack); err != nil {
		t.Fatal(err)
	}
	entries := pack["entries"].([]any)
	entry := entries[0].(map[string]any)
	entry["contentSha256"] = strings.Repeat("a", 64)
	tampered, err := json.Marshal(pack)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := validateProfileContentPackBytes(tampered, "knowledge-pack"); err == nil ||
		!strings.Contains(err.Error(), "does not match content") {
		t.Fatalf("inner hash tamper error = %v", err)
	}

	validKnowledge := knowledgePackBytes(t, "trusted")
	if _, err := validateProfileContentPackBytes(validKnowledge, "skill-pack"); err == nil ||
		!strings.Contains(err.Error(), "kind does not match") {
		t.Fatalf("kind mismatch error = %v", err)
	}

	skill := skillPackBytes(t, "Review without mutation.")
	var skillPack map[string]any
	if err := json.Unmarshal(skill, &skillPack); err != nil {
		t.Fatal(err)
	}
	skillEntries := skillPack["entries"].([]any)
	skillEntry := skillEntries[0].(map[string]any)
	skillEntry["toolIds"] = []string{"filesystem.write"}
	withTool, err := json.Marshal(skillPack)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := validateProfileContentPackBytes(withTool, "skill-pack"); err == nil ||
		!strings.Contains(err.Error(), "toolIds must remain empty") {
		t.Fatalf("skill tool authority error = %v", err)
	}

	skillEntry["toolIds"] = []string{}
	skillEntry["authority"] = "mutable"
	mutable, err := json.Marshal(skillPack)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := validateProfileContentPackBytes(mutable, "skill-pack"); err == nil ||
		!strings.Contains(err.Error(), "authority must remain none") {
		t.Fatalf("skill mutable authority error = %v", err)
	}
}


func TestStageEvidenceBindsVerifiedArtifactSignatureAndHealth(t *testing.T) {
	dir, manifestPath, envelopePath, trustPath, contentPath := signedFixture(t)
	root := filepath.Join(dir, "slots")
	t.Cleanup(func() { allowStageCleanup(root) })

	manifest, slot, _, err := stageContent(
		manifestPath,
		envelopePath,
		trustPath,
		contentPath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := stagedSlotEvidence(slot, trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if evidence.Schema != "ordax.profile-content-stage-evidence/1" {
		t.Fatalf("unexpected evidence schema: %s", evidence.Schema)
	}
	if evidence.Artifact.ID != manifest.ID ||
		evidence.Artifact.Kind != manifest.Kind ||
		evidence.Artifact.Version != manifest.Version ||
		evidence.Artifact.SHA256 != manifest.ContentHash ||
		evidence.Artifact.SizeBytes != manifest.ContentSize {
		t.Fatalf("artifact evidence mismatch: %+v", evidence.Artifact)
	}
	if evidence.Verification.SignatureAlgorithm != "ed25519" ||
		evidence.Verification.KeyID != "profile-content-stage-test-1" ||
		!shaPattern.MatchString(evidence.Verification.ManifestSHA256) {
		t.Fatalf("verification evidence mismatch: %+v", evidence.Verification)
	}
	if evidence.Health.Schema != "ordax.profile-content-health/1" ||
		evidence.Health.State != "healthy" ||
		evidence.Health.EntryCount != 1 ||
		!evidence.Health.PerEntryHashVerified ||
		!evidence.Health.PerEntryProvenanceVerified ||
		evidence.Health.ExecutablePayloadAllowed ||
		evidence.Health.Authority != "none" {
		t.Fatalf("health evidence mismatch: %+v", evidence.Health)
	}
}
