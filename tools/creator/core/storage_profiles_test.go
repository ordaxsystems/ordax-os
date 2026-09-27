package creatorcore

import "testing"

func TestPlanPortableTargetStorageUsesSharedDataCapacity(t *testing.T) {
	const target = uint64(8 * 1024 * 1024 * 1024)
	layout, err := PlanPortableTargetStorage(target)
	if err != nil {
		t.Fatal(err)
	}
	if layout.Profile != "portable-usb" {
		t.Fatalf("unexpected profile: %s", layout.Profile)
	}
	if layout.ESPBytes != 512*1024*1024 {
		t.Fatalf("unexpected portable ESP size: %d", layout.ESPBytes)
	}
	if layout.PayloadName != "ORDAX-DATA" {
		t.Fatalf("unexpected portable payload: %s", layout.PayloadName)
	}
	if layout.PayloadBytes <= 6*1024*1024*1024 {
		t.Fatalf("expected most of 8 GiB target to remain shared data capacity, got %d", layout.PayloadBytes)
	}
	if layout.PayloadLastLBA != layout.LastUsableLBA {
		t.Fatal("portable data area must fill the remaining usable GPT capacity")
	}
	if (layout.PayloadLastLBA+1)%storageAlignmentLBA != 0 {
		t.Fatalf("portable usable end must be 1 MiB aligned, got LBA %d", layout.PayloadLastLBA+1)
	}
}

func TestPlanPortableTargetStorageMatchesWindowsRemovableFreeExtent(t *testing.T) {
	const target = uint64(8053063680)
	const observedLargestFreeExtent = uint64(8050966528)
	const expectedPayloadBytes = uint64(7514095616)

	layout, err := PlanPortableTargetStorage(target)
	if err != nil {
		t.Fatal(err)
	}
	if layout.ESPStartLBA != 2048 || layout.ESPLastLBA != 1050623 {
		t.Fatalf("unexpected ESP geometry: %d-%d", layout.ESPStartLBA, layout.ESPLastLBA)
	}
	if layout.PayloadStartLBA != 1050624 || layout.PayloadLastLBA != 15726591 {
		t.Fatalf("unexpected ORDAX-DATA geometry: %d-%d", layout.PayloadStartLBA, layout.PayloadLastLBA)
	}
	if layout.PayloadBytes != expectedPayloadBytes {
		t.Fatalf("unexpected ORDAX-DATA bytes: %d", layout.PayloadBytes)
	}
	if layout.ESPBytes+layout.PayloadBytes != observedLargestFreeExtent {
		t.Fatalf(
			"planned partitions must fit Windows LargestFreeExtent: planned=%d observed=%d",
			layout.ESPBytes+layout.PayloadBytes,
			observedLargestFreeExtent,
		)
	}
}

func TestPlanNativeDiskTargetStorageUsesOneSharedPool(t *testing.T) {
	const target = uint64(64 * 1024 * 1024 * 1024)
	layout, err := PlanNativeDiskTargetStorage(target)
	if err != nil {
		t.Fatal(err)
	}
	if layout.Profile != "native-disk" {
		t.Fatalf("unexpected profile: %s", layout.Profile)
	}
	if layout.ESPBytes != 1024*1024*1024 {
		t.Fatalf("unexpected native ESP size: %d", layout.ESPBytes)
	}
	if layout.PayloadName != "ORDAX-POOL" {
		t.Fatalf("unexpected native payload: %s", layout.PayloadName)
	}
	if layout.PayloadLastLBA != layout.LastUsableLBA {
		t.Fatal("native pool must fill the remaining usable GPT capacity")
	}
	expectedLastUsable := target/storageSectorBytes - storageGPTTailSectors - 1
	if layout.LastUsableLBA != expectedLastUsable {
		t.Fatalf("native GPT geometry changed unexpectedly: got=%d want=%d", layout.LastUsableLBA, expectedLastUsable)
	}
	if layout.PayloadBytes <= 62*1024*1024*1024 {
		t.Fatalf("expected almost all native target capacity in shared pool, got %d", layout.PayloadBytes)
	}
}

func TestTargetStorageProfilesRejectInvalidCapacity(t *testing.T) {
	if _, err := PlanPortableTargetStorage(12345); err == nil {
		t.Fatal("expected non-sector-aligned portable capacity to fail")
	}
	if _, err := PlanNativeDiskTargetStorage(0); err == nil {
		t.Fatal("expected zero native capacity to fail")
	}
	if _, err := PlanPortableTargetStorage(1024 * 1024 * 1024); err == nil {
		t.Fatal("expected target without at least 1 GiB ORDAX-DATA to fail")
	}
}

func TestTargetStorageProfilesStayIndependentFromTransitionalSystemPartition(t *testing.T) {
	portable, err := PlanPortableTargetStorage(16 * 1024 * 1024 * 1024)
	if err != nil {
		t.Fatal(err)
	}
	native, err := PlanNativeDiskTargetStorage(16 * 1024 * 1024 * 1024)
	if err != nil {
		t.Fatal(err)
	}
	if portable.PayloadName == "ORDAX" || native.PayloadName == "ORDAX" {
		t.Fatal("long-term profiles must not encode a fixed physical ORDAX system partition")
	}
	if portable.PayloadStartLBA == native.PayloadStartLBA {
		t.Fatal("portable and native profiles must retain independent ESP sizing policies")
	}
}