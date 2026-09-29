package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

const (
	manifestSchema = "prototype-ordax.profile-content-manifest/1"
	envelopeSchema = "prototype-ordax.profile-content-envelope/1"
	trustSchema    = "prototype-ordax.profile-content-trust/1"
	algorithm      = "ed25519"
	contentFormat  = "ordax.profile-content-pack/1"

	maxManifestBytes = 256 << 10
	maxEnvelopeBytes = 16 << 10
	maxTrustBytes    = 16 << 10
	maxPrivateKey    = 16 << 10
	maxContentBytes        = int64(256 << 20)
	maxStructuralPackBytes = int64(64 << 20)
	maxPackEntries         = 2048
	maxEntryTextBytes      = 1 << 20
	maxTotalTextBytes      = 32 << 20

	stageManifestName = "profile-content-manifest.json"
	stageEnvelopeName = "profile-content-envelope.json"
	stageContentName  = "content.pack"
	defaultStageRoot  = "/var/lib/ordax/profile-content"
)

var (
	idPattern     = regexp.MustCompile(`^[a-z][a-z0-9._-]{1,127}$`)
	versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$`)
	keyIDPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	shaPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type sourceDescriptor struct {
	URI          string  `json:"uri"`
	Revision     string  `json:"revision"`
	License      string  `json:"license"`
	Jurisdiction *string `json:"jurisdiction"`
}

type profileContentManifest struct {
	Schema                   string           `json:"$schema"`
	ID                       string           `json:"id"`
	Kind                     string           `json:"kind"`
	Version                  string           `json:"version"`
	Publisher                string           `json:"publisher"`
	ContentHash              string           `json:"content_hash"`
	ContentSize              int64            `json:"content_size"`
	ContentFormat            string           `json:"content_format"`
	Source                   sourceDescriptor `json:"source"`
	RequestedCapabilities    []string         `json:"requested_capabilities"`
	RuntimeNetworkAllowed    bool             `json:"runtime_network_allowed"`
	MutableHostAccessAllowed bool             `json:"mutable_host_access_allowed"`
}

type envelope struct {
	Schema          string `json:"$schema"`
	Algorithm       string `json:"algorithm"`
	KeyID           string `json:"key_id"`
	SignatureBase64 string `json:"signature_base64"`
}

type trustAnchor struct {
	Schema       string `json:"$schema"`
	Algorithm    string `json:"algorithm"`
	KeyID        string `json:"key_id"`
	PublicKeyB64 string `json:"public_key_base64"`
}

type contentSource struct {
	URI          string  `json:"uri"`
	Revision     string  `json:"revision"`
	License      string  `json:"license"`
	Jurisdiction *string `json:"jurisdiction"`
	Title        string  `json:"title"`
}

type profileContentPack struct {
	Schema  string            `json:"schema"`
	Kind    string            `json:"kind"`
	Entries []json.RawMessage `json:"entries"`
}

type knowledgeEntry struct {
	ID            string        `json:"id"`
	MediaType     string        `json:"mediaType"`
	Content       string        `json:"content"`
	ContentSHA256 string        `json:"contentSha256"`
	Source        contentSource `json:"source"`
}

type skillEntry struct {
	ID                 string        `json:"id"`
	Title              string        `json:"title"`
	Instructions       string        `json:"instructions"`
	InstructionsSHA256 string        `json:"instructionsSha256"`
	Authority          string        `json:"authority"`
	ToolIDs            []string      `json:"toolIds"`
	Source             contentSource `json:"source"`
}

type profileContentHealth struct {
	State                       string
	Kind                        string
	EntryCount                  int
	PerEntryHashVerified        bool
	PerEntryProvenanceVerified  bool
	ExecutablePayloadAllowed    bool
	Authority                   string
}

type stageEvidenceArtifact struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"sizeBytes"`
}

type stageEvidenceVerification struct {
	SignatureAlgorithm string `json:"signatureAlgorithm"`
	KeyID              string `json:"keyId"`
	ManifestSHA256     string `json:"manifestSha256"`
}

type stageEvidenceHealth struct {
	Schema                      string `json:"schema"`
	State                       string `json:"state"`
	EntryCount                  int    `json:"entryCount"`
	PerEntryHashVerified        bool   `json:"perEntryHashVerified"`
	PerEntryProvenanceVerified  bool   `json:"perEntryProvenanceVerified"`
	ExecutablePayloadAllowed    bool   `json:"executablePayloadAllowed"`
	Authority                   string `json:"authority"`
}

type profileContentStageEvidence struct {
	Schema       string                    `json:"schema"`
	Artifact     stageEvidenceArtifact     `json:"artifact"`
	Verification stageEvidenceVerification `json:"verification"`
	Health       stageEvidenceHealth       `json:"health"`
}

func decodeStrict(data []byte, max int, target any) error {
	if len(data) == 0 || len(data) > max {
		return fmt.Errorf("document size outside allowed range: %d", len(data))
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are forbidden")
		}
		return err
	}
	return nil
}

