package creatorcore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

// PortableApplicationExecutionGrant is intentionally separate from the
// host-neutral application plan. The plan itself must remain
// planned-not-authorized; a destructive host boundary may execute it only after
// binding an explicit grant to the exact canonical plan bytes.
type PortableApplicationExecutionGrant struct {
	ApplicationPlanSHA256 string `json:"application_plan_sha256"`
	PhysicalWriteAuthorized bool `json:"physical_write_authorized"`
}

// PortableApplicationSource binds one transport source to the integrity
// identity already present in the canonical application plan. The runtime owns
// opening/streaming bytes; Core owns exact identity and operation ordering.
type PortableApplicationSource struct {
	ArtifactID string `json:"artifact_id"`
	SHA256 string `json:"sha256"`
	SizeBytes uint64 `json:"size_bytes"`
}

// PortableApplicationRuntime is the only host-specific boundary needed to
// execute the canonical 39-operation plan. Implementations must not replan
// geometry, target paths, artifact order, digests, or sizes.
type PortableApplicationRuntime interface {
	WriteGPT(partitions []PortableApplicationPartition, targetBytes uint64) error
	Format(partition PortableApplicationPartition) error
	Materialize(operation PortableApplicationOperation, source PortableApplicationSource) error
	Flush() error
	Readback(operation PortableApplicationOperation) error
	VerifyLayout(partitions []PortableApplicationPartition, targetBytes uint64) error
}

// PortableApplicationExecutionReceipt contains policy evidence only. It does
// not identify or authorize a physical target on its own.
type PortableApplicationExecutionReceipt struct {
	Schema string `json:"$schema"`
	Status string `json:"status"`
	Profile string `json:"profile"`
	SourceCommit string `json:"source_commit"`
	ApplicationPlanSHA256 string `json:"application_plan_sha256"`
	OperationCount int `json:"operation_count"`
	MaterializedArtifacts int `json:"materialized_artifacts"`
	ReadbackArtifacts int `json:"readback_artifacts"`
	WholeDiskRawImageUsed bool `json:"whole_disk_raw_image_used"`
}

const PortableApplicationExecutionReceiptSchema = "prototype-ordax.portable-application-execution-receipt/1"

// PortableApplicationPlanCanonicalBytes defines the one byte representation
// used both for the emitted portable-application-plan.json and for destructive
// authorization. It intentionally matches json.Encoder with SetIndent("", "  ")
// followed by Encode, including the final LF byte.
func PortableApplicationPlanCanonicalBytes(plan PortableApplicationPlan) ([]byte, error) {
	payload, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode canonical portable application plan: %w", err)
	}
	return append(payload, '\n'), nil
}

func PortableApplicationPlanSHA256(plan PortableApplicationPlan) (string, error) {
	payload, err := PortableApplicationPlanCanonicalBytes(plan)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:]), nil
}

