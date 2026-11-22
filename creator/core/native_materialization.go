package creatorcore

const (
	nativeESPTypeGUID  = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b"
	nativeLUKSTypeGUID = "ca7d7ccb-63ed-4c53-861c-1742536059cc"
)

// NativePartitionMaterialization describes bytes that a future installer must
// create. It is policy only: it carries no file descriptor or mutation grant.
type NativePartitionMaterialization struct {
	Index           int    `json:"index"`
	Name            string `json:"name"`
	Role            string `json:"role"`
	TypeGUID        string `json:"type_guid"`
	StartLBA        uint64 `json:"start_lba"`
	LastLBA         uint64 `json:"last_lba"`
	SizeBytes       uint64 `json:"size_bytes"`
	Filesystem      string `json:"filesystem"`
	FilesystemLabel string `json:"filesystem_label"`
	Encryption      string `json:"encryption,omitempty"`
}

type NativeSubvolumeMaterialization struct {
	Name    string `json:"name"`
	Mount   string `json:"mount"`
	Purpose string `json:"purpose"`
}

// NativeMaterializationPlan is the exact non-destructive storage recipe used by
// disposable proofs and, later, by a separately authorized physical adapter.
type NativeMaterializationPlan struct {
	Schema             string `json:"schema"`
	Status             string `json:"status"`
	PartitionTable     string `json:"partition_table"`
	LogicalSectorBytes uint64 `json:"logical_sector_bytes"`
	AlignmentBytes     uint64 `json:"alignment_bytes"`
	TargetBytes        uint64 `json:"target_bytes"`

	SourceProductMode     string `json:"source_product_mode"`
	TargetProductMode                 string `json:"target_product_mode"`
	TargetProductModePath             string `json:"target_product_mode_path"`
	TargetProductModePoolRelativePath string `json:"target_product_mode_pool_relative_path"`

	Partitions []NativePartitionMaterialization `json:"partitions"`
	Subvolumes []NativeSubvolumeMaterialization `json:"subvolumes"`

	SignedReleaseRequired bool   `json:"signed_release_required"`
	BootIntegrationStatus string `json:"boot_integration_status"`
	DisposableProofOnly   bool   `json:"disposable_proof_only"`
	PhysicalWriteAllowed  bool   `json:"physical_write_allowed"`
}

// PlanNativeMaterialization converts canonical Native geometry into one exact
// storage recipe without touching the target. Durable boot integration for the
// LUKS2/Btrfs pool remains a separate gate and is stated honestly in the plan.
func PlanNativeMaterialization(targetBytes uint64) (NativeMaterializationPlan, error) {
	install, err := PlanNativeInstallation(targetBytes)
	if err != nil {
		return NativeMaterializationPlan{}, err
	}
	storage := install.Storage
	return NativeMaterializationPlan{
		Schema:                "prototype-ordax.native-materialization-plan/1",
		Status:                "plan-only",
		PartitionTable:        "gpt",
		LogicalSectorBytes:    storageSectorBytes,
		AlignmentBytes:        storageAlignmentBytes,
		TargetBytes:           storage.TargetBytes,
		SourceProductMode:                 install.SourceProductMode,
		TargetProductMode:                 install.TargetProductMode,
		TargetProductModePath:             install.TargetProductModePath,
		TargetProductModePoolRelativePath: "bootstrap/config/product-mode",
		Partitions: []NativePartitionMaterialization{
			{
				Index:           1,
				Name:            "ORDAX-ESP",
				Role:            "uefi-boot-and-minimal-recovery",
				TypeGUID:        nativeESPTypeGUID,
				StartLBA:        storage.ESPStartLBA,
				LastLBA:         storage.ESPLastLBA,
				SizeBytes:       storage.ESPBytes,
				Filesystem:      "fat32",
				FilesystemLabel: "ORDAX-ESP",
			},
			{
				Index:           2,
				Name:            "ORDAX-POOL",
				Role:            "shared-system-state-app-and-user-capacity",
				TypeGUID:        nativeLUKSTypeGUID,
				StartLBA:        storage.PayloadStartLBA,
				LastLBA:         storage.PayloadLastLBA,
				SizeBytes:       storage.PayloadBytes,
				Filesystem:      "btrfs",
				FilesystemLabel: "ORDAX-POOL",
				Encryption:      "luks2",
			},
		},
		Subvolumes: []NativeSubvolumeMaterialization{
			{Name: "ordax-state", Mount: "/var", Purpose: "persistent-machine-and-application-state"},
			{Name: "ordax-home", Mount: "/var/home", Purpose: "user-files-and-user-state"},
			{Name: "ordax-apps", Mount: "/var/lib/ordax/apps", Purpose: "application-payloads-and-managed-app-state"},
			{Name: "ordax-containers", Mount: "/var/lib/containers", Purpose: "optional-container-storage"},
			{Name: "ordax-snapshots", Mount: "/.ordax-snapshots", Purpose: "bounded-recovery-snapshots-and-maintenance"},
		},
		SignedReleaseRequired: true,
		BootIntegrationStatus: "pending-native-luks2-btrfs-bootstrap",
		DisposableProofOnly:   true,
		PhysicalWriteAllowed:  false,
	}, nil
}
