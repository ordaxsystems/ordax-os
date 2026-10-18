package physicalchannel

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sequencedCandidate(t *testing.T, root, commit string, sequence int64) Installed {
	t.Helper()
	manifest := validManifest()
	manifest.SourceCommit = commit
	directory := filepath.Join(root, "versions", commit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	provenance := physicalProvenance{
		Schema:                             physicalProvenanceSchema,
		Status:                             "authorized-candidate-not-published",
		SourceCommit:                       commit,
		WriterSourceCommit:                 commit,
		CanonicalV4ReleaseProofSHA256:      strings.Repeat("6", 64),
		CanonicalV4ReleaseSourceCommit:     strings.Repeat("a", 40),
		CanonicalV4ReleaseEnvelopeURL:      canonicalV4TestEnvelope(strings.Repeat("a", 40)),
		ReleaseSequence:                    sequence,
		ConsumerKeySetupRequired:           false,
		DevelopmentChannel:                 false,
		CanonicalTrustSHA256:               strings.Repeat("1", 64),
		MinimalBootstrapSHA256:             strings.Repeat("2", 64),
		PortableUSBContractSHA256:          strings.Repeat("3", 64),
		CreatorPortableMediaContractSHA256: strings.Repeat("4", 64),
		PhysicalWriteAuthorizationSHA256:   strings.Repeat("5", 64),
		PortableWriterLinked:               true,
		PortableApplicationPlanSchema:      "prototype-ordax.portable-application-plan/1",
		PortableApplicationOperationCount:  39,
		PortableArtifactCount:              17,
		PerArtifactReadbackSHA256Size:       true,
		WholeDiskRawImageRequired:           false,
		TargetSpecificPlanRequired:          true,
		PayloadArtifactsInCandidate:         false,
		PublicCreatorReachable:              false,
		PhysicalWriteAuthorizedInBinary:     true,
		ReleasePublished:                    false,
		PrivateKeyInCandidate:               false,
	}
	provenanceBytes, err := json.Marshal(provenance)
	if err != nil {
		t.Fatal(err)
	}
	bodies := map[string][]byte{
		"ordax-creator-physical-test.exe":   []byte("writer"),
		"release-ed25519.json":              []byte("trust"),
		"minimal-bootstrap.json":            []byte("{\"schema\":\"minimal-bootstrap-fixture\"}"),
		"portable-usb-v2.json":              []byte("{\"schema\":\"portable-usb-v2-fixture\"}"),
		"creator-portable-media-plan.json":  []byte("{\"schema\":\"creator-portable-media-plan-fixture\"}"),
		"physical-write-authorization.json": []byte("{\"schema\":\"physical-write-authorization-fixture\"}"),
		"provenance.json":                   provenanceBytes,
		"SHA256SUMS":                        []byte("checksums"),
	}
	for i := range manifest.Files {
		body := bodies[manifest.Files[i].Name]
		if err := os.WriteFile(filepath.Join(directory, manifest.Files[i].Name), body, 0o600); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		manifest.Files[i].SHA256 = hex.EncodeToString(digest[:])
		manifest.Files[i].Size = int64(len(body))
	}
	return Installed{SourceCommit: commit, Directory: directory, Manifest: manifest}
}

func cacheSignedCandidate(t *testing.T, root string, installed Installed, private ed25519.PrivateKey) {
	t.Helper()
	envelope := signedEnvelope(t, installed.Manifest, private)
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), envelope, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestCurrentRequiresBoundMonotonicSequence(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	installed := sequencedCandidate(t, root, "1111111111111111111111111111111111111111", 2)
	cacheSignedCandidate(t, root, installed, private)

	current, err := Current(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	sequence, err := ReleaseSequence(current)
	if err != nil {
		t.Fatal(err)
	}
	if sequence != 2 {
		t.Fatalf("sequence=%d want=2", sequence)
	}

	if err := os.WriteFile(filepath.Join(installed.Directory, "provenance.json"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("tampered provenance error=%v", err)
	}
}

func TestEnsureNotRollbackRejectsOlderSignedCandidate(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	current := sequencedCandidate(t, root, "2222222222222222222222222222222222222222", 2)
	cacheSignedCandidate(t, root, current, private)
	older := sequencedCandidate(t, root, "1111111111111111111111111111111111111111", 1)

	if err := ensureNotRollback(root, older, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "rollback rejected") {
		t.Fatalf("rollback error=%v", err)
	}
}

func TestEnsureNotRollbackRejectsSequenceReuseAndAllowsAdvance(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	current := sequencedCandidate(t, root, "2222222222222222222222222222222222222222", 2)
	cacheSignedCandidate(t, root, current, private)
	reused := sequencedCandidate(t, root, "3333333333333333333333333333333333333333", 2)
	newer := sequencedCandidate(t, root, "4444444444444444444444444444444444444444", 3)

	if err := ensureNotRollback(root, reused, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "reused") {
		t.Fatalf("sequence reuse error=%v", err)
	}
	if err := ensureNotRollback(root, newer, trust, trustSHA); err != nil {
		t.Fatalf("newer candidate rejected: %v", err)
	}
}


func TestReleaseSequenceRejectsLegacyRawWriterProvenanceShape(t *testing.T) {
	root := t.TempDir()
	installed := sequencedCandidate(t, root, "5555555555555555555555555555555555555555", 4)
	path := filepath.Join(installed.Directory, "provenance.json")
	var provenance map[string]any
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &provenance); err != nil {
		t.Fatal(err)
	}
	provenance["$schema"] = "prototype-ordax.physical-write-candidate/1"
	provenance["physical_media_sha256"] = strings.Repeat("a", 64)
	provenance["seed_sha256"] = strings.Repeat("b", 64)
	provenance["seed_size"] = 4096
	data, _ = json.Marshal(provenance)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	for i := range installed.Manifest.Files {
		if installed.Manifest.Files[i].Name != "provenance.json" {
			continue
		}
		digest := sha256.Sum256(data)
		installed.Manifest.Files[i].SHA256 = hex.EncodeToString(digest[:])
		installed.Manifest.Files[i].Size = int64(len(data))
	}
	if _, err := ReleaseSequence(installed); err == nil {
		t.Fatal("legacy RAW provenance unexpectedly accepted")
	}
}

func TestReleaseSequenceRejectsPortableCandidateThatRequiresWholeDiskRaw(t *testing.T) {
	root := t.TempDir()
	installed := sequencedCandidate(t, root, "6666666666666666666666666666666666666666", 5)
	path := filepath.Join(installed.Directory, "provenance.json")
	var provenance map[string]any
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &provenance); err != nil {
		t.Fatal(err)
	}
	provenance["whole_disk_raw_image_required"] = true
	data, _ = json.Marshal(provenance)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	for i := range installed.Manifest.Files {
		if installed.Manifest.Files[i].Name != "provenance.json" {
			continue
		}
		digest := sha256.Sum256(data)
		installed.Manifest.Files[i].SHA256 = hex.EncodeToString(digest[:])
		installed.Manifest.Files[i].Size = int64(len(data))
	}
	if _, err := ReleaseSequence(installed); err == nil || !strings.Contains(err.Error(), "whole-disk RAW") {
		t.Fatalf("whole-disk RAW regression unexpectedly accepted: %v", err)
	}
}

func canonicalV4TestEnvelope(commit string) string {
	return "https://github.com/" + SourceRepository +
		"/releases/download/ordax-stable-v4-" + commit + "/release-envelope.json"
}

func sequencedPortableTestCandidate(t *testing.T, root, writerCommit, releaseCommit string) Installed {
	t.Helper()
	installed := sequencedCandidate(t, root, writerCommit, 7)
	payload := validPortablePayload()
	payload.ReleaseSourceCommit = releaseCommit
	sourceRoot := filepath.Join(installed.Directory, portablePayloadDirectory)
	if err := os.Mkdir(sourceRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := range payload.Artifacts {
		binding := &payload.Artifacts[i]
		binding.URL = strings.Replace(binding.URL, "0123456789abcdef0123456789abcdef01234567", releaseCommit, 1)
		body := []byte("v4 canonical fixture bytes:" + binding.ID)
		if err := os.WriteFile(filepath.Join(sourceRoot, binding.ID), body, 0o600); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(body)
		binding.SHA256, binding.SizeBytes = hex.EncodeToString(sum[:]), int64(len(body))
	}
	installed.Manifest.Schema = ManifestSchemaPortable
	installed.Manifest.PortablePayload = &payload
	receipt, err := canonicalPortablePayloadBytes(payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installed.Directory, portablePayloadReceiptName), receipt, 0o600); err != nil {
		t.Fatal(err)
	}
	// The signed publisher embeds this authorized v3 JSON alongside its
	// provenance. Build a production-shaped fixture with internally coherent
	// bindings, then keep the existing manifest's file hashes authoritative.
	auth := physicalAuthorizationV3{
		Schema: "prototype-ordax.physical-write-authorization/3",
		Status: "authorized",
		PhysicalWriteAllowed: true,
		ExplicitOwnerAuthorization: true,
		Scope: "first-real-stable-mvp-usb-proof",
		SourceRepository: SourceRepository,
		ReleaseSequence: 7,
		AuthorizationContextSHA256: strings.Repeat("8", 64),
		Requirements: map[string]bool{"canonical_v4_release_proof_bound": true},
		ConsumerPolicy: map[string]bool{
			"development_channel_may_satisfy_this_authorization": false,
			"legacy_ordax_ext4_layout_may_satisfy_this_authorization": false,
		},
	}
	auth.Bindings.MinimalBootstrapSHA256 = strings.Repeat("2", 64)
	auth.Bindings.ReleaseTrustSHA256 = strings.Repeat("1", 64)
	auth.Bindings.PortableUSBContractSHA256 = strings.Repeat("3", 64)
	auth.Bindings.CreatorPortableMediaContractSHA256 = strings.Repeat("4", 64)
	auth.Bindings.CanonicalV4ReleaseProofSHA256 = strings.Repeat("6", 64)
	auth.ReleaseBinding.ProofPath = "docs/evidence/canonical-v4-release-proof.json"
	auth.ReleaseBinding.ProofSchema = "prototype-ordax.portable-v4-canonical-release-proof/1"
	auth.ReleaseBinding.SourceCommit = releaseCommit
	auth.ReleaseBinding.CanonicalEnvelopeURL = canonicalV4TestEnvelope(releaseCommit)
	auth.ReleaseBinding.ReleaseManifestSHA256 = strings.Repeat("d", 64)
	auth.ReleaseBinding.ReleaseEnvelopeSHA256 = strings.Repeat("e", 64)
	authorizationHash := rewriteBoundAuthorization(t, &installed, func(a *physicalAuthorizationV3) { *a = auth })
	rewriteBoundProvenance(t, &installed, func(p *physicalProvenance) {
		p.CanonicalV4ReleaseSourceCommit = releaseCommit
		p.CanonicalV4ReleaseEnvelopeURL = canonicalV4TestEnvelope(releaseCommit)
		p.PhysicalWriteAuthorizationSHA256 = authorizationHash
	})
	return installed
}

// rewriteBoundAuthorization updates both the fixture and its signed manifest
// binding, so negative tests exercise semantic mismatches, not stale hashes.
func rewriteBoundAuthorization(t *testing.T, installed *Installed, edit func(*physicalAuthorizationV3)) string {
	t.Helper()
	path := filepath.Join(installed.Directory, "physical-write-authorization.json")
	var auth physicalAuthorizationV3
	raw, err := os.ReadFile(path)
	if err != nil { t.Fatal(err) }
	if err := json.Unmarshal(raw, &auth); err != nil { t.Fatal(err) }
	edit(&auth)
	data, err := json.Marshal(auth)
	if err != nil { t.Fatal(err) }
	if err := os.WriteFile(path, data, 0o600); err != nil { t.Fatal(err) }
	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])
	for i := range installed.Manifest.Files {
		if installed.Manifest.Files[i].Name == "physical-write-authorization.json" {
			installed.Manifest.Files[i].SHA256 = digest
			installed.Manifest.Files[i].Size = int64(len(data))
			return digest
		}
	}
	t.Fatal("physical authorization not bound")
	return ""
}

