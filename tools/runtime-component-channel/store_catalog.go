package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"sort"
)

const (
	storeCatalogEnvelopeSchema    = "ordax.store-catalog-envelope/1"
	storeCatalogPublicationSchema = "ordax-apps.store-catalog-publication/2"
	storeCatalogCandidateSchema   = "ordax-apps.store-catalog-candidate/1"
	storeCatalogSourceRepository  = "ordaxsystems/ordax-apps"
	storeCatalogTrustDomain       = "runtime-components"
	storeCatalogKeyID             = "ordax-runtime-components-v1"
	maxStoreCatalogPayloadBytes   = 2 << 20
	maxStoreCatalogEntries        = 128
)

type storeCatalogSource struct {
	Repository string `json:"repository"`
	Commit     string `json:"commit"`
}

type storeCatalogTrust struct {
	Domain        string `json:"domain"`
	RequiredKeyID string `json:"requiredKeyId"`
}

type storeCatalogArtifact struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type storeCatalogArtifacts struct {
	Package           storeCatalogArtifact `json:"package"`
	Release           storeCatalogArtifact `json:"release"`
	Compatibility     storeCatalogArtifact `json:"compatibility"`
	ComponentEnvelope storeCatalogArtifact `json:"componentEnvelope"`
}

type storeCatalogEntry struct {
	AppID        string                `json:"appId"`
	Title        string                `json:"title"`
	Version      string                `json:"version"`
	ReleaseMode  string                `json:"releaseMode"`
	SourceCommit string                `json:"sourceCommit"`
	Artifacts    storeCatalogArtifacts `json:"artifacts"`
	Trust        storeCatalogTrust     `json:"trust"`
}

type storeCatalogProvenance struct {
	CandidateSchema string `json:"candidateSchema"`
	CandidateSHA256 string `json:"candidateSha256"`
}

type storeCatalogAuthority struct {
	Signing      bool `json:"signing"`
	Publication  bool `json:"publication"`
	Installation bool `json:"installation"`
	Activation   bool `json:"activation"`
	Rollback     bool `json:"rollback"`
}

type storeCatalogSafety struct {
	RequiresExternalSignature                    bool `json:"requiresExternalSignature"`
	CanonicalPublicAnchorRequired                bool `json:"canonicalPublicAnchorRequired"`
	ComponentEnvelopesRequired                   bool `json:"componentEnvelopesRequired"`
	ComponentEnvelopesVerifiedBeforeCatalogAssembly bool `json:"componentEnvelopesVerifiedBeforeCatalogAssembly"`
	ComponentEnvelopesReverifiedByPlatformLifecycle bool `json:"componentEnvelopesReverifiedByPlatformLifecycle"`
	PlatformLifecycleRequired                    bool `json:"platformLifecycleRequired"`
	PayloadGrantsAuthority                       bool `json:"payloadGrantsAuthority"`
}

type storeCatalogPublication struct {
	Schema     string                 `json:"$schema"`
	Status     string                 `json:"status"`
	Sequence   int64                  `json:"sequence"`
	Source     storeCatalogSource     `json:"source"`
	Entries    []storeCatalogEntry    `json:"entries"`
	Trust      storeCatalogTrust      `json:"trust"`
	Provenance storeCatalogProvenance `json:"provenance"`
	Authority  storeCatalogAuthority  `json:"authority"`
	Safety     storeCatalogSafety     `json:"safety"`
}

type verifiedStoreCatalogEntry struct {
	AppID        string                `json:"appId"`
	Title        string                `json:"title"`
	Version      string                `json:"version"`
	ReleaseMode  string                `json:"releaseMode"`
	SourceCommit string                `json:"sourceCommit"`
	Artifacts    storeCatalogArtifacts `json:"artifacts"`
}

type verifiedStoreCatalog struct {
	Schema        string             `json:"schema"`
	State         string             `json:"state"`
	Sequence      int64              `json:"sequence"`
	CatalogSHA256 string             `json:"catalogSha256"`
	Source        storeCatalogSource `json:"source"`
	Trust         struct {
		Domain string `json:"domain"`
		KeyID  string `json:"keyId"`
	} `json:"trust"`
	Entries   []verifiedStoreCatalogEntry `json:"entries"`
	Reason    *string                     `json:"reason"`
	Authority string                      `json:"authority"`
}

func validateStoreCatalogArtifact(value storeCatalogArtifact, label string) error {
	if !fileNamePattern.MatchString(value.Name) {
		return fmt.Errorf("%s name is invalid", label)
	}
	if !shaPattern.MatchString(value.SHA256) || value.Size <= 0 || value.Size > maxPackageBytes {
		return fmt.Errorf("%s identity is invalid", label)
	}
	return nil
}

