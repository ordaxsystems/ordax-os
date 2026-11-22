package creatorcore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
)

// PortableUpdateGrant binds a host authorization and an independently verified
// signed release to the exact policy plan. Neither a plan nor Git alone grants
// permission to write a physical disk.
type PortableUpdateGrant struct {
	PlanSHA256            string `json:"plan_sha256"`
	SignedSourceCommit    string `json:"signed_source_commit"`
	PhysicalWriteAuthorized bool `json:"physical_write_authorized"`
}

// The host adapter MUST revalidate the same physical disk before each write,
// keep source handles immutable, publish each new path atomically and read back
// hashes. ArmCandidate publishes only after every signed release byte is
// verified, and must not directly edit boot EFI or ext4 state images.
type PortableUpdateRuntime interface {
	VerifyLayout([]PortableApplicationPartition, uint64) error
	Readback(PortableApplicationOperation) error
	Materialize(PortableApplicationOperation, PortableApplicationSource) error
	Flush() error
	ArmCandidate(string) error
}

type PortableUpdateReceipt struct {
	Schema                string `json:"$schema"`
	Status                string `json:"status"`
	FromSourceCommit      string `json:"from_source_commit"`
	ToSourceCommit        string `json:"to_source_commit"`
	PlanSHA256            string `json:"plan_sha256"`
	InstalledReadbacks    int    `json:"installed_readbacks"`
	ReleaseMaterialized   int    `json:"release_materialized"`
	ReleaseReadbacks      int    `json:"release_readbacks"`
	CandidateRequestArmed bool   `json:"candidate_request_armed"`
	Activated             bool   `json:"activated"`
}

const PortableUpdateReceiptSchema = "prototype-ordax.portable-incremental-update-receipt/1"

func PortableUpdatePlanCanonicalBytes(plan PortableUpdatePlan) ([]byte, error) {
	data, err := json.MarshalIndent(plan, "", "  ")
	if err != nil { return nil, err }
	return append(data, byte(10)), nil
}

