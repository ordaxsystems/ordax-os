package linuxadapter

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFixture(t *testing.T, path, value string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(value), 0o644); err != nil {
		t.Fatal(err)
	}
}

func addDiskFixture(t *testing.T, root, name, stable, sectors, logical, ro, removable string) {
	t.Helper()
	base := filepath.Join(root, name)
	writeFixture(t, filepath.Join(base, "wwid"), stable)
	writeFixture(t, filepath.Join(base, "size"), sectors)
	writeFixture(t, filepath.Join(base, "queue", "logical_block_size"), logical)
	writeFixture(t, filepath.Join(base, "ro"), ro)
	writeFixture(t, filepath.Join(base, "removable"), removable)
	writeFixture(t, filepath.Join(base, "device", "model"), "Test "+name)
}

func TestEnumerateNativeInstallTargetsRejectsSourceBootDisk(t *testing.T) {
	root := t.TempDir()
	addDiskFixture(t, root, "sda", "internal-a", "134217728", "512", "0", "0")
	addDiskFixture(t, root, "sdb", "usb-source", "67108864", "512", "0", "1")
	writeFixture(t, filepath.Join(root, "sdb2", "partition"), "2")

	targets, err := EnumerateNativeInstallTargets(root, "/dev", "/dev/sdb2")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 2 {
		t.Fatalf("expected two discovered physical disks, got %d", len(targets))
	}
	var internal, sourceFound bool
	for _, target := range targets {
		switch target.DevicePath {
		case "/dev/sda":
			internal = true
			if !target.Eligible || target.SourceBootMedia {
				t.Fatal("internal target should be eligible")
			}
		case "/dev/sdb":
			sourceFound = true
			if target.Eligible || !target.SourceBootMedia {
				t.Fatal("source OrdaX USB must be visible but ineligible")
			}
		}
	}
	if !internal || !sourceFound {
		t.Fatal("expected both internal and source disks")
	}
}

func TestEnumerateNativeInstallTargetsFailsWhenSourceCannotBeIdentified(t *testing.T) {
	root := t.TempDir()
	addDiskFixture(t, root, "nvme0n1", "nvme-a", "134217728", "512", "0", "0")
	if _, err := EnumerateNativeInstallTargets(root, "/dev", "/dev/sdz9"); err == nil {
		t.Fatal("discovery must fail closed when source boot disk is unknown")
	}
}

func TestEnumerateNativeInstallTargetsHandlesNVMePartitionNaming(t *testing.T) {
	root := t.TempDir()
	addDiskFixture(t, root, "nvme0n1", "nvme-source", "134217728", "512", "0", "0")
	writeFixture(t, filepath.Join(root, "nvme0n1p2", "partition"), "2")
	addDiskFixture(t, root, "sda", "sata-target", "134217728", "512", "0", "0")

	targets, err := EnumerateNativeInstallTargets(root, "/dev", "/dev/nvme0n1p2")
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range targets {
		if target.DevicePath == "/dev/nvme0n1" && (!target.SourceBootMedia || target.Eligible) {
			t.Fatal("NVMe source parent must be detected and excluded")
		}
	}
}

func TestEnumerateNativeInstallTargetsSkipsUnsupportedOrUnstableDevices(t *testing.T) {
	root := t.TempDir()
	addDiskFixture(t, root, "sdb", "source", "67108864", "512", "0", "1")
	writeFixture(t, filepath.Join(root, "sdb1", "partition"), "1")
	addDiskFixture(t, root, "sda", "good", "134217728", "512", "0", "0")
	addDiskFixture(t, root, "sdc", "4k", "134217728", "4096", "0", "0")
	base := filepath.Join(root, "sdd")
	writeFixture(t, filepath.Join(base, "size"), "134217728")
	writeFixture(t, filepath.Join(base, "queue", "logical_block_size"), "512")
	writeFixture(t, filepath.Join(base, "ro"), "0")
	writeFixture(t, filepath.Join(base, "removable"), "0")

	targets, err := EnumerateNativeInstallTargets(root, "/dev", "/dev/sdb1")
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range targets {
		if target.DevicePath == "/dev/sdc" || target.DevicePath == "/dev/sdd" {
			t.Fatal("unsupported 4K or unstable-id devices must not be selectable")
		}
	}
}

func TestEnumerateNativeInstallTargetsFailsClosedOnUnknownSafetyMetadata(t *testing.T) {
	cases := []struct {
		name   string
		field  string
		value  string
		remove bool
	}{
		{name: "missing-read-only", field: "ro", remove: true},
		{name: "invalid-read-only", field: "ro", value: "unknown"},
		{name: "out-of-range-read-only", field: "ro", value: "2"},
		{name: "missing-removable", field: "removable", remove: true},
		{name: "invalid-removable", field: "removable", value: "unknown"},
		{name: "out-of-range-removable", field: "removable", value: "2"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			addDiskFixture(t, root, "sdb", "source", "67108864", "512", "0", "1")
			writeFixture(t, filepath.Join(root, "sdb1", "partition"), "1")
			addDiskFixture(t, root, "sda", "internal-target", "134217728", "512", "0", "0")

			path := filepath.Join(root, "sda", tc.field)
			if tc.remove {
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			} else {
				writeFixture(t, path, tc.value)
			}
			targets, err := EnumerateNativeInstallTargets(root, "/dev", "/dev/sdb1")
			if err != nil {
				t.Fatal(err)
			}
			if len(targets) != 1 || targets[0].DevicePath != "/dev/sdb" ||
				targets[0].Eligible || !targets[0].SourceBootMedia {
				t.Fatalf("unknown disk safety state must never become an eligible target: %#v", targets)
			}
		})
	}
}

func TestEnumerateNativeInstallTargetsKeepsKnownReadOnlyDiskIneligible(t *testing.T) {
	root := t.TempDir()
	addDiskFixture(t, root, "sdb", "source", "67108864", "512", "0", "1")
	writeFixture(t, filepath.Join(root, "sdb1", "partition"), "1")
	addDiskFixture(t, root, "sda", "read-only", "134217728", "512", "1", "0")
	targets, err := EnumerateNativeInstallTargets(root, "/dev", "/dev/sdb1")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 2 {
		t.Fatalf("known read-only disk should remain visible for explanation: %#v", targets)
	}
	for _, target := range targets {
		if target.DevicePath == "/dev/sda" {
			if !target.ReadOnly || target.Eligible {
				t.Fatalf("read-only disk must remain visible but ineligible: %#v", target)
			}
			return
		}
	}
	t.Fatal("known read-only disk was unexpectedly omitted")
}