func validateStoreCatalogPublication(value storeCatalogPublication) error {
	if value.Schema != storeCatalogPublicationSchema {
		return errors.New("unsupported Store catalog publication schema")
	}
	if value.Status != "unsigned-publication-payload" {
		return errors.New("Store catalog publication status is invalid")
	}
	if value.Sequence <= 0 {
		return errors.New("Store catalog publication sequence must be positive")
	}
	if value.Source.Repository != storeCatalogSourceRepository || !commitPattern.MatchString(value.Source.Commit) {
		return errors.New("Store catalog source identity is not canonical")
	}
	if value.Trust.Domain != storeCatalogTrustDomain || value.Trust.RequiredKeyID != storeCatalogKeyID {
		return errors.New("Store catalog trust identity is not canonical")
	}
	if value.Provenance.CandidateSchema != storeCatalogCandidateSchema ||
		!shaPattern.MatchString(value.Provenance.CandidateSHA256) {
		return errors.New("Store catalog provenance is invalid")
	}
	if value.Authority.Signing || value.Authority.Publication || value.Authority.Installation ||
		value.Authority.Activation || value.Authority.Rollback {
		return errors.New("Store catalog publication must remain authority-free")
	}
	if !value.Safety.RequiresExternalSignature ||
		!value.Safety.CanonicalPublicAnchorRequired ||
		!value.Safety.ComponentEnvelopesRequired ||
		!value.Safety.ComponentEnvelopesVerifiedBeforeCatalogAssembly ||
		!value.Safety.ComponentEnvelopesReverifiedByPlatformLifecycle ||
		!value.Safety.PlatformLifecycleRequired ||
		value.Safety.PayloadGrantsAuthority {
		return errors.New("Store catalog safety boundary drifted")
	}
	if len(value.Entries) == 0 || len(value.Entries) > maxStoreCatalogEntries {
		return errors.New("Store catalog entries must be bounded and non-empty")
	}
	ids := make([]string, 0, len(value.Entries))
	seen := map[string]struct{}{}
	for _, entry := range value.Entries {
		if !componentPattern.MatchString(entry.AppID) {
			return errors.New("Store catalog app id is invalid")
		}
		if _, exists := seen[entry.AppID]; exists {
			return fmt.Errorf("Store catalog app id is duplicated: %s", entry.AppID)
		}
		seen[entry.AppID] = struct{}{}
		ids = append(ids, entry.AppID)
		if len(entry.Title) == 0 || len(entry.Title) > 160 || entry.Title != string(bytes.TrimSpace([]byte(entry.Title))) {
			return fmt.Errorf("Store catalog title is invalid: %s", entry.AppID)
		}
		if !semverPattern.MatchString(entry.Version) || entry.ReleaseMode != "component-slot" {
			return fmt.Errorf("Store catalog app release identity is invalid: %s", entry.AppID)
		}
		if entry.SourceCommit != value.Source.Commit {
			return fmt.Errorf("Store catalog source commit mismatch: %s", entry.AppID)
		}
		if entry.Trust != value.Trust {
			return fmt.Errorf("Store catalog entry trust identity drifted: %s", entry.AppID)
		}
		if err := validateStoreCatalogArtifact(entry.Artifacts.Package, entry.AppID+" package"); err != nil {
			return err
		}
		if err := validateStoreCatalogArtifact(entry.Artifacts.Release, entry.AppID+" release"); err != nil {
			return err
		}
		if err := validateStoreCatalogArtifact(entry.Artifacts.Compatibility, entry.AppID+" compatibility"); err != nil {
			return err
		}
		if err := validateStoreCatalogArtifact(entry.Artifacts.ComponentEnvelope, entry.AppID+" component envelope"); err != nil {
			return err
		}
		if entry.Artifacts.ComponentEnvelope.Name != entry.AppID+".runtime-component-envelope.json" {
			return fmt.Errorf("Store catalog component envelope name is not canonical: %s", entry.AppID)
		}
	}
	if !sort.StringsAreSorted(ids) {
		return errors.New("Store catalog entries must be sorted by appId")
	}
	return nil
}

func verifyStoreCatalogEnvelopeBytes(envelopeBytes, trustBytes []byte) (verifiedStoreCatalog, []byte, error) {
	payload, err := verifySignedEnvelopePayload(
		envelopeBytes,
		trustBytes,
		storeCatalogEnvelopeSchema,
		maxStoreCatalogPayloadBytes,
		"Store catalog",
	)
	if err != nil {
		return verifiedStoreCatalog{}, nil, err
	}
	var publication storeCatalogPublication
	if err := decodeStrict(payload, maxStoreCatalogPayloadBytes, &publication); err != nil {
		return verifiedStoreCatalog{}, nil, fmt.Errorf("signed Store catalog publication: %w", err)
	}
	if err := validateStoreCatalogPublication(publication); err != nil {
		return verifiedStoreCatalog{}, nil, err
	}
	digest := sha256.Sum256(payload)
	entries := make([]verifiedStoreCatalogEntry, 0, len(publication.Entries))
	for _, entry := range publication.Entries {
		entries = append(entries, verifiedStoreCatalogEntry{
			AppID:        entry.AppID,
			Title:        entry.Title,
			Version:      entry.Version,
			ReleaseMode:  entry.ReleaseMode,
			SourceCommit: entry.SourceCommit,
			Artifacts:    entry.Artifacts,
		})
	}
	verified := verifiedStoreCatalog{
		Schema:        "ordax.verified-app-store-catalog/1",
		State:         "ready",
		Sequence:      publication.Sequence,
		CatalogSHA256: hex.EncodeToString(digest[:]),
		Source:        publication.Source,
		Entries:       entries,
		Reason:        nil,
		Authority:     "none",
	}
	verified.Trust.Domain = storeCatalogTrustDomain
	verified.Trust.KeyID = storeCatalogKeyID
	return verified, payload, nil
}

