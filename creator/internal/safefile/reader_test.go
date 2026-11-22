package safefile

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestReadBoundedRegularReadsExactCachedEvidence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "current-envelope.json")
	want := []byte("a valid local fixture")
	if err := os.WriteFile(path, want, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := ReadBoundedRegular(path, int64(len(want)))
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("bounded evidence read got=%q err=%v", got, err)
	}
	if _, err := ReadBoundedRegular(path, int64(len(want)-1)); err == nil {
		t.Fatal("oversized cached evidence accepted")
	}
	for _, badMax := range []int64{0, -1, int64(^uint64(0) >> 1)} {
		if _, err := ReadBoundedRegular(path, badMax); err == nil {
			t.Fatalf("invalid read bound %d accepted", badMax)
		}
	}
}

func TestReadBoundedRegularRejectsUnsafeLocalEntries(t *testing.T) {
	root := t.TempDir()
	if _, err := ReadBoundedRegular(filepath.Join(root, "missing"), 32); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing evidence should preserve os.ErrNotExist, got %v", err)
	}
	empty := filepath.Join(root, "empty")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadBoundedRegular(empty, 32); err == nil {
		t.Fatal("empty cached evidence accepted")
	}
	if _, err := ReadBoundedRegular(root, 32); err == nil {
		t.Fatal("directory was accepted as cached evidence")
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(empty, link); err != nil {
		t.Logf("symlink creation unavailable on this host: %v", err)
	} else if _, err := ReadBoundedRegular(link, 32); err == nil {
		t.Fatal("symlinked cached evidence accepted")
	}
}

func TestReadBoundedRegularRejectsOversizedSparseFileBeforeAllocation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "envelope")
	if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(path, 8<<20); err != nil {
		t.Skipf("sparse test unavailable: %v", err)
	}
	if _, err := ReadBoundedRegular(path, 1<<20); err == nil {
		t.Fatal("oversized sparse cached envelope accepted")
	}
}