func validatePortableApplicationPlanForExecution(plan PortableApplicationPlan) error {
	if plan.Schema != PortableApplicationPlanSchema ||
		plan.Status != "planned-not-authorized" ||
		plan.Profile != "portable-usb" ||
		!validPortableSourceCommit(plan.SourceCommit) ||
		!validPortableMediaSHA256(plan.MediaPlanSHA256) {
		return errors.New("portable application execution plan identity is invalid")
	}
	if plan.TargetBytes == 0 ||
		plan.WholeDiskRawImageNeeded ||
		plan.PhysicalDeviceBound ||
		plan.PhysicalWriteAuthorized ||
		plan.PublicPromotionAllowed {
		return errors.New("portable application execution plan crossed its non-authorizing boundary")
	}

	layout, err := PlanPortableTargetStorage(plan.TargetBytes)
	if err != nil {
		return fmt.Errorf("revalidate portable target geometry: %w", err)
	}
	if len(plan.Partitions) != 2 {
		return errors.New("portable application execution requires exactly two partitions")
	}
	expectedPartitions := []PortableApplicationPartition{
		{Index: 1, Name: "ORDAX-ESP", Filesystem: "fat32", StartLBA: layout.ESPStartLBA, LastLBA: layout.ESPLastLBA},
		{Index: 2, Name: "ORDAX-DATA", Filesystem: "exfat", StartLBA: layout.PayloadStartLBA, LastLBA: layout.PayloadLastLBA},
	}
	for i := range expectedPartitions {
		if plan.Partitions[i] != expectedPartitions[i] {
			return fmt.Errorf("portable application partition %d differs from Core policy", i+1)
		}
	}

	const artifactCount = 17
	if len(plan.Operations) != 3+artifactCount+1+artifactCount+1 {
		return fmt.Errorf("portable application execution requires 39 operations; got=%d", len(plan.Operations))
	}
	expectedPrefix := []struct {
		kind string
		partition string
	}{
		{"partition-table-gpt-two-partition", ""},
		{"format-fat32", "ORDAX-ESP"},
		{"format-exfat", "ORDAX-DATA"},
	}
	for i, expected := range expectedPrefix {
		op := plan.Operations[i]
		if op.Sequence != i+1 || op.Kind != expected.kind || op.Partition != expected.partition ||
			!op.DestructiveClass || !op.ReadbackRequired {
			return fmt.Errorf("portable application destructive prefix operation %d is invalid", i+1)
		}
	}

	materialized := map[string]PortableApplicationOperation{}
	for i := 3; i < 3+artifactCount; i++ {
		op := plan.Operations[i]
		if op.Sequence != i+1 ||
			op.Kind != "materialize-artifact" ||
			!op.DestructiveClass ||
			!op.ReadbackRequired ||
			op.ArtifactID == "" ||
			op.Partition == "" ||
			op.TargetPath == "" ||
			!validPortableMediaSHA256(op.SHA256) ||
			op.SizeBytes == 0 ||
			op.SizeBytes > portableMediaMaxArtifact {
			return fmt.Errorf("portable application materialize operation %d is invalid", i+1)
		}
		if _, exists := materialized[op.ArtifactID]; exists {
			return fmt.Errorf("portable application contains duplicate artifact %q", op.ArtifactID)
		}
		materialized[op.ArtifactID] = op
	}

	flushIndex := 3 + artifactCount
	flush := plan.Operations[flushIndex]
	if flush.Sequence != flushIndex+1 ||
		flush.Kind != "flush-and-sync" ||
		flush.DestructiveClass ||
		flush.ReadbackRequired {
		return errors.New("portable application flush operation is invalid")
	}

	readbacks := map[string]PortableApplicationOperation{}
	for i := flushIndex + 1; i < flushIndex+1+artifactCount; i++ {
		op := plan.Operations[i]
		if op.Sequence != i+1 ||
			op.Kind != "readback-sha256-size" ||
			op.DestructiveClass ||
			!op.ReadbackRequired {
			return fmt.Errorf("portable application readback operation %d is invalid", i+1)
		}
		source, ok := materialized[op.ArtifactID]
		if !ok ||
			op.Partition != source.Partition ||
			op.TargetPath != source.TargetPath ||
			op.SHA256 != source.SHA256 ||
			op.SizeBytes != source.SizeBytes {
			return fmt.Errorf("portable application readback for %q is not bound to materialization", op.ArtifactID)
		}
		if _, exists := readbacks[op.ArtifactID]; exists {
			return fmt.Errorf("portable application contains duplicate readback %q", op.ArtifactID)
		}
		readbacks[op.ArtifactID] = op
	}
	if len(materialized) != artifactCount || len(readbacks) != artifactCount {
		return errors.New("portable application does not bind exactly 17 artifact materializations and readbacks")
	}

	finalIndex := len(plan.Operations) - 1
	final := plan.Operations[finalIndex]
	if final.Sequence != finalIndex+1 ||
		final.Kind != "verify-gpt-filesystem-labels-and-capacity" ||
		final.DestructiveClass ||
		!final.ReadbackRequired {
		return errors.New("portable application final layout verification is invalid")
	}
	return nil
}

