package creatorcore

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func portableSourceFixture(t *testing.T) (string, PortableMediaBindings) {
	t.Helper()
	root := t.TempDir()
	ids := make([]string, 0, len(portableMediaTargets))
	for id := range portableMediaTargets {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	bindings := PortableMediaBindings{
		Schema:    PortableMediaBindingsSchema,
		Artifacts: make([]PortableMediaArtifactBinding, 0, len(ids)),
	}
	for index, id := range ids {
		payload := []byte(strings.Repeat(id+"\n", index+1))
		path := filepath.Join(root, id)
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(payload)
		bindings.Artifacts = append(bindings.Artifacts, PortableMediaArtifactBinding{
			ID:        id,
			SHA256:    hex.EncodeToString(sum[:]),
			SizeBytes: uint64(len(payload)),
		})
	}
	return root, bindings
}

func TestVerifyPortableSourcesAcceptsExactCanonicalSet(t *testing.T) {
	root, bindings := portableSourceFixture(t)
	verified, err := VerifyPortableSources(bindings, root)
	if err != nil {
		t.Fatal(err)
	}
	if len(verified) != 17 {
		t.Fatalf("verified source count=%d want=17", len(verified))
	}
	for _, source := range verified {
		if source.ArtifactID == "" || source.Path == "" || source.SHA256 == "" || source.SizeBytes == 0 {
			t.Fatalf("incomplete verified source: %#v", source)
		}
	}
}

func TestVerifyPortableSourcesRejectsMutationAndExtraFiles(t *testing.T) {
	root, bindings := portableSourceFixture(t)
	if err := os.WriteFile(filepath.Join(root, "kernel"), []byte("mutated"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyPortableSources(bindings, root); err == nil || !strings.Contains(err.Error(), "kernel") {
		t.Fatalf("expected mutated kernel rejection, got %v", err)
	}

	root, bindings = portableSourceFixture(t)
	if err := os.WriteFile(filepath.Join(root, "unexpected"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyPortableSources(bindings, root); err == nil || !strings.Contains(err.Error(), "exactly 17") {
		t.Fatalf("expected extra-file rejection, got %v", err)
	}
}

func TestVerifyPortableSourcesRejectsMissingDuplicateAndUnknownBindings(t *testing.T) {
	root, bindings := portableSourceFixture(t)
	if err := os.Remove(filepath.Join(root, "kernel")); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyPortableSources(bindings, root); err == nil {
		t.Fatal("missing source unexpectedly accepted")
	}

	root, bindings = portableSourceFixture(t)
	bindings.Artifacts[1] = bindings.Artifacts[0]
	if _, err := VerifyPortableSources(bindings, root); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("expected duplicate binding rejection, got %v", err)
	}

	root, bindings = portableSourceFixture(t)
	bindings.Artifacts[0].ID = "not-canonical"
	if _, err := VerifyPortableSources(bindings, root); err == nil || !strings.Contains(err.Error(), "unknown") {
		t.Fatalf("expected unknown binding rejection, got %v", err)
	}
}

func TestVerifyPortableSourcesRejectsSymlink(t *testing.T) {
	root, bindings := portableSourceFixture(t)
	target := filepath.Join(root, "kernel")
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	real := filepath.Join(t.TempDir(), "kernel-real")
	if err := os.WriteFile(real, []byte("payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, target); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := VerifyPortableSources(bindings, root); err == nil {
		t.Fatal("symlink source unexpectedly accepted")
	}
}
