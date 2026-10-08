package linuxadapter

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	creatorcore "github.com/ordaxsystems/prototipo-ordax-os/tools/creator/core"
)

const sysfsSectorBytes = uint64(512)

func readTrimmed(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func readUint(path string) (uint64, error) {
	value := readTrimmed(path)
	if value == "" {
		return 0, fmt.Errorf("missing numeric sysfs value %s", path)
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse numeric sysfs value %s: %w", path, err)
	}
	return parsed, nil
}

func isPartition(path string) bool {
	// Partition markers are not guaranteed to be readable or well formed.
	// Any existing marker (including an unexpected directory or symlink)
	// identifies a non-whole-disk entry. Ambiguous I/O errors exclude it.
	_, err := os.Lstat(filepath.Join(path, "partition"))
	return err == nil || !errors.Is(err, os.ErrNotExist)
}

func allDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func sourceParentDisk(sourceName string, wholeDisks []string) (string, error) {
	sourceName = strings.TrimSpace(path.Base(sourceName))
	if sourceName == "" || sourceName == "." || sourceName == string(filepath.Separator) {
		return "", fmt.Errorf("source boot block device is invalid")
	}
	best := ""
	for _, disk := range wholeDisks {
		if sourceName == disk {
			if len(disk) > len(best) {
				best = disk
			}
			continue
		}
		if !strings.HasPrefix(sourceName, disk) {
			continue
		}
		suffix := strings.TrimPrefix(sourceName, disk)
		if allDigits(suffix) || (strings.HasPrefix(suffix, "p") && allDigits(strings.TrimPrefix(suffix, "p"))) {
			if len(disk) > len(best) {
				best = disk
			}
		}
	}
	if best == "" {
		return "", fmt.Errorf("source boot block device %q cannot be mapped to a whole disk", sourceName)
	}
	return best, nil
}

func stableIdentity(blockRoot string) (string, string) {
	for _, relative := range []string{"wwid", filepath.Join("device", "wwid")} {
		if value := readTrimmed(filepath.Join(blockRoot, relative)); value != "" {
			return "wwid:" + value, value
		}
	}
	for _, relative := range []string{"serial", filepath.Join("device", "serial")} {
		if value := readTrimmed(filepath.Join(blockRoot, relative)); value != "" {
			return "serial:" + value, value
		}
	}
	return "", ""
}

func blockModel(blockRoot string) string {
	for _, relative := range []string{
		filepath.Join("device", "model"),
		filepath.Join("device", "name"),
		filepath.Join("device", "vendor"),
	} {
		if value := readTrimmed(filepath.Join(blockRoot, relative)); value != "" {
			return value
		}
	}
	return ""
}

func transportHint(blockRoot string) string {
	resolved, err := filepath.EvalSymlinks(blockRoot)
	if err != nil {
		resolved = blockRoot
	}
	value := strings.ToLower(filepath.ToSlash(resolved))
	switch {
	case strings.Contains(value, "/nvme"):
		return "nvme"
	case strings.Contains(value, "/usb"):
		return "usb"
	case strings.Contains(value, "/virtio"):
		return "virtio"
	case strings.Contains(value, "/ata"):
		return "ata"
	default:
		return "other"
	}
}

func wholeDiskNames(sysClassBlock string) ([]string, error) {
	entries, err := os.ReadDir(sysClassBlock)
	if err != nil {
		return nil, fmt.Errorf("read sysfs block class: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if name == "" || isPartition(filepath.Join(sysClassBlock, name)) {
			continue
		}
		names = append(names, name)
	}
	return names, nil
}

// EnumerateNativeInstallTargets performs read-only Linux/sysfs discovery.
// sourceBootBlockDevice is mandatory; enumeration fails closed if the current
// OrdaX boot medium cannot be mapped to its containing whole disk.
func EnumerateNativeInstallTargets(sysClassBlock, devRoot, sourceBootBlockDevice string) ([]creatorcore.NativeInstallTargetIdentity, error) {
	wholeDisks, err := wholeDiskNames(sysClassBlock)
	if err != nil {
		return nil, err
	}
	sourceDisk, err := sourceParentDisk(sourceBootBlockDevice, wholeDisks)
	if err != nil {
		return nil, err
	}

	targets := make([]creatorcore.NativeInstallTargetIdentity, 0, len(wholeDisks))
	for _, name := range wholeDisks {
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") || strings.HasPrefix(name, "zram") {
			continue
		}
		root := filepath.Join(sysClassBlock, name)
		sectors, err := readUint(filepath.Join(root, "size"))
		if err != nil || sectors == 0 || sectors > math.MaxUint64/sysfsSectorBytes {
			continue
		}
		logicalSector, err := readUint(filepath.Join(root, "queue", "logical_block_size"))
		if err != nil {
			continue
		}
		stableID, serial := stableIdentity(root)
		if stableID == "" {
			continue
		}
		// Missing or malformed safety metadata must never be interpreted as
		// writable/non-removable (Go's zero-value would make it eligible).
		readOnly, err := readUint(filepath.Join(root, "ro"))
		if err != nil || readOnly > 1 {
			continue
		}
		removable, err := readUint(filepath.Join(root, "removable"))
		if err != nil || removable > 1 {
			continue
		}
		target, err := creatorcore.FinalizeNativeInstallTarget(creatorcore.NativeInstallTargetIdentity{
			StableID:           stableID,
			DevicePath:         path.Join(strings.ReplaceAll(devRoot, "\\", "/"), name),
			Model:              blockModel(root),
			Serial:             serial,
			Transport:          transportHint(root),
			PhysicalBytes:      sectors * sysfsSectorBytes,
			LogicalSectorBytes: logicalSector,
			Removable:          removable != 0,
			ReadOnly:           readOnly != 0,
			SourceBootMedia:    name == sourceDisk,
		})
		if err != nil {
			continue
		}
		targets = append(targets, target)
	}
	return targets, nil
}
