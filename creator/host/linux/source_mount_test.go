package linuxadapter

import (
	"os"
	"path/filepath"
	"testing"
)

func writeMountInfoFixture(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mountinfo")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestDiscoverMountedBlockDeviceFindsExactOrdaxMount(t *testing.T) {
	fixture := writeMountInfoFixture(t,
		"24 1 0:20 / /proc rw,nosuid - proc proc rw\n"+
			"36 1 8:18 / /ordax rw,relatime - ext4 /dev/sdb2 rw\n"+
			"40 36 8:18 /home /ordax/home rw - ext4 /dev/sdb2 rw\n",
	)
	device, err := DiscoverMountedBlockDevice(fixture, "/ordax")
	if err != nil {
		t.Fatal(err)
	}
	if device != "/dev/sdb2" {
		t.Fatalf("unexpected source device: %q", device)
	}
}

func TestDiscoverMountedBlockDeviceRejectsNonDevSource(t *testing.T) {
	fixture := writeMountInfoFixture(t,
		"36 1 0:45 / /ordax rw - tmpfs tmpfs rw\n",
	)
	if _, err := DiscoverMountedBlockDevice(fixture, "/ordax"); err == nil {
		t.Fatal("non-/dev source must fail closed")
	}
}

func TestDiscoverMountedBlockDeviceRejectsAmbiguousMount(t *testing.T) {
	fixture := writeMountInfoFixture(t,
		"36 1 8:18 / /ordax rw - ext4 /dev/sdb2 rw\n"+
			"37 1 8:34 / /ordax rw - ext4 /dev/sdc2 rw\n",
	)
	if _, err := DiscoverMountedBlockDevice(fixture, "/ordax"); err == nil {
		t.Fatal("ambiguous source mount must fail closed")
	}
}

func TestDiscoverMountedBlockDeviceDecodesMountInfoEscapes(t *testing.T) {
	fixture := writeMountInfoFixture(t,
		"36 1 8:18 / /ordax rw - ext4 /dev/disk/by-label/OR\\134DAX rw\n",
	)
	device, err := DiscoverMountedBlockDevice(fixture, "/ordax")
	if err != nil {
		t.Fatal(err)
	}
	if device != "/dev/disk/by-label/OR\\DAX" {
		t.Fatalf("unexpected decoded source device: %q", device)
	}
}