func boundedText(value, label string, max int) error {
	if len(value) < 1 || len(value) > max || bytes.IndexByte([]byte(value), 0) >= 0 {
		return fmt.Errorf("%s must be bounded text", label)
	}
	return nil
}

func validateManifest(value profileContentManifest) error {
	if value.Schema != manifestSchema {
		return errors.New("unsupported Profile content manifest schema")
	}
	if !idPattern.MatchString(value.ID) {
		return errors.New("Profile content id is invalid")
	}
	if value.Kind != "knowledge-pack" && value.Kind != "skill-pack" {
		return errors.New("Profile content kind is unsupported")
	}
	if !versionPattern.MatchString(value.Version) {
		return errors.New("Profile content version is invalid")
	}
	if err := boundedText(value.Publisher, "publisher", 120); err != nil {
		return err
	}
	if !shaPattern.MatchString(value.ContentHash) {
		return errors.New("Profile content hash must be lowercase SHA-256")
	}
	if value.ContentSize <= 0 || value.ContentSize > maxContentBytes {
		return errors.New("Profile content size is outside allowed bounds")
	}
	if value.ContentFormat != contentFormat {
		return errors.New("Profile content format is unsupported")
	}
	if err := boundedText(value.Source.URI, "source uri", 512); err != nil {
		return err
	}
	if err := boundedText(value.Source.Revision, "source revision", 160); err != nil {
		return err
	}
	if err := boundedText(value.Source.License, "source license", 120); err != nil {
		return err
	}
	if value.Source.Jurisdiction != nil {
		if err := boundedText(*value.Source.Jurisdiction, "source jurisdiction", 80); err != nil {
			return err
		}
	}
	if len(value.RequestedCapabilities) != 0 {
		return errors.New("Profile content proof must not request capabilities")
	}
	if value.RuntimeNetworkAllowed {
		return errors.New("Profile content proof cannot allow runtime network")
	}
	if value.MutableHostAccessAllowed {
		return errors.New("Profile content proof cannot allow mutable host access")
	}
	return nil
}

func canonicalManifestBytes(value profileContentManifest) ([]byte, error) {
	if err := validateManifest(value); err != nil {
		return nil, err
	}
	return json.Marshal(value)
}


func normalizedText(value, label string, max int) (string, error) {
	normalized := strings.TrimSpace(value)
	if err := boundedText(normalized, label, max); err != nil {
		return "", err
	}
	return normalized, nil
}

func validateContentSource(value contentSource, label string) error {
	if _, err := normalizedText(value.URI, label+" uri", 512); err != nil {
		return err
	}
	if _, err := normalizedText(value.Revision, label+" revision", 160); err != nil {
		return err
	}
	if _, err := normalizedText(value.License, label+" license", 120); err != nil {
		return err
	}
	if _, err := normalizedText(value.Title, label+" title", 240); err != nil {
		return err
	}
	if value.Jurisdiction != nil {
		if _, err := normalizedText(*value.Jurisdiction, label+" jurisdiction", 80); err != nil {
			return err
		}
	}
	return nil
}

func textDigest(value string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(digest[:])
}

func validateKnowledgeEntry(raw []byte, index int) (string, int, error) {
	var entry knowledgeEntry
	if err := decodeStrict(raw, int(maxEntryTextBytes)+4096, &entry); err != nil {
		return "", 0, fmt.Errorf("Knowledge entry[%d]: %w", index, err)
	}
	if !idPattern.MatchString(entry.ID) {
		return "", 0, fmt.Errorf("Knowledge entry[%d] id is invalid", index)
	}
	if entry.MediaType != "text/plain" &&
		entry.MediaType != "text/markdown" &&
		entry.MediaType != "application/json" {
		return "", 0, fmt.Errorf("Knowledge entry[%d] mediaType is unsupported", index)
	}
	content, err := normalizedText(entry.Content, fmt.Sprintf("Knowledge entry[%d] content", index), maxEntryTextBytes)
	if err != nil {
		return "", 0, err
	}
	if !shaPattern.MatchString(entry.ContentSHA256) || textDigest(content) != entry.ContentSHA256 {
		return "", 0, fmt.Errorf("Knowledge entry[%d] contentSha256 does not match content", index)
	}
	if entry.MediaType == "application/json" && !json.Valid([]byte(content)) {
		return "", 0, fmt.Errorf("Knowledge entry[%d] content is invalid JSON", index)
	}
	if err := validateContentSource(entry.Source, fmt.Sprintf("Knowledge entry[%d] source", index)); err != nil {
		return "", 0, err
	}
	return entry.ID, len([]byte(content)), nil
}

