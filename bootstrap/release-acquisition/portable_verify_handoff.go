package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
)

// portableVerifyReceiptWire is the narrow boot handoff emitted only after the
// release agent has completed exact portable-release verification. The
// artifact digest is derived from the same signed manifest payload that was
// already verified by verifyPortable*Exact; this layer does not introduce a
// second signing or trust authority.
type portableVerifyReceiptWire struct {
	Status            string `json:"status"`
	SourceCommit      string `json:"source_commit"`
	ReleasePath       string `json:"release_path"`
	ArtifactPath      string `json:"artifact_path"`
	ArtifactSHA256    string `json:"artifact_sha256"`
	RuntimePath       string `json:"runtime_path,omitempty"`
	AIRuntimePath     string `json:"ai_runtime_path,omitempty"`
	ActivationAllowed bool   `json:"activation_allowed"`
}

func portableVerifyReceiptExpectedSchema(receipt PortableVerifyReceipt) (string, error) {
	if receipt.ActivationAllowed {
		return "", fmt.Errorf("portable verification handoff cannot allow activation")
	}
	switch receipt.Status {
	case "verified-portable-exact":
		if receipt.RuntimePath != "" || receipt.AIRuntimePath != "" {
			return "", fmt.Errorf("portable v2 verification handoff contains unexpected runtime paths")
		}
		return manifestSchemaV2, nil
	case "verified-portable-v3-exact":
		if receipt.RuntimePath == "" || receipt.AIRuntimePath != "" {
			return "", fmt.Errorf("portable v3 verification handoff runtime paths are invalid")
		}
		return manifestSchemaV3, nil
	case "verified-portable-v4-exact":
		if receipt.RuntimePath == "" || receipt.AIRuntimePath == "" {
			return "", fmt.Errorf("portable v4 verification handoff runtime paths are invalid")
		}
		return manifestSchemaV4, nil
	default:
		return "", fmt.Errorf("unsupported portable verification handoff status: %q", receipt.Status)
	}
}

func authenticatedSystemDigestForPortableVerifyReceipt(receipt PortableVerifyReceipt) (string, error) {
	expectedSchema, err := portableVerifyReceiptExpectedSchema(receipt)
	if err != nil {
		return "", err
	}
	if !commitPattern.MatchString(receipt.SourceCommit) {
		return "", fmt.Errorf("portable verification handoff source commit is invalid")
	}
	if receipt.ReleasePath == "" || filepath.Clean(receipt.ReleasePath) != receipt.ReleasePath {
		return "", fmt.Errorf("portable verification handoff release path is not canonical")
	}
	if filepath.Base(receipt.ReleasePath) != receipt.SourceCommit || filepath.Base(filepath.Dir(receipt.ReleasePath)) != "releases" {
		return "", fmt.Errorf("portable verification handoff release path does not name the verified commit")
	}
	expectedArtifactPath := filepath.Join(receipt.ReleasePath, "system.erofs")
	if receipt.ArtifactPath != expectedArtifactPath {
		return "", fmt.Errorf("portable verification handoff artifact path is not canonical")
	}

	manifestBytes, err := readBoundedRegularFile(
		filepath.Join(receipt.ReleasePath, "release-manifest.json"),
		maxPayload,
		"portable verification handoff manifest",
	)
	if err != nil {
		return "", err
	}
	envelopeBytes, err := readBoundedRegularFile(
		filepath.Join(receipt.ReleasePath, "release-envelope.json"),
		maxEnvelope,
		"portable verification handoff envelope",
	)
	if err != nil {
		return "", err
	}
	var envelope Envelope
	if err := strictDecode(envelopeBytes, maxEnvelope, &envelope); err != nil {
		return "", fmt.Errorf("decode portable verification handoff envelope: %w", err)
	}
	if envelope.Schema != envelopeSchema || !bytes.Equal(envelope.Payload, manifestBytes) {
		return "", fmt.Errorf("portable verification handoff manifest differs from signed envelope payload")
	}

	var manifest Manifest
	if err := strictDecode(manifestBytes, maxPayload, &manifest); err != nil {
		return "", fmt.Errorf("decode portable verification handoff manifest: %w", err)
	}
	if manifest.SourceRepository == "" {
		return "", fmt.Errorf("portable verification handoff source repository is empty")
	}
	if err := validateManifest(manifest, manifest.SourceRepository); err != nil {
		return "", fmt.Errorf("portable verification handoff manifest is invalid: %w", err)
	}
	if manifest.Schema != expectedSchema || manifest.SourceCommit != receipt.SourceCommit {
		return "", fmt.Errorf("portable verification handoff manifest identity does not match receipt")
	}
	if len(manifest.Artifacts) == 0 {
		return "", fmt.Errorf("portable verification handoff manifest has no system artifact")
	}
	systemArtifact := manifest.Artifacts[0]
	if systemArtifact.Name != "system.erofs" || systemArtifact.Role != "system-image" || !shaPattern.MatchString(systemArtifact.SHA256) {
		return "", fmt.Errorf("portable verification handoff system artifact identity is invalid")
	}

	// Exact verification already authenticated this digest against the signed
	// manifest. Re-check the current image bytes here only to fail closed on a
	// post-verification mutation before the JSON handoff is emitted; the digest
	// value itself still comes from the signed manifest, not from a new trust
	// authority.
	actualDigest, actualSize, err := hashFile(receipt.ArtifactPath)
	if err != nil {
		return "", fmt.Errorf("portable verification handoff system artifact: %w", err)
	}
	if actualSize != systemArtifact.Size || actualDigest != systemArtifact.SHA256 {
		return "", fmt.Errorf("portable verification handoff system artifact digest mismatch")
	}
	return systemArtifact.SHA256, nil
}

func (receipt PortableVerifyReceipt) MarshalJSON() ([]byte, error) {
	digest, err := authenticatedSystemDigestForPortableVerifyReceipt(receipt)
	if err != nil {
		return nil, err
	}
	return json.Marshal(portableVerifyReceiptWire{
		Status:            receipt.Status,
		SourceCommit:      receipt.SourceCommit,
		ReleasePath:       receipt.ReleasePath,
		ArtifactPath:      receipt.ArtifactPath,
		ArtifactSHA256:    digest,
		RuntimePath:       receipt.RuntimePath,
		AIRuntimePath:     receipt.AIRuntimePath,
		ActivationAllowed: receipt.ActivationAllowed,
	})
}