func rewriteBoundProvenance(t *testing.T, installed *Installed, edit func(*physicalProvenance)) {
	t.Helper()
	path := filepath.Join(installed.Directory, "provenance.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var p physicalProvenance
	if err := json.Unmarshal(data, &p); err != nil {
		t.Fatal(err)
	}
	edit(&p)
	data, err = json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	for i := range installed.Manifest.Files {
		if installed.Manifest.Files[i].Name == "provenance.json" {
			sum := sha256.Sum256(data)
			installed.Manifest.Files[i].SHA256 = hex.EncodeToString(sum[:])
			installed.Manifest.Files[i].Size = int64(len(data))
			return
		}
	}
	t.Fatal("provenance not bound")
}

func TestCurrentAcceptsPortableV4ProductionShapedProvenance(t *testing.T) {
	root := t.TempDir()
	trust, private, pin := testTrust(t)
	writer, release := strings.Repeat("9", 40), strings.Repeat("a", 40)
	candidate := sequencedPortableTestCandidate(t, root, writer, release)
	cacheSignedCandidate(t, root, candidate, private)
	current, err := Current(root, trust, pin)
	if err != nil {
		t.Fatalf("production provenance rejected: %v", err)
	}
	sequence, err := ReleaseSequence(current)
	if err != nil || sequence != 7 {
		t.Fatalf("sequence=%d, error=%v", sequence, err)
	}
}

func TestCurrentRejectsPortableV4AuthorizationBindingMismatch(t *testing.T) {
	for _, tc := range []struct{
		name string
		change func(*physicalAuthorizationV3)
	}{
		{"not-authorized", func(a *physicalAuthorizationV3) { a.Status = "blocked-explicit-physical-authorization-pending" }},
		{"no-owner-consent", func(a *physicalAuthorizationV3) { a.ExplicitOwnerAuthorization = false }},
		{"no-write-approval", func(a *physicalAuthorizationV3) { a.PhysicalWriteAllowed = false }},
		{"wrong-sequence", func(a *physicalAuthorizationV3) { a.ReleaseSequence++ }},
		{"wrong-source", func(a *physicalAuthorizationV3) { a.ReleaseBinding.SourceCommit = strings.Repeat("b", 40) }},
		{"wrong-proof", func(a *physicalAuthorizationV3) { a.Bindings.CanonicalV4ReleaseProofSHA256 = strings.Repeat("f", 64) }},
		{"wrong-envelope", func(a *physicalAuthorizationV3) { a.ReleaseBinding.CanonicalEnvelopeURL = canonicalV4TestEnvelope(strings.Repeat("b", 40)) }},
		{"wrong-trust", func(a *physicalAuthorizationV3) { a.Bindings.ReleaseTrustSHA256 = strings.Repeat("f", 64) }},
		{"wrong-bootstrap", func(a *physicalAuthorizationV3) { a.Bindings.MinimalBootstrapSHA256 = strings.Repeat("f", 64) }},
		{"wrong-context", func(a *physicalAuthorizationV3) { a.AuthorizationContextSHA256 = "" }},
		{"development-allowed", func(a *physicalAuthorizationV3) { a.ConsumerPolicy["development_channel_may_satisfy_this_authorization"] = true }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			trust, private, pin := testTrust(t)
			installed := sequencedPortableTestCandidate(t, root, strings.Repeat("9", 40), strings.Repeat("a", 40))
			rewriteBoundAuthorization(t, &installed, tc.change)
			cacheSignedCandidate(t, root, installed, private)
			if _, err := Current(root, trust, pin); err == nil {
				t.Fatal("authorization mismatch accepted with freshly signed manifest")
			}
		})
	}
}

