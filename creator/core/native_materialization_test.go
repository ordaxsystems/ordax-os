package creatorcore

import "testing"

func TestPlanNativeMaterializationMatchesCanonicalGeometry(t *testing.T) {
	const target = uint64(3 * 1024 * 1024 * 1024)
	plan, err := PlanNativeMaterialization(target)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Schema != "prototype-ordax.native-materialization-plan/1" || plan.Status != "plan-only" {
		t.Fatalf("unexpected plan identity: %#v", plan)
	}
	if plan.PartitionTable != "gpt" || plan.LogicalSectorBytes != 512 || plan.AlignmentBytes != 1024*1024 {
		t.Fatalf("unexpected physical geometry policy: %#v", plan)
	}
	if len(plan.Partitions) != 2 {
		t.Fatalf("expected exactly two partitions, got %d", len(plan.Partitions))
	}
	esp, pool := plan.Partitions[0], plan.Partitions[1]
	if esp.Name != "ORDAX-ESP" || esp.TypeGUID != nativeESPTypeGUID || esp.Filesystem != "fat32" || esp.SizeBytes != 1024*1024*1024 {
		t.Fatalf("unexpected ESP plan: %#v", esp)
	}
	if pool.Name != "ORDAX-POOL" || pool.TypeGUID != nativeLUKSTypeGUID || pool.Encryption != "luks2" || pool.Filesystem != "btrfs" {
		t.Fatalf("unexpected pool plan: %#v", pool)
	}
	if pool.StartLBA <= esp.LastLBA || pool.LastLBA <= pool.StartLBA {
		t.Fatalf("invalid partition ordering: esp=%#v pool=%#v", esp, pool)
	}
	if plan.SourceProductMode != "usb" || plan.TargetProductMode != "native-disk" {
		t.Fatalf("unexpected product-mode transition: %s -> %s", plan.SourceProductMode, plan.TargetProductMode)
	}
	if plan.TargetProductModePath != "/ordax/bootstrap/config/product-mode" {
		t.Fatalf("unexpected product-mode target path: %s", plan.TargetProductModePath)
	}
	if plan.TargetProductModePoolRelativePath != "bootstrap/config/product-mode" {
		t.Fatalf("unexpected pool-relative product-mode path: %s", plan.TargetProductModePoolRelativePath)
	}
	if len(plan.Subvolumes) != 5 {
		t.Fatalf("expected canonical Btrfs subvolume set, got %d", len(plan.Subvolumes))
	}
	if plan.BootIntegrationStatus != "pending-native-luks2-btrfs-bootstrap" {
		t.Fatalf("proof must not claim durable Native boot is integrated: %s", plan.BootIntegrationStatus)
	}
	if !plan.SignedReleaseRequired || !plan.DisposableProofOnly || plan.PhysicalWriteAllowed {
		t.Fatal("Native materialization plan crossed its non-destructive boundary")
	}
}
