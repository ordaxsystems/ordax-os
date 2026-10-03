package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
)

const (
	releaseSchemaV2       = "prototype-ordax.runtime-component-release/2"
	compatibilitySchemaV1 = "ordax.component-compatibility/1"
	maxCompatibilityBytes = int64(64 << 10)
	maxCompatibilityItems = 128
	maxContractMajor      = int64(10_000)
	maxStateVersion       = int64(1_000_000)
	maxCompatibilityIDLen = 160
)

var compatibilityIDPattern = regexp.MustCompile(`^[a-z0-9]+(?:[.-][a-z0-9]+)*$`)

type compatibilityBinding struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type releaseDescriptorV2 struct {
	Schema            string               `json:"$schema"`
	SourceRepository  string               `json:"source_repository"`
	SourceCommit      string               `json:"source_commit"`
	CreatedFromRecipe string               `json:"created_from_ci_recipe"`
	Component         releaseComponent     `json:"component"`
	Package           packageBinding       `json:"package"`
	Activation        activationPolicy     `json:"activation"`
	Compatibility     compatibilityBinding `json:"compatibility"`
}

type providedCompatibilityContract struct {
	ID    string `json:"id"`
	Major int64  `json:"major"`
}

type requiredCompatibilityContract struct {
	ID       string `json:"id"`
	MinMajor int64  `json:"minMajor"`
	MaxMajor int64  `json:"maxMajor"`
	Optional bool   `json:"optional"`
}

type compatibilityState struct {
	ID              string `json:"id"`
	WriteVersion    int64  `json:"writeVersion"`
	ReadableFrom    int64  `json:"readableFrom"`
	ReadableThrough int64  `json:"readableThrough"`
}

type componentCompatibilityDescriptor struct {
	Schema           string                          `json:"schema"`
	ComponentID      string                          `json:"componentId"`
	ComponentVersion string                          `json:"componentVersion"`
	Provides         []providedCompatibilityContract `json:"provides"`
	Requires         []requiredCompatibilityContract `json:"requires"`
	State            *compatibilityState             `json:"state"`
	Authority        string                          `json:"authority"`
}

func validateCompatibilityID(value, label string) error {
	if len(value) < 1 || len(value) > maxCompatibilityIDLen || !compatibilityIDPattern.MatchString(value) {
		return fmt.Errorf("%s is invalid", label)
	}
	return nil
}

func validateCompatibilityNumber(value, max int64, label string) error {
	if value <= 0 || value > max {
		return fmt.Errorf("%s is outside the supported bound", label)
	}
	return nil
}

func validateReleaseDescriptorV2(value releaseDescriptorV2) error {
	if value.Schema != releaseSchemaV2 {
		return errors.New("unsupported runtime component release/2 schema")
	}
	shared := releaseDescriptor{
		Schema:            releaseSchema,
		SourceRepository:  value.SourceRepository,
		SourceCommit:      value.SourceCommit,
		CreatedFromRecipe: value.CreatedFromRecipe,
		Component:         value.Component,
		Package:           value.Package,
		Activation:        value.Activation,
	}
	if err := validateReleaseDescriptor(shared); err != nil {
		return err
	}
	expectedName := value.Component.ID + ".compatibility.json"
	if !fileNamePattern.MatchString(value.Compatibility.Name) || value.Compatibility.Name != expectedName {
		return errors.New("runtime component release/2 compatibility name is not canonical")
	}
	if value.Compatibility.Schema != compatibilitySchemaV1 {
		return errors.New("runtime component release/2 compatibility schema is unsupported")
	}
	if !shaPattern.MatchString(value.Compatibility.SHA256) ||
		value.Compatibility.Size <= 0 || value.Compatibility.Size > maxCompatibilityBytes {
		return errors.New("runtime component release/2 compatibility binding is invalid")
	}
	return nil
}

func exactJSONObjectKeys(raw json.RawMessage, expected []string, label string) error {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return fmt.Errorf("%s must be an object", label)
	}
	if len(object) != len(expected) {
		return fmt.Errorf("%s shape is invalid", label)
	}
	for _, key := range expected {
		if _, exists := object[key]; !exists {
			return fmt.Errorf("%s shape is invalid", label)
		}
	}
	return nil
}

