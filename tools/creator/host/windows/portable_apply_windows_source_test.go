//go:build windows && ordax_raw_backend

package windowsadapter

import (
	"os"
	"strings"
	"testing"
)

func TestPortableFormatHandlesUnassignedDriveLetterAsNUL(t *testing.T) {
	source, err := os.ReadFile("portable_apply_windows.go")
	if err != nil {
		t.Fatalf("read portable_apply_windows.go: %v", err)
	}
	text := string(source)

	for _, required := range []string{
		"$letter=[char]$p.DriveLetter",
		"[int]$letter -eq 0",
		"Add-PartitionAccessPath -AssignDriveLetter",
		"$v=$p | Get-Volume -ErrorAction Stop",
		"Portable volume did not stabilize after format",
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("Portable format path is missing required stabilization boundary %q", required)
		}
	}

	if strings.Contains(text, "Get-Volume -DriveLetter $p.DriveLetter") {
		t.Fatal("Portable format path regressed to querying a possibly-NUL DriveLetter directly")
	}
}
