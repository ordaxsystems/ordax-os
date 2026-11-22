package creatorcore

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"crypto/sha256"
)

const (
	PortableMediaBindingsSchema = "prototype-ordax.portable-media-bindings/1"
	PortableMediaPlanSchema = "prototype-ordax.portable-media-plan/1"
	PortableApplicationPlanSchema = "prototype-ordax.portable-application-plan/1"
	portableMediaMaxArtifact = uint64(16 << 30)
	// Reserved headroom for FAT32/exFAT filesystem structures, cluster rounding,
	// directory metadata and capacity variations. This is only an early
	// conservative rejection gate; real formatted capacity is checked on-device.
	portableMediaESPReserveBytes = uint64(32 << 20)
	portableMediaDataMinReserveBytes = uint64(128 << 20)
	portableMediaDataReserveDivisor = uint64(50) // 2% for large media
)

type PortableMediaArtifactBinding struct {
	ID string `json:"id"`
	SHA256 string `json:"sha256"`
	SizeBytes uint64 `json:"size_bytes"`
}

type PortableMediaBindings struct {
	Schema string `json:"$schema"`
	Artifacts []PortableMediaArtifactBinding `json:"artifacts"`
}

type PortableMediaArtifactPlan struct {
	ID string `json:"id"`
	Partition string `json:"partition"`
	TargetPath string `json:"target_path"`
	SHA256 string `json:"sha256"`
	SizeBytes uint64 `json:"size_bytes"`
}

type PortableMediaPlan struct {
	Schema string `json:"$schema"`
	Profile string `json:"profile"`
	SourceCommit string `json:"source_commit"`
	TargetBytes uint64 `json:"target_bytes"`
	ESPStartLBA uint64 `json:"esp_start_lba"`
	ESPLastLBA uint64 `json:"esp_last_lba"`
	DataStartLBA uint64 `json:"data_start_lba"`
	DataLastLBA uint64 `json:"data_last_lba"`
	Artifacts []PortableMediaArtifactPlan `json:"artifacts"`
	PhysicalWriteAuthorized bool `json:"physical_write_authorized"`
}


type PortableApplicationPartition struct {
	Index      int    `json:"index"`
	Name       string `json:"name"`
	Filesystem string `json:"filesystem"`
	StartLBA   uint64 `json:"start_lba"`
	LastLBA    uint64 `json:"last_lba"`
}

type PortableApplicationOperation struct {
	Sequence         int    `json:"sequence"`
	ID               string `json:"id"`
	Kind             string `json:"kind"`
	Partition        string `json:"partition,omitempty"`
	TargetPath       string `json:"target_path,omitempty"`
	ArtifactID       string `json:"artifact_id,omitempty"`
	SHA256           string `json:"sha256,omitempty"`
	SizeBytes        uint64 `json:"size_bytes,omitempty"`
	DestructiveClass bool   `json:"destructive_class"`
	ReadbackRequired bool   `json:"readback_required"`
}

type PortableApplicationPlan struct {
	Schema                  string                         `json:"$schema"`
	Status                  string                         `json:"status"`
	Profile                 string                         `json:"profile"`
	SourceCommit            string                         `json:"source_commit"`
	TargetBytes             uint64                         `json:"target_bytes"`
	MediaPlanSHA256         string                         `json:"media_plan_sha256"`
	Partitions              []PortableApplicationPartition `json:"partitions"`
	Operations              []PortableApplicationOperation `json:"operations"`
	WholeDiskRawImageNeeded bool                           `json:"whole_disk_raw_image_required"`
	PhysicalDeviceBound     bool                           `json:"physical_device_bound"`
	PhysicalWriteAuthorized bool                           `json:"physical_write_authorized"`
	PublicPromotionAllowed  bool                           `json:"public_promotion_allowed"`
}

type portableMediaTarget struct {
	partition string
	target func(string, string) string
}