func PortableUpdatePlanSHA256(plan PortableUpdatePlan) (string, error) {
	data, err := PortableUpdatePlanCanonicalBytes(plan)
	if err != nil { return "", err }
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// ExecutePortableUpdate owns one non-destructive transaction for an installed
// two-partition Portable USB. The same Core policy governs Windows and any
// future host adapter; there is no second update-engine or formatter.
func ExecutePortableUpdate(
	installed, candidate PortableMediaPlan,
	plan PortableUpdatePlan,
	sources []PortableApplicationSource,
	grant PortableUpdateGrant,
	runtime PortableUpdateRuntime,
) (PortableUpdateReceipt, error) {
	if runtime == nil { return PortableUpdateReceipt{}, errors.New("Portable update runtime is required") }
	expected, err := PlanPortableUpdate(installed, candidate)
	if err != nil { return PortableUpdateReceipt{}, err }
	if !reflect.DeepEqual(plan, expected) {
		return PortableUpdateReceipt{}, errors.New("Portable update plan differs from canonical Core policy")
	}
	sha, err := PortableUpdatePlanSHA256(plan)
	if err != nil { return PortableUpdateReceipt{}, err }
	if !grant.PhysicalWriteAuthorized ||
		grant.PlanSHA256 != sha ||
		!validPortableMediaSHA256(sha) ||
		grant.SignedSourceCommit != candidate.SourceCommit {
		return PortableUpdateReceipt{}, errors.New("Portable update requires exact signed-release and physical-target grant")
	}
	required := map[string]PortableApplicationOperation{}
	for _, op := range plan.Operations {
		if op.Kind == "materialize-artifact" {
			if _, ok := required[op.ArtifactID]; ok { return PortableUpdateReceipt{}, errors.New("duplicate materialization") }
			required[op.ArtifactID] = op
		}
	}
	if len(sources) != len(required) {
		return PortableUpdateReceipt{}, errors.New("Portable update source set is incomplete")
	}
	byID := make(map[string]PortableApplicationSource, len(sources))
	for _, source := range sources {
		op, ok := required[source.ArtifactID]
		if !ok || source.SHA256 != op.SHA256 ||
			source.SizeBytes != op.SizeBytes ||
			!validPortableMediaSHA256(source.SHA256) ||
			source.SizeBytes == 0 || source.SizeBytes > portableMediaMaxArtifact {
			return PortableUpdateReceipt{}, fmt.Errorf("invalid signed source binding %q", source.ArtifactID)
		}
		if _, exists := byID[source.ArtifactID]; exists {
			return PortableUpdateReceipt{}, errors.New("duplicate update source")
		}
		byID[source.ArtifactID] = source
	}
	// Verify EVERY installed artifact, including known-good release bytes, before any
	// candidate materialization; the trusted plan alone cannot establish the
	// condition of a physical pendrive.
	if err := runtime.VerifyLayout(plan.Partitions, plan.TargetBytes); err != nil {
		return PortableUpdateReceipt{}, fmt.Errorf("installed Portable layout: %w", err)
	}
	installedCount := 0
	for _, artifact := range installed.Artifacts {
		op := PortableApplicationOperation{
			ID: "verify-installed-" + artifact.ID,
			Kind: "readback-sha256-size", Partition: artifact.Partition,
			TargetPath: artifact.TargetPath, ArtifactID: artifact.ID,
			SHA256: artifact.SHA256, SizeBytes: artifact.SizeBytes,
			ReadbackRequired: true,
		}
		if err := runtime.Readback(op); err != nil {
			return PortableUpdateReceipt{}, fmt.Errorf("installed artifact %q failed readback: %w", artifact.ID, err)
		}
		installedCount++
	}
	if installedCount != len(installed.Artifacts) {
		return PortableUpdateReceipt{}, errors.New("installed Portable artifact set is incomplete")
	}
	materialized, readbacks := 0, 0
	for _, op := range plan.Operations {
		switch op.Kind {
		case "verify-gpt-filesystem-labels-and-capacity":
			if err := runtime.VerifyLayout(plan.Partitions, plan.TargetBytes); err != nil {
				return PortableUpdateReceipt{}, fmt.Errorf("layout gate %q: %w", op.ID, err)
			}
		case "materialize-artifact":
			if err := runtime.Materialize(op, byID[op.ArtifactID]); err != nil {
				return PortableUpdateReceipt{}, fmt.Errorf("materialize %q: %w", op.ID, err)
			}
			materialized++
		case "flush-and-sync":
			if err := runtime.Flush(); err != nil { return PortableUpdateReceipt{}, fmt.Errorf("flush update: %w", err) }
		case "readback-sha256-size":
			if err := runtime.Readback(op); err != nil {
				return PortableUpdateReceipt{}, fmt.Errorf("candidate readback %q: %w", op.ID, err)
			}
			readbacks++
		default:
			return PortableUpdateReceipt{}, fmt.Errorf("unexpected update operation %q", op.Kind)
		}
	}
	if readbacks != len(portableReleaseArtifacts) {
		return PortableUpdateReceipt{}, errors.New("Portable signed release did not pass complete readback")
	}
	if err := runtime.ArmCandidate(candidate.SourceCommit); err != nil {
		return PortableUpdateReceipt{}, fmt.Errorf("publish verified candidate request: %w", err)
	}
	return PortableUpdateReceipt{
		Schema: PortableUpdateReceiptSchema, Status: "staged-not-activated",
		FromSourceCommit: installed.SourceCommit, ToSourceCommit: candidate.SourceCommit,
		PlanSHA256: sha, InstalledReadbacks: installedCount,
		ReleaseMaterialized: materialized, ReleaseReadbacks: readbacks,
		CandidateRequestArmed: true, Activated: false,
	}, nil
}

