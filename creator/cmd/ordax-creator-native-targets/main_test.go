package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadSourceBootDeviceOverrideRequiresDevPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "source-block-device")
	if err := os.WriteFile(path, []byte("/dev/sdb2\n"), 0o400); err != nil {
		t.Fatal(err)
	}
	value, err := readSourceBootDevice(path)
	if err != nil {
		t.Fatal(err)
	}
	if value != "/dev/sdb2" {
		t.Fatalf("unexpected source device: %q", value)
	}
}

func TestReadSourceBootDeviceOverrideRejectsNonDevPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "source-block-device")
	if err := os.WriteFile(path, []byte("/tmp/fake\n"), 0o400); err != nil {
		t.Fatal(err)
	}
	if _, err := readSourceBootDevice(path); err == nil {
		t.Fatal("non-/dev source handoff must fail closed")
	}
}
