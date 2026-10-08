//go:build windows && ordax_raw_backend

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	creatorcore "github.com/ordaxsystems/ordax-os/tools/creator/core"
	windowsadapter "github.com/ordaxsystems/ordax-os/tools/creator/host/windows"
)

var (
	buildSourceCommit            = "UNRESOLVED"
	buildReleaseSourceCommit     = "UNRESOLVED"
	buildCanonicalTrustSHA256    = "UNRESOLVED"
	buildManifestSHA256          = "UNRESOLVED"
	buildSeedImageSHA256               = "UNRESOLVED"
	buildSeedImageSize                 = "0"
	buildPortableUSBContractSHA256     = "UNRESOLVED"
	buildCreatorPortableContractSHA256 = "UNRESOLVED"
	buildPhysicalWriteAuthorized       = "NO"
	applyDiagnosticLog                 string
)

type stringListFlag []string

func (values *stringListFlag) String() string {
	return strings.Join(*values, ",")
}

func (values *stringListFlag) Set(value string) error {
	*values = append(*values, value)
	return nil
}

type buildBinding struct {
	SourceCommit            string `json:"source_commit"`
	ReleaseSourceCommit     string `json:"release_source_commit"`
	CanonicalTrustSHA256    string `json:"canonical_trust_sha256"`
	ManifestSHA256          string `json:"manifest_sha256"`
	SeedImageSHA256                 string `json:"seed_image_sha256"`
	SeedImageSize                   int64  `json:"seed_image_size"`
	PortableUSBContractSHA256       string `json:"portable_usb_contract_sha256"`
	CreatorPortableContractSHA256   string `json:"creator_portable_contract_sha256"`
	PhysicalWriteAuthorized         bool   `json:"physical_write_authorized"`
	Ready                           bool   `json:"ready"`
}

func validLowerHex(value string, bytes int) bool {
	if len(value) != bytes*2 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == bytes
}

func binding() buildBinding {
	size, _ := strconv.ParseInt(buildSeedImageSize, 10, 64)
	authorized := buildPhysicalWriteAuthorized == "YES"
	ready := validLowerHex(buildSourceCommit, 20) &&
		validLowerHex(buildReleaseSourceCommit, 20) &&
		validLowerHex(buildCanonicalTrustSHA256, sha256.Size) &&
		validLowerHex(buildManifestSHA256, sha256.Size) &&
		validLowerHex(buildSeedImageSHA256, sha256.Size) &&
		size > 0 && authorized
	return buildBinding{
		SourceCommit: buildSourceCommit,
		ReleaseSourceCommit: buildReleaseSourceCommit,
		CanonicalTrustSHA256: buildCanonicalTrustSHA256,
		ManifestSHA256: buildManifestSHA256,
		SeedImageSHA256: buildSeedImageSHA256,
		SeedImageSize: size,
		PortableUSBContractSHA256: buildPortableUSBContractSHA256,
		CreatorPortableContractSHA256: buildCreatorPortableContractSHA256,
		PhysicalWriteAuthorized: authorized,
		Ready: ready,
	}
}

func encode(value any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(value)
}

