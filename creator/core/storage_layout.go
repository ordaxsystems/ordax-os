package creatorcore

import (
	"errors"
	"fmt"
)

const (
	storageSectorBytes    = uint64(512)
	storageAlignmentBytes = uint64(1024 * 1024)
	storageAlignmentLBA   = storageAlignmentBytes / storageSectorBytes
	storageESPStartLBA    = storageAlignmentLBA
	storageESPBytes       = uint64(256 * 1024 * 1024)
	storageMainMinBytes   = uint64(2 * 1024 * 1024 * 1024)
	storageMainMaxBytes   = uint64(8 * 1024 * 1024 * 1024)
	storageDataMinBytes   = uint64(1 * 1024 * 1024 * 1024)
	storageGPTTailSectors = uint64(33) // 32 entry sectors + backup GPT header.
	ownerDevelopmentMainMinBytes = uint64(5 * 1024 * 1024 * 1024)
	ownerDevelopmentMainMaxBytes = uint64(16 * 1024 * 1024 * 1024)
)

// PhysicalStorageLayout is the target USB geometry for the storage-v2 design.
// The system partition is deliberately bounded; the remaining capacity belongs
// to ORDAX-DATA instead of being silently absorbed by the ext4 system volume.
type PhysicalStorageLayout struct {
	TargetBytes uint64 `json:"target_bytes"`

	ESPStartLBA uint64 `json:"esp_start_lba"`
	ESPLastLBA  uint64 `json:"esp_last_lba"`
	ESPBytes    uint64 `json:"esp_bytes"`

	MainStartLBA uint64 `json:"main_start_lba"`
	MainLastLBA  uint64 `json:"main_last_lba"`
	MainBytes    uint64 `json:"main_bytes"`

	DataStartLBA uint64 `json:"data_start_lba"`
	DataLastLBA  uint64 `json:"data_last_lba"`
	DataBytes    uint64 `json:"data_bytes"`

	LastUsableLBA uint64 `json:"last_usable_lba"`
}

func alignDown(value, alignment uint64) uint64 {
	if alignment == 0 {
		return value
	}
	return value - value%alignment
}

func alignUp(value, alignment uint64) (uint64, error) {
	if alignment == 0 {
		return value, nil
	}
	remainder := value % alignment
	if remainder == 0 {
		return value, nil
	}
	delta := alignment - remainder
	if value > ^uint64(0)-delta {
		return 0, errors.New("storage layout alignment overflow")
	}
	return value + delta, nil
}

func preferredMainBytes(targetBytes uint64) uint64 {
	preferred := alignDown(targetBytes/4, storageAlignmentBytes)
	if preferred < storageMainMinBytes {
		return storageMainMinBytes
	}
	if preferred > storageMainMaxBytes {
		return storageMainMaxBytes
	}
	return preferred
}

// PlanPhysicalStorage preserves the canonical public storage-v2 geometry.
// ORDAX-ESP (FAT32), bounded ORDAX (ext4), and ORDAX-DATA (exFAT).
func PlanPhysicalStorage(targetBytes uint64) (PhysicalStorageLayout, error) {
    return planPhysicalStorage(targetBytes, false)
}

// PlanOwnerDevelopmentStorage reserves enough writable ext4 space for the
// Git checkout plus the dynamic Cage/WebKit APK runtime on the Developer USB.
// Public/Stable remains on PlanPhysicalStorage. Owner media smaller than this
// budget is rejected before preparing an image or opening a device.
func PlanOwnerDevelopmentStorage(targetBytes uint64) (PhysicalStorageLayout, error) {
    return planPhysicalStorage(targetBytes, true)
}

func planPhysicalStorage(targetBytes uint64, ownerDevelopment bool) (PhysicalStorageLayout, error) {
	if targetBytes == 0 || targetBytes%storageSectorBytes != 0 {
		return PhysicalStorageLayout{}, errors.New("USB capacity must be positive and 512-byte aligned")
	}
	targetSectors := targetBytes / storageSectorBytes
	if targetSectors <= storageGPTTailSectors+storageESPStartLBA {
		return PhysicalStorageLayout{}, errors.New("USB capacity is too small for GPT storage layout")
	}
	lastUsable := targetSectors - storageGPTTailSectors - 1

	espSectors := storageESPBytes / storageSectorBytes
	espLast := storageESPStartLBA + espSectors - 1
	mainStart, err := alignUp(espLast+1, storageAlignmentLBA)
	if err != nil {
		return PhysicalStorageLayout{}, err
	}
	mainBytes := preferredMainBytes(targetBytes)
	if ownerDevelopment {
		// Leave >=1GiB user DATA; GPT and alignment overhead remain reserved.
		reserve := storageESPBytes + storageDataMinBytes + 2*storageAlignmentBytes
		if targetBytes <= reserve {
			return PhysicalStorageLayout{}, errors.New("Owner/Development USB is too small for runtime and data")
		}
		mainBytes = alignDown(targetBytes-reserve, storageAlignmentBytes)
		if mainBytes > ownerDevelopmentMainMaxBytes {
			mainBytes = ownerDevelopmentMainMaxBytes
		}
		if mainBytes < ownerDevelopmentMainMinBytes {
			return PhysicalStorageLayout{}, fmt.Errorf(
				"Owner/Development USB cannot provide a %d byte writable ext4 runtime partition; use a larger disposable USB",
				ownerDevelopmentMainMinBytes,
			)
		}
	}
	mainSectors := mainBytes / storageSectorBytes
	if mainSectors == 0 || mainStart > ^uint64(0)-(mainSectors-1) {
		return PhysicalStorageLayout{}, errors.New("ORDAX system partition geometry overflow")
	}
	mainLast := mainStart + mainSectors - 1
	dataStart, err := alignUp(mainLast+1, storageAlignmentLBA)
	if err != nil {
		return PhysicalStorageLayout{}, err
	}
	if dataStart > lastUsable {
		return PhysicalStorageLayout{}, errors.New("USB is too small for ORDAX system and portable data partitions")
	}
	dataSectors := lastUsable - dataStart + 1
	if dataSectors > ^uint64(0)/storageSectorBytes {
		return PhysicalStorageLayout{}, errors.New("ORDAX-DATA size overflow")
	}
	dataBytes := dataSectors * storageSectorBytes
	if dataBytes < storageDataMinBytes {
		return PhysicalStorageLayout{}, fmt.Errorf(
			"USB leaves only %d bytes for ORDAX-DATA; at least %d bytes are required",
			dataBytes,
			storageDataMinBytes,
		)
	}

	return PhysicalStorageLayout{
		TargetBytes: targetBytes,
		ESPStartLBA: storageESPStartLBA,
		ESPLastLBA:  espLast,
		ESPBytes:    storageESPBytes,
		MainStartLBA: mainStart,
		MainLastLBA:  mainLast,
		MainBytes:    mainBytes,
		DataStartLBA: dataStart,
		DataLastLBA:  lastUsable,
		DataBytes:    dataBytes,
		LastUsableLBA: lastUsable,
	}, nil
}
