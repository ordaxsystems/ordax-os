package creatorcore

import (
	"errors"
	"fmt"
)

// PortableUpdatePlanSchema defines a non-destructive update of an already
// installed two-partition Portable USB. It never grants device write access.
const PortableUpdatePlanSchema = "prototype-ordax.portable-incremental-update-plan/1"

type PortableUpdatePlan struct {
	Schema                   string                         `json:"$schema"`
	Status                   string                         `json:"status"`
	Profile                  string                         `json:"profile"`
	FromSourceCommit         string                         `json:"from_source_commit"`
	ToSourceCommit           string                         `json:"to_source_commit"`
	TargetBytes              uint64                         `json:"target_bytes"`
	Partitions               []PortableApplicationPartition `json:"partitions"`
	Operations               []PortableApplicationOperation `json:"operations"`
	RequiresSignedRelease    bool                           `json:"requires_signed_release"`
	RequiresPostbootHealth   bool                           `json:"requires_postboot_health"`
	WholeDiskRewriteRequired bool                           `json:"whole_disk_rewrite_required"`
	PhysicalWriteAuthorized  bool                           `json:"physical_write_authorized"`
}

// The immutable bootstrap, kernel and state are NOT part of a Surface hot
// update. A foundation change must use the canonical Base/boot upgrade
// transaction, never silently format a working USB or replace known-good.
var portableImmutableArtifacts = map[string]bool{
	"systemd-boot": true, "loader-config": true,
	"loader-normal": true, "loader-recovery": true,
	"kernel": true, "initramfs": true, "bootstrap-capsule": true,
	"release-trust": true, "stable-base": true,
	"persistent-state": true,
}

var portableReleaseArtifacts = map[string]bool{
	"system-image": true, "surface-runtime-image": true,
	"surface-runtime-ref": true, "local-ai-runtime-image": true,
	"local-ai-runtime-ref": true, "release-manifest": true,
	"release-envelope": true,
}

// PlanPortableUpdate derives changes exclusively from the existing canonical
// 17-artifact media contract. No second update manifest, GPT writer, format,
// or ext4 mutator is introduced. Installed and candidate full media plans
// must be independently verified against their signed artifact manifests by
// the host before using this non-authorizing plan.
func PlanPortableUpdate(installed, candidate PortableMediaPlan) (PortableUpdatePlan, error) {
	current, err := PlanPortableApplication(installed)
	if err != nil {
		return PortableUpdatePlan{}, fmt.Errorf("installed Portable media is invalid: %w", err)
	}
	next, err := PlanPortableApplication(candidate)
	if err != nil {
		return PortableUpdatePlan{}, fmt.Errorf("candidate Portable media is invalid: %w", err)
	}
	if installed.SourceCommit == candidate.SourceCommit {
		return PortableUpdatePlan{}, errors.New("Portable update candidate is already installed")
	}
	if current.TargetBytes != next.TargetBytes ||
		current.Profile != next.Profile ||
		len(current.Partitions) != 2 || len(next.Partitions) != 2 {
		return PortableUpdatePlan{}, errors.New("Portable update would change installed media geometry")
	}
	for i := range current.Partitions {
		if current.Partitions[i] != next.Partitions[i] {
			return PortableUpdatePlan{}, errors.New("Portable update would repartition installed media")
		}
	}
	byID := make(map[string]PortableMediaArtifactPlan, len(installed.Artifacts))
	for _, artifact := range installed.Artifacts {
		byID[artifact.ID] = artifact
	}
	for _, artifact := range candidate.Artifacts {
		previous, ok := byID[artifact.ID]
		if !ok {
			return PortableUpdatePlan{}, fmt.Errorf("missing installed artifact %q", artifact.ID)
		}
		if portableImmutableArtifacts[artifact.ID] &&
			(previous.Partition != artifact.Partition ||
				previous.TargetPath != artifact.TargetPath ||
				previous.SHA256 != artifact.SHA256 ||
				previous.SizeBytes != artifact.SizeBytes) {
			return PortableUpdatePlan{}, fmt.Errorf(
				"foundation/state artifact %q needs a separate verified Base update", artifact.ID)
		}
	}
	operations := make([]PortableApplicationOperation, 0, 17)
	add := func(op PortableApplicationOperation) {
		op.Sequence = len(operations) + 1
		operations = append(operations, op)
	}
	add(PortableApplicationOperation{
		ID: "verify-installed-layout", Kind: "verify-gpt-filesystem-labels-and-capacity",
		ReadbackRequired: true,
	})
	for _, artifact := range candidate.Artifacts {
		if !portableReleaseArtifacts[artifact.ID] {
			continue
		}
		if artifact.Partition != "ORDAX-DATA" {
			return PortableUpdatePlan{}, fmt.Errorf("Portable release artifact %q cannot be written to boot partition", artifact.ID)
		}
		old := byID[artifact.ID]
		if old.TargetPath == artifact.TargetPath {
			if old.SHA256 != artifact.SHA256 || old.SizeBytes != artifact.SizeBytes {
				return PortableUpdatePlan{}, fmt.Errorf("Portable update would overwrite an immutable artifact %q", artifact.ID)
			}
			continue // Content-addressed artifact already exists and is reusable.
		}
		add(PortableApplicationOperation{
			ID: "materialize-" + artifact.ID, Kind: "materialize-artifact",
			Partition: artifact.Partition, TargetPath: artifact.TargetPath,
			ArtifactID: artifact.ID, SHA256: artifact.SHA256, SizeBytes: artifact.SizeBytes,
			ReadbackRequired: true,
		})
	}
	add(PortableApplicationOperation{ID: "flush-release", Kind: "flush-and-sync"})
	for _, artifact := range candidate.Artifacts {
		if !portableReleaseArtifacts[artifact.ID] {
			continue
		}
		add(PortableApplicationOperation{
			ID: "readback-" + artifact.ID, Kind: "readback-sha256-size",
			Partition: artifact.Partition, TargetPath: artifact.TargetPath,
			ArtifactID: artifact.ID, SHA256: artifact.SHA256,
			SizeBytes: artifact.SizeBytes, ReadbackRequired: true,
		})
	}
	add(PortableApplicationOperation{
		ID: "verify-preserved-layout", Kind: "verify-gpt-filesystem-labels-and-capacity",
		ReadbackRequired: true,
	})
	return PortableUpdatePlan{
		Schema: PortableUpdatePlanSchema, Status: "planned-not-authorized",
		Profile: next.Profile, FromSourceCommit: installed.SourceCommit,
		ToSourceCommit: candidate.SourceCommit, TargetBytes: next.TargetBytes,
		Partitions: next.Partitions, Operations: operations,
		RequiresSignedRelease: true, RequiresPostbootHealth: true,
	}, nil
}