var portableMediaTargets = map[string]portableMediaTarget{
	"systemd-boot": {"ORDAX-ESP", func(string, string) string { return "/EFI/BOOT/BOOTX64.EFI" }},
	"loader-config": {"ORDAX-ESP", func(string, string) string { return "/loader/loader.conf" }},
	"loader-normal": {"ORDAX-ESP", func(string, string) string { return "/loader/entries/ordax-portable.conf" }},
	"loader-recovery": {"ORDAX-ESP", func(string, string) string { return "/loader/entries/ordax-portable-recovery.conf" }},
	"kernel": {"ORDAX-ESP", func(string, string) string { return "/ordax/vmlinuz" }},
	"initramfs": {"ORDAX-ESP", func(string, string) string { return "/ordax/initrd.gz" }},
	"bootstrap-capsule": {"ORDAX-ESP", func(string, string) string { return "/ordax/bootstrap/bootstrap.erofs" }},
	"release-trust": {"ORDAX-ESP", func(string, string) string { return "/ordax/bootstrap/trust/release-ed25519.json" }},
	"stable-base": {"ORDAX-DATA", func(string, string) string { return "/.ordax/base/stable-base.erofs" }},
	"persistent-state": {"ORDAX-DATA", func(string, string) string { return "/.ordax/state/persistent-state.img" }},
	"system-image": {"ORDAX-DATA", func(commit, _ string) string { return "/.ordax/releases/" + commit + "/system.erofs" }},
	"surface-runtime-image": {"ORDAX-DATA", func(_, digest string) string { return "/.ordax/runtimes/sha256/" + digest + "/native-surface-runtime.erofs" }},
	"surface-runtime-ref": {"ORDAX-DATA", func(commit, _ string) string { return "/.ordax/releases/" + commit + "/surface-runtime.sha256" }},
	"local-ai-runtime-image": {"ORDAX-DATA", func(_, digest string) string { return "/.ordax/ai-runtimes/sha256/" + digest + "/local-ai-runtime.erofs" }},
	"local-ai-runtime-ref": {"ORDAX-DATA", func(commit, _ string) string { return "/.ordax/releases/" + commit + "/local-ai-runtime.sha256" }},
	"release-manifest": {"ORDAX-DATA", func(commit, _ string) string { return "/.ordax/releases/" + commit + "/release-manifest.json" }},
	"release-envelope": {"ORDAX-DATA", func(commit, _ string) string { return "/.ordax/releases/" + commit + "/release-envelope.json" }},
}

func ParsePortableMediaBindings(data []byte) (PortableMediaBindings, error) {
	var value PortableMediaBindings
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return PortableMediaBindings{}, fmt.Errorf("decode portable media bindings: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return PortableMediaBindings{}, errors.New("decode portable media bindings: trailing JSON value")
		}
		return PortableMediaBindings{}, fmt.Errorf("decode portable media bindings trailing content: %w", err)
	}
	if value.Schema != PortableMediaBindingsSchema {
		return PortableMediaBindings{}, fmt.Errorf("unsupported portable media bindings schema %q", value.Schema)
	}
	return value, nil
}

func ParsePortableMediaPlan(data []byte) (PortableMediaPlan, error) {
	var value PortableMediaPlan
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return PortableMediaPlan{}, fmt.Errorf("decode portable media plan: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return PortableMediaPlan{}, errors.New("decode portable media plan: trailing JSON value")
		}
		return PortableMediaPlan{}, fmt.Errorf("decode portable media plan trailing content: %w", err)
	}
	return value, nil
}

func validPortableMediaSHA256(value string) bool {
	if len(value) != 64 || value != strings.ToLower(value) { return false }
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32
}

func validPortableSourceCommit(value string) bool {
	if len(value) != 40 || value != strings.ToLower(value) { return false }
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 20
}

// validatePortableArtifactCapacity rejects an oversized complete payload before
// formatting a device. Every caller uses the same target geometry and reserve
// policy; neither a JSON media plan nor an application plan may bypass it.
func validatePortableArtifactCapacity(layout TargetStorageProfile, artifacts []PortableMediaArtifactPlan) error {
	dataReserve := layout.PayloadBytes / portableMediaDataReserveDivisor
	if dataReserve < portableMediaDataMinReserveBytes {
		dataReserve = portableMediaDataMinReserveBytes
	}
	if layout.ESPBytes <= portableMediaESPReserveBytes || layout.PayloadBytes <= dataReserve {
		return errors.New("portable target has insufficient usable filesystem capacity")
	}
	budgets := map[string]uint64{
		"ORDAX-ESP": layout.ESPBytes - portableMediaESPReserveBytes,
		"ORDAX-DATA": layout.PayloadBytes - dataReserve,
	}
	used := map[string]uint64{}
	for _, artifact := range artifacts {
		budget, ok := budgets[artifact.Partition]
		if !ok {
			return fmt.Errorf("unknown portable capacity partition %q", artifact.Partition)
		}
		if artifact.SizeBytes == 0 || artifact.SizeBytes > budget-used[artifact.Partition] {
			return fmt.Errorf("portable payload exceeds reserved capacity of %s (artifact %q)", artifact.Partition, artifact.ID)
		}
		used[artifact.Partition] += artifact.SizeBytes
	}
	return nil
}