func verifyFile(path, expectedSHA string, expectedSize int64) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("file must be a regular non-symlink file")
	}
	if info.Size() != expectedSize {
		return fmt.Errorf("file size mismatch: expected=%d actual=%d", expectedSize, info.Size())
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	digest := sha256.New()
	written, err := io.Copy(digest, file)
	if err != nil {
		return err
	}
	if written != expectedSize {
		return fmt.Errorf("hashed file size mismatch: expected=%d actual=%d", expectedSize, written)
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != expectedSHA {
		return fmt.Errorf("file SHA-256 mismatch: expected=%s actual=%s", expectedSHA, actual)
	}
	return nil
}

func requireReady() buildBinding {
	b := binding()
	if !b.Ready {
		fmt.Fprintln(os.Stderr, "ordax-creator-physical-test: this build is inspection-only; canonical trust, authorized manifest and canonical seed image are not all bound")
		os.Exit(1)
	}
	return b
}

func enumerateConfirmed(token string) (windowsadapter.Target, error) {
	targets, err := windowsadapter.EnumerateRemovableTargets()
	if err != nil {
		return windowsadapter.Target{}, err
	}
	return windowsadapter.MatchConfirmedTarget(targets, token)
}

func runStatus() error {
	b := binding()
	return encode(struct {
		Schema                  string       `json:"$schema"`
		Mode                    string       `json:"mode"`
		RawBackendLinked        bool         `json:"raw_backend_linked"`
		PublicCreatorUnaffected bool         `json:"public_creator_unaffected"`
		PortableWriterLinked    bool         `json:"portable_writer_linked"`
		PortableWriterReady     bool         `json:"portable_writer_ready"`
		Build                   buildBinding `json:"build"`
	}{Schema: "prototype-ordax.creator-physical-test-status/3", Mode: "physical-test-only", RawBackendLinked: true, PublicCreatorUnaffected: true, PortableWriterLinked: true, PortableWriterReady: portableBindingReady(b), Build: b})
}

func runTargets() error {
	targets, err := windowsadapter.EnumerateRemovableTargets()
	if err != nil {
		return err
	}
	return encode(struct {
		Schema  string                  `json:"$schema"`
		Mode    string                  `json:"mode"`
		Targets []windowsadapter.Target `json:"targets"`
	}{Schema: "prototype-ordax.creator-physical-test-targets/1", Mode: "read-only", Targets: targets})
}

func portableBindingReady(b buildBinding) bool {
	return validLowerHex(b.SourceCommit, 20) &&
		validLowerHex(b.ReleaseSourceCommit, 20) &&
		validLowerHex(b.CanonicalTrustSHA256, sha256.Size) &&
		validLowerHex(b.PortableUSBContractSHA256, sha256.Size) &&
		validLowerHex(b.CreatorPortableContractSHA256, sha256.Size) &&
		b.PhysicalWriteAuthorized
}

func requirePortableReady() buildBinding {
	b := binding()
	if !portableBindingReady(b) {
		fmt.Fprintln(os.Stderr, "ordax-creator-physical-test: Portable writer is linked but not authorized; canonical trust and physical promotion must be bound first")
		os.Exit(1)
	}
	return b
}

func loadPortableApplicationPlan(path string) (creatorcore.PortableApplicationPlan, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return creatorcore.PortableApplicationPlan{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 2<<20 {
		return creatorcore.PortableApplicationPlan{}, fmt.Errorf("portable application plan must be a bounded regular non-symlink file")
	}
	file, err := os.Open(path)
	if err != nil {
		return creatorcore.PortableApplicationPlan{}, err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 2<<20))
	decoder.DisallowUnknownFields()
	var plan creatorcore.PortableApplicationPlan
	if err := decoder.Decode(&plan); err != nil {
		return creatorcore.PortableApplicationPlan{}, fmt.Errorf("decode portable application plan: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return creatorcore.PortableApplicationPlan{}, fmt.Errorf("portable application plan has trailing JSON")
	}
	return plan, nil
}

func portableSourcesFromFlags(plan creatorcore.PortableApplicationPlan, specs []string) ([]windowsadapter.PortablePhysicalArtifactSource, error) {
	expected := map[string]creatorcore.PortableApplicationOperation{}
	for _, op := range plan.Operations {
		if op.Kind == "materialize-artifact" {
			expected[op.ArtifactID] = op
		}
	}
	if len(expected) != 17 || len(specs) != 17 {
		return nil, fmt.Errorf("Portable apply requires exactly 17 canonical artifact sources")
	}
	seen := map[string]bool{}
	sources := make([]windowsadapter.PortablePhysicalArtifactSource, 0, len(specs))
	for _, spec := range specs {
		id, path, ok := strings.Cut(spec, "=")
		if !ok || id == "" || path == "" || seen[id] {
			return nil, fmt.Errorf("invalid or duplicate --source %q; expected artifact-id=path", spec)
		}
		op, ok := expected[id]
		if !ok {
			return nil, fmt.Errorf("source artifact %q is not in the canonical plan", id)
		}
		seen[id] = true
		sources = append(sources, windowsadapter.PortablePhysicalArtifactSource{
			ArtifactID: id,
			Path: path,
			SHA256: op.SHA256,
			SizeBytes: op.SizeBytes,
		})
	}
	return sources, nil
}

func runPreparePortable(args []string) error {
	b := requirePortableReady()
	fs := flag.NewFlagSet("prepare-portable", flag.ContinueOnError)
	confirm := fs.String("confirm", "", "confirmation token from targets")
	planPath := fs.String("plan", "", "canonical Portable application-plan JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *confirm == "" || *planPath == "" || fs.NArg() != 0 {
		return fmt.Errorf("prepare-portable requires --confirm and --plan")
	}
	target, err := enumerateConfirmed(*confirm)
	if err != nil {
		return err
	}
	plan, err := loadPortableApplicationPlan(*planPath)
	if err != nil {
		return err
	}
	if plan.SourceCommit != b.ReleaseSourceCommit {
		return fmt.Errorf("Portable application plan source_commit does not match authorized canonical release")
	}
	if plan.TargetBytes != target.PhysicalDiskBytes {
		return fmt.Errorf("Portable application plan capacity does not match confirmed USB target")
	}
	planSHA, err := creatorcore.PortableApplicationPlanSHA256(plan)
	if err != nil {
		return err
	}
	token := windowsadapter.PortableDestructiveAuthorizationToken(target, planSHA)
	return encode(struct {
		Schema string `json:"$schema"`
		Target windowsadapter.Target `json:"target"`
		ApplicationPlanSHA256 string `json:"application_plan_sha256"`
		DestructiveAuthorization string `json:"destructive_authorization"`
		WholeDiskRawImageRequired bool `json:"whole_disk_raw_image_required"`
		Next string `json:"next"`
	}{
		Schema:"prototype-ordax.creator-portable-physical-preparation/1",
		Target:target,
		ApplicationPlanSHA256:planSHA,
		DestructiveAuthorization:token,
		WholeDiskRawImageRequired:false,
		Next:"request UAC elevation and invoke apply-portable with the exact same plan, 17 sources, confirmation token and authorization token",
	})
}

func runApplyPortable(args []string) error {
	b := requirePortableReady()
	fs := flag.NewFlagSet("apply-portable", flag.ContinueOnError)
	confirm := fs.String("confirm", "", "confirmation token from selected target")
	planPath := fs.String("plan", "", "canonical Portable application-plan JSON")
	authorize := fs.String("authorize", "", "destructive authorization emitted by prepare-portable")
	diagnosticLog := fs.String("diagnostic-log", "", "optional UTF-8 error report path")
	progressLog := fs.String("progress-log", "", "optional JSON progress path")
	var sourceSpecs stringListFlag
	fs.Var(&sourceSpecs, "source", "canonical artifact source in artifact-id=path form; repeat exactly 17 times")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *confirm == "" || *planPath == "" || *authorize == "" || fs.NArg() != 0 {
		return fmt.Errorf("apply-portable requires --confirm, --plan, --authorize and exactly 17 --source values")
	}
	plan, err := loadPortableApplicationPlan(*planPath)
	if err != nil {
		return err
	}
	if plan.SourceCommit != b.ReleaseSourceCommit {
		return fmt.Errorf("Portable application plan source_commit does not match authorized canonical release")
	}
	diagnosticPath, err := validateApplySidecarPath(*planPath, *diagnosticLog, "ordax-physical-error.txt")
	if err != nil {
		return fmt.Errorf("validate Portable diagnostic log path: %w", err)
	}
	progressPath, err := validateApplySidecarPath(*planPath, *progressLog, "ordax-physical-progress.json")
	if err != nil {
		return fmt.Errorf("validate Portable progress log path: %w", err)
	}
	applyDiagnosticLog = diagnosticPath
	if applyDiagnosticLog != "" {
		_ = os.Remove(applyDiagnosticLog)
	}
	if progressPath != "" {
		_ = os.Remove(progressPath)
	}
	sources, err := portableSourcesFromFlags(plan, sourceSpecs)
	if err != nil {
		return err
	}
	target, err := enumerateConfirmed(*confirm)
	if err != nil {
		return err
	}
	progressReporter := newApplyProgressReporter(progressPath)
	progressReporter(windowsadapter.PhysicalApplyProgress{Phase:"starting-portable"})
	result, err := windowsadapter.ApplyPortablePhysicalWithProgress(windowsadapter.PortablePhysicalApplyRequest{
		Target:target,
		ConfirmationToken:*confirm,
		ApplicationPlan:plan,
		Sources:sources,
		CanonicalTrustResolved:validLowerHex(b.CanonicalTrustSHA256, sha256.Size),
		PhysicalPromotionAuthorized:b.PhysicalWriteAuthorized,
		DestructiveAuthorization:*authorize,
	}, progressReporter)
	if err != nil {
		return err
	}
	progressReporter(windowsadapter.PhysicalApplyProgress{Phase:"complete-portable", CompletedBytes:1, TotalBytes:1})
	return encode(result)
}

func runPrepare(args []string) error {
	b := requireReady()
	fs := flag.NewFlagSet("prepare", flag.ContinueOnError)
	confirm := fs.String("confirm", "", "confirmation token from targets")
	seed := fs.String("seed", "", "authorized canonical seed RAW image")
	out := fs.String("out", "", "new target-sized RAW image path")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *confirm == "" || *seed == "" || *out == "" || fs.NArg() != 0 {
		return fmt.Errorf("prepare requires --confirm, --seed and --out")
	}
	target, err := enumerateConfirmed(*confirm)
	if err != nil {
		return err
	}
	if err := verifyFile(*seed, b.SeedImageSHA256, b.SeedImageSize); err != nil {
		return fmt.Errorf("verify authorized seed image: %w", err)
	}
	prepared, err := creatorcore.PreparePhysicalStorageImage(*seed, *out, target.PhysicalDiskBytes)
	if err != nil {
		return err
	}
	image := windowsadapter.VerifiedRawImage{Path: prepared.Path, SizeBytes: prepared.SizeBytes, SHA256: prepared.SHA256}
	authorization := windowsadapter.DestructiveAuthorizationToken(target, image)
	return encode(struct {
		Schema                   string                             `json:"$schema"`
		SourceCommit             string                             `json:"source_commit"`
		CanonicalTrustSHA256     string                             `json:"canonical_trust_sha256"`
		ManifestSHA256           string                             `json:"manifest_sha256"`
		AuthorizedSeedSHA256     string                             `json:"authorized_seed_sha256"`
		Target                   windowsadapter.Target              `json:"target"`
		PreparedImage            creatorcore.PreparedPhysicalImage `json:"prepared_image"`
		DestructiveAuthorization string                             `json:"destructive_authorization"`
		Next                     string                             `json:"next"`
	}{Schema: "prototype-ordax.creator-physical-test-preparation/2", SourceCommit: b.SourceCommit, CanonicalTrustSHA256: b.CanonicalTrustSHA256, ManifestSHA256: b.ManifestSHA256, AuthorizedSeedSHA256: b.SeedImageSHA256, Target: target, PreparedImage: prepared, DestructiveAuthorization: authorization, Next: "consumer Creator must request Windows elevation and call apply with the exact same target token, image SHA/size and destructive authorization token"})
}

func runApply(args []string) error {
	fs := flag.NewFlagSet("apply", flag.ContinueOnError)
	confirm := fs.String("confirm", "", "confirmation token from the selected target")
	imagePath := fs.String("image", "", "prepared target-sized RAW image")
	imageSHA := fs.String("sha256", "", "prepared image SHA-256")
	imageSize := fs.Int64("size", 0, "prepared image size in bytes")
	authorize := fs.String("authorize", "", "destructive authorization token emitted by prepare")
	diagnosticLog := fs.String("diagnostic-log", "", "optional UTF-8 error report path owned by the parent Creator")
	progressLog := fs.String("progress-log", "", "optional JSON progress path owned by the parent Creator")
	if err := fs.Parse(args); err != nil {
		return err
	}
	b := requireReady()
	if *confirm == "" || *imagePath == "" || *imageSHA == "" || *imageSize <= 0 || *authorize == "" || fs.NArg() != 0 {
		return fmt.Errorf("apply requires --confirm, --image, --sha256, --size and --authorize")
	}
	diagnosticPath, err := validateApplySidecarPath(*imagePath, *diagnosticLog, "ordax-physical-error.txt")
	if err != nil {
		return fmt.Errorf("validate diagnostic log path: %w", err)
	}
	progressPath, err := validateApplySidecarPath(*imagePath, *progressLog, "ordax-physical-progress.json")
	if err != nil {
		return fmt.Errorf("validate progress log path: %w", err)
	}
	applyDiagnosticLog = diagnosticPath
	if applyDiagnosticLog != "" {
		_ = os.Remove(applyDiagnosticLog)
	}
	if progressPath != "" {
		_ = os.Remove(progressPath)
	}
	progressReporter := newApplyProgressReporter(progressPath)
	progressReporter(windowsadapter.PhysicalApplyProgress{Phase: "starting"})
	target, err := enumerateConfirmed(*confirm)
	if err != nil {
		return err
	}
	image := windowsadapter.VerifiedRawImage{Path: *imagePath, SHA256: *imageSHA, SizeBytes: *imageSize}
	request := windowsadapter.RawDiskApplyRequest{Target: target, ConfirmationToken: *confirm, Image: image, BootstrapSeedBytes: b.SeedImageSize, CanonicalTrustResolved: true, DestructiveAuthorization: *authorize}
	result, err := windowsadapter.ApplyPhysicalTestWithProgress(request, progressReporter)
	if err != nil {
		return err
	}
	layout, err := creatorcore.PlanPhysicalStorage(target.PhysicalDiskBytes)
	if err != nil {
		return fmt.Errorf("rebuild authorized storage layout after raw verification: %w", err)
	}
	progressReporter(windowsadapter.PhysicalApplyProgress{Phase: "formatting-data"})
	if err := windowsadapter.FormatPortableDataVolume(target, layout.DataStartLBA, layout.DataBytes); err != nil {
		return fmt.Errorf("finalize portable ORDAX-DATA volume: %w", err)
	}
	progressReporter(windowsadapter.PhysicalApplyProgress{Phase: "complete", CompletedBytes: 1, TotalBytes: 1})
	return encode(struct {
		Schema       string                             `json:"$schema"`
		Status       string                             `json:"status"`
		PortableData string                             `json:"portable_data"`
		Result       windowsadapter.PhysicalApplyResult `json:"result"`
	}{Schema: "prototype-ordax.creator-physical-test-apply/2", Status: "pass-readback-verified-data-formatted", PortableData: "ORDAX-DATA:exFAT:verified", Result: result})
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ordax-creator-physical-test <status|targets|prepare|apply|prepare-portable|apply-portable> [options]")
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "status":
		err = runStatus()
	case "targets":
		err = runTargets()
	case "prepare":
		err = runPrepare(os.Args[2:])
	case "apply":
		err = runApply(os.Args[2:])
	case "prepare-portable":
		err = runPreparePortable(os.Args[2:])
	case "apply-portable":
		err = runApplyPortable(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		if applyDiagnosticLog != "" {
			_ = os.WriteFile(applyDiagnosticLog, []byte(err.Error()+"\n"), 0o600)
		}
		fmt.Fprintln(os.Stderr, "ordax-creator-physical-test:", err)
		os.Exit(1)
	}
}
