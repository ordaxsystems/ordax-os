package creatorcore

// NativeInstallationPlan is a pure, non-destructive description of the first
// Native MVP installation target. It contains no device handle and grants no
// permission to write a disk.
type NativeInstallationPlan struct {
	Schema string `json:"schema"`
	Status string `json:"status"`

	SourceProductMode      string `json:"source_product_mode"`
	TargetProductMode      string `json:"target_product_mode"`
	TargetProductModePath  string `json:"target_product_mode_path"`

	Storage TargetStorageProfile `json:"storage"`

	WholeDiskInstall             bool `json:"whole_disk_install"`
	ExistingTargetDataErased     bool `json:"existing_target_data_erased"`
	ExplicitTargetRequired       bool `json:"explicit_target_required"`
	ExplicitConfirmationRequired bool `json:"explicit_confirmation_required"`
	SourceBootMediaMustDiffer    bool `json:"source_boot_media_must_differ"`
	InstallAlongsideSupported    bool `json:"install_alongside_supported"`
	AutomaticPartitionShrink     bool `json:"automatic_partition_shrink"`

	PoolEncryption string `json:"pool_encryption"`
	PoolFilesystem string `json:"pool_filesystem"`

	PhysicalDeviceTouched bool `json:"physical_device_touched"`
	PhysicalApplyAllowed  bool `json:"physical_apply_allowed"`
}

// PlanNativeInstallation validates the target capacity against the canonical
// Native storage profile and returns a fail-closed plan. Destructive target
// identity binding and physical APPLY belong to later gates.
func PlanNativeInstallation(targetBytes uint64) (NativeInstallationPlan, error) {
	storage, err := PlanNativeDiskTargetStorage(targetBytes)
	if err != nil {
		return NativeInstallationPlan{}, err
	}
	return NativeInstallationPlan{
		Schema:                       "prototype-ordax.native-install-plan/1",
		Status:                       "plan-only",
		SourceProductMode:            "usb",
		TargetProductMode:            "native-disk",
		TargetProductModePath:        "/ordax/bootstrap/config/product-mode",
		Storage:                      storage,
		WholeDiskInstall:             true,
		ExistingTargetDataErased:     true,
		ExplicitTargetRequired:       true,
		ExplicitConfirmationRequired: true,
		SourceBootMediaMustDiffer:    true,
		InstallAlongsideSupported:    false,
		AutomaticPartitionShrink:     false,
		PoolEncryption:               "luks2",
		PoolFilesystem:               "btrfs",
		PhysicalDeviceTouched:        false,
		PhysicalApplyAllowed:         false,
	}, nil
}