func PlanPortableMedia(targetBytes uint64, sourceCommit string, bindings PortableMediaBindings) (PortableMediaPlan, error) {
	if !validPortableSourceCommit(sourceCommit) {
		return PortableMediaPlan{}, errors.New("portable source commit must be lowercase 40-hex")
	}
	if bindings.Schema != PortableMediaBindingsSchema {
		return PortableMediaPlan{}, errors.New("portable media bindings schema is not canonical")
	}
	layout, err := PlanPortableTargetStorage(targetBytes)
	if err != nil { return PortableMediaPlan{}, err }
	if len(bindings.Artifacts) != len(portableMediaTargets) {
		return PortableMediaPlan{}, fmt.Errorf("portable media requires exactly %d artifact bindings; got=%d", len(portableMediaTargets), len(bindings.Artifacts))
	}
	seen := map[string]bool{}
	artifacts := make([]PortableMediaArtifactPlan, 0, len(bindings.Artifacts))
	for _, binding := range bindings.Artifacts {
		target, ok := portableMediaTargets[binding.ID]
		if !ok { return PortableMediaPlan{}, fmt.Errorf("unknown portable media artifact id %q", binding.ID) }
		if seen[binding.ID] { return PortableMediaPlan{}, fmt.Errorf("duplicate portable media artifact id %q", binding.ID) }
		seen[binding.ID] = true
		if !validPortableMediaSHA256(binding.SHA256) { return PortableMediaPlan{}, fmt.Errorf("portable media artifact %q has invalid SHA-256", binding.ID) }
		if binding.SizeBytes == 0 || binding.SizeBytes > portableMediaMaxArtifact { return PortableMediaPlan{}, fmt.Errorf("portable media artifact %q size is outside allowed range", binding.ID) }
		artifacts = append(artifacts, PortableMediaArtifactPlan{ID: binding.ID, Partition: target.partition, TargetPath: target.target(sourceCommit, binding.SHA256), SHA256: binding.SHA256, SizeBytes: binding.SizeBytes})
	}
	for id := range portableMediaTargets { if !seen[id] { return PortableMediaPlan{}, fmt.Errorf("missing portable media artifact id %q", id) } }
	if err := validatePortableArtifactCapacity(layout, artifacts); err != nil { return PortableMediaPlan{}, err }
	sort.Slice(artifacts, func(i, j int) bool {
		if artifacts[i].Partition == artifacts[j].Partition {
			if artifacts[i].TargetPath == artifacts[j].TargetPath { return artifacts[i].ID < artifacts[j].ID }
			return artifacts[i].TargetPath < artifacts[j].TargetPath
		}
		return artifacts[i].Partition < artifacts[j].Partition
	})
	return PortableMediaPlan{
		Schema: PortableMediaPlanSchema, Profile: layout.Profile, SourceCommit: sourceCommit, TargetBytes: targetBytes,
		ESPStartLBA: layout.ESPStartLBA, ESPLastLBA: layout.ESPLastLBA, DataStartLBA: layout.PayloadStartLBA, DataLastLBA: layout.PayloadLastLBA,
		Artifacts: artifacts, PhysicalWriteAuthorized: false,
	}, nil
}


func validatePortableMediaPlanForApplication(plan PortableMediaPlan) (TargetStorageProfile, error) {
	if plan.Schema != PortableMediaPlanSchema {
		return TargetStorageProfile{}, errors.New("portable application requires the canonical portable media plan schema")
	}
	if plan.Profile != "portable-usb" || !validPortableSourceCommit(plan.SourceCommit) {
		return TargetStorageProfile{}, errors.New("portable application plan identity is invalid")
	}
	if plan.PhysicalWriteAuthorized {
		return TargetStorageProfile{}, errors.New("portable media policy plan must not authorize physical write")
	}
	layout, err := PlanPortableTargetStorage(plan.TargetBytes)
	if err != nil {
		return TargetStorageProfile{}, err
	}
	if plan.ESPStartLBA != layout.ESPStartLBA ||
		plan.ESPLastLBA != layout.ESPLastLBA ||
		plan.DataStartLBA != layout.PayloadStartLBA ||
		plan.DataLastLBA != layout.PayloadLastLBA {
		return TargetStorageProfile{}, errors.New("portable media plan geometry differs from Creator Core storage policy")
	}
	if len(plan.Artifacts) != len(portableMediaTargets) {
		return TargetStorageProfile{}, fmt.Errorf("portable application requires exactly %d artifacts", len(portableMediaTargets))
	}
	seen := map[string]bool{}
	seenTargets := map[string]bool{}
	for _, artifact := range plan.Artifacts {
		target, ok := portableMediaTargets[artifact.ID]
		if !ok || seen[artifact.ID] {
			return TargetStorageProfile{}, fmt.Errorf("portable application artifact identity is invalid: %q", artifact.ID)
		}
		seen[artifact.ID] = true
		expectedPath := target.target(plan.SourceCommit, artifact.SHA256)
		if artifact.Partition != target.partition || artifact.TargetPath != expectedPath {
			return TargetStorageProfile{}, fmt.Errorf("portable application artifact %q destination differs from Core policy", artifact.ID)
		}
		key := artifact.Partition + ":" + artifact.TargetPath
		if seenTargets[key] {
			return TargetStorageProfile{}, errors.New("portable application contains duplicate target destination")
		}
		seenTargets[key] = true
		if !validPortableMediaSHA256(artifact.SHA256) ||
			artifact.SizeBytes == 0 ||
			artifact.SizeBytes > portableMediaMaxArtifact {
			return TargetStorageProfile{}, fmt.Errorf("portable application artifact %q integrity binding is invalid", artifact.ID)
		}
	}
	for id := range portableMediaTargets {
		if !seen[id] {
			return TargetStorageProfile{}, fmt.Errorf("portable application is missing artifact %q", id)
		}
	}
	if err := validatePortableArtifactCapacity(layout, plan.Artifacts); err != nil { return TargetStorageProfile{}, err }
	return layout, nil
}

