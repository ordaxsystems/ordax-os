package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testStorePublication() storeCatalogPublication {
	entryTrust := storeCatalogTrust{
		Domain:        storeCatalogTrustDomain,
		RequiredKeyID: storeCatalogKeyID,
	}
	return storeCatalogPublication{
		Schema:   storeCatalogPublicationSchema,
		Status:   "unsigned-publication-payload",
		Sequence: 17,
		Source: storeCatalogSource{
			Repository: storeCatalogSourceRepository,
			Commit:     testSourceCommit,
		},
		Entries: []storeCatalogEntry{
			{
				AppID:        "notes",
				Title:        "Notas",
				Version:      "0.4.3",
				ReleaseMode:  "component-slot",
				SourceCommit: testSourceCommit,
				Artifacts: storeCatalogArtifacts{
					Package: storeCatalogArtifact{
						Name: "notes.zip", SHA256: strings.Repeat("a", 64), Size: 123,
					},
					Release: storeCatalogArtifact{
						Name: "notes.release.json", SHA256: strings.Repeat("b", 64), Size: 124,
					},
					Compatibility: storeCatalogArtifact{
						Name: "notes.compatibility.json", SHA256: strings.Repeat("c", 64), Size: 125,
					},
				},
				Trust: entryTrust,
			},
		},
		Trust: entryTrust,
		Provenance: storeCatalogProvenance{
			CandidateSchema: storeCatalogCandidateSchema,
			CandidateSHA256: strings.Repeat("d", 64),
		},
		Authority: storeCatalogAuthority{},
		Safety: storeCatalogSafety{
			RequiresExternalSignature:     true,
			CanonicalPublicAnchorRequired: true,
			PlatformLifecycleRequired:     true,
			PayloadGrantsAuthority:        false,
		},
	}
}

func makeStoreCatalogFixture(t *testing.T) (string, string, string, string) {
	t.Helper()
	dir := t.TempDir()
	publicationPath := filepath.Join(dir, "store.catalog-publication.json")
	privatePath := filepath.Join(dir, "private.pem")
	trustPath := filepath.Join(dir, "runtime-components-trust.json")
	envelopePath := filepath.Join(dir, "store.catalog-envelope.json")

	payload, err := marshalJSON(testStorePublication())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(publicationPath, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := generateKey(privatePath, trustPath, storeCatalogKeyID); err != nil {
		t.Fatal(err)
	}
	if err := signStoreCatalogPayload(
		publicationPath,
		privatePath,
		trustPath,
		envelopePath,
		storeCatalogKeyID,
	); err != nil {
		t.Fatal(err)
	}
	return publicationPath, privatePath, trustPath, envelopePath
}

func TestStoreCatalogVerifierAuthenticatesExactPublicationWithoutLifecycleAuthority(t *testing.T) {
	_, _, trustPath, envelopePath := makeStoreCatalogFixture(t)
	envelopeBytes, err := os.ReadFile(envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	trustBytes, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	verified, signedPayload, err := verifyStoreCatalogEnvelopeBytes(envelopeBytes, trustBytes)
	if err != nil {
		t.Fatal(err)
	}
	if verified.Schema != "ordax.verified-app-store-catalog/1" ||
		verified.State != "ready" ||
		verified.Sequence != 17 ||
		verified.Authority != "none" ||
		verified.Reason != nil {
		t.Fatalf("unexpected verified catalog: %+v", verified)
	}
	if verified.Source.Repository != storeCatalogSourceRepository ||
		verified.Source.Commit != testSourceCommit ||
		verified.Trust.Domain != storeCatalogTrustDomain ||
		verified.Trust.KeyID != storeCatalogKeyID {
		t.Fatalf("verified catalog identity drifted: %+v", verified)
	}
	if len(verified.Entries) != 1 || verified.Entries[0].AppID != "notes" {
		t.Fatalf("unexpected verified entries: %+v", verified.Entries)
	}
	var publication storeCatalogPublication
	if err := json.Unmarshal(signedPayload, &publication); err != nil {
		t.Fatal(err)
	}
	if publication.Authority.Installation || publication.Authority.Activation || publication.Authority.Rollback {
		t.Fatal("signed Store catalog unexpectedly carries lifecycle authority")
	}
}

func TestStoreCatalogVerifierRejectsTamperingAndWrongTrust(t *testing.T) {
	_, _, trustPath, envelopePath := makeStoreCatalogFixture(t)
	envelopeBytes, err := os.ReadFile(envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	trustBytes, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}

	var signed envelope
	if err := json.Unmarshal(envelopeBytes, &signed); err != nil {
		t.Fatal(err)
	}
	signed.Payload[0] ^= 1
	tampered, err := marshalJSON(signed)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := verifyStoreCatalogEnvelopeBytes(tampered, trustBytes); err == nil ||
		!strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("tampered catalog error = %v", err)
	}

	dir := t.TempDir()
	otherPrivate := filepath.Join(dir, "other-private.pem")
	otherTrust := filepath.Join(dir, "other-trust.json")
	if _, err := generateKey(otherPrivate, otherTrust, storeCatalogKeyID); err != nil {
		t.Fatal(err)
	}
	otherTrustBytes, err := os.ReadFile(otherTrust)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := verifyStoreCatalogEnvelopeBytes(envelopeBytes, otherTrustBytes); err == nil ||
		!strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("wrong trust error = %v", err)
	}
}

func TestStoreCatalogSigningRejectsAuthorityAndIdentityDrift(t *testing.T) {
	dir := t.TempDir()
	privatePath := filepath.Join(dir, "private.pem")
	trustPath := filepath.Join(dir, "trust.json")
	if _, err := generateKey(privatePath, trustPath, storeCatalogKeyID); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*storeCatalogPublication){
		"authority": func(value *storeCatalogPublication) {
			value.Authority.Installation = true
		},
		"source": func(value *storeCatalogPublication) {
			value.Source.Repository = "example/other"
		},
		"trust": func(value *storeCatalogPublication) {
			value.Trust.RequiredKeyID = "other-key"
		},
		"entry-source": func(value *storeCatalogPublication) {
			value.Entries[0].SourceCommit = strings.Repeat("9", 40)
		},
	} {
		t.Run(name, func(t *testing.T) {
			value := testStorePublication()
			mutate(&value)
			payload, err := marshalJSON(value)
			if err != nil {
				t.Fatal(err)
			}
			publicationPath := filepath.Join(t.TempDir(), "publication.json")
			if err := os.WriteFile(publicationPath, payload, 0o644); err != nil {
				t.Fatal(err)
			}
			err = signStoreCatalogPayload(
				publicationPath,
				privatePath,
				trustPath,
				filepath.Join(t.TempDir(), "envelope.json"),
				storeCatalogKeyID,
			)
			if err == nil {
				t.Fatal("drifted Store catalog publication unexpectedly signed")
			}
		})
	}
}

func TestStoreCatalogEnvelopeSchemaCannotAliasComponentReleaseEnvelope(t *testing.T) {
	_, _, trustPath, envelopePath := makeStoreCatalogFixture(t)
	envelopeBytes, err := os.ReadFile(envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	trustBytes, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyEnvelopeSignaturePayload(envelopeBytes, trustBytes); err == nil ||
		!strings.Contains(err.Error(), "envelope schema") {
		t.Fatalf("Store envelope unexpectedly accepted as component release: %v", err)
	}
}