func validateCompatibilityJSONShape(data []byte) error {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(data, &root); err != nil || root == nil {
		return errors.New("component compatibility descriptor must be an object")
	}
	expectedRoot := []string{"schema", "componentId", "componentVersion", "provides", "requires", "state", "authority"}
	if len(root) != len(expectedRoot) {
		return errors.New("component compatibility descriptor shape is invalid")
	}
	for _, key := range expectedRoot {
		if _, exists := root[key]; !exists {
			return errors.New("component compatibility descriptor shape is invalid")
		}
	}
	var provides []json.RawMessage
	if err := json.Unmarshal(root["provides"], &provides); err != nil {
		return errors.New("component compatibility provides must be an array")
	}
	for _, raw := range provides {
		if err := exactJSONObjectKeys(raw, []string{"id", "major"}, "provided component contract"); err != nil {
			return err
		}
	}
	var requires []json.RawMessage
	if err := json.Unmarshal(root["requires"], &requires); err != nil {
		return errors.New("component compatibility requires must be an array")
	}
	for _, raw := range requires {
		if err := exactJSONObjectKeys(raw, []string{"id", "minMajor", "maxMajor", "optional"}, "required component contract"); err != nil {
			return err
		}
	}
	if string(root["state"]) != "null" {
		if err := exactJSONObjectKeys(root["state"], []string{"id", "writeVersion", "readableFrom", "readableThrough"}, "component state contract"); err != nil {
			return err
		}
	}
	return nil
}

func validateCanonicalCompatibilityJSON(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are forbidden")
		}
		return err
	}
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	if !bytes.Equal(payload, data) {
		return errors.New("runtime component compatibility JSON is not canonical deterministic encoding")
	}
	return nil
}

func validateCompatibilityDescriptor(value componentCompatibilityDescriptor, release releaseDescriptorV2) error {
	if value.Schema != compatibilitySchemaV1 {
		return errors.New("unsupported runtime component compatibility schema")
	}
	if value.ComponentID != release.Component.ID || value.ComponentVersion != release.Component.Version {
		return errors.New("runtime component compatibility identity does not match signed release")
	}
	if !componentPattern.MatchString(value.ComponentID) || !semverPattern.MatchString(value.ComponentVersion) {
		return errors.New("runtime component compatibility identity is invalid")
	}
	if value.Authority != "none" {
		return errors.New("runtime component compatibility must remain authority:none")
	}
	if len(value.Provides) > maxCompatibilityItems || len(value.Requires) > maxCompatibilityItems {
		return errors.New("runtime component compatibility contract list exceeds bound")
	}
	provided := make(map[string]struct{}, len(value.Provides))
	for _, contract := range value.Provides {
		if err := validateCompatibilityID(contract.ID, "provided compatibility contract id"); err != nil {
			return err
		}
		if err := validateCompatibilityNumber(contract.Major, maxContractMajor, "provided compatibility contract major"); err != nil {
			return err
		}
		key := fmt.Sprintf("%s@%d", contract.ID, contract.Major)
		if _, exists := provided[key]; exists {
			return errors.New("runtime component provided compatibility contracts must be unique")
		}
		provided[key] = struct{}{}
	}
	required := make(map[string]struct{}, len(value.Requires))
	for _, contract := range value.Requires {
		if err := validateCompatibilityID(contract.ID, "required compatibility contract id"); err != nil {
			return err
		}
		if _, exists := required[contract.ID]; exists {
			return errors.New("runtime component required compatibility contracts must be unique by id")
		}
		required[contract.ID] = struct{}{}
		if err := validateCompatibilityNumber(contract.MinMajor, maxContractMajor, "required compatibility contract minMajor"); err != nil {
			return err
		}
		if err := validateCompatibilityNumber(contract.MaxMajor, maxContractMajor, "required compatibility contract maxMajor"); err != nil {
			return err
		}
		if contract.MaxMajor < contract.MinMajor {
			return errors.New("runtime component required compatibility contract range is invalid")
		}
	}
	if value.State != nil {
		if err := validateCompatibilityID(value.State.ID, "compatibility state id"); err != nil {
			return err
		}
		if err := validateCompatibilityNumber(value.State.WriteVersion, maxStateVersion, "compatibility state writeVersion"); err != nil {
			return err
		}
		if err := validateCompatibilityNumber(value.State.ReadableFrom, maxStateVersion, "compatibility state readableFrom"); err != nil {
			return err
		}
		if err := validateCompatibilityNumber(value.State.ReadableThrough, maxStateVersion, "compatibility state readableThrough"); err != nil {
			return err
		}
		if value.State.ReadableFrom > value.State.ReadableThrough ||
			value.State.WriteVersion < value.State.ReadableFrom ||
			value.State.WriteVersion > value.State.ReadableThrough {
			return errors.New("runtime component compatibility state readable range excludes writeVersion")
		}
	}
	return nil
}

