package creatorcore

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
)

// InstalledMediaInspection reports only facts proved from GPT metadata.
// It cannot establish filesystem health, installed Git SHA, bootability,
// signature provenance, or authorization for an update/repair/write.
type InstalledMediaInspection struct {
	Schema        string                   `json:"$schema"`
	Mode          string                   `json:"mode"`
	PhysicalWrite bool                     `json:"physical_write"`
	Profile       string                   `json:"profile"`
	Verification  string                   `json:"verification"`
	Partitions    []InstalledMediaPartition `json:"partitions"`
}

type InstalledMediaPartition struct {
	Name       string `json:"name"`
	FirstLBA   uint64 `json:"first_lba"`
	LastLBA    uint64 `json:"last_lba"`
}

// InspectInstalledMedia inspects an already-opened, read-only disk handle.
// The host adapter owns USB/system-disk exclusion, live target identity
// checks, and Windows permissions. Core exclusively owns GPT validation and
// profile recognition; unknown or damaged disks never become write targets.
func InspectInstalledMedia(disk *os.File, diskBytes uint64) (InstalledMediaInspection, error) {
	if disk == nil || diskBytes < 68*gptSectorBytes ||
		diskBytes%gptSectorBytes != 0 || diskBytes > uint64(^uint64(0)>>1) {
		return InstalledMediaInspection{}, errors.New("invalid disk reader or aligned physical capacity")
	}
	totalSectors := diskBytes / gptSectorBytes
	mbr, err := readSector(disk, 0)
	if err != nil {
		return InstalledMediaInspection{}, fmt.Errorf("read protective MBR: %w", err)
	}
	if mbr[510] != 0x55 || mbr[511] != 0xaa {
		return InstalledMediaInspection{}, errors.New("protective MBR signature is invalid")
	}
	protective := false
	for index := 0; index < 4; index++ {
		offset := 446 + 16*index
		if mbr[offset+4] == 0xee && binary.LittleEndian.Uint32(mbr[offset+8:offset+12]) == 1 {
			protective = true
		}
	}
	if !protective {
		return InstalledMediaInspection{}, errors.New("protective GPT partition is missing")
	}

	primaryBlock, err := readSector(disk, 1)
	if err != nil {
		return InstalledMediaInspection{}, fmt.Errorf("read primary GPT: %w", err)
	}
	primary, err := parseGPTHeader(primaryBlock)
	if err != nil {
		return InstalledMediaInspection{}, fmt.Errorf("primary GPT: %w", err)
	}
	if primary.CurrentLBA != 1 || primary.BackupLBA != totalSectors-1 ||
		primary.LastUsableLBA >= primary.BackupLBA ||
		primary.FirstUsableLBA < 2 {
		return InstalledMediaInspection{}, errors.New("primary GPT does not match physical disk geometry")
	}
	entryBytes, entrySectors, err := gptEntryBytes(primary)
	if err != nil {
		return InstalledMediaInspection{}, err
	}
	if primary.PartitionEntryLBA < 2 ||
		primary.PartitionEntryLBA > primary.FirstUsableLBA ||
		entrySectors > primary.FirstUsableLBA-primary.PartitionEntryLBA {
		return InstalledMediaInspection{}, errors.New("primary GPT entry array is outside reserved region")
	}
	entries, _, err := readGPTEntries(disk, primary)
	if err != nil {
		return InstalledMediaInspection{}, err
	}
	if uint64(len(entries)) != entryBytes {
		return InstalledMediaInspection{}, errors.New("primary GPT entry length mismatch")
	}

	secondaryBlock, err := readSector(disk, primary.BackupLBA)
	if err != nil {
		return InstalledMediaInspection{}, fmt.Errorf("read secondary GPT: %w", err)
	}
	secondary, err := parseGPTHeader(secondaryBlock)
	if err != nil {
		return InstalledMediaInspection{}, fmt.Errorf("secondary GPT: %w", err)
	}
	if secondary.CurrentLBA != primary.BackupLBA || secondary.BackupLBA != 1 ||
		secondary.FirstUsableLBA != primary.FirstUsableLBA ||
		secondary.LastUsableLBA != primary.LastUsableLBA ||
		secondary.EntryCount != primary.EntryCount ||
		secondary.EntrySize != primary.EntrySize ||
		secondary.EntryCRC32 != primary.EntryCRC32 ||
		secondary.PartitionEntryLBA <= primary.LastUsableLBA ||
		secondary.PartitionEntryLBA > secondary.CurrentLBA ||
		entrySectors != secondary.CurrentLBA-secondary.PartitionEntryLBA ||
		!bytes.Equal(primaryBlock[56:72], secondaryBlock[56:72]) {
		return InstalledMediaInspection{}, errors.New("primary and secondary GPT metadata disagree")
	}
	backupEntries, _, err := readGPTEntries(disk, secondary)
	if err != nil {
		return InstalledMediaInspection{}, fmt.Errorf("secondary GPT entries: %w", err)
	}
	if !bytes.Equal(entries, backupEntries) {
		return InstalledMediaInspection{}, errors.New("primary and secondary GPT partition arrays disagree")
	}

	parts := make([]InstalledMediaPartition, 0, 3)
	seen := make(map[string]bool)
	for index := uint32(0); index < primary.EntryCount; index++ {
		offset := int(index * primary.EntrySize)
		entry := entries[offset : offset+int(primary.EntrySize)]
		if isZeroGUID(entry[:16]) {
			continue
		}
		name := gptEntryName(entry)
		first := binary.LittleEndian.Uint64(entry[32:40])
		last := binary.LittleEndian.Uint64(entry[40:48])
		if name == "" || seen[name] || first < primary.FirstUsableLBA ||
			last > primary.LastUsableLBA || first > last {
			return InstalledMediaInspection{}, fmt.Errorf("invalid or duplicated GPT partition at entry %d", index+1)
		}
		for _, other := range parts {
			if first <= other.LastLBA && last >= other.FirstLBA {
				return InstalledMediaInspection{}, errors.New("overlapping GPT partitions")
			}
		}
		seen[name] = true
		parts = append(parts, InstalledMediaPartition{Name: name, FirstLBA: first, LastLBA: last})
	}
	profile := "unrecognized"
	if len(parts) == 2 && seen["ORDAX-ESP"] && seen["ORDAX"] {
		profile = "owner-seed-candidate"
	} else if len(parts) == 3 && seen["ORDAX-ESP"] && seen["ORDAX"] && seen["ORDAX-DATA"] {
		profile = "owner-development-candidate"
	} else if len(parts) == 2 && seen["ORDAX-ESP"] && seen["ORDAX-DATA"] {
		profile = "portable-stable-candidate"
	}
	return InstalledMediaInspection{
		Schema:        "prototype-ordax.creator-installed-media-inspection/1",
		Mode:          "read-only-gpt-inspection",
		PhysicalWrite: false,
		Profile:       profile,
		Verification:  "gpt-primary-backup-crc-and-geometry-only",
		Partitions:    parts,
	}, nil
}
