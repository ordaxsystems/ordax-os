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
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
)

const (
	envelopeSchema   = "prototype-ordax.release-envelope/1"
	manifestSchema   = "prototype-ordax.release-manifest/1"
	manifestSchemaV2 = "prototype-ordax.release-manifest/2"
	manifestSchemaV3 = "prototype-ordax.release-manifest/3"
	manifestSchemaV4 = "prototype-ordax.release-manifest/4"
	trustSchema      = "prototype-ordax.release-trust/1"
	defaultRepo    = "ordaxsystems/ordax-os"
	maxManifest    = 512 << 10
	maxEnvelope    = 2 << 20
	maxPrivateKey  = 16 << 10
	maxTrust       = 16 << 10
	maxArtifact    = int64(16 << 30)
)

var (
	keyIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	revisionPattern = regexp.MustCompile(`^[0-9a-f]{7,64}$`)
	licensePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$`)
	recipePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$`)
)

type TrustAnchor struct {
	Schema       string `json:"$schema"`
	KeyID        string `json:"key_id"`
	PublicKeyB64 string `json:"public_key_base64"`
}

type Envelope struct {
	Schema    string `json:"$schema"`
	Payload   []byte `json:"payload"`
	Signature []byte `json:"signature"`
	KeyID     string `json:"key_id"`
}

type Manifest struct {
	Schema              string     `json:"$schema"`
	SourceRepository    string     `json:"source_repository"`
	SourceCommit        string     `json:"source_commit"`
	ReleaseID           string     `json:"release_id"`
	CreatedFromCIRecipe string     `json:"created_from_ci_recipe"`
	ProductMode         string     `json:"product_mode,omitempty"`
	StorageProfile      string     `json:"storage_profile,omitempty"`
	RuntimeFormat       string          `json:"runtime_format,omitempty"`
	Artifacts           []Artifact      `json:"artifacts"`
	LocalAI             *LocalAIBinding `json:"local_ai,omitempty"`
}

