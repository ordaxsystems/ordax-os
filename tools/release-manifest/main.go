package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
)

const (
	manifestSchema                = "prototype-ordax.release-manifest/1"
	manifestSchemaV2              = "prototype-ordax.release-manifest/2"
	manifestSchemaV3               = "prototype-ordax.release-manifest/3"
	manifestSchemaV4               = "prototype-ordax.release-manifest/4"
	defaultRepo                    = "ordaxsystems/ordax-os"
	defaultRecipe                  = "release/native/1"
	defaultPortableRecipe          = "release/portable-usb-v2/1"
	defaultPortableRuntimeRecipe   = "release/portable-usb-v2-runtime/1"
	defaultPortableAIRuntimeRecipe = "release/portable-usb-v2-local-ai/1"
	maxArtifact                    = int64(16 << 30)
)

var (
	commitPattern   = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern      = regexp.MustCompile(`^[0-9a-f]{64}$`)
	revisionPattern = regexp.MustCompile(`^[0-9a-f]{7,64}$`)
	licensePattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$`)
	recipePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$`)
)

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
	Contract             string `json:"contract"`
	SourceLockSchema     string `json:"source_lock_schema"`
	SourceLockSHA256     string `json:"source_lock_sha256"`
	EngineID             string `json:"engine_id"`
	EngineRepository     string `json:"engine_repository"`
	EngineSourceCommit   string `json:"engine_source_commit"`
	EngineLicense        string `json:"engine_license"`
	ModelID              string `json:"model_id"`
	ModelRepository      string `json:"model_repository"`
	ModelFilename        string `json:"model_filename"`
	ModelUpstreamRevision string `json:"model_upstream_revision"`
	ModelSHA256          string `json:"model_sha256"`
	ModelSize            int64  `json:"model_size"`
	ModelLicense         string `json:"model_license"`
}

type LocalAISourceLock struct {
	Schema string `json:"$schema"`
	Engine struct {
		ID         string `json:"id"`
		Repository string `json:"repository"`
		Commit     string `json:"commit"`
		License    string `json:"license"`
	} `json:"engine"`
	Model struct {
		ID               string `json:"id"`
		Repository       string `json:"repository"`
		Filename         string `json:"filename"`
		SHA256           string `json:"sha256"`
		SizeBytes        int64  `json:"size_bytes"`
		License          string `json:"license"`
		UpstreamRevision string `json:"upstream_revision"`
	} `json:"model"`
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
		return "", errors.New("parent must be a real directory, not a symlink")
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

func validateHTTPSURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("artifact URL must be absolute HTTPS without credentials or fragment")
	}
	return nil
}