func validateSkillEntry(raw []byte, index int) (string, int, error) {
	var entry skillEntry
	if err := decodeStrict(raw, int(maxEntryTextBytes)+4096, &entry); err != nil {
		return "", 0, fmt.Errorf("Skill entry[%d]: %w", index, err)
	}
	if !idPattern.MatchString(entry.ID) {
		return "", 0, fmt.Errorf("Skill entry[%d] id is invalid", index)
	}
	if _, err := normalizedText(entry.Title, fmt.Sprintf("Skill entry[%d] title", index), 160); err != nil {
		return "", 0, err
	}
	instructions, err := normalizedText(
		entry.Instructions,
		fmt.Sprintf("Skill entry[%d] instructions", index),
		maxEntryTextBytes,
	)
	if err != nil {
		return "", 0, err
	}
	if !shaPattern.MatchString(entry.InstructionsSHA256) ||
		textDigest(instructions) != entry.InstructionsSHA256 {
		return "", 0, fmt.Errorf("Skill entry[%d] instructionsSha256 does not match instructions", index)
	}
	if entry.Authority != "none" {
		return "", 0, fmt.Errorf("Skill entry[%d] authority must remain none", index)
	}
	if len(entry.ToolIDs) != 0 {
		return "", 0, fmt.Errorf("Skill entry[%d] toolIds must remain empty", index)
	}
	if err := validateContentSource(entry.Source, fmt.Sprintf("Skill entry[%d] source", index)); err != nil {
		return "", 0, err
	}
	return entry.ID, len([]byte(instructions)), nil
}

func validateProfileContentPackBytes(payload []byte, expectedKind string) (profileContentHealth, error) {
	if len(payload) == 0 || int64(len(payload)) > maxStructuralPackBytes {
		return profileContentHealth{}, errors.New("Profile content pack size is outside structural bounds")
	}
	var pack profileContentPack
	if err := decodeStrict(payload, int(maxStructuralPackBytes), &pack); err != nil {
		return profileContentHealth{}, fmt.Errorf("Profile content pack: %w", err)
	}
	if pack.Schema != contentFormat {
		return profileContentHealth{}, errors.New("Profile content pack schema is unsupported")
	}
	if pack.Kind != expectedKind {
		return profileContentHealth{}, errors.New("Profile content pack kind does not match signed artifact kind")
	}
	if len(pack.Entries) < 1 || len(pack.Entries) > maxPackEntries {
		return profileContentHealth{}, errors.New("Profile content pack entries are outside bounds")
	}
	ids := make(map[string]struct{}, len(pack.Entries))
	totalText := 0
	for index, raw := range pack.Entries {
		var (
			entryID string
			size    int
			err     error
		)
		switch pack.Kind {
		case "knowledge-pack":
			entryID, size, err = validateKnowledgeEntry(raw, index)
		case "skill-pack":
			entryID, size, err = validateSkillEntry(raw, index)
		default:
			return profileContentHealth{}, errors.New("Profile content pack kind is unsupported")
		}
		if err != nil {
			return profileContentHealth{}, err
		}
		if _, exists := ids[entryID]; exists {
			return profileContentHealth{}, errors.New("Profile content pack entry ids must be unique")
		}
		ids[entryID] = struct{}{}
		totalText += size
		if totalText > maxTotalTextBytes {
			return profileContentHealth{}, errors.New("Profile content pack total text exceeds bounds")
		}
	}
	return profileContentHealth{
		State:                      "healthy",
		Kind:                       pack.Kind,
		EntryCount:                 len(pack.Entries),
		PerEntryHashVerified:       true,
		PerEntryProvenanceVerified: true,
		ExecutablePayloadAllowed:   false,
		Authority:                  "none",
	}, nil
}

func validateProfileContentPackFile(path, expectedKind string) (profileContentHealth, error) {
	payload, err := readRegular(path, maxStructuralPackBytes, false)
	if err != nil {
		return profileContentHealth{}, err
	}
	return validateProfileContentPackBytes(payload, expectedKind)
}

func validateKeyID(value string) error {
	if !keyIDPattern.MatchString(value) {
		return errors.New("key id must match [a-z0-9][a-z0-9._-]{0,63}")
	}
	return nil
}

func ensureRealParent(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	parent := filepath.Dir(absolute)
	info, err := os.Lstat(parent)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("parent must be a real directory")
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", err
	}
	resolvedAbs, err := filepath.Abs(resolved)
	if err != nil {
		return "", err
	}
	if filepath.Clean(resolvedAbs) != filepath.Clean(parent) {
		return "", errors.New("parent path may not traverse symlinks")
	}
	return absolute, nil
}

func readRegular(path string, max int64, secret bool) ([]byte, error) {
	absolute, err := ensureRealParent(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("input must be a regular non-symlink file")
	}
	if info.Size() <= 0 || info.Size() > max {
		return nil, fmt.Errorf("input size outside allowed range: %d", info.Size())
	}
	if secret && runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("private key permissions are too broad: %04o", info.Mode().Perm())
	}
	return os.ReadFile(absolute)
}

