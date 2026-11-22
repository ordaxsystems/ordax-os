package creatorcore

import "testing"

func TestPlanNativeInstallationIsFailClosedAndUsesNativeProfile(t *testing.T) {
	const target = uint64(64 * 1024 * 1024 * 1024)
	plan, err := PlanNativeInstallation(target)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Schema != "prototype-ordax.native-install-plan/1" || plan.Status != "plan-only" {
		t.Fatalf("unexpected native plan identity: %#v", plan)
	}
	if plan.SourceProductMode != "usb" || plan.TargetProductMode != "native-disk" {
		t.Fatalf("unexpected product-mode transition: %s -> %s", plan.SourceProductMode, plan.TargetProductMode)
	}
	if plan.TargetProductModePath != "/ordax/bootstrap/config/product-mode" {
		t.Fatalf("unexpected target product-mode path: %s", plan.TargetProductModePath)
	}
	if plan.Storage.Profile != "native-disk" || plan.Storage.PayloadName != "ORDAX-POOL" {
		t.Fatalf("unexpected native storage profile: %#v", plan.Storage)
	}
	if plan.Storage.ESPBytes != 1024*1024*1024 {
		t.Fatalf("unexpected native ESP size: %d", plan.Storage.ESPBytes)
	}
	if !plan.WholeDiskInstall || !plan.ExistingTargetDataErased {
		t.Fatal("initial Native MVP must be an explicit whole-disk installation")
	}
	if !plan.ExplicitTargetRequired || !plan.ExplicitConfirmationRequired || !plan.SourceBootMediaMustDiffer {
		t.Fatal("native plan is missing destructive target safety requirements")
	}
	if plan.InstallAlongsideSupported || plan.AutomaticPartitionShrink {
		t.Fatal("first Native MVP must not pretend dual-boot resize is implemented")
	}
	if plan.PoolEncryption != "luks2" || plan.PoolFilesystem != "btrfs" {
		t.Fatalf("unexpected pool semantics: %s/%s", plan.PoolEncryption, plan.PoolFilesystem)
	}
	if plan.PhysicalDeviceTouched || plan.PhysicalApplyAllowed {
		t.Fatal("plan-native must never touch or authorize a physical device")
	}
}

func TestPlanNativeInstallationRejectsInvalidTargetCapacity(t *testing.T) {
	if _, err := PlanNativeInstallation(12345); err == nil {
		t.Fatal("expected non-sector-aligned Native target capacity to fail")
	}
}
