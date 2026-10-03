package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestStageReleaseV2CreatesImmutableVerifiedSlot(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	root := filepath.Join(fixture.dir, "slots-v2")
	t.Cleanup(func() { allowTestTreeCleanup(root) })

	release, slot, changed, err := stageComponentV2(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		fixture.compatibilityPath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("first release/2 stage did not create a slot")
	}
	if release.Schema != releaseSchemaV2 || release.Component.ID != "internet" {
		t.Fatalf("unexpected staged release/2: %+v", release)
	}

	compatibilityPath := filepath.Join(slot, release.Compatibility.Name)
	info, err := os.Stat(compatibilityPath)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o222 != 0 {
		t.Fatalf("staged compatibility sidecar remains writable: %04o", info.Mode().Perm())
	}
	trustBytes, err := os.ReadFile(fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := verifySlotV2WithTrustBytes(slot, trustBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !sameReleaseV2(verified, release) {
		t.Fatal("verified release/2 slot identity differs from staged release")
	}
}

func TestStageReleaseV2RestageIsIdempotent(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	root := filepath.Join(fixture.dir, "slots-v2")
	t.Cleanup(func() { allowTestTreeCleanup(root) })

	_, firstSlot, changed, err := stageComponentV2(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		fixture.compatibilityPath,
		root,
	)
	if err != nil || !changed {
		t.Fatalf("initial stage changed=%t err=%v", changed, err)
	}
	_, secondSlot, changed, err := stageComponentV2(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		fixture.compatibilityPath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if changed || firstSlot != secondSlot {
		t.Fatalf("restage should reuse exact verified slot: changed=%t first=%q second=%q", changed, firstSlot, secondSlot)
	}
}

func TestVerifyReleaseV2SlotDetectsCompatibilityTamper(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	root := filepath.Join(fixture.dir, "slots-v2")
	t.Cleanup(func() { allowTestTreeCleanup(root) })
	_, slot, _, err := stageComponentV2(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		fixture.compatibilityPath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	compatibilityPath := filepath.Join(slot, fixture.release.Compatibility.Name)
	if runtime.GOOS != "windows" {
		if err := os.Chmod(compatibilityPath, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(compatibilityPath, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	trustBytes, err := os.ReadFile(fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = verifySlotV2WithTrustBytes(slot, trustBytes)
	if err == nil {
		t.Fatal("tampered compatibility sidecar unexpectedly verified")
	}
	if !strings.Contains(err.Error(), "size") &&
		!strings.Contains(err.Error(), "SHA-256") &&
		!strings.Contains(err.Error(), "writable") {
		t.Fatalf("unexpected compatibility tamper error: %v", err)
	}
}

func TestVerifyReleaseV2SlotRejectsMissingCompatibility(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	root := filepath.Join(fixture.dir, "slots-v2")
	t.Cleanup(func() { allowTestTreeCleanup(root) })
	_, slot, _, err := stageComponentV2(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		fixture.compatibilityPath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(slot, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Remove(filepath.Join(slot, fixture.release.Compatibility.Name)); err != nil {
		t.Fatal(err)
	}
	trustBytes, err := os.ReadFile(fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = verifySlotV2WithTrustBytes(slot, trustBytes)
	if err == nil {
		t.Fatal("release/2 slot without compatibility sidecar unexpectedly verified")
	}
}

func TestVerifyReleaseV2SlotRejectsExtraFile(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	root := filepath.Join(fixture.dir, "slots-v2")
	t.Cleanup(func() { allowTestTreeCleanup(root) })
	_, slot, _, err := stageComponentV2(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		fixture.compatibilityPath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(slot, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	extra := filepath.Join(slot, "unexpected.txt")
	if err := os.WriteFile(extra, []byte("unexpected\n"), 0o444); err != nil {
		t.Fatal(err)
	}
	trustBytes, err := os.ReadFile(fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = verifySlotV2WithTrustBytes(slot, trustBytes)
	if err == nil || !strings.Contains(err.Error(), "file set is not canonical") {
		t.Fatalf("extra release/2 slot file error = %v", err)
	}
}

func TestStageReleaseV2RejectsExistingV1SlotAtSameImmutableIdentity(t *testing.T) {
	v1 := makeFixture(t)
	v2 := writeReleaseV2Fixture(t)
	root := filepath.Join(t.TempDir(), "shared-slots")
	t.Cleanup(func() { allowTestTreeCleanup(root) })

	_, v1Slot, changed, err := stageComponent(
		v1.envelopePath,
		v1.trustPath,
		v1.packagePath,
		root,
	)
	if err != nil || !changed {
		t.Fatalf("v1 stage changed=%t err=%v", changed, err)
	}
	_, _, _, err = stageComponentV2(
		v2.envelopePath,
		v2.trustPath,
		v2.packagePath,
		v2.compatibilityPath,
		root,
	)
	if err == nil {
		t.Fatal("release/2 staging silently reused/upgraded an existing release/1 slot")
	}
	if !strings.Contains(err.Error(), "not the exact verified release/2 candidate") {
		t.Fatalf("unexpected v1/v2 slot collision error: %v", err)
	}
	if _, statErr := os.Stat(v1Slot); statErr != nil {
		t.Fatalf("existing v1 slot was damaged: %v", statErr)
	}
}

func TestStageReleaseV2RejectsPackageBindingSubstitution(t *testing.T) {
	fixture := writeReleaseV2Fixture(t)
	file, err := os.OpenFile(fixture.packagePath, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("tampered")); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	_, _, _, err = stageComponentV2(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		fixture.compatibilityPath,
		filepath.Join(fixture.dir, "slots-v2"),
	)
	if err == nil || !strings.Contains(err.Error(), "SHA-256/size") {
		t.Fatalf("tampered release/2 package error = %v", err)
	}
}
