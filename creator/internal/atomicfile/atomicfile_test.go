package atomicfile

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReplaceCreatesAndReplacesOnePointer(t *testing.T) {
	pointer := filepath.Join(t.TempDir(), "creator", "current-envelope.json")
	for _, data := range []string{"signed-old-envelope", "signed-new-envelope"} {
		if err := Replace(pointer, []byte(data)); err != nil {
			t.Fatal(err)
		}
		actual, err := os.ReadFile(pointer)
		if err != nil || string(actual) != data {
			t.Fatalf("pointer bytes=%q error=%v", actual, err)
		}
	}
	entries, err := os.ReadDir(filepath.Dir(pointer))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "current-envelope.json" {
		t.Fatalf("unexpected staged files: %v", entries)
	}
}

func TestReplaceCommitFailurePreservesPreviousPointer(t *testing.T) {
	root := t.TempDir()
	pointer := filepath.Join(root, "current-envelope.json")
	if err := os.WriteFile(pointer, []byte("signed-known-good"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := replaceWithRename(pointer, []byte("signed-new"), func(from, to string) error {
		if filepath.Dir(from) != root || to != pointer {
			t.Fatalf("unexpected paths: %q -> %q", from, to)
		}
		staged, e := os.ReadFile(from)
		if e != nil || string(staged) != "signed-new" {
			t.Fatalf("unexpected staged bytes: %q %v", staged, e)
		}
		return errors.New("simulated sharing violation")
	})
	if err == nil || !strings.Contains(err.Error(), "sharing violation") {
		t.Fatalf("failed rename: %v", err)
	}
	actual, e := os.ReadFile(pointer)
	if e != nil || string(actual) != "signed-known-good" {
		t.Fatalf("lost signed baseline: %q %v", actual, e)
	}
	entries, e := os.ReadDir(root)
	if e != nil {
		t.Fatal(e)
	}
	if len(entries) != 1 || entries[0].Name() != "current-envelope.json" {
		t.Fatalf("leaked stage: %v", entries)
	}
}