func hashNamedArtifact(path, expectedName, schemaLabel string) (string, int64, error) {
	absolute, err := ensureRealParent(path)
	if err != nil {
		return "", 0, err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", 0, errors.New("artifact must be a regular non-symlink file")
	}
	if filepath.Base(absolute) != expectedName {
		return "", 0, fmt.Errorf("%s artifact must be named %s", schemaLabel, expectedName)
	}
	if info.Size() <= 0 || info.Size() > maxArtifact {
		return "", 0, fmt.Errorf("artifact size outside allowed range: %d", info.Size())
	}
	file, err := os.Open(absolute)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	h := sha256.New()
	n, err := io.Copy(h, file)
	if err != nil {
		return "", 0, err
	}
	if n != info.Size() {
		return "", 0, errors.New("artifact size changed while hashing")
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func hashArtifact(path string) (string, int64, error) {
	return hashNamedArtifact(path, "system.tar", "release-manifest/1")
}

func buildManifest(artifactPath, sourceCommit, artifactURL, repository, recipe string) (Manifest, error) {
	if !commitPattern.MatchString(sourceCommit) {
		return Manifest{}, errors.New("source commit must be lowercase 40-hex")
	}
	if repository == "" {
		return Manifest{}, errors.New("source repository is required")
	}
	if !recipePattern.MatchString(recipe) {
		return Manifest{}, errors.New("invalid CI recipe identifier")
	}
	if err := validateHTTPSURL(artifactURL); err != nil {
		return Manifest{}, err
	}
	digest, size, err := hashArtifact(artifactPath)
	if err != nil {
		return Manifest{}, err
	}
	return Manifest{
		Schema:              manifestSchema,
		SourceRepository:    repository,
		SourceCommit:        sourceCommit,
		ReleaseID:           sourceCommit,
		CreatedFromCIRecipe: recipe,
		Artifacts: []Artifact{{
			Name:   "system.tar",
			Role:   "system",
			URL:    artifactURL,
			SHA256: digest,
			Size:   size,
		}},
	}, nil
}

func buildPortableManifest(artifactPath, sourceCommit, artifactURL, repository, recipe string) (Manifest, error) {
	if !commitPattern.MatchString(sourceCommit) {
		return Manifest{}, errors.New("source commit must be lowercase 40-hex")
	}
	if repository == "" {
		return Manifest{}, errors.New("source repository is required")
	}
	if !recipePattern.MatchString(recipe) {
		return Manifest{}, errors.New("invalid CI recipe identifier")
	}
	if err := validateHTTPSURL(artifactURL); err != nil {
		return Manifest{}, err
	}
	digest, size, err := hashNamedArtifact(artifactPath, "system.erofs", "release-manifest/2")
	if err != nil {
		return Manifest{}, err
	}
	return Manifest{
		Schema:              manifestSchemaV2,
		SourceRepository:    repository,
		SourceCommit:        sourceCommit,
		ReleaseID:           sourceCommit,
		CreatedFromCIRecipe: recipe,
		ProductMode:         "usb",
		StorageProfile:      "portable-usb-v2",
		RuntimeFormat:       "erofs",
		Artifacts: []Artifact{{
			Name:   "system.erofs",
			Role:   "system-image",
			URL:    artifactURL,
			SHA256: digest,
			Size:   size,
		}},
	}, nil
}

func buildPortableRuntimeManifest(systemPath, runtimePath, sourceCommit, systemURL, runtimeURL, repository, recipe string) (Manifest, error) {
	if !commitPattern.MatchString(sourceCommit) {
		return Manifest{}, errors.New("source commit must be lowercase 40-hex")
	}
	if repository == "" {
		return Manifest{}, errors.New("source repository is required")
	}
	if !recipePattern.MatchString(recipe) {
		return Manifest{}, errors.New("invalid CI recipe identifier")
	}
	if err := validateHTTPSURL(systemURL); err != nil {
		return Manifest{}, fmt.Errorf("system artifact URL: %w", err)
	}
	if err := validateHTTPSURL(runtimeURL); err != nil {
		return Manifest{}, fmt.Errorf("Surface runtime artifact URL: %w", err)
	}
	systemDigest, systemSize, err := hashNamedArtifact(systemPath, "system.erofs", "release-manifest/3 system")
	if err != nil {
		return Manifest{}, err
	}
	runtimeDigest, runtimeSize, err := hashNamedArtifact(runtimePath, "native-surface-runtime.erofs", "release-manifest/3 Surface runtime")
	if err != nil {
		return Manifest{}, err
	}
	return Manifest{
		Schema:              manifestSchemaV3,
		SourceRepository:    repository,
		SourceCommit:        sourceCommit,
		ReleaseID:           sourceCommit,
		CreatedFromCIRecipe: recipe,
		ProductMode:         "usb",
		StorageProfile:      "portable-usb-v2",
		RuntimeFormat:       "erofs",
		Artifacts: []Artifact{
			{
				Name:   "system.erofs",
				Role:   "system-image",
				URL:    systemURL,
				SHA256: systemDigest,
				Size:   systemSize,
			},
			{
				Name:   "native-surface-runtime.erofs",
				Role:   "surface-runtime",
				URL:    runtimeURL,
				SHA256: runtimeDigest,
				Size:   runtimeSize,
			},
		},
	}, nil
}

func loadLocalAISourceLock(path string) (LocalAIBinding, error) {
	absolute, err := ensureRealParent(path)
	if err != nil {
		return LocalAIBinding{}, err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return LocalAIBinding{}, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() <= 0 || info.Size() > 64<<10 {
		return LocalAIBinding{}, errors.New("local AI source lock must be a bounded regular non-symlink file")
	}
	data, err := os.ReadFile(absolute)
	if err != nil {
		return LocalAIBinding{}, err
	}
	var lock LocalAISourceLock
	if err := json.Unmarshal(data, &lock); err != nil {
		return LocalAIBinding{}, fmt.Errorf("invalid local AI source lock: %w", err)
	}
	if lock.Schema != "prototype-ordax.local-ai-source-lock/1" {
		return LocalAIBinding{}, errors.New("unsupported local AI source lock schema")
	}
	if lock.Engine.ID == "" || len(lock.Engine.ID) > 128 ||
		lock.Engine.Repository == "" || len(lock.Engine.Repository) > 512 ||
		!commitPattern.MatchString(lock.Engine.Commit) ||
		!licensePattern.MatchString(lock.Engine.License) {
		return LocalAIBinding{}, errors.New("invalid local AI engine source identity")
	}
	if lock.Model.ID == "" || len(lock.Model.ID) > 128 ||
		lock.Model.Repository == "" || len(lock.Model.Repository) > 512 ||
		lock.Model.Filename == "" || filepath.Base(lock.Model.Filename) != lock.Model.Filename ||
		!shaPattern.MatchString(lock.Model.SHA256) ||
		lock.Model.SizeBytes <= 0 || lock.Model.SizeBytes > maxArtifact ||
		!licensePattern.MatchString(lock.Model.License) ||
		!revisionPattern.MatchString(lock.Model.UpstreamRevision) {
		return LocalAIBinding{}, errors.New("invalid local AI model source identity")
	}
	digest := sha256.Sum256(data)
	return LocalAIBinding{
		Contract:              "ordax.local-ai/1",
		SourceLockSchema:      lock.Schema,
		SourceLockSHA256:      hex.EncodeToString(digest[:]),
		EngineID:              lock.Engine.ID,
		EngineRepository:      lock.Engine.Repository,
		EngineSourceCommit:    lock.Engine.Commit,
		EngineLicense:         lock.Engine.License,
		ModelID:               lock.Model.ID,
		ModelRepository:       lock.Model.Repository,
		ModelFilename:         lock.Model.Filename,
		ModelUpstreamRevision: lock.Model.UpstreamRevision,
		ModelSHA256:           lock.Model.SHA256,
		ModelSize:             lock.Model.SizeBytes,
		ModelLicense:          lock.Model.License,
	}, nil
}

func buildPortableAIManifest(systemPath, runtimePath, aiRuntimePath, sourceLockPath, sourceCommit, systemURL, runtimeURL, aiRuntimeURL, repository, recipe string) (Manifest, error) {
	if err := validateHTTPSURL(aiRuntimeURL); err != nil {
		return Manifest{}, fmt.Errorf("local AI runtime artifact URL: %w", err)
	}
	manifest, err := buildPortableRuntimeManifest(
		systemPath,
		runtimePath,
		sourceCommit,
		systemURL,
		runtimeURL,
		repository,
		recipe,
	)
	if err != nil {
		return Manifest{}, err
	}
	aiDigest, aiSize, err := hashNamedArtifact(aiRuntimePath, "local-ai-runtime.erofs", "release-manifest/4 local AI runtime")
	if err != nil {
		return Manifest{}, err
	}
	binding, err := loadLocalAISourceLock(sourceLockPath)
	if err != nil {
		return Manifest{}, err
	}
	manifest.Schema = manifestSchemaV4
	manifest.Artifacts = append(manifest.Artifacts, Artifact{
		Name:   "local-ai-runtime.erofs",
		Role:   "local-ai-runtime",
		URL:    aiRuntimeURL,
		SHA256: aiDigest,
		Size:   aiSize,
	})
	manifest.LocalAI = &binding
	return manifest, nil
}

func writeManifest(path string, manifest Manifest) error {
	absolute, err := ensureRealParent(path)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(absolute); err == nil {
		return errors.New("output already exists; overwrite is forbidden")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	file, err := os.OpenFile(absolute, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(absolute)
		}
	}()
	if _, err := io.Copy(file, bytes.NewReader(data)); err != nil {
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

func run(args []string) error {
	flags := flag.NewFlagSet("ordax-release-manifest", flag.ContinueOnError)
	artifact := flags.String("artifact", "", "verified release artifact path")
	runtimeArtifact := flags.String("runtime-artifact", "", "verified native-surface-runtime.erofs path for schema 3 or 4")
	localAIArtifact := flags.String("local-ai-artifact", "", "verified local-ai-runtime.erofs path for schema 4")
	localAISourceLock := flags.String("local-ai-source-lock", "", "verified local AI source-lock.json path for schema 4")
	commit := flags.String("source-commit", "", "exact lowercase 40-hex source commit")
	artifactURL := flags.String("artifact-url", "", "canonical HTTPS URL for the exact system artifact")
	runtimeArtifactURL := flags.String("runtime-artifact-url", "", "canonical HTTPS URL for native-surface-runtime.erofs for schema 3 or 4")
	localAIArtifactURL := flags.String("local-ai-artifact-url", "", "canonical HTTPS URL for local-ai-runtime.erofs for schema 4")
	out := flags.String("out", "", "new release-manifest.json path")
	repository := flags.String("repository", defaultRepo, "source repository")
	recipe := flags.String("recipe", "", "CI recipe identity; defaults by schema")
	schema := flags.String("manifest-schema", "1", "release manifest schema major: 1, 2, 3 or 4")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *artifact == "" || *commit == "" || *artifactURL == "" || *out == "" || flags.NArg() != 0 {
		return errors.New("requires --artifact, --source-commit, --artifact-url and --out")
	}

	selectedRecipe := *recipe
	var manifest Manifest
	var err error
	switch *schema {
	case "1":
		if selectedRecipe == "" {
			selectedRecipe = defaultRecipe
		}
		manifest, err = buildManifest(*artifact, *commit, *artifactURL, *repository, selectedRecipe)
	case "2":
		if selectedRecipe == "" {
			selectedRecipe = defaultPortableRecipe
		}
		manifest, err = buildPortableManifest(*artifact, *commit, *artifactURL, *repository, selectedRecipe)
	case "3":
		if *runtimeArtifact == "" || *runtimeArtifactURL == "" {
			return errors.New("release-manifest/3 requires --runtime-artifact and --runtime-artifact-url")
		}
		if selectedRecipe == "" {
			selectedRecipe = defaultPortableRuntimeRecipe
		}
		manifest, err = buildPortableRuntimeManifest(
			*artifact,
			*runtimeArtifact,
			*commit,
			*artifactURL,
			*runtimeArtifactURL,
			*repository,
			selectedRecipe,
		)
	case "4":
		if *runtimeArtifact == "" || *runtimeArtifactURL == "" ||
			*localAIArtifact == "" || *localAIArtifactURL == "" || *localAISourceLock == "" {
			return errors.New("release-manifest/4 requires Surface runtime, local AI runtime and local AI source lock inputs")
		}
		if selectedRecipe == "" {
			selectedRecipe = defaultPortableAIRuntimeRecipe
		}
		manifest, err = buildPortableAIManifest(
			*artifact,
			*runtimeArtifact,
			*localAIArtifact,
			*localAISourceLock,
			*commit,
			*artifactURL,
			*runtimeArtifactURL,
			*localAIArtifactURL,
			*repository,
			selectedRecipe,
		)
	default:
		return errors.New("unsupported manifest schema major; expected 1, 2, 3 or 4")
	}
	if err != nil {
		return err
	}
	if err := writeManifest(*out, manifest); err != nil {
		return err
	}
	fmt.Printf(
		"RELEASE_MANIFEST_BUILT=YES\nMANIFEST_SCHEMA=%s\nSOURCE_COMMIT=%s\nARTIFACT_NAME=%s\nARTIFACT_SHA256=%s\nARTIFACT_SIZE=%d\n",
		manifest.Schema,
		manifest.SourceCommit,
		manifest.Artifacts[0].Name,
		manifest.Artifacts[0].SHA256,
		manifest.Artifacts[0].Size,
	)
	if manifest.Schema == manifestSchemaV3 || manifest.Schema == manifestSchemaV4 {
		fmt.Printf(
			"RUNTIME_ARTIFACT_NAME=%s\nRUNTIME_ARTIFACT_SHA256=%s\nRUNTIME_ARTIFACT_SIZE=%d\n",
			manifest.Artifacts[1].Name,
			manifest.Artifacts[1].SHA256,
			manifest.Artifacts[1].Size,
		)
	}
	if manifest.Schema == manifestSchemaV4 {
		fmt.Printf(
			"LOCAL_AI_ARTIFACT_NAME=%s\nLOCAL_AI_ARTIFACT_SHA256=%s\nLOCAL_AI_ARTIFACT_SIZE=%d\nLOCAL_AI_SOURCE_LOCK_SHA256=%s\n",
			manifest.Artifacts[2].Name,
			manifest.Artifacts[2].SHA256,
			manifest.Artifacts[2].Size,
			manifest.LocalAI.SourceLockSHA256,
		)
	}
	return nil
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "ordax-release-manifest: ERROR:", err)
		os.Exit(1)
	}
}
