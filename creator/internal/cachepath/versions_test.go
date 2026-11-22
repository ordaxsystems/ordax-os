package cachepath

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureVersionsCreatesAndReusesCanonicalDirectory(t *testing.T) {
	root := t.TempDir()
	first, err := EnsureVersions(root)
	if err != nil {
		t.Fatal(err)
	}
	if first != filepath.Join(root, "versions") {
		t.Fatalf("unexpected canonical versions directory: %q", first)
	}
	again, err := EnsureVersions(root)
	if err != nil || again != first {
		t.Fatalf("reusing real directory failed: %q, %v", again, err)
	}
	found, err := Versions(root)
	if err != nil || found != first {
		t.Fatalf("offline verification failed: %q, %v", found, err)
	}
}

func TestVersionsMissingDoesNotCreateCache(t *testing.T) {
	root := t.TempDir()
	if _, err := Versions(root); !os.IsNotExist(err) {
		t.Fatalf("missing cache must return os.ErrNotExist, got %v", err)
	}
	if _, err := os.Lstat(filepath.Join(root, "versions")); !os.IsNotExist(err) {
		t.Fatalf("offline read unexpectedly created cache: %v", err)
	}
}

func TestVersionsRejectsSymlinkAndRegularFile(t *testing.T) {
	for _, tc := range []struct {
		name string
		setup func(*testing.T, string)
	}{
		{"file", func(t *testing.T, target string) {
			if err := os.WriteFile(target, []byte("not a directory"), 0o600); err != nil {
				t.Fatal(err)
			}
		}},
		{"symlink", func(t *testing.T, target string) {
			if err := os.Symlink(t.TempDir(), target); err != nil {
				t.Skipf("symlinks unavailable on this host: %v", err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			tc.setup(t, filepath.Join(root, "versions"))
			if _, err := Versions(root); err == nil {
				t.Fatal("unsafe versions cache accepted by offline reader")
			}
			if _, err := EnsureVersions(root); err == nil {
				t.Fatal("unsafe versions cache accepted by installer")
			}
		})
	}
}

func TestEnsureVersionsCreatesMissingRealRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "OrdaX", "Creator", "app")
	versions, err := EnsureVersions(root)
	if err != nil {
		t.Fatal(err)
	}
	if versions != filepath.Join(root, "versions") {
		t.Fatalf("wrong versions path: %q", versions)
	}
	if _, err := Versions(root); err != nil {
		t.Fatalf("created cache is unreadable: %v", err)
	}
}

func TestVersionsRejectsUnsafeCacheRootBeforeWritingChildren(t *testing.T) {
	for _, mode := range []string{"symlink", "file"} {
		t.Run(mode, func(t *testing.T) {
			parent := t.TempDir()
			external := t.TempDir()
			root := filepath.Join(parent, "creator-cache")
			switch mode {
			case "symlink":
				if err := os.Symlink(external, root); err != nil {
					t.Skipf("symlink unavailable on this host: %v", err)
				}
			case "file":
				if err := os.WriteFile(root, []byte("not a cache directory"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := Versions(root); err == nil {
				t.Fatal("offline reader followed an unsafe cache root")
			}
			if _, err := EnsureVersions(root); err == nil {
				t.Fatal("installer accepted an unsafe cache root")
			}
			if _, err := os.Lstat(filepath.Join(external, "versions")); !os.IsNotExist(err) {
				t.Fatalf("installer wrote through redirected cache root: %v", err)
			}
		})
	}
}