type Artifact struct {
	Name   string `json:"name"`
	Role   string `json:"role"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type LocalAIBinding struct {
	Contract              string `json:"contract"`
	SourceLockSchema      string `json:"source_lock_schema"`
	SourceLockSHA256      string `json:"source_lock_sha256"`
	EngineID              string `json:"engine_id"`
	EngineRepository      string `json:"engine_repository"`
	EngineSourceCommit    string `json:"engine_source_commit"`
	EngineLicense         string `json:"engine_license"`
	ModelID               string `json:"model_id"`
	ModelRepository       string `json:"model_repository"`
	ModelFilename         string `json:"model_filename"`
	ModelUpstreamRevision string `json:"model_upstream_revision"`
	ModelSHA256           string `json:"model_sha256"`
	ModelSize             int64  `json:"model_size"`
	ModelLicense          string `json:"model_license"`
}

func validateKeyID(keyID string) error {
	if !keyIDPattern.MatchString(keyID) {
		return errors.New("key id must match [a-z0-9][a-z0-9._-]{0,63}")
	}
	return nil
}

func ensureRealParent(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve path: %w", err)
	}
	parent := filepath.Dir(absolute)
	info, err := os.Lstat(parent)
	if err != nil {
		return "", fmt.Errorf("stat parent directory: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("parent must be a real directory, not a symlink")
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", fmt.Errorf("resolve parent directory: %w", err)
	}
	resolvedAbs, err := filepath.Abs(resolved)
	if err != nil {
		return "", fmt.Errorf("resolve evaluated parent: %w", err)
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
	data, err := os.ReadFile(absolute)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func ensureOutputAvailable(path string) (string, error) {
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

func writeExclusive(path string, data []byte, mode os.FileMode) error {
	absolute, err := ensureOutputAvailable(path)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(absolute, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(absolute)
		}
	}()
	if _, err := file.Write(data); err != nil {
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

func marshalJSON(value any) ([]byte, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
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

func loadPrivateKey(path string) (ed25519.PrivateKey, error) {
	data, err := readRegular(path, maxPrivateKey, true)
	if err != nil {
		return nil, fmt.Errorf("private key: %w", err)
	}
	block, rest := pem.Decode(data)
	if block == nil || block.Type != "PRIVATE KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("private key must contain exactly one PKCS#8 PRIVATE KEY PEM block")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse PKCS#8 private key: %w", err)
	}
	privateKey, ok := parsed.(ed25519.PrivateKey)
	if !ok || len(privateKey) != ed25519.PrivateKeySize {
		return nil, errors.New("private key is not Ed25519")
	}
	return privateKey, nil
}

func loadTrustAnchor(path string) (TrustAnchor, ed25519.PublicKey, error) {
	data, err := readRegular(path, maxTrust, false)
	if err != nil {
		return TrustAnchor{}, nil, fmt.Errorf("trust anchor: %w", err)
	}
	var trust TrustAnchor
	if err := decodeStrict(data, maxTrust, &trust); err != nil {
		return TrustAnchor{}, nil, fmt.Errorf("trust anchor: %w", err)
	}
	if trust.Schema != trustSchema {
		return TrustAnchor{}, nil, errors.New("unsupported trust anchor schema")
	}
	if err := validateKeyID(trust.KeyID); err != nil {
		return TrustAnchor{}, nil, fmt.Errorf("trust anchor: %w", err)
	}
	publicKey, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return TrustAnchor{}, nil, errors.New("trust anchor contains invalid Ed25519 public key")
	}
	return trust, ed25519.PublicKey(publicKey), nil
}

func trustForPrivate(privateKey ed25519.PrivateKey, keyID string) (TrustAnchor, error) {
	if err := validateKeyID(keyID); err != nil {
		return TrustAnchor{}, err
	}
	publicKey, ok := privateKey.Public().(ed25519.PublicKey)
	if !ok || len(publicKey) != ed25519.PublicKeySize {
		return TrustAnchor{}, errors.New("cannot derive Ed25519 public key")
	}
	return TrustAnchor{
		Schema:       trustSchema,
		KeyID:        keyID,
		PublicKeyB64: base64.StdEncoding.EncodeToString(publicKey),
	}, nil
}

func validateSigningIdentity(privateKey ed25519.PrivateKey, trust TrustAnchor, trustedPublic ed25519.PublicKey, keyID string) error {
	if trust.KeyID != keyID {
		return fmt.Errorf("signing key id %q does not match trust anchor key id %q", keyID, trust.KeyID)
	}
	publicKey, ok := privateKey.Public().(ed25519.PublicKey)
	if !ok || len(publicKey) != ed25519.PublicKeySize {
		return errors.New("cannot derive public key from signing private key")
	}
	if !bytes.Equal(publicKey, trustedPublic) {
		return errors.New("signing private key does not match supplied trust anchor")
	}
	return nil
}

func validateHTTPSURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("URL must be absolute HTTPS without credentials or fragment")
	}
	return nil
}

func strictManifest(data []byte, expectedRepository string) (Manifest, error) {
	var manifest Manifest
	if err := decodeStrict(data, maxManifest, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("decode manifest: %w", err)
	}
	if manifest.SourceRepository != expectedRepository {
		return Manifest{}, fmt.Errorf("unexpected source repository: %q", manifest.SourceRepository)
	}
	if !commitPattern.MatchString(manifest.SourceCommit) {
		return Manifest{}, errors.New("source_commit must be lowercase 40-hex")
	}
	if manifest.ReleaseID != manifest.SourceCommit {
		return Manifest{}, errors.New("release_id must equal source_commit")
	}
	if !recipePattern.MatchString(manifest.CreatedFromCIRecipe) {
		return Manifest{}, errors.New("invalid created_from_ci_recipe")
	}

	switch manifest.Schema {
	case manifestSchema:
		if len(manifest.Artifacts) != 1 {
			return Manifest{}, errors.New("release-manifest/1 requires exactly one system.tar artifact")
		}
		if manifest.ProductMode != "" || manifest.StorageProfile != "" || manifest.RuntimeFormat != "" || manifest.LocalAI != nil {
			return Manifest{}, errors.New("release-manifest/1 forbids portable-v2 and local AI identity fields")
		}
		if manifest.Artifacts[0].Name != "system.tar" || manifest.Artifacts[0].Role != "system" {
			return Manifest{}, errors.New("release-manifest/1 artifact must be system.tar with role=system")
		}
	case manifestSchemaV2:
		if len(manifest.Artifacts) != 1 {
			return Manifest{}, errors.New("release-manifest/2 requires exactly one system.erofs artifact")
		}
		if manifest.LocalAI != nil {
			return Manifest{}, errors.New("release-manifest/2 forbids local_ai binding")
		}
		if manifest.ProductMode != "usb" || manifest.StorageProfile != "portable-usb-v2" || manifest.RuntimeFormat != "erofs" {
			return Manifest{}, errors.New("release-manifest/2 requires usb portable-usb-v2 erofs identity")
		}
		if manifest.Artifacts[0].Name != "system.erofs" || manifest.Artifacts[0].Role != "system-image" {
			return Manifest{}, errors.New("release-manifest/2 artifact must be system.erofs with role=system-image")
		}
	case manifestSchemaV3:
		if len(manifest.Artifacts) != 2 {
			return Manifest{}, errors.New("release-manifest/3 requires exactly system.erofs and native-surface-runtime.erofs")
		}
		if manifest.LocalAI != nil {
			return Manifest{}, errors.New("release-manifest/3 forbids local_ai binding")
		}
		if manifest.ProductMode != "usb" || manifest.StorageProfile != "portable-usb-v2" || manifest.RuntimeFormat != "erofs" {
			return Manifest{}, errors.New("release-manifest/3 requires usb portable-usb-v2 erofs identity")
		}
		if manifest.Artifacts[0].Name != "system.erofs" || manifest.Artifacts[0].Role != "system-image" {
			return Manifest{}, errors.New("release-manifest/3 first artifact must be system.erofs with role=system-image")
		}
		if manifest.Artifacts[1].Name != "native-surface-runtime.erofs" || manifest.Artifacts[1].Role != "surface-runtime" {
			return Manifest{}, errors.New("release-manifest/3 second artifact must be native-surface-runtime.erofs with role=surface-runtime")
		}
	case manifestSchemaV4:
		if len(manifest.Artifacts) != 3 {
			return Manifest{}, errors.New("release-manifest/4 requires system, Surface runtime and local AI runtime artifacts")
		}
		if manifest.ProductMode != "usb" || manifest.StorageProfile != "portable-usb-v2" || manifest.RuntimeFormat != "erofs" {
			return Manifest{}, errors.New("release-manifest/4 requires usb portable-usb-v2 erofs identity")
		}
		if manifest.Artifacts[0].Name != "system.erofs" || manifest.Artifacts[0].Role != "system-image" {
			return Manifest{}, errors.New("release-manifest/4 first artifact must be system.erofs with role=system-image")
		}
		if manifest.Artifacts[1].Name != "native-surface-runtime.erofs" || manifest.Artifacts[1].Role != "surface-runtime" {
			return Manifest{}, errors.New("release-manifest/4 second artifact must be native-surface-runtime.erofs with role=surface-runtime")
		}
		if manifest.Artifacts[2].Name != "local-ai-runtime.erofs" || manifest.Artifacts[2].Role != "local-ai-runtime" {
			return Manifest{}, errors.New("release-manifest/4 third artifact must be local-ai-runtime.erofs with role=local-ai-runtime")
		}
		if manifest.LocalAI == nil {
			return Manifest{}, errors.New("release-manifest/4 requires local_ai source/model binding")
		}
		binding := manifest.LocalAI
		if binding.Contract != "ordax.local-ai/1" ||
			binding.SourceLockSchema != "prototype-ordax.local-ai-source-lock/1" ||
			!shaPattern.MatchString(binding.SourceLockSHA256) ||
			binding.EngineID == "" || len(binding.EngineID) > 128 ||
			binding.EngineRepository == "" || len(binding.EngineRepository) > 512 ||
			!commitPattern.MatchString(binding.EngineSourceCommit) ||
			!licensePattern.MatchString(binding.EngineLicense) ||
			binding.ModelID == "" || len(binding.ModelID) > 128 ||
			binding.ModelRepository == "" || len(binding.ModelRepository) > 512 ||
			binding.ModelFilename == "" || filepath.Base(binding.ModelFilename) != binding.ModelFilename ||
			!revisionPattern.MatchString(binding.ModelUpstreamRevision) ||
			!shaPattern.MatchString(binding.ModelSHA256) ||
			binding.ModelSize <= 0 || binding.ModelSize > maxArtifact ||
			!licensePattern.MatchString(binding.ModelLicense) {
			return Manifest{}, errors.New("release-manifest/4 contains invalid local_ai source/model binding")
		}
	default:
		return Manifest{}, errors.New("unsupported release manifest schema")
	}

	for _, artifact := range manifest.Artifacts {
		if !shaPattern.MatchString(artifact.SHA256) {
			return Manifest{}, fmt.Errorf("invalid artifact SHA-256 for %s", artifact.Name)
		}
		if artifact.Size <= 0 || artifact.Size > maxArtifact {
			return Manifest{}, fmt.Errorf("%s size outside allowed range", artifact.Name)
		}
		if err := validateHTTPSURL(artifact.URL); err != nil {
			return Manifest{}, fmt.Errorf("%s: %w", artifact.Name, err)
		}
	}
	return manifest, nil
}

func generateKeyFiles(privatePath, trustPath, keyID string) (string, error) {
	if err := validateKeyID(keyID); err != nil {
		return "", err
	}
	if privatePath == trustPath {
		return "", errors.New("private key and trust outputs must be different paths")
	}
	privateAbsolute, err := ensureOutputAvailable(privatePath)
	if err != nil {
		return "", fmt.Errorf("private key output: %w", err)
	}
	if _, err := ensureOutputAvailable(trustPath); err != nil {
		return "", fmt.Errorf("trust output: %w", err)
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", err
	}
	der, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return "", err
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	trust := TrustAnchor{Schema: trustSchema, KeyID: keyID, PublicKeyB64: base64.StdEncoding.EncodeToString(publicKey)}
	trustBytes, err := marshalJSON(trust)
	if err != nil {
		return "", err
	}
	if err := writeExclusive(privatePath, pemBytes, 0o600); err != nil {
		return "", fmt.Errorf("write private key: %w", err)
	}
	if err := writeExclusive(trustPath, trustBytes, 0o644); err != nil {
		_ = os.Remove(privateAbsolute)
		return "", fmt.Errorf("write trust anchor: %w", err)
	}
	digest := sha256.Sum256(publicKey)
	return hex.EncodeToString(digest[:]), nil
}

func deriveTrust(privatePath, outputPath, keyID string) (string, error) {
	privateKey, err := loadPrivateKey(privatePath)
	if err != nil {
		return "", err
	}
	trust, err := trustForPrivate(privateKey, keyID)
	if err != nil {
		return "", err
	}
	data, err := marshalJSON(trust)
	if err != nil {
		return "", err
	}
	if err := writeExclusive(outputPath, data, 0o644); err != nil {
		return "", err
	}
	publicKey := privateKey.Public().(ed25519.PublicKey)
	digest := sha256.Sum256(publicKey)
	return hex.EncodeToString(digest[:]), nil
}

func signManifest(manifestPath, privatePath, trustPath, outputPath, keyID, repository string) (string, error) {
	if err := validateKeyID(keyID); err != nil {
		return "", err
	}
	manifestBytes, err := readRegular(manifestPath, maxManifest, false)
	if err != nil {
		return "", fmt.Errorf("manifest: %w", err)
	}
	manifest, err := strictManifest(manifestBytes, repository)
	if err != nil {
		return "", err
	}
	privateKey, err := loadPrivateKey(privatePath)
	if err != nil {
		return "", err
	}
	trust, trustedPublic, err := loadTrustAnchor(trustPath)
	if err != nil {
		return "", err
	}
	if err := validateSigningIdentity(privateKey, trust, trustedPublic, keyID); err != nil {
		return "", err
	}
	signature := ed25519.Sign(privateKey, manifestBytes)
	envelope := Envelope{Schema: envelopeSchema, Payload: manifestBytes, Signature: signature, KeyID: keyID}
	envelopeBytes, err := marshalJSON(envelope)
	if err != nil {
		return "", err
	}
	if err := writeExclusive(outputPath, envelopeBytes, 0o644); err != nil {
		return "", err
	}
	return manifest.SourceCommit, nil
}

func verifyEnvelope(envelopePath, trustPath, repository string) (Manifest, error) {
	envelopeBytes, err := readRegular(envelopePath, maxEnvelope, false)
	if err != nil {
		return Manifest{}, fmt.Errorf("envelope: %w", err)
	}
	var envelope Envelope
	if err := decodeStrict(envelopeBytes, maxEnvelope, &envelope); err != nil {
		return Manifest{}, fmt.Errorf("envelope: %w", err)
	}
	if envelope.Schema != envelopeSchema {
		return Manifest{}, errors.New("unsupported release envelope schema")
	}
	if err := validateKeyID(envelope.KeyID); err != nil {
		return Manifest{}, fmt.Errorf("envelope: %w", err)
	}
	trust, trustedPublic, err := loadTrustAnchor(trustPath)
	if err != nil {
		return Manifest{}, err
	}
	if envelope.KeyID != trust.KeyID {
		return Manifest{}, errors.New("release envelope key id does not match trust anchor")
	}
	if len(envelope.Signature) != ed25519.SignatureSize {
		return Manifest{}, errors.New("release envelope signature length is invalid")
	}
	if !ed25519.Verify(trustedPublic, envelope.Payload, envelope.Signature) {
		return Manifest{}, errors.New("release envelope signature verification failed")
	}
	manifest, err := strictManifest(envelope.Payload, repository)
	if err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func verifyCommand(args []string) error {
	flags := flag.NewFlagSet("verify-envelope", flag.ContinueOnError)
	envelopePath := flags.String("envelope", "", "signed release envelope JSON path")
	trustPath := flags.String("trust", "", "public trust-anchor JSON path")
	repository := flags.String("repository", defaultRepo, "expected source repository")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || flags.NArg() != 0 {
		return errors.New("verify-envelope requires --envelope and --trust")
	}
	manifest, err := verifyEnvelope(*envelopePath, *trustPath, *repository)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RELEASE_ENVELOPE_VERIFIED=YES\nSOURCE_COMMIT=%s\nKEY_ID_VERIFIED=YES\nSIGNATURE_VERIFIED=YES\n",
		manifest.SourceCommit,
	)
	return nil
}

func generateCommand(args []string) error {
	flags := flag.NewFlagSet("generate-key", flag.ContinueOnError)
	privatePath := flags.String("private-key", "", "new external PKCS#8 Ed25519 private-key path")
	trustPath := flags.String("trust", "", "new public trust-anchor JSON path")
	keyID := flags.String("key-id", "", "stable release key identifier")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *privatePath == "" || *trustPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("generate-key requires --private-key, --trust and --key-id")
	}
	fingerprint, err := generateKeyFiles(*privatePath, *trustPath, *keyID)
	if err != nil {
		return err
	}
	fmt.Printf("KEY_GENERATED=YES\nKEY_ID=%s\nPUBLIC_KEY_SHA256=%s\nPRIVATE_KEY_PRINTED=NO\n", *keyID, fingerprint)
	return nil
}

func deriveCommand(args []string) error {
	flags := flag.NewFlagSet("derive-trust", flag.ContinueOnError)
	privatePath := flags.String("private-key", "", "external PKCS#8 Ed25519 private-key path")
	outputPath := flags.String("out", "", "new public trust-anchor JSON path")
	keyID := flags.String("key-id", "", "stable release key identifier")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *privatePath == "" || *outputPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("derive-trust requires --private-key, --out and --key-id")
	}
	fingerprint, err := deriveTrust(*privatePath, *outputPath, *keyID)
	if err != nil {
		return err
	}
	fmt.Printf("TRUST_DERIVED=YES\nKEY_ID=%s\nPUBLIC_KEY_SHA256=%s\nPRIVATE_KEY_PRINTED=NO\n", *keyID, fingerprint)
	return nil
}

func signCommand(args []string) error {
	flags := flag.NewFlagSet("sign", flag.ContinueOnError)
	manifestPath := flags.String("manifest", "", "exact release manifest JSON path")
	privatePath := flags.String("private-key", "", "external PKCS#8 Ed25519 private-key path")
	trustPath := flags.String("trust", "", "public trust-anchor JSON expected by devices")
	outputPath := flags.String("out", "", "new release envelope JSON path")
	keyID := flags.String("key-id", "", "stable release key identifier")
	repository := flags.String("repository", defaultRepo, "expected source repository")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *manifestPath == "" || *privatePath == "" || *trustPath == "" || *outputPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("sign requires --manifest, --private-key, --trust, --out and --key-id")
	}
	commit, err := signManifest(*manifestPath, *privatePath, *trustPath, *outputPath, *keyID, *repository)
	if err != nil {
		return err
	}
	fmt.Printf("RELEASE_ENVELOPE_SIGNED=YES\nSOURCE_COMMIT=%s\nKEY_ID=%s\nTRUST_MATCH=YES\nPRIVATE_KEY_PRINTED=NO\n", commit, *keyID)
	return nil
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ordax-release-signing <generate-key|derive-trust|sign|verify-envelope|sign-trust-transition|verify-trust-transition> [options]")
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "generate-key":
		err = generateCommand(os.Args[2:])
	case "derive-trust":
		err = deriveCommand(os.Args[2:])
	case "sign":
		err = signCommand(os.Args[2:])
	case "verify-envelope":
		err = verifyCommand(os.Args[2:])
	case "sign-trust-transition":
		err = signTrustTransitionCommand(os.Args[2:])
	case "verify-trust-transition":
		err = verifyTrustTransitionCommand(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-release-signing: ERROR:", err)
		os.Exit(1)
	}
}
