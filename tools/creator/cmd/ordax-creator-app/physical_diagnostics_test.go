package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPersistPhysicalDiagnosticSurvivesWorkDirectoryCleanup(t *testing.T) {
	cacheRoot := t.TempDir()
	workDir := t.TempDir()
	source := filepath.Join(workDir, "ordax-physical-error.txt")
	content := []byte("backend refused unsafe target\n")
	if err := os.WriteFile(source, content, 0o600); err != nil {
		t.Fatal(err)
	}

	persisted, err := persistPhysicalDiagnosticAt(source, cacheRoot)
	if err != nil {
		t.Fatal(err)
	}
	if persisted == source {
		t.Fatal("diagnostic remained inside the temporary work directory")
	}

	expectedRoot := filepath.Join(cacheRoot, "OrdaX", "Creator", "diagnostics")
	relative, err := filepath.Rel(expectedRoot, persisted)
	if err != nil {
		t.Fatal(err)
	}
	if relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		t.Fatalf("diagnostic escaped canonical persistent root: %s", persisted)
	}

	if err := os.RemoveAll(workDir); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(persisted)
	if err != nil {
		t.Fatalf("persisted diagnostic disappeared with work directory: %v", err)
	}
	if string(got) != string(content) {
		t.Fatalf("persisted diagnostic changed: got %q want %q", got, content)
	}
}