func sourceMapForPortableExecution(plan PortableApplicationPlan, sources []PortableApplicationSource) (map[string]PortableApplicationSource, error) {
	if len(sources) != 17 {
		return nil, fmt.Errorf("portable application execution requires exactly 17 sources; got=%d", len(sources))
	}
	expected := map[string]PortableApplicationOperation{}
	for _, op := range plan.Operations {
		if op.Kind == "materialize-artifact" {
			expected[op.ArtifactID] = op
		}
	}
	result := make(map[string]PortableApplicationSource, len(sources))
	for _, source := range sources {
		if source.ArtifactID == "" || !validPortableMediaSHA256(source.SHA256) ||
			source.SizeBytes == 0 || source.SizeBytes > portableMediaMaxArtifact {
			return nil, fmt.Errorf("portable application source %q has invalid identity", source.ArtifactID)
		}
		if _, exists := result[source.ArtifactID]; exists {
			return nil, fmt.Errorf("duplicate portable application source %q", source.ArtifactID)
		}
		op, ok := expected[source.ArtifactID]
		if !ok || source.SHA256 != op.SHA256 || source.SizeBytes != op.SizeBytes {
			return nil, fmt.Errorf("portable application source %q differs from canonical plan", source.ArtifactID)
		}
		result[source.ArtifactID] = source
	}
	if len(result) != len(expected) {
		return nil, errors.New("portable application execution source set is incomplete")
	}
	return result, nil
}

func ExecutePortableApplication(
	plan PortableApplicationPlan,
	sources []PortableApplicationSource,
	grant PortableApplicationExecutionGrant,
	runtime PortableApplicationRuntime,
) (PortableApplicationExecutionReceipt, error) {
	if runtime == nil {
		return PortableApplicationExecutionReceipt{}, errors.New("portable application runtime is required")
	}
	if err := validatePortableApplicationPlanForExecution(plan); err != nil {
		return PortableApplicationExecutionReceipt{}, err
	}
	planSHA, err := PortableApplicationPlanSHA256(plan)
	if err != nil {
		return PortableApplicationExecutionReceipt{}, err
	}
	if !grant.PhysicalWriteAuthorized ||
		grant.ApplicationPlanSHA256 != planSHA ||
		!validPortableMediaSHA256(grant.ApplicationPlanSHA256) {
		return PortableApplicationExecutionReceipt{}, errors.New("portable application execution grant does not authorize the exact plan")
	}
	sourceByID, err := sourceMapForPortableExecution(plan, sources)
	if err != nil {
		return PortableApplicationExecutionReceipt{}, err
	}

	materialized := 0
	readbacks := 0
	for _, op := range plan.Operations {
		switch op.Kind {
		case "partition-table-gpt-two-partition":
			if err := runtime.WriteGPT(plan.Partitions, plan.TargetBytes); err != nil {
				return PortableApplicationExecutionReceipt{}, fmt.Errorf("execute %s: %w", op.ID, err)
			}
		case "format-fat32", "format-exfat":
			var partition PortableApplicationPartition
			found := false
			for _, candidate := range plan.Partitions {
				if candidate.Name == op.Partition {
					partition = candidate
					found = true
					break
				}
			}
			if !found {
				return PortableApplicationExecutionReceipt{}, fmt.Errorf("execute %s: partition %q is missing", op.ID, op.Partition)
			}
			if err := runtime.Format(partition); err != nil {
				return PortableApplicationExecutionReceipt{}, fmt.Errorf("execute %s: %w", op.ID, err)
			}
		case "materialize-artifact":
			if err := runtime.Materialize(op, sourceByID[op.ArtifactID]); err != nil {
				return PortableApplicationExecutionReceipt{}, fmt.Errorf("execute %s: %w", op.ID, err)
			}
			materialized++
		case "flush-and-sync":
			if err := runtime.Flush(); err != nil {
				return PortableApplicationExecutionReceipt{}, fmt.Errorf("execute %s: %w", op.ID, err)
			}
		case "readback-sha256-size":
			if err := runtime.Readback(op); err != nil {
				return PortableApplicationExecutionReceipt{}, fmt.Errorf("execute %s: %w", op.ID, err)
			}
			readbacks++
		case "verify-gpt-filesystem-labels-and-capacity":
			if err := runtime.VerifyLayout(plan.Partitions, plan.TargetBytes); err != nil {
				return PortableApplicationExecutionReceipt{}, fmt.Errorf("execute %s: %w", op.ID, err)
			}
		default:
			return PortableApplicationExecutionReceipt{}, fmt.Errorf("unsupported portable application operation %q", op.Kind)
		}
	}

	return PortableApplicationExecutionReceipt{
		Schema: PortableApplicationExecutionReceiptSchema,
		Status: "pass",
		Profile: plan.Profile,
		SourceCommit: plan.SourceCommit,
		ApplicationPlanSHA256: planSHA,
		OperationCount: len(plan.Operations),
		MaterializedArtifacts: materialized,
		ReadbackArtifacts: readbacks,
		WholeDiskRawImageUsed: false,
	}, nil
}