func TestCurrentRejectsProvenanceAuthorizationHashDifferentFromSignedBytes(t *testing.T) {
	root := t.TempDir()
	trust, private, pin := testTrust(t)
	installed := sequencedPortableTestCandidate(t, root, strings.Repeat("9", 40), strings.Repeat("a", 40))
	rewriteBoundProvenance(t, &installed, func(p *physicalProvenance) {
		p.PhysicalWriteAuthorizationSHA256 = strings.Repeat("f", 64)
	})
	cacheSignedCandidate(t, root, installed, private)
	if _, err := Current(root, trust, pin); err == nil {
		t.Fatal("provenance with incorrect but well-formed authorization SHA-256 accepted")
	}
}

func TestCurrentRejectsSignedPortableV4ProvenanceIdentityMismatch(t *testing.T) {
	for _, tc := range []struct{ name string; edit func(*physicalProvenance) }{
		{"writer", func(p *physicalProvenance) { p.WriterSourceCommit = strings.Repeat("b", 40) }},
		{"release", func(p *physicalProvenance) { p.CanonicalV4ReleaseSourceCommit = strings.Repeat("b", 40) }},
		{"proof", func(p *physicalProvenance) { p.CanonicalV4ReleaseProofSHA256 = "" }},
		{"url", func(p *physicalProvenance) { p.CanonicalV4ReleaseEnvelopeURL = canonicalV4TestEnvelope(strings.Repeat("b", 40)) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			trust, private, pin := testTrust(t)
			candidate := sequencedPortableTestCandidate(t, root, strings.Repeat("9", 40), strings.Repeat("a", 40))
			rewriteBoundProvenance(t, &candidate, tc.edit)
			cacheSignedCandidate(t, root, candidate, private)
			if _, err := Current(root, trust, pin); err == nil {
				t.Fatal("inconsistent signed Portable v4 provenance accepted")
			}
		})
	}
}