func PlanPortableApplication(plan PortableMediaPlan) (PortableApplicationPlan, error) {
	layout, err := validatePortableMediaPlanForApplication(plan)
	if err != nil {
		return PortableApplicationPlan{}, err
	}
	canonical, err := json.Marshal(plan)
	if err != nil {
		return PortableApplicationPlan{}, fmt.Errorf("encode portable media plan identity: %w", err)
	}
	digest := sha256.Sum256(canonical)

	operations := make([]PortableApplicationOperation, 0, 3+len(plan.Artifacts)*2+2)
	add := func(operation PortableApplicationOperation) {
		operation.Sequence = len(operations) + 1
		operations = append(operations, operation)
	}
	add(PortableApplicationOperation{
		ID: "write-gpt", Kind: "partition-table-gpt-two-partition",
		DestructiveClass: true, ReadbackRequired: true,
	})
	add(PortableApplicationOperation{
		ID: "format-esp", Kind: "format-fat32", Partition: "ORDAX-ESP",
		DestructiveClass: true, ReadbackRequired: true,
	})
	add(PortableApplicationOperation{
		ID: "format-data", Kind: "format-exfat", Partition: "ORDAX-DATA",
		DestructiveClass: true, ReadbackRequired: true,
	})
	for _, artifact := range plan.Artifacts {
		add(PortableApplicationOperation{
			ID: "materialize-" + artifact.ID,
			Kind: "materialize-artifact",
			Partition: artifact.Partition,
			TargetPath: artifact.TargetPath,
			ArtifactID: artifact.ID,
			SHA256: artifact.SHA256,
			SizeBytes: artifact.SizeBytes,
			DestructiveClass: true,
			ReadbackRequired: true,
		})
	}
	add(PortableApplicationOperation{
		ID: "flush-filesystems", Kind: "flush-and-sync",
		DestructiveClass: false, ReadbackRequired: false,
	})
	for _, artifact := range plan.Artifacts {
		add(PortableApplicationOperation{
			ID: "readback-" + artifact.ID,
			Kind: "readback-sha256-size",
			Partition: artifact.Partition,
			TargetPath: artifact.TargetPath,
			ArtifactID: artifact.ID,
			SHA256: artifact.SHA256,
			SizeBytes: artifact.SizeBytes,
			DestructiveClass: false,
			ReadbackRequired: true,
		})
	}
	add(PortableApplicationOperation{
		ID: "verify-filesystems", Kind: "verify-gpt-filesystem-labels-and-capacity",
		DestructiveClass: false, ReadbackRequired: true,
	})

	return PortableApplicationPlan{
		Schema: PortableApplicationPlanSchema,
		Status: "planned-not-authorized",
		Profile: plan.Profile,
		SourceCommit: plan.SourceCommit,
		TargetBytes: plan.TargetBytes,
		MediaPlanSHA256: hex.EncodeToString(digest[:]),
		Partitions: []PortableApplicationPartition{
			{Index: 1, Name: "ORDAX-ESP", Filesystem: "fat32", StartLBA: layout.ESPStartLBA, LastLBA: layout.ESPLastLBA},
			{Index: 2, Name: "ORDAX-DATA", Filesystem: "exfat", StartLBA: layout.PayloadStartLBA, LastLBA: layout.PayloadLastLBA},
		},
		Operations: operations,
		WholeDiskRawImageNeeded: false,
		PhysicalDeviceBound: false,
		PhysicalWriteAuthorized: false,
		PublicPromotionAllowed: false,
	}, nil
}