func outputPathAvailable(path string) (string, error) {
	absolute, err := ensureRealParent(path)
	if err != nil {
		return "", err
	}
	if _, err := os.Lstat(absolute); err == nil {
		return "", errors.New("output already exists; overwrite is forbidden")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return absolute, nil
}

func writeExclusive(path string, payload []byte, mode os.FileMode) error {
	absolute, err := outputPathAvailable(path)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(absolute, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(absolute)
		}
	}()
	if _, err := file.Write(payload); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(absolute, mode); err != nil {
			return err
		}
	}
	remove = false
	return nil
}

func loadPrivateKey(path string) (ed25519.PrivateKey, error) {
	payload, err := readRegular(path, maxPrivateKey, true)
	if err != nil {
		return nil, fmt.Errorf("private key: %w", err)
	}
	block, rest := pem.Decode(payload)
	if block == nil || block.Type != "PRIVATE KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("private key must contain exactly one PKCS#8 PRIVATE KEY PEM block")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok || len(key) != ed25519.PrivateKeySize {
		return nil, errors.New("private key is not Ed25519")
	}
	return key, nil
}

func loadTrust(path string) (trustAnchor, ed25519.PublicKey, error) {
	payload, err := readRegular(path, maxTrustBytes, false)
	if err != nil {
		return trustAnchor{}, nil, err
	}
	var trust trustAnchor
	if err := decodeStrict(payload, maxTrustBytes, &trust); err != nil {
		return trustAnchor{}, nil, err
	}
	if trust.Schema != trustSchema || trust.Algorithm != algorithm {
		return trustAnchor{}, nil, errors.New("unsupported Profile content trust")
	}
	if err := validateKeyID(trust.KeyID); err != nil {
		return trustAnchor{}, nil, err
	}
	public, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil || len(public) != ed25519.PublicKeySize {
		return trustAnchor{}, nil, errors.New("Profile content trust contains invalid Ed25519 key")
	}
	return trust, ed25519.PublicKey(public), nil
}

func readManifest(path string) (profileContentManifest, []byte, error) {
	payload, err := readRegular(path, maxManifestBytes, false)
	if err != nil {
		return profileContentManifest{}, nil, err
	}
	var manifest profileContentManifest
	if err := decodeStrict(payload, maxManifestBytes, &manifest); err != nil {
		return profileContentManifest{}, nil, err
	}
	canonical, err := canonicalManifestBytes(manifest)
	if err != nil {
		return profileContentManifest{}, nil, err
	}
	return manifest, canonical, nil
}

func readEnvelope(path string) (envelope, []byte, error) {
	payload, err := readRegular(path, maxEnvelopeBytes, false)
	if err != nil {
		return envelope{}, nil, err
	}
	var value envelope
	if err := decodeStrict(payload, maxEnvelopeBytes, &value); err != nil {
		return envelope{}, nil, err
	}
	if value.Schema != envelopeSchema || value.Algorithm != algorithm {
		return envelope{}, nil, errors.New("unsupported Profile content envelope")
	}
	if err := validateKeyID(value.KeyID); err != nil {
		return envelope{}, nil, err
	}
	signature, err := base64.StdEncoding.Strict().DecodeString(value.SignatureBase64)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return envelope{}, nil, errors.New("Profile content envelope signature is invalid")
	}
	return value, signature, nil
}

func verifyContent(manifest profileContentManifest, contentPath string) error {
	info, err := os.Lstat(contentPath)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("Profile content payload must be a regular non-symlink file")
	}
	if info.Size() != manifest.ContentSize || info.Size() <= 0 || info.Size() > maxContentBytes {
		return errors.New("Profile content size mismatch")
	}
	file, err := os.Open(contentPath)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(file, maxContentBytes+1))
	if err != nil {
		return err
	}
	if n != info.Size() {
		return errors.New("Profile content size changed during verification")
	}
	if hex.EncodeToString(hash.Sum(nil)) != manifest.ContentHash {
		return errors.New("Profile content hash mismatch")
	}
	return nil
}

func generateKey(privatePath, trustPath, keyID string) error {
	if err := validateKeyID(keyID); err != nil {
		return err
	}
	if privatePath == trustPath {
		return errors.New("private key and trust outputs must differ")
	}
	privateAbsolute, err := outputPathAvailable(privatePath)
	if err != nil {
		return err
	}
	if _, err := outputPathAvailable(trustPath); err != nil {
		return err
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		return err
	}
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	trust := trustAnchor{
		Schema:       trustSchema,
		Algorithm:    algorithm,
		KeyID:        keyID,
		PublicKeyB64: base64.StdEncoding.EncodeToString(public),
	}
	trustBytes, err := json.MarshalIndent(trust, "", "  ")
	if err != nil {
		return err
	}
	trustBytes = append(trustBytes, '\n')
	if err := writeExclusive(privatePath, privatePEM, 0o600); err != nil {
		return err
	}
	if err := writeExclusive(trustPath, trustBytes, 0o644); err != nil {
		_ = os.Remove(privateAbsolute)
		return err
	}
	return nil
}