func signStoreCatalogPayload(publicationPath, privatePath, trustPath, outputPath, keyID string) error {
	if keyID != storeCatalogKeyID {
		return errors.New("Store catalog signing key id is not canonical")
	}
	payload, err := readRegular(publicationPath, maxStoreCatalogPayloadBytes, false)
	if err != nil {
		return err
	}
	var publication storeCatalogPublication
	if err := decodeStrict(payload, maxStoreCatalogPayloadBytes, &publication); err != nil {
		return err
	}
	if err := validateStoreCatalogPublication(publication); err != nil {
		return err
	}
	private, err := loadPrivateKey(privatePath)
	if err != nil {
		return err
	}
	trust, public, err := loadTrustAnchor(trustPath)
	if err != nil {
		return err
	}
	if trust.KeyID != keyID {
		return errors.New("Store catalog key id does not match runtime component trust")
	}
	derived := private.Public().(ed25519.PublicKey)
	if !bytes.Equal(derived, public) {
		return errors.New("Store catalog private key does not match runtime component trust")
	}
	signed := envelope{
		Schema:    storeCatalogEnvelopeSchema,
		Payload:   payload,
		Signature: ed25519.Sign(private, payload),
		KeyID:     keyID,
	}
	envelopeBytes, err := marshalJSON(signed)
	if err != nil {
		return err
	}
	return writeExclusive(outputPath, envelopeBytes, 0o644)
}

func signStoreCatalogCommand(args []string) error {
	flags := flag.NewFlagSet("sign-store-catalog", flag.ContinueOnError)
	publicationPath := flags.String("publication", "", "canonical Store catalog publication payload")
	privatePath := flags.String("private-key", "", "external PKCS#8 Ed25519 private-key path")
	trustPath := flags.String("trust", "", "runtime component public trust")
	outputPath := flags.String("out", "", "new signed Store catalog envelope")
	keyID := flags.String("key-id", "", "runtime component trust key id")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *publicationPath == "" || *privatePath == "" || *trustPath == "" || *outputPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("sign-store-catalog requires --publication, --private-key, --trust, --out and --key-id")
	}
	if err := signStoreCatalogPayload(*publicationPath, *privatePath, *trustPath, *outputPath, *keyID); err != nil {
		return err
	}
	fmt.Printf("STORE_CATALOG_ENVELOPE_SIGNED=YES\nKEY_ID=%s\nPUBLICATION_AUTHORIZED=NO\nINSTALL_AUTHORITY=NO\nPRIVATE_KEY_PRINTED=NO\n", *keyID)
	return nil
}

func verifyStoreCatalogCommand(args []string) error {
	flags := flag.NewFlagSet("verify-store-catalog", flag.ContinueOnError)
	envelopePath := flags.String("envelope", "", "signed Store catalog envelope")
	trustPath := flags.String("trust", "", "runtime component public trust")
	outputPath := flags.String("out", "", "new verified Store catalog projection")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || *outputPath == "" || flags.NArg() != 0 {
		return errors.New("verify-store-catalog requires --envelope, --trust and --out")
	}
	envelopeBytes, err := readRegular(*envelopePath, maxEnvelopeBytes, false)
	if err != nil {
		return err
	}
	trustBytes, err := readRegular(*trustPath, maxTrustBytes, false)
	if err != nil {
		return err
	}
	verified, _, err := verifyStoreCatalogEnvelopeBytes(envelopeBytes, trustBytes)
	if err != nil {
		return err
	}
	payload, err := marshalJSON(verified)
	if err != nil {
		return err
	}
	if err := writeExclusive(*outputPath, payload, 0o644); err != nil {
		return err
	}
	fmt.Printf(
		"STORE_CATALOG_VERIFIED=YES\nSEQUENCE=%d\nCATALOG_SHA256=%s\nENTRY_COUNT=%d\nAUTHORITY=NONE\n",
		verified.Sequence,
		verified.CatalogSHA256,
		len(verified.Entries),
	)
	return nil
}
