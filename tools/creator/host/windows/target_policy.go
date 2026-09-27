package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

const (
	DriveTypeRemovable uint32 = 2
	DriveTypeFixed     uint32 = 3
	BusTypeUSB         uint32 = 7
)

type Target struct {
	DriveLetter       string `json:"drive_letter"`
	VolumeLabel       string `json:"volume_label"`
	VolumeSerial      uint32 `json:"volume_serial"`
	DiskNumber        uint32 `json:"disk_number"`
	VolumeBytes       uint64 `json:"volume_bytes"`
	PhysicalDiskBytes uint64 `json:"physical_disk_bytes"`
	DriveType         string `json:"drive_type"`
	BusType           string `json:"bus_type"`
	DeviceRemovable   bool   `json:"device_removable"`
	DeviceSerial      string `json:"device_serial,omitempty"`
	SystemDisk        bool   `json:"system_disk"`
	PrototypeSafe     bool   `json:"prototype_safe"`
	ConfirmationToken string `json:"confirmation_token"`
}

func driveTypeName(value uint32) string {
	switch value {
	case DriveTypeRemovable:
		return "removable"
	case DriveTypeFixed:
		return "fixed"
	default:
		return "other"
	}
}

func busTypeName(value uint32) string {
	if value == BusTypeUSB {
		return "usb"
	}
	return "other"
}

func IsPrototypeCandidate(driveLetter string, driveType uint32, mappedPhysicalDisk bool, busType uint32, systemDisk bool) bool {
	letter := strings.ToUpper(strings.TrimSpace(driveLetter))
	if !mappedPhysicalDisk || systemDisk || busType != BusTypeUSB {
		return false
	}
	if driveType != DriveTypeRemovable && driveType != DriveTypeFixed {
		return false
	}
	if len(letter) != 2 || letter[1] != ':' || letter[0] < 'A' || letter[0] > 'Z' {
		return false
	}
	return letter != "C:"
}

// IsPrototypePhysicalRecoveryCandidate allows a purpose-bound recovery path for
// a USB that no longer has a mounted volume after a failed destructive step.
// The physical device must still be proven USB, must have measurable capacity,
// and must not host the running Windows installation. Volume identity is not
// required because the failed write may have already removed the partition.
func IsPrototypePhysicalRecoveryCandidate(busType uint32, systemDisk bool) bool {
	return !systemDisk && busType == BusTypeUSB
}

func ConfirmationToken(target Target) string {
	identity := fmt.Sprintf(
		"ordax-target-v3|%s|%08x|%d|%d|%d|%s|%s|%t|%s|%t",
		strings.ToUpper(strings.TrimSpace(target.DriveLetter)),
		target.VolumeSerial,
		target.DiskNumber,
		target.VolumeBytes,
		target.PhysicalDiskBytes,
		target.DriveType,
		target.BusType,
		target.DeviceRemovable,
		strings.TrimSpace(target.DeviceSerial),
		target.SystemDisk,
	)
	digest := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(digest[:])
}

func FinalizeTarget(target Target, driveType uint32, mappedPhysicalDisk bool, busType uint32, systemDisk bool) Target {
	target.DriveType = driveTypeName(driveType)
	target.BusType = busTypeName(busType)
	target.SystemDisk = systemDisk
	target.PrototypeSafe = target.PhysicalDiskBytes > 0 && IsPrototypeCandidate(target.DriveLetter, driveType, mappedPhysicalDisk, busType, systemDisk)
	target.ConfirmationToken = ConfirmationToken(target)
	return target
}

// FinalizePhysicalRecoveryTarget binds an unmounted physical USB identity to a
// fresh confirmation token. It is intentionally distinct from FinalizeTarget so
// normal mounted-volume discovery keeps the existing drive-letter policy.
func FinalizePhysicalRecoveryTarget(target Target, busType uint32, systemDisk bool) Target {
	target.DriveType = "physical-unmounted"
	target.BusType = busTypeName(busType)
	target.SystemDisk = systemDisk
	target.PrototypeSafe = target.PhysicalDiskBytes > 0 && IsPrototypePhysicalRecoveryCandidate(busType, systemDisk)
	target.ConfirmationToken = ConfirmationToken(target)
	return target
}

func MatchConfirmedTarget(targets []Target, token string) (Target, error) {
	token = strings.TrimSpace(token)
	if token != strings.ToLower(token) {
		return Target{}, errors.New("confirmation token must be lowercase 64-hex SHA-256")
	}
	decoded, err := hex.DecodeString(token)
	if err != nil || len(decoded) != sha256.Size {
		return Target{}, errors.New("confirmation token must be lowercase 64-hex SHA-256")
	}
	var match *Target
	for i := range targets {
		candidate := targets[i]
		if !candidate.PrototypeSafe {
			continue
		}
		// Never trust the token carried by an object as proof of its current
		// identity. Recompute it from the fields that identify the live target
		// so stale or internally modified Target values fail closed.
		recomputed := ConfirmationToken(candidate)
		if candidate.ConfirmationToken != recomputed {
			return Target{}, errors.New("currently safe USB target identity is internally inconsistent")
		}
		if recomputed != token {
			continue
		}
		if match != nil {
			return Target{}, errors.New("confirmation token matched multiple targets")
		}
		copy := candidate
		match = &copy
	}
	if match == nil {
		return Target{}, errors.New("confirmation token no longer matches a currently safe USB target")
	}
	return *match, nil
}