func deriveTrust(privatePath, outputPath, keyID string) (string, error) {
	if err := validateKeyID(keyID); err != nil {
		return "", err
	}
	private, err := loadPrivateKey(privatePath)
	if err != nil {
		return "", err
	}
	public := private.Public().(ed25519.PublicKey)
	trust := trustAnchor{
		Schema:       trustSchema,
		Algorithm:    algorithm,
		KeyID:        keyID,
		PublicKeyB64: base64.StdEncoding.EncodeToString(public),
	}
	payload, err := json.MarshalIndent(trust, "", "  ")
	if err != nil {
		return "", err
	}
	payload = append(payload, '\n')
	if err := writeExclusive(outputPath, payload, 0o644); err != nil {
		return "", err
	}
	digest := sha256.Sum256(public)
	return hex.EncodeToString(digest[:]), nil
}

func signManifest(manifestPath, privatePath, trustPath, outputPath, keyID string) error {
	_, canonical, err := readManifest(manifestPath)
	if err != nil {
		return err
	}
	private, err := loadPrivateKey(privatePath)
	if err != nil {
		return err
	}
	trust, public, err := loadTrust(trustPath)
	if err != nil {
		return err
	}
	if trust.KeyID != keyID {
		return errors.New("key id does not match Profile content trust")
	}
	derived := private.Public().(ed25519.PublicKey)
	if !bytes.Equal(derived, public) {
		return errors.New("private key does not match Profile content trust")
	}
	value := envelope{
		Schema:          envelopeSchema,
		Algorithm:       algorithm,
		KeyID:           keyID,
		SignatureBase64: base64.StdEncoding.EncodeToString(ed25519.Sign(private, canonical)),
	}
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	return writeExclusive(outputPath, payload, 0o644)
}

func verify(manifestPath, envelopePath, trustPath, contentPath string) (profileContentManifest, error) {
	manifest, canonical, err := readManifest(manifestPath)
	if err != nil {
		return profileContentManifest{}, err
	}
	envelopeValue, signature, err := readEnvelope(envelopePath)
	if err != nil {
		return profileContentManifest{}, err
	}
	trust, public, err := loadTrust(trustPath)
	if err != nil {
		return profileContentManifest{}, err
	}
	if envelopeValue.KeyID != trust.KeyID {
		return profileContentManifest{}, errors.New("Profile content envelope key does not match trust")
	}
	if !ed25519.Verify(public, canonical, signature) {
		return profileContentManifest{}, errors.New("Profile content manifest signature verification failed")
	}
	if err := verifyContent(manifest, contentPath); err != nil {
		return profileContentManifest{}, err
	}
	return manifest, nil
}


func ensureSecureDirectory(path string, mode os.FileMode) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(absolute, mode); err != nil {
		return "", err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("Profile content stage path must be a real directory")
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	resolvedAbs, err := filepath.Abs(resolved)
	if err != nil {
		return "", err
	}
	if filepath.Clean(resolvedAbs) != filepath.Clean(absolute) {
		return "", errors.New("Profile content stage path may not traverse symlinks")
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(absolute, mode); err != nil {
			return "", err
		}
	}
	return absolute, nil
}

func writeFileSynced(path string, payload []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(payload); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	remove = false
	return nil
}

func copyContentSynced(sourcePath, targetPath string, manifest profileContentManifest) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(targetPath)
		}
	}()

	hash := sha256.New()
	writer := io.MultiWriter(target, hash)
	written, err := io.Copy(writer, io.LimitReader(source, maxContentBytes+1))
	if err != nil {
		_ = target.Close()
		return err
	}
	if written != manifest.ContentSize {
		_ = target.Close()
		return errors.New("Profile content size mismatch during staging")
	}
	if hex.EncodeToString(hash.Sum(nil)) != manifest.ContentHash {
		_ = target.Close()
		return errors.New("Profile content hash mismatch during staging")
	}
	if err := target.Sync(); err != nil {
		_ = target.Close()
		return err
	}
	if err := target.Close(); err != nil {
		return err
	}
	remove = false
	return nil
}

func makeStageReadOnly(root string) error {
	directories := []string{}
	if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("Profile content stage contains a symlink")
		}
		if entry.IsDir() {
			directories = append(directories, path)
			return nil
		}
		if !info.Mode().IsRegular() {
			return errors.New("Profile content stage contains non-regular file")
		}
		if runtime.GOOS != "windows" {
			return os.Chmod(path, 0o400)
		}
		return nil
	}); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		for i := len(directories) - 1; i >= 0; i-- {
			if err := os.Chmod(directories[i], 0o500); err != nil {
				return err
			}
		}
	}
	return nil
}

