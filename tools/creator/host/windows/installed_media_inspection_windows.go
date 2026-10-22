//go:build windows

package windowsadapter

import (
	"fmt"

	creatorcore "github.com/ordaxsystems/ordax-os/tools/creator/core"
)

// InspectRemovableTargetReadOnly inspects one confirmed, currently eligible
// USB device. It reuses the existing physical handle and volume ownership
// validation; no mount, elevation, filesystem mutation or GPT writer is used.
func InspectRemovableTargetReadOnly(target Target) (creatorcore.InstalledMediaInspection, error) {
	if !target.PrototypeSafe || target.SystemDisk || target.BusType != "usb" ||
		target.ConfirmationToken != ConfirmationToken(target) {
		return creatorcore.InstalledMediaInspection{}, fmt.Errorf("USB inspection requires a currently safe confirmed target")
	}

	// The normal volume path preserves the existing mounted-volume binding.
	// The physical-unmounted recovery path may have no logical drive letter.
	if target.DriveLetter != "" {
		if _, err := enumerateTargetPhysicalVolumesReadOnly(target); err != nil {
			return creatorcore.InstalledMediaInspection{}, err
		}
	} else {
		volumes, err := enumerateAllPhysicalVolumesReadOnly()
		if err != nil {
			return creatorcore.InstalledMediaInspection{}, err
		}
		if err := validateTargetVolumeIsolation(volumes, target.DiskNumber); err != nil {
			return creatorcore.InstalledMediaInspection{}, err
		}
	}

	disk, err := openVerifiedPhysicalDriveReadOnly(target)
	if err != nil {
		return creatorcore.InstalledMediaInspection{}, err
	}
	defer disk.Close()

	result, err := creatorcore.InspectInstalledMedia(disk, target.PhysicalDiskBytes)
	if err != nil {
		return creatorcore.InstalledMediaInspection{}, fmt.Errorf("inspect PhysicalDrive%d: %w", target.DiskNumber, err)
	}
	return result, nil
}
