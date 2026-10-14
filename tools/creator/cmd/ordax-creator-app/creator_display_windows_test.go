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
