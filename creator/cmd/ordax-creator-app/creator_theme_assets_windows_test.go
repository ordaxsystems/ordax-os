//go:build windows

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func writeCreatorThemeFixture(t *testing.T, directory string) map[string][]byte {
	t.Helper()
	files := map[string][]byte{
		"ordax-design-theme.json": []byte(`{"$schema":"prototype-ordax.creator-ui-theme/1"}`),
		"ordax-symbol.png":       []byte("\x89PNG\r\n\x1a\n" + "fixture-symbol-contents"),
		"provenance.json":        []byte(`{"theme_sha256":"fixture"}`),
	}
	for name, contents := range files {
		if err := os.WriteFile(filepath.Join(directory, name), contents, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return files
}

func TestCreatorVisualThemeAssetsReadExistingBoundedFiles(t *testing.T) {
	root := t.TempDir()
	want := writeCreatorThemeFixture(t, root)
	theme, symbol, provenance, symbolPath, err := readCreatorVisualThemeAssets(root)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(theme, want["ordax-design-theme.json"]) ||
		!bytes.Equal(symbol, want["ordax-symbol.png"]) ||
		!bytes.Equal(provenance, want["provenance.json"]) {
		t.Fatal("Creator design assets changed during bounded read")
	}
	if symbolPath != filepath.Join(root, "ordax-symbol.png") {
		t.Fatalf("logo file path changed: %q", symbolPath)
	}
}

func TestCreatorVisualThemeAssetsFailClosedOnOversizedFiles(t *testing.T) {
	for _, tc := range []struct {
		name string
		max  int64
	}{
		{"ordax-design-theme.json", creatorThemeMaxBytes},
		{"ordax-symbol.png", creatorSymbolMaxBytes},
		{"provenance.json", creatorProvenanceMaxBytes},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			writeCreatorThemeFixture(t, root)
			if err := os.Truncate(filepath.Join(root, tc.name), tc.max+1); err != nil {
				t.Fatal(err)
			}
			theme, symbol, provenance, path, err := readCreatorVisualThemeAssets(root)
			if err == nil || theme != nil || symbol != nil || provenance != nil || path != "" {
				t.Fatalf("oversized asset %s accepted or partially published: %v", tc.name, err)
			}
		})
	}
}

func TestCreatorVisualThemeAssetsRejectMissingEmptyAndSymlinkEntries(t *testing.T) {
	for _, name := range []string{"ordax-design-theme.json", "ordax-symbol.png", "provenance.json"} {
		for _, mode := range []string{"missing", "empty", "symlink"} {
			t.Run(name+"/"+mode, func(t *testing.T) {
				root := t.TempDir()
				writeCreatorThemeFixture(t, root)
				path := filepath.Join(root, name)
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				switch mode {
				case "empty":
					if err := os.WriteFile(path, nil, 0o600); err != nil {
						t.Fatal(err)
					}
				case "symlink":
					target := filepath.Join(root, "real-asset")
					if err := os.WriteFile(target, []byte("asset"), 0o600); err != nil {
						t.Fatal(err)
					}
					if err := os.Symlink(target, path); err != nil {
						t.Skipf("symlink unavailable on this Windows host: %v", err)
					}
				}
				theme, symbol, provenance, symbolPath, err := readCreatorVisualThemeAssets(root)
				if err == nil || theme != nil || symbol != nil || provenance != nil || symbolPath != "" {
					t.Fatalf("unsafe asset %s (%s) accepted or partially published: %v", name, mode, err)
				}
			})
		}
	}
}
