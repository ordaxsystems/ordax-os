package physicalchannel

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const (
	physicalProvenanceSchema = "prototype-ordax.physical-write-candidate/2"
	maxProvenanceBytes       = 64 << 10
)

type physicalProvenance struct {
	Schema                            string `json:"$schema"`
	Status                            string `json:"status"`
	SourceCommit                      string `json:"source_commit"`
	WriterSourceCommit                string `json:"writer_source_commit"`
	CanonicalV4ReleaseProofSHA256     string `json:"canonical_v4_release_proof_sha256"`
	CanonicalV4ReleaseSourceCommit    string `json:"canonical_v4_release_source_commit"`
	CanonicalV4ReleaseEnvelopeURL     string `json:"canonical_v4_release_envelope_url"`
	ReleaseSequence                   int64  `json:"release_sequence"`
	ConsumerKeySetupRequired          bool   `json:"consumer_key_setup_required"`
	DevelopmentChannel                bool   `json:"development_channel"`
	CanonicalTrustSHA256              string `json:"canonical_trust_sha256"`
	MinimalBootstrapSHA256            string `json:"minimal_bootstrap_sha256"`
	PortableUSBContractSHA256         string `json:"portable_usb_contract_sha256"`
	CreatorPortableMediaContractSHA256 string `json:"creator_portable_media_contract_sha256"`
	PhysicalWriteAuthorizationSHA256  string `json:"physical_write_authorization_sha256"`
	PortableWriterLinked              bool   `json:"portable_writer_linked"`
	PortableApplicationPlanSchema     string `json:"portable_application_plan_schema"`
	PortableApplicationOperationCount int    `json:"portable_application_operation_count"`
	PortableArtifactCount             int    `json:"portable_artifact_count"`
	PerArtifactReadbackSHA256Size      bool   `json:"per_artifact_readback_sha256_size"`
	WholeDiskRawImageRequired          bool   `json:"whole_disk_raw_image_required"`
	TargetSpecificPlanRequired         bool   `json:"target_specific_plan_required"`
	PayloadArtifactsInCandidate        bool   `json:"payload_artifacts_in_candidate"`
	PublicCreatorReachable             bool   `json:"public_creator_reachable"`
	PhysicalWriteAuthorizedInBinary    bool   `json:"physical_write_authorized_in_binary"`
	ReleasePublished                   bool   `json:"release_published"`
	PrivateKeyInCandidate              bool   `json:"private_key_in_candidate"`
}

