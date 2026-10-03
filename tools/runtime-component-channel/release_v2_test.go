package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type releaseV2Fixture struct {
	dir               string
	packagePath       string
	releasePath       string
	compatibilityPath string
	privatePath       string
	trustPath         string
	envelopePath      string
	release           releaseDescriptorV2
}

func canonicalCompatibilityFor(t *testing.T, componentID, version string) []byte {
	t.Helper()
	value := map[string]any{
		"schema":           compatibilitySchemaV1,
		"componentId":      componentID,
		"componentVersion": version,
		"provides": []any{
			map[string]any{"id": "ordax.internet", "major": 1},
		},
		"requires":  []any{},
		"state":     nil,
		"authority": "none",
	}
	payload, err := marshalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func writeReleaseV2Fixture(t *testing.T) releaseV2Fixture {
	t.Helper()
	dir := t.TempDir()
	packagePath, manifestHash, packageHash, packageSize := writePackage(
		t,
		dir,
		"system/components/internet/runtime.mjs",
	)
	compatibilityPath := filepath.Join(dir, "internet.compatibility.json")
	compatibilityBytes := canonicalCompatibilityFor(t, "internet", "0.3.0")
	if err := os.WriteFile(compatibilityPath, compatibilityBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	compatibilityDigest := sha256.Sum256(compatibilityBytes)
	release := releaseDescriptorV2{
		Schema:            releaseSchemaV2,
		SourceRepository:  sourceRepository,
		SourceCommit:      testSourceCommit,
		CreatedFromRecipe: createdFromRecipe,
		Component: releaseComponent{
			ID:            "internet",
			Version:       "0.3.0",
			ReleaseMode:   "bundled",
			PackageSchema: packageSchema,
		},
		Package: packageBinding{
			Name:           filepath.Base(packagePath),
			SHA256:         packageHash,
			Size:           packageSize,
			ManifestSHA256: manifestHash,
		},
		Activation: activationPolicy{
			DirectActivationAllowed: false,
			PendingHealthRequired:   true,
		},
		Compatibility: compatibilityBinding{
			Name:   filepath.Base(compatibilityPath),
			Schema: compatibilitySchemaV1,
			SHA256: hex.EncodeToString(compatibilityDigest[:]),
			Size:   int64(len(compatibilityBytes)),
		},
	}
	releaseBytes, err := marshalJSON(release)
	if err != nil {
		t.Fatal(err)
	}
	releasePath := filepath.Join(dir, "runtime-component-release-v2.json")
	if err := os.WriteFile(releasePath, releaseBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	privatePath := filepath.Join(dir, "component-private.pem")
	trustPath := filepath.Join(dir, "component-trust.json")
	if _, err := generateKey(privatePath, trustPath, "runtime-components-v2-test-1"); err != nil {
		t.Fatal(err)
	}
	envelopePath := filepath.Join(dir, "runtime-component-envelope-v2.json")
	if _, err := signReleaseV2(
		releasePath,
		compatibilityPath,
		privatePath,
		trustPath,
		envelopePath,
		"runtime-components-v2-test-1",
	); err != nil {
		t.Fatal(err)
	}
	return releaseV2Fixture{
		dir:               dir,
		packagePath:       packagePath,
		releasePath:       releasePath,
		compatibilityPath: compatibilityPath,
		privatePath:       privatePath,
		trustPath:         trustPath,
		envelopePath:      envelopePath,
		release:           release,
	}
}

func rewriteCompatibilityAndBinding(t *testing.T, fixture releaseV2Fixture, compatibilityBytes []byte) {
	t.Helper()
	if err := os.WriteFile(fixture.compatibilityPath, compatibilityBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(compatibilityBytes)
	release := fixture.release
	release.Compatibility.SHA256 = hex.EncodeToString(digest[:])
	release.Compatibility.Size = int64(len(compatibilityBytes))
	releaseBytes, err := marshalJSON(release)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixture.releasePath, releaseBytes, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestReleaseV2UsesExistingRuntimeComponentTrustDomain(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	release, _, _, _, err := verifyEnvelopeV2Files(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.compatibilityPath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if release.Schema != releaseSchemaV2 || release.Component.ID != "internet" {
		t.Fatalf("unexpected release/2 identity: %+v", release)
	}
	if release.Activation.DirectActivationAllowed || !release.Activation.PendingHealthRequired {
		t.Fatalf("unsafe release/2 activation policy: %+v", release.Activation)
	}
}

func TestReleaseV2CompatibilityTamperFailsAfterSigning(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	value := map[string]any{}
	payload, err := os.ReadFile(fixture.compatibilityPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &value); err != nil {
		t.Fatal(err)
	}
	provides := value["provides"].([]any)
	provides[0].(map[string]any)["major"] = float64(2)
	tampered, err := marshalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixture.compatibilityPath, tampered, 0o644); err != nil {
		t.Fatal(err)
	}
	_, _, _, _, err = verifyEnvelopeV2Files(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.compatibilityPath,
	)
	if err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("tampered compatibility error = %v", err)
	}
}

func TestReleaseV2SigningRejectsAuthorityEscalationEvenWhenRebound(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	value := map[string]any{}
	payload, err := os.ReadFile(fixture.compatibilityPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &value); err != nil {
		t.Fatal(err)
	}
	value["authority"] = "system"
	changed, err := marshalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	rewriteCompatibilityAndBinding(t, fixture, changed)
	out := filepath.Join(fixture.dir, "authority-escalation-envelope.json")
	_, err = signReleaseV2(
		fixture.releasePath,
		fixture.compatibilityPath,
		fixture.privatePath,
		fixture.trustPath,
		out,
		"runtime-components-v2-test-1",
	)
	if err == nil || !strings.Contains(err.Error(), "authority:none") {
		t.Fatalf("authority escalation error = %v", err)
	}
}

func TestReleaseV2SigningRejectsMissingNestedFields(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	value := map[string]any{
		"schema":           compatibilitySchemaV1,
		"componentId":      "internet",
		"componentVersion": "0.3.0",
		"provides":         []any{},
		"requires": []any{
			map[string]any{"id": "ordax.local-ai", "minMajor": 1, "maxMajor": 1},
		},
		"state":     nil,
		"authority": "none",
	}
	changed, err := marshalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	rewriteCompatibilityAndBinding(t, fixture, changed)
	out := filepath.Join(fixture.dir, "missing-field-envelope.json")
	_, err = signReleaseV2(
		fixture.releasePath,
		fixture.compatibilityPath,
		fixture.privatePath,
		fixture.trustPath,
		out,
		"runtime-components-v2-test-1",
	)
	if err == nil || !strings.Contains(err.Error(), "shape is invalid") {
		t.Fatalf("missing nested field error = %v", err)
	}
}

func TestReleaseV2SigningRejectsNonCanonicalCompatibilityEncoding(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	value := map[string]any{}
	payload, err := os.ReadFile(fixture.compatibilityPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &value); err != nil {
		t.Fatal(err)
	}
	compact, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	rewriteCompatibilityAndBinding(t, fixture, compact)
	out := filepath.Join(fixture.dir, "noncanonical-envelope.json")
	_, err = signReleaseV2(
		fixture.releasePath,
		fixture.compatibilityPath,
		fixture.privatePath,
		fixture.trustPath,
		out,
		"runtime-components-v2-test-1",
	)
	if err == nil || !strings.Contains(err.Error(), "canonical deterministic") {
		t.Fatalf("noncanonical compatibility error = %v", err)
	}
}

func TestReleaseV2SigningRejectsCompatibilityIdentitySubstitution(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	value := map[string]any{}
	payload, err := os.ReadFile(fixture.compatibilityPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &value); err != nil {
		t.Fatal(err)
	}
	value["componentId"] = "ordax-intelligence"
	changed, err := marshalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	rewriteCompatibilityAndBinding(t, fixture, changed)
	out := filepath.Join(fixture.dir, "identity-substitution-envelope.json")
	_, err = signReleaseV2(
		fixture.releasePath,
		fixture.compatibilityPath,
		fixture.privatePath,
		fixture.trustPath,
		out,
		"runtime-components-v2-test-1",
	)
	if err == nil || !strings.Contains(err.Error(), "identity does not match") {
		t.Fatalf("compatibility identity substitution error = %v", err)
	}
}

func TestReleaseV2RejectsWrongTrust(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	otherPrivate := filepath.Join(fixture.dir, "other-private.pem")
	otherTrust := filepath.Join(fixture.dir, "other-trust.json")
	if _, err := generateKey(otherPrivate, otherTrust, "runtime-components-v2-test-1"); err != nil {
		t.Fatal(err)
	}
	compatibilityBytes, err := os.ReadFile(fixture.compatibilityPath)
	if err != nil {
		t.Fatal(err)
	}
	envelopeBytes, err := os.ReadFile(fixture.envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	trustBytes, err := os.ReadFile(otherTrust)
	if err != nil {
		t.Fatal(err)
	}
	_, err = verifyEnvelopeV2Bytes(
		envelopeBytes,
		trustBytes,
		compatibilityBytes,
		filepath.Base(fixture.compatibilityPath),
	)
	if err == nil || !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("wrong trust error = %v", err)
	}
}
