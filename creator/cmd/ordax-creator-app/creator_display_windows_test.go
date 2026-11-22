//go:build windows

package main

import (
	"strings"
	"testing"
)

func TestCreatorBuildLabelIncludesImmutableShortCommit(t *testing.T) {
	state := appRefreshState{
		Version:      "0.6.1-dev",
		SourceCommit: "ef6c111fb6fadc7eba2c63fe51e2abb50e44af58",
	}
	label := creatorBuildLabel(state)
	if !strings.Contains(label, "0.6.1-dev") || !strings.Contains(label, "ef6c111f") {
		t.Fatalf("build identity is ambiguous: %q", label)
	}
}

func TestPhysicalRecoveryTargetHasDeliberateIdentity(t *testing.T) {
	target := physicalTarget{
		DriveType:         "physical-unmounted",
		DiskNumber:        1,
		PhysicalDiskBytes: 8052549120,
	}
	if got := targetPrimaryIdentity(target); got != creatorT(msgTargetRecoveryName) {
		t.Fatalf("recovery primary identity = %q", got)
	}
	if got := targetDriveLabel(target); got != creatorT(msgTargetRecoveryDrive) {
		t.Fatalf("recovery drive identity = %q", got)
	}
	if strings.TrimSpace(targetLabel(target)) == "" || strings.HasPrefix(targetLabel(target), "—") {
		t.Fatalf("recovery target label is not user-readable: %q", targetLabel(target))
	}
}

func TestShortSourceCommitRejectsNonHexIdentity(t *testing.T) {
	if got := shortSourceCommit("not-a-commit"); got != "" {
		t.Fatalf("invalid source commit rendered as trusted build identity: %q", got)
	}
}

func TestUSBSelectionMustBeExplicitOnFirstDiscovery(t *testing.T) {
	target := physicalTarget{
		DiskNumber: 1, DeviceSerial: "USB-001",
		PhysicalDiskBytes: 8 << 30, PrototypeSafe: true,
		ConfirmationToken: strings.Repeat("a", 64),
	}
	if got := restoredUSBSelectionIndex(nil, []physicalTarget{target}); got != -1 {
		t.Fatalf("first discovery implicitly selected a destructive target: %d", got)
	}
}

func TestUSBSelectionRestoresOnlySameUniquePhysicalDevice(t *testing.T) {
	selected := physicalTarget{
		DiskNumber: 2, DriveLetter: "E:", VolumeLabel: "USB",
		DeviceSerial: "SERIAL-ONE", PhysicalDiskBytes: 8 << 30,
		PrototypeSafe: true, ConfirmationToken: strings.Repeat("a", 64),
	}
	other := physicalTarget{
		DiskNumber: 3, DriveLetter: "F:", VolumeLabel: "OTHER",
		DeviceSerial: "SERIAL-TWO", PhysicalDiskBytes: 16 << 30,
		PrototypeSafe: true, ConfirmationToken: strings.Repeat("b", 64),
	}
	renamed := selected
	renamed.DriveLetter = "Z:"
	renamed.VolumeLabel = "ORDAX-ESP"
	if got := restoredUSBSelectionIndex(&selected, []physicalTarget{other, renamed}); got != 1 {
		t.Fatalf("same physical USB with changed volume presentation was not restored: %d", got)
	}
	if got := restoredUSBSelectionIndex(&selected, []physicalTarget{renamed, renamed}); got != -1 {
		t.Fatalf("ambiguous duplicated USB identity was restored: %d", got)
	}
	if got := restoredUSBSelectionIndex(&selected, []physicalTarget{other}); got != -1 {
		t.Fatalf("removed USB remained selected: %d", got)
	}
}

func TestUSBSelectionRejectsDriftAndUnprovableIdentity(t *testing.T) {
	selected := physicalTarget{
		DiskNumber: 2, DeviceSerial: "SERIAL-ONE",
		PhysicalDiskBytes: 8 << 30, PrototypeSafe: true,
		ConfirmationToken: strings.Repeat("a", 64),
	}
	mutations := []struct {
		name string
		modify func(*physicalTarget)
	}{
		{"disk-number", func(target *physicalTarget) { target.DiskNumber++ }},
		{"size", func(target *physicalTarget) { target.PhysicalDiskBytes++ }},
		{"serial", func(target *physicalTarget) { target.DeviceSerial = "SWAPPED" }},
		{"token", func(target *physicalTarget) { target.ConfirmationToken = strings.Repeat("b", 64) }},
		{"system-disk", func(target *physicalTarget) { target.SystemDisk = true }},
		{"unsafe", func(target *physicalTarget) { target.PrototypeSafe = false }},
	}
	for _, tc := range mutations {
		t.Run(tc.name, func(t *testing.T) {
			current := selected
			tc.modify(&current)
			if got := restoredUSBSelectionIndex(&selected, []physicalTarget{current}); got != -1 {
				t.Fatalf("identity changed but remained selected: %d", got)
			}
		})
	}
	for _, tc := range []struct {
		name string
		change func(*physicalTarget)
	}{
		{"serial-missing", func(target *physicalTarget) { target.DeviceSerial = "" }},
		{"token-not-hex", func(target *physicalTarget) { target.ConfirmationToken = strings.Repeat("z", 64) }},
		{"token-uppercase", func(target *physicalTarget) { target.ConfirmationToken = strings.Repeat("A", 64) }},
		{"previous-system-disk", func(target *physicalTarget) { target.SystemDisk = true }},
		{"previous-unsafe", func(target *physicalTarget) { target.PrototypeSafe = false }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			previous := selected
			tc.change(&previous)
			if got := restoredUSBSelectionIndex(&previous, []physicalTarget{previous}); got != -1 {
				t.Fatalf("unprovable previous selection was restored: %d", got)
			}
		})
	}
}

func TestCreatorDisplayedBuildLabelUsesPackagedExeNotSeparatelyInstalledBackend(t *testing.T) {
	oldVersion, oldCommit := buildCreatorVersion, buildCreatorSourceCommit
	t.Cleanup(func() {
		buildCreatorVersion, buildCreatorSourceCommit = oldVersion, oldCommit
	})
	buildCreatorVersion = "0.6.3-dev"
	buildCreatorSourceCommit = "67517dff22647d531cd31ac834931b12406b1b3f"
	backend := appRefreshState{
		Version: "0.6.2-dev",
		SourceCommit: "ef6c111fb6fadc7eba2c63fe51e2abb50e44af58",
		Updated: true,
	}
	expected := creatorBuildLabel(appRefreshState{
		Version: buildCreatorVersion, SourceCommit: buildCreatorSourceCommit,
	})
	for _, state := range []appRefreshState{{}, backend} {
		got := creatorDisplayedBuildLabel(state)
		if got != expected || !strings.Contains(got, "0.6.3-dev") ||
			!strings.Contains(got, "67517dff") || strings.Contains(got, "ef6c111f") ||
			strings.Contains(got, creatorT(msgVersionUpdated)) {
			t.Fatalf("packaged GUI identity was replaced with backend identity: %q", got)
		}
	}
	buildCreatorSourceCommit = "not-an-immutable-commit"
	if got := creatorDisplayedBuildLabel(backend); got != creatorBuildLabel(backend) {
		t.Fatalf("invalid linker identity did not fail closed to legacy presentation: %q", got)
	}
}