// ReleaseSequence reads the monotonic physical-release sequence from the
// provenance file whose exact bytes are already bound by the signed manifest.
// It deliberately re-runs VerifyInstalled so callers cannot inspect unbound or
// modified provenance bytes.
func ReleaseSequence(installed Installed) (int64, error) {
	if err := VerifyInstalled(installed.Directory, installed.Manifest); err != nil {
		return 0, err
	}
	path := filepath.Join(installed.Directory, "provenance.json")
	info, err := os.Lstat(path)
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return 0, errors.New("physical provenance is not a regular non-symlink file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	var provenance physicalProvenance
	if err := decodeStrict(data, maxProvenanceBytes, &provenance); err != nil {
		return 0, fmt.Errorf("decode physical provenance: %w", err)
	}
	if provenance.Schema != physicalProvenanceSchema {
		return 0, errors.New("unsupported physical provenance schema")
	}
	if provenance.Status != "authorized-candidate-not-published" {
		return 0, fmt.Errorf("unexpected physical provenance status %q", provenance.Status)
	}
	if provenance.SourceCommit != installed.SourceCommit || provenance.SourceCommit != installed.Manifest.SourceCommit {
		return 0, errors.New("physical provenance source commit does not match signed manifest")
	}
	// The signer owns two distinct identities: the writer build and the signed
	// Stable release. Production provenance must survive strict JSON decoding
	// without silently interchanging those identities.
	if provenance.WriterSourceCommit != "" && provenance.WriterSourceCommit != provenance.SourceCommit {
		return 0, errors.New("physical provenance writer source commit mismatch")
	}
	if installed.Manifest.Schema == ManifestSchemaPortable {
		payload := installed.Manifest.PortablePayload
		if payload == nil ||
			provenance.WriterSourceCommit != installed.SourceCommit ||
			!shaPattern.MatchString(provenance.CanonicalV4ReleaseProofSHA256) ||
			provenance.CanonicalV4ReleaseSourceCommit != payload.ReleaseSourceCommit {
			return 0, errors.New("physical provenance canonical v4 release identity mismatch")
		}
		expectedURL := "https://github.com/" + SourceRepository +
			"/releases/download/ordax-stable-v4-" + payload.ReleaseSourceCommit + "/release-envelope.json"
		if provenance.CanonicalV4ReleaseEnvelopeURL != expectedURL {
			return 0, errors.New("physical provenance canonical v4 release envelope URL mismatch")
		}
	}
	if provenance.ReleaseSequence <= 0 {
		return 0, errors.New("physical release sequence must be positive")
	}
	if provenance.ConsumerKeySetupRequired ||
		provenance.DevelopmentChannel ||
		provenance.PrivateKeyInCandidate ||
		provenance.ReleasePublished ||
		provenance.PayloadArtifactsInCandidate ||
		provenance.PublicCreatorReachable {
		return 0, errors.New("physical provenance violates consumer/publisher boundary")
	}
	if !provenance.PortableWriterLinked || !provenance.PhysicalWriteAuthorizedInBinary {
		return 0, errors.New("physical provenance does not describe the authorized internal Portable writer")
	}
	if provenance.PortableApplicationPlanSchema != "prototype-ordax.portable-application-plan/1" {
		return 0, errors.New("physical provenance Portable application plan schema is invalid")
	}
	if provenance.PortableApplicationOperationCount != 39 {
		return 0, errors.New("physical provenance Portable operation count must be 39")
	}
	if provenance.PortableArtifactCount != 17 {
		return 0, errors.New("physical provenance Portable artifact count must be 17")
	}
	if !provenance.PerArtifactReadbackSHA256Size {
		return 0, errors.New("physical provenance must require per-artifact SHA-256 and size readback")
	}
	if provenance.WholeDiskRawImageRequired {
		return 0, errors.New("physical provenance must not require a whole-disk RAW image")
	}
	if !provenance.TargetSpecificPlanRequired {
		return 0, errors.New("physical provenance must require a target-specific application plan")
	}
	for name, value := range map[string]string{
		"canonical_trust_sha256":                 provenance.CanonicalTrustSHA256,
		"minimal_bootstrap_sha256":               provenance.MinimalBootstrapSHA256,
		"portable_usb_contract_sha256":           provenance.PortableUSBContractSHA256,
		"creator_portable_media_contract_sha256": provenance.CreatorPortableMediaContractSHA256,
		"physical_write_authorization_sha256":    provenance.PhysicalWriteAuthorizationSHA256,
	} {
		if !shaPattern.MatchString(value) {
			return 0, fmt.Errorf("physical provenance %s is invalid", name)
		}
	}
	return provenance.ReleaseSequence, nil
}

func ensureNotRollback(root string, candidate Installed, trustBytes []byte, expectedTrustSHA256 string) error {
	candidateSequence, err := ReleaseSequence(candidate)
	if err != nil {
		return fmt.Errorf("candidate physical release sequence invalid: %w", err)
	}
	current, err := Current(root, trustBytes, expectedTrustSHA256)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("existing physical release baseline is invalid; refusing rollback-sensitive update: %w", err)
	}
	currentSequence, err := ReleaseSequence(current)
	if err != nil {
		return fmt.Errorf("current physical release sequence invalid: %w", err)
	}
	if candidateSequence < currentSequence {
		return fmt.Errorf("physical release rollback rejected: candidate sequence %d is older than current sequence %d", candidateSequence, currentSequence)
	}
	if candidateSequence == currentSequence && candidate.SourceCommit != current.SourceCommit {
		return fmt.Errorf("physical release sequence %d was reused by a different source commit", candidateSequence)
	}
	return nil
}
