//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	creatorcore "github.com/ordaxsystems/ordax-os/tools/creator/core"
	physicalchannel "github.com/ordaxsystems/ordax-os/tools/creator/physicalchannel"
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

func portableSourceSpecsFixture(t *testing.T) (string, physicalchannel.PortablePayloadManifest, creatorcore.PortableMediaBindings) {
	t.Helper()
	directory := t.TempDir()
	ids := []string{
		"systemd-boot", "loader-config", "loader-normal", "loader-recovery",
		"kernel", "initramfs", "bootstrap-capsule", "release-trust",
		"stable-base", "persistent-state", "system-image",
		"surface-runtime-image", "surface-runtime-ref",
		"local-ai-runtime-image", "local-ai-runtime-ref",
		"release-manifest", "release-envelope",
	}
	bindings := creatorcore.PortableMediaBindings{
		Schema: creatorcore.PortableMediaBindingsSchema,
		Artifacts: make([]creatorcore.PortableMediaArtifactBinding, 0, len(ids)),
	}
	payload := physicalchannel.PortablePayloadManifest{
		Schema: physicalchannel.PortablePayloadSchema,
		ReleaseSourceCommit: strings.Repeat("a", 40),
	}
	for _, id := range ids {
		path, err := physicalchannel.PortablePayloadSourcePath(directory, id)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		body := []byte("signed source bytes: " + id)
		if err := os.WriteFile(path, body, 0o600); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(body)
		digest := hex.EncodeToString(sum[:])
		bindings.Artifacts = append(bindings.Artifacts, creatorcore.PortableMediaArtifactBinding{
			ID: id, SHA256: digest, SizeBytes: uint64(len(body)),
		})
		payload.Artifacts = append(payload.Artifacts, physicalchannel.PortablePayloadArtifactBinding{
			ID: id, SHA256: digest, SizeBytes: int64(len(body)),
		})
	}
	return directory, payload, bindings
}

func TestPortableSourceSpecsReusesCanonicalCoreVerificationBeforeElevation(t *testing.T) {
	root, payload, bindings := portableSourceSpecsFixture(t)
	specs, err := portableSourceSpecs(root, payload, bindings)
	if err != nil || len(specs) != 17 {
		t.Fatalf("canonical pre-elevation sources rejected: count=%d err=%v", len(specs), err)
	}
	for _, spec := range specs {
		if !strings.Contains(spec, "=") {
			t.Fatalf("unbound Portable source argument: %s", spec)
		}
	}
	path, err := physicalchannel.PortablePayloadSourcePath(root, "kernel")
	if err != nil {
		t.Fatal(err)
	}
	// Same-size corruption evades the old GUI size-only preflight.
	if err := os.WriteFile(path, []byte("signed source bytes: kerneL"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := portableSourceSpecs(root, payload, bindings); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("corrupted Portable source accepted before UAC: %v", err)
	}
}

func TestPortableSourceSpecsRejectsUnboundExtraSourceBeforeElevation(t *testing.T) {
	root, payload, bindings := portableSourceSpecsFixture(t)
	path, err := physicalchannel.PortablePayloadSourcePath(root, "kernel")
	if err != nil {
		t.Fatal(err)
	}
	extra := filepath.Join(filepath.Dir(path), "unexpected")
	if err := os.WriteFile(extra, []byte("unsigned"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := portableSourceSpecs(root, payload, bindings); err == nil || !strings.Contains(err.Error(), "exactly 17") {
		t.Fatalf("extra Portable source accepted before UAC: %v", err)
	}
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
