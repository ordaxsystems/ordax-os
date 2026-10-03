//go:build windows

package main

import (
	"strings"
	"testing"
)

func validPreparationForTest() (physicalPreparationDocument, physicalTarget, string) {
	target := physicalTarget{
		DriveLetter:       "O:",
		DiskNumber:        1,
		PhysicalDiskBytes: 8 * 1024 * 1024 * 1024,
		PrototypeSafe:     true,
		ConfirmationToken: strings.Repeat("a", 64),
	}
	path := `C:\Temp\ordax-prepared.raw`
	preparation := physicalPreparationDocument{
		Schema: "prototype-ordax.creator-physical-test-preparation/2",
		Target: target,
		PreparedImage: preparedPhysicalImage{
			Path:      path,
			SizeBytes: int64(target.PhysicalDiskBytes),
			SHA256:    strings.Repeat("b", 64),
		},
		DestructiveAuthorization: strings.Repeat("c", 64),
	}
	return preparation, target, path
}

func TestValidatePhysicalPreparationAcceptsExactBinding(t *testing.T) {
	preparation, target, path := validPreparationForTest()
	if err := validatePhysicalPreparation(preparation, target, path); err != nil {
		t.Fatal(err)
	}
}

func TestValidatePhysicalPreparationRejectsTargetSwap(t *testing.T) {
	preparation, target, path := validPreparationForTest()
	preparation.Target.DiskNumber++
	if err := validatePhysicalPreparation(preparation, target, path); err == nil {
		t.Fatal("target swap unexpectedly accepted")
	}
}

func TestValidatePhysicalPreparationRejectsAuthorizationMismatchShape(t *testing.T) {
	preparation, target, path := validPreparationForTest()
	preparation.DestructiveAuthorization = "short"
	if err := validatePhysicalPreparation(preparation, target, path); err == nil {
		t.Fatal("invalid destructive authorization unexpectedly accepted")
	}
}

func validPortablePreparationForTest() (portablePhysicalPreparationDocument, physicalTarget, string) {
	target := physicalTarget{
		DriveLetter:       "O:",
		DiskNumber:        2,
		PhysicalDiskBytes: 16 * 1024 * 1024 * 1024,
		PrototypeSafe:     true,
		ConfirmationToken: strings.Repeat("d", 64),
	}
	planSHA := strings.Repeat("e", 64)
	preparation := portablePhysicalPreparationDocument{
		Schema:                    "prototype-ordax.creator-portable-physical-preparation/1",
		Target:                    target,
		ApplicationPlanSHA256:     planSHA,
		DestructiveAuthorization:  strings.Repeat("f", 64),
		WholeDiskRawImageRequired: false,
	}
	return preparation, target, planSHA
}

func TestValidatePortablePhysicalPreparationAcceptsExactBinding(t *testing.T) {
	preparation, target, planSHA := validPortablePreparationForTest()
	if err := validatePortablePhysicalPreparation(preparation, target, planSHA); err != nil {
		t.Fatal(err)
	}
}

func TestValidatePortablePhysicalPreparationRejectsPlanOrTargetDrift(t *testing.T) {
	preparation, target, planSHA := validPortablePreparationForTest()
	preparation.ApplicationPlanSHA256 = strings.Repeat("1", 64)
	if err := validatePortablePhysicalPreparation(preparation, target, planSHA); err == nil {
		t.Fatal("Portable plan drift unexpectedly accepted")
	}

	preparation, target, planSHA = validPortablePreparationForTest()
	preparation.Target.DiskNumber++
	if err := validatePortablePhysicalPreparation(preparation, target, planSHA); err == nil {
		t.Fatal("Portable target swap unexpectedly accepted")
	}
}

func TestValidatePortablePhysicalPreparationRejectsRawRequirement(t *testing.T) {
	preparation, target, planSHA := validPortablePreparationForTest()
	preparation.WholeDiskRawImageRequired = true
	if err := validatePortablePhysicalPreparation(preparation, target, planSHA); err == nil {
		t.Fatal("Portable preparation unexpectedly accepted whole-disk RAW requirement")
	}
}