func validateCompatibilityBytes(release releaseDescriptorV2, compatibilityName string, compatibilityBytes []byte) error {
	if filepath.Base(compatibilityName) != compatibilityName || compatibilityName != release.Compatibility.Name {
		return errors.New("runtime component compatibility filename does not match signed release")
	}
	if len(compatibilityBytes) == 0 || int64(len(compatibilityBytes)) > maxCompatibilityBytes {
		return errors.New("runtime component compatibility size is outside allowed range")
	}
	if int64(len(compatibilityBytes)) != release.Compatibility.Size {
		return errors.New("runtime component compatibility size does not match signed release")
	}
	digest := sha256.Sum256(compatibilityBytes)
	if hex.EncodeToString(digest[:]) != release.Compatibility.SHA256 {
		return errors.New("runtime component compatibility SHA-256 does not match signed release")
	}
	if err := validateCompatibilityJSONShape(compatibilityBytes); err != nil {
		return err
	}
	if err := validateCanonicalCompatibilityJSON(compatibilityBytes); err != nil {
		return err
	}
	var compatibility componentCompatibilityDescriptor
	if err := decodeStrict(compatibilityBytes, int(maxCompatibilityBytes), &compatibility); err != nil {
		return fmt.Errorf("runtime component compatibility descriptor: %w", err)
	}
	return validateCompatibilityDescriptor(compatibility, release)
}

func readReleaseDescriptorV2(releasePath, compatibilityPath string) ([]byte, []byte, releaseDescriptorV2, error) {
	releaseBytes, err := readRegular(releasePath, maxReleaseBytes, false)
	if err != nil {
		return nil, nil, releaseDescriptorV2{}, err
	}
	var release releaseDescriptorV2
	if err := decodeStrict(releaseBytes, maxReleaseBytes, &release); err != nil {
		return nil, nil, releaseDescriptorV2{}, err
	}
	if err := validateReleaseDescriptorV2(release); err != nil {
		return nil, nil, releaseDescriptorV2{}, err
	}
	compatibilityBytes, err := readRegular(compatibilityPath, maxCompatibilityBytes, false)
	if err != nil {
		return nil, nil, releaseDescriptorV2{}, err
	}
	if err := validateCompatibilityBytes(release, filepath.Base(compatibilityPath), compatibilityBytes); err != nil {
		return nil, nil, releaseDescriptorV2{}, err
	}
	return releaseBytes, compatibilityBytes, release, nil
}

