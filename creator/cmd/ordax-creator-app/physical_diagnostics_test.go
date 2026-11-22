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

func TestPersistPhysicalDiagnosticRejectsUnsafeSourceBeforeCreatingCache(t *testing.T) {
	for _, mode := range []string{"empty", "oversized", "symlink", "directory"} {
		t.Run(mode, func(t *testing.T) {
			cacheRoot := t.TempDir()
			workDir := t.TempDir()
			source := filepath.Join(workDir, "physical-error.txt")
			switch mode {
			case "empty":
				if err := os.WriteFile(source, nil, 0o600); err != nil {
					t.Fatal(err)
				}
			case "oversized":
				if err := os.WriteFile(source, []byte("X"), 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Truncate(source, maxPhysicalDiagnosticBytes+1); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				realFile := filepath.Join(workDir, "real-log.txt")
				if err := os.WriteFile(realFile, []byte("valid content"), 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(realFile, source); err != nil {
					t.Skipf("symlink unavailable: %v", err)
				}
			case "directory":
				if err := os.Mkdir(source, 0o700); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := persistPhysicalDiagnosticAt(source, cacheRoot); err == nil {
				t.Fatal("unsafe physical diagnostic was persisted")
			}
			if _, err := os.Lstat(filepath.Join(cacheRoot, "OrdaX")); !os.IsNotExist(err) {
				t.Fatalf("rejected diagnostic created persistent cache: %v", err)
			}
		})
	}
}

func TestPersistPhysicalDiagnosticRefusesRedirectedCacheComponents(t *testing.T) {
	for _, component := range []string{"OrdaX", "Creator", "diagnostics"} {
		t.Run(component, func(t *testing.T) {
			cacheRoot := t.TempDir()
			source := filepath.Join(t.TempDir(), "physical-error.txt")
			if err := os.WriteFile(source, []byte("backend error\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			external := t.TempDir()
			linkedPath := filepath.Join(cacheRoot, "OrdaX")
			switch component {
			case "Creator":
				linkedPath = filepath.Join(linkedPath, "Creator")
			case "diagnostics":
				linkedPath = filepath.Join(linkedPath, "Creator", "diagnostics")
			}
			if err := os.MkdirAll(filepath.Dir(linkedPath), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(external, linkedPath); err != nil {
				t.Skipf("symlink unavailable: %v", err)
			}
			if _, err := persistPhysicalDiagnosticAt(source, cacheRoot); err == nil {
				t.Fatal("redirected diagnostics directory was accepted")
			}
			entries, err := os.ReadDir(external)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Fatalf("redirected diagnostics path received %d unexpected entries", len(entries))
			}
		})
	}
}