func stagedFileSetIsCanonical(slot string) error {
	expected := map[string]struct{}{
		stageManifestName: {},
		stageEnvelopeName: {},
		stageContentName:  {},
	}
	actual := map[string]struct{}{}
	if err := filepath.WalkDir(slot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == slot {
			return nil
		}
		relative, err := filepath.Rel(slot, path)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return errors.New("Profile content stage contains unexpected directory")
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("Profile content stage contains unsafe entry")
		}
		if runtime.GOOS != "windows" && info.Mode().Perm()&0o222 != 0 {
			return errors.New("Profile content stage file is writable")
		}
		actual[relative] = struct{}{}
		return nil
	}); err != nil {
		return err
	}
	if len(actual) != len(expected) {
		return errors.New("Profile content stage file set is not canonical")
	}
	for name := range expected {
		if _, ok := actual[name]; !ok {
			return fmt.Errorf("Profile content stage missing %s", name)
		}
	}
	return nil
}

func verifyStagedSlot(slot, trustPath string) (profileContentManifest, error) {
	absolute, err := filepath.Abs(slot)
	if err != nil {
		return profileContentManifest{}, err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return profileContentManifest{}, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return profileContentManifest{}, errors.New("Profile content slot is not a real directory")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o222 != 0 {
		return profileContentManifest{}, errors.New("Profile content slot directory is writable")
	}
	if err := stagedFileSetIsCanonical(absolute); err != nil {
		return profileContentManifest{}, err
	}
	return verify(
		filepath.Join(absolute, stageManifestName),
		filepath.Join(absolute, stageEnvelopeName),
		trustPath,
		filepath.Join(absolute, stageContentName),
	)
}

func inspectStagedSlotHealth(slot, trustPath string) (profileContentHealth, error) {
	manifest, err := verifyStagedSlot(slot, trustPath)
	if err != nil {
		return profileContentHealth{}, err
	}
	return validateProfileContentPackFile(filepath.Join(slot, stageContentName), manifest.Kind)
}

func stagedSlotEvidence(slot, trustPath string) (profileContentStageEvidence, error) {
	manifest, err := verifyStagedSlot(slot, trustPath)
	if err != nil {
		return profileContentStageEvidence{}, err
	}
	health, err := validateProfileContentPackFile(filepath.Join(slot, stageContentName), manifest.Kind)
	if err != nil {
		return profileContentStageEvidence{}, err
	}
	envelopeValue, _, err := readEnvelope(filepath.Join(slot, stageEnvelopeName))
	if err != nil {
		return profileContentStageEvidence{}, err
	}
	canonical, err := canonicalManifestBytes(manifest)
	if err != nil {
		return profileContentStageEvidence{}, err
	}
	manifestDigest := sha256.Sum256(canonical)
	return profileContentStageEvidence{
		Schema: "ordax.profile-content-stage-evidence/1",
		Artifact: stageEvidenceArtifact{
			ID:        manifest.ID,
			Kind:      manifest.Kind,
			Version:   manifest.Version,
			SHA256:    manifest.ContentHash,
			SizeBytes: manifest.ContentSize,
		},
		Verification: stageEvidenceVerification{
			SignatureAlgorithm: algorithm,
			KeyID:              envelopeValue.KeyID,
			ManifestSHA256:     hex.EncodeToString(manifestDigest[:]),
		},
		Health: stageEvidenceHealth{
			Schema:                     "ordax.profile-content-health/1",
			State:                      health.State,
			EntryCount:                 health.EntryCount,
			PerEntryHashVerified:       health.PerEntryHashVerified,
			PerEntryProvenanceVerified: health.PerEntryProvenanceVerified,
			ExecutablePayloadAllowed:   health.ExecutablePayloadAllowed,
			Authority:                  health.Authority,
		},
	}, nil
}

func syncDirectory(path string) {
	directory, err := os.Open(path)
	if err != nil {
		return
	}
	defer directory.Close()
	_ = directory.Sync()
}

func stageContent(manifestPath, envelopePath, trustPath, contentPath, root string) (profileContentManifest, string, bool, error) {
	manifest, canonical, err := readManifest(manifestPath)
	if err != nil {
		return profileContentManifest{}, "", false, err
	}
	if _, err := verify(manifestPath, envelopePath, trustPath, contentPath); err != nil {
		return profileContentManifest{}, "", false, err
	}
	if _, err := validateProfileContentPackFile(contentPath, manifest.Kind); err != nil {
		return profileContentManifest{}, "", false, fmt.Errorf("Profile content structural health failed: %w", err)
	}
	envelopeBytes, err := readRegular(envelopePath, maxEnvelopeBytes, false)
	if err != nil {
		return profileContentManifest{}, "", false, err
	}

	root, err = ensureSecureDirectory(root, 0o700)
	if err != nil {
		return profileContentManifest{}, "", false, err
	}
	parent := filepath.Join(
		root,
		manifest.Kind,
		manifest.ID,
		"versions",
		manifest.Version,
	)
	parent, err = ensureSecureDirectory(parent, 0o700)
	if err != nil {
		return profileContentManifest{}, "", false, err
	}
	slot := filepath.Join(parent, manifest.ContentHash)
	if _, err := os.Lstat(slot); err == nil {
		verified, verifyErr := verifyStagedSlot(slot, trustPath)
		if verifyErr != nil {
			return profileContentManifest{}, "", false, fmt.Errorf("existing Profile content slot failed verification: %w", verifyErr)
		}
		if verified.ID != manifest.ID || verified.Version != manifest.Version || verified.ContentHash != manifest.ContentHash {
			return profileContentManifest{}, "", false, errors.New("existing Profile content slot identity mismatch")
		}
		return verified, slot, false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return profileContentManifest{}, "", false, err
	}

	temp, err := os.MkdirTemp(parent, ".stage-")
	if err != nil {
		return profileContentManifest{}, "", false, err
	}
	removeTemp := true
	defer func() {
		if removeTemp {
			_ = os.Chmod(temp, 0o700)
			_ = os.RemoveAll(temp)
		}
	}()

	if err := writeFileSynced(filepath.Join(temp, stageManifestName), canonical, 0o600); err != nil {
		return profileContentManifest{}, "", false, err
	}
	if err := writeFileSynced(filepath.Join(temp, stageEnvelopeName), envelopeBytes, 0o600); err != nil {
		return profileContentManifest{}, "", false, err
	}
	if err := copyContentSynced(contentPath, filepath.Join(temp, stageContentName), manifest); err != nil {
		return profileContentManifest{}, "", false, err
	}
	if err := makeStageReadOnly(temp); err != nil {
		return profileContentManifest{}, "", false, err
	}
	if _, err := verifyStagedSlot(temp, trustPath); err != nil {
		return profileContentManifest{}, "", false, fmt.Errorf("staged Profile content failed verification: %w", err)
	}
	if err := os.Rename(temp, slot); err != nil {
		return profileContentManifest{}, "", false, err
	}
	removeTemp = false
	syncDirectory(parent)

	verified, err := verifyStagedSlot(slot, trustPath)
	if err != nil {
		return profileContentManifest{}, "", false, fmt.Errorf("installed Profile content slot failed post-rename verification: %w", err)
	}
	if _, err := inspectStagedSlotHealth(slot, trustPath); err != nil {
		return profileContentManifest{}, "", false, fmt.Errorf("installed Profile content structural health failed: %w", err)
	}
	return verified, slot, true, nil
}

func run() int {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "PROFILE_CONTENT_ERROR=command required")
		return 2
	}
	switch os.Args[1] {
	case "generate-key":
		fs := flag.NewFlagSet("generate-key", flag.ContinueOnError)
		privatePath := fs.String("private-key", "", "")
		trustPath := fs.String("trust", "", "")
		keyID := fs.String("key-id", "", "")
		if err := fs.Parse(os.Args[2:]); err != nil {
			return 2
		}
		if err := generateKey(*privatePath, *trustPath, *keyID); err != nil {
			fmt.Fprintf(os.Stderr, "PROFILE_CONTENT_ERROR=%v\n", err)
			return 1
		}
		fmt.Println("PROFILE_CONTENT_KEY_GENERATION=PASS")
		return 0
	case "derive-trust":
		fs := flag.NewFlagSet("derive-trust", flag.ContinueOnError)
		privatePath := fs.String("private-key", "", "")
		output := fs.String("out", "", "")
		keyID := fs.String("key-id", "", "")
		if err := fs.Parse(os.Args[2:]); err != nil {
			return 2
		}
		digest, err := deriveTrust(*privatePath, *output, *keyID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "PROFILE_CONTENT_ERROR=%v\n", err)
			return 1
		}
		fmt.Println("PROFILE_CONTENT_TRUST_DERIVATION=PASS")
		fmt.Printf("PROFILE_CONTENT_PUBLIC_KEY_SHA256=%s\n", digest)
		fmt.Println("PROFILE_CONTENT_CANONICAL_ANCHOR_PINNED=NO")
		fmt.Println("PROFILE_CONTENT_PUBLICATION_ALLOWED=NO")
		fmt.Println("PROFILE_CONTENT_INSTALL_ALLOWED=NO")
		fmt.Println("PROFILE_CONTENT_ACTIVATION_ALLOWED=NO")
		return 0
	case "sign":
		fs := flag.NewFlagSet("sign", flag.ContinueOnError)
		manifest := fs.String("manifest", "", "")
		privatePath := fs.String("private-key", "", "")
		trustPath := fs.String("trust", "", "")
		keyID := fs.String("key-id", "", "")
		output := fs.String("out", "", "")
		if err := fs.Parse(os.Args[2:]); err != nil {
			return 2
		}
		if err := signManifest(*manifest, *privatePath, *trustPath, *output, *keyID); err != nil {
			fmt.Fprintf(os.Stderr, "PROFILE_CONTENT_ERROR=%v\n", err)
			return 1
		}
		fmt.Println("PROFILE_CONTENT_SIGN=PASS")
		return 0
	case "verify":
		fs := flag.NewFlagSet("verify", flag.ContinueOnError)
		manifestPath := fs.String("manifest", "", "")
		envelopePath := fs.String("envelope", "", "")
		trustPath := fs.String("trust", "", "")
		contentPath := fs.String("content", "", "")
		if err := fs.Parse(os.Args[2:]); err != nil {
			return 2
		}
		manifest, err := verify(*manifestPath, *envelopePath, *trustPath, *contentPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "PROFILE_CONTENT_ERROR=%v\n", err)
			return 1
		}
		fmt.Println("PROFILE_CONTENT_VERIFY=PASS")
		fmt.Printf("PROFILE_CONTENT_ID=%s\n", manifest.ID)
		fmt.Printf("PROFILE_CONTENT_KIND=%s\n", manifest.Kind)
		fmt.Printf("PROFILE_CONTENT_VERSION=%s\n", manifest.Version)
		fmt.Println("PROFILE_CONTENT_ACTIVATION_ALLOWED=NO")
		return 0
	case "stage":
		fs := flag.NewFlagSet("stage", flag.ContinueOnError)
		manifestPath := fs.String("manifest", "", "")
		envelopePath := fs.String("envelope", "", "")
		trustPath := fs.String("trust", "", "")
		contentPath := fs.String("content", "", "")
		root := fs.String("root", defaultStageRoot, "")
		if err := fs.Parse(os.Args[2:]); err != nil {
			return 2
		}
		manifest, slot, changed, err := stageContent(
			*manifestPath,
			*envelopePath,
			*trustPath,
			*contentPath,
			*root,
		)
		if err != nil {
			fmt.Fprintf(os.Stderr, "PROFILE_CONTENT_ERROR=%v\n", err)
			return 1
		}
		fmt.Println("PROFILE_CONTENT_STAGE=PASS")
		fmt.Printf("PROFILE_CONTENT_ID=%s\n", manifest.ID)
		fmt.Printf("PROFILE_CONTENT_VERSION=%s\n", manifest.Version)
		fmt.Printf("PROFILE_CONTENT_SLOT=%s\n", slot)
		if changed {
			fmt.Println("PROFILE_CONTENT_SLOT_CHANGED=YES")
		} else {
			fmt.Println("PROFILE_CONTENT_SLOT_CHANGED=NO")
		}
		fmt.Println("PROFILE_CONTENT_ACTIVATION_ALLOWED=NO")
		return 0
	case "health":
		fs := flag.NewFlagSet("health", flag.ContinueOnError)
		slot := fs.String("slot", "", "")
		trustPath := fs.String("trust", "", "")
		if err := fs.Parse(os.Args[2:]); err != nil {
			return 2
		}
		health, err := inspectStagedSlotHealth(*slot, *trustPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "PROFILE_CONTENT_ERROR=%v\n", err)
			return 1
		}
		fmt.Println("PROFILE_CONTENT_HEALTH=PASS")
		fmt.Printf("PROFILE_CONTENT_HEALTH_STATE=%s\n", health.State)
		fmt.Printf("PROFILE_CONTENT_KIND=%s\n", health.Kind)
		fmt.Printf("PROFILE_CONTENT_ENTRY_COUNT=%d\n", health.EntryCount)
		fmt.Println("PROFILE_CONTENT_PER_ENTRY_HASH_VERIFIED=YES")
		fmt.Println("PROFILE_CONTENT_PER_ENTRY_PROVENANCE_VERIFIED=YES")
		fmt.Println("PROFILE_CONTENT_EXECUTABLE_PAYLOAD_ALLOWED=NO")
		fmt.Println("PROFILE_CONTENT_AUTHORITY=NONE")
		fmt.Println("PROFILE_CONTENT_ACTIVATION_ALLOWED=NO")
		return 0
	case "evidence":
		fs := flag.NewFlagSet("evidence", flag.ContinueOnError)
		slot := fs.String("slot", "", "")
		trustPath := fs.String("trust", "", "")
		if err := fs.Parse(os.Args[2:]); err != nil {
			return 2
		}
		evidence, err := stagedSlotEvidence(*slot, *trustPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "PROFILE_CONTENT_ERROR=%v\n", err)
			return 1
		}
		payload, err := json.Marshal(evidence)
		if err != nil {
			fmt.Fprintf(os.Stderr, "PROFILE_CONTENT_ERROR=%v\n", err)
			return 1
		}
		fmt.Println(string(payload))
		return 0
	default:
		fmt.Fprintf(os.Stderr, "PROFILE_CONTENT_ERROR=unknown command %q\n", os.Args[1])
		return 2
	}
}

func main() {
	os.Exit(run())
}