func verifyEnvelopeSignaturePayload(envelopeBytes, trustBytes []byte) ([]byte, error) {
	var trust trustAnchor
	if err := decodeStrict(trustBytes, maxTrustBytes, &trust); err != nil {
		return nil, fmt.Errorf("trust anchor: %w", err)
	}
	if trust.Schema != trustSchema {
		return nil, errors.New("unsupported runtime component trust schema")
	}
	if err := validateKeyID(trust.KeyID); err != nil {
		return nil, err
	}
	publicBytes, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil || len(publicBytes) != ed25519.PublicKeySize {
		return nil, errors.New("runtime component trust contains an invalid Ed25519 public key")
	}
	var signed envelope
	if err := decodeStrict(envelopeBytes, maxEnvelopeBytes, &signed); err != nil {
		return nil, fmt.Errorf("runtime component envelope: %w", err)
	}
	if signed.Schema != envelopeSchema {
		return nil, errors.New("unsupported runtime component envelope schema")
	}
	if signed.KeyID != trust.KeyID {
		return nil, errors.New("runtime component envelope key_id does not match trust")
	}
	if len(signed.Payload) == 0 || len(signed.Payload) > maxReleaseBytes {
		return nil, errors.New("runtime component signed payload size is invalid")
	}
	if len(signed.Signature) != ed25519.SignatureSize ||
		!ed25519.Verify(ed25519.PublicKey(publicBytes), signed.Payload, signed.Signature) {
		return nil, errors.New("runtime component signature verification failed")
	}
	return signed.Payload, nil
}

func signReleaseV2(releasePath, compatibilityPath, privatePath, trustPath, outputPath, keyID string) (releaseDescriptorV2, error) {
	if err := validateKeyID(keyID); err != nil {
		return releaseDescriptorV2{}, err
	}
	releaseBytes, _, release, err := readReleaseDescriptorV2(releasePath, compatibilityPath)
	if err != nil {
		return releaseDescriptorV2{}, fmt.Errorf("release/2 descriptor: %w", err)
	}
	private, err := loadPrivateKey(privatePath)
	if err != nil {
		return releaseDescriptorV2{}, err
	}
	trust, public, err := loadTrustAnchor(trustPath)
	if err != nil {
		return releaseDescriptorV2{}, err
	}
	if trust.KeyID != keyID {
		return releaseDescriptorV2{}, errors.New("key id does not match runtime component trust")
	}
	derived := private.Public().(ed25519.PublicKey)
	if !bytes.Equal(derived, public) {
		return releaseDescriptorV2{}, errors.New("private key does not match runtime component trust")
	}
	signed := envelope{
		Schema:    envelopeSchema,
		Payload:   releaseBytes,
		Signature: ed25519.Sign(private, releaseBytes),
		KeyID:     keyID,
	}
	payload, err := marshalJSON(signed)
	if err != nil {
		return releaseDescriptorV2{}, err
	}
	if err := writeExclusive(outputPath, payload, 0o644); err != nil {
		return releaseDescriptorV2{}, err
	}
	return release, nil
}

func verifyEnvelopeV2Bytes(envelopeBytes, trustBytes, compatibilityBytes []byte, compatibilityName string) (releaseDescriptorV2, error) {
	payload, err := verifyEnvelopeSignaturePayload(envelopeBytes, trustBytes)
	if err != nil {
		return releaseDescriptorV2{}, err
	}
	var release releaseDescriptorV2
	if err := decodeStrict(payload, maxReleaseBytes, &release); err != nil {
		return releaseDescriptorV2{}, fmt.Errorf("signed runtime component release/2: %w", err)
	}
	if err := validateReleaseDescriptorV2(release); err != nil {
		return releaseDescriptorV2{}, err
	}
	if err := validateCompatibilityBytes(release, compatibilityName, compatibilityBytes); err != nil {
		return releaseDescriptorV2{}, err
	}
	return release, nil
}

func verifyEnvelopeV2Files(envelopePath, trustPath, compatibilityPath string) (releaseDescriptorV2, []byte, []byte, []byte, error) {
	envelopeBytes, err := readRegular(envelopePath, maxEnvelopeBytes, false)
	if err != nil {
		return releaseDescriptorV2{}, nil, nil, nil, err
	}
	trustBytes, err := readRegular(trustPath, maxTrustBytes, false)
	if err != nil {
		return releaseDescriptorV2{}, nil, nil, nil, err
	}
	compatibilityBytes, err := readRegular(compatibilityPath, maxCompatibilityBytes, false)
	if err != nil {
		return releaseDescriptorV2{}, nil, nil, nil, err
	}
	release, err := verifyEnvelopeV2Bytes(
		envelopeBytes,
		trustBytes,
		compatibilityBytes,
		filepath.Base(compatibilityPath),
	)
	return release, envelopeBytes, trustBytes, compatibilityBytes, err
}
