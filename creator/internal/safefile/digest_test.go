package safefile

import (
	"bytes"
	"errors"
	"runtime"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDigestBoundRegularRequiresExactSignedSizeAndContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "signed-component.exe")
	body := []byte("exact signed component fixture")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	got, n, err := DigestBoundRegular(path, int64(len(body)))
	if err != nil || n != int64(len(body)) || got != hex.EncodeToString(sum[:]) {
		t.Fatalf("correct signed file rejected: hash=%q size=%d err=%v", got, n, err)
	}
	for _, expected := range []int64{-1, 0, int64(len(body) - 1), int64(len(body) + 1), int64(^uint64(0) >> 1)} {
		if _, _, err := DigestBoundRegular(path, expected); err == nil {
			t.Fatalf("incorrect signed size %d was accepted", expected)
		}
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", len(body))), 0o600); err != nil {
		t.Fatal(err)
	}
	got, n, err = DigestBoundRegular(path, int64(len(body)))
	if err != nil || n != int64(len(body)) || got == hex.EncodeToString(sum[:]) {
		t.Fatalf("signed SHA-256 check cannot detect same-size modification: hash=%q n=%d err=%v", got, n, err)
	}
}

func TestDigestBoundRegularRejectsSymlinkDirectoryAndOversizedSparseFile(t *testing.T) {
	root := t.TempDir()
	if _, _, err := DigestBoundRegular(root, 1); err == nil {
		t.Fatal("directory accepted as executable")
	}
	path := filepath.Join(root, "signed-release")
	if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "symlink")
	if err := os.Symlink(path, link); err != nil {
		t.Logf("symlink unavailable: %v", err)
	} else if _, _, err := DigestBoundRegular(link, 1); err == nil {
		t.Fatal("symlink accepted as a signed executable")
	}
	if err := os.Truncate(path, 8<<20); err != nil {
		t.Skipf("sparse file unavailable: %v", err)
	}
	if _, _, err := DigestBoundRegular(path, 1<<20); err == nil || !strings.Contains(err.Error(), "changed size") {
		t.Fatalf("oversized sparse file bypassed size bound: %v", err)
	}
}

func TestDigestInventoryRegularAllowsEmptyFilesWithoutWeakeningSignedPolicy(t *testing.T) {
	root := t.TempDir()
	empty := filepath.Join(root, "empty-file")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	expected := sha256.Sum256(nil)
	digest, size, err := DigestInventoryRegular(empty, 0)
	if err != nil || size != 0 || digest != hex.EncodeToString(expected[:]) {
		t.Fatalf("empty Dev cache file unexpectedly rejected: sha=%s size=%d err=%v", digest, size, err)
	}
	if _, _, err := DigestBoundRegular(empty, 0); err == nil {
		t.Fatal("signed artifact unexpectedly accepted empty file")
	}
	for _, size := range []int64{-1, 1, int64(^uint64(0) >> 1)} {
		if _, _, err := DigestInventoryRegular(empty, size); err == nil {
			t.Fatalf("invalid Dev cache size %d accepted", size)
		}
	}
	if _, _, err := DigestInventoryRegular(root, 0); err == nil {
		t.Fatal("directory accepted as empty regular cache file")
	}
	link := filepath.Join(root, "linked-empty")
	if err := os.Symlink(empty, link); err == nil {
		if _, _, err := DigestInventoryRegular(link, 0); err == nil {
			t.Fatal("symlink to empty cache file accepted")
		}
	} else {
		t.Logf("symlinks unavailable on host: %v", err)
	}
}

func TestDigestInventoryRegularRejectsReplacedOrUnexpectedlySizedFile(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "receipt-source")
	body := []byte("legitimate development receipt")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	expected := sha256.Sum256(body)
	got, size, err := DigestInventoryRegular(path, int64(len(body)))
	if err != nil || got != hex.EncodeToString(expected[:]) || size != int64(len(body)) {
		t.Fatalf("development cache digest mismatch: sha=%s size=%d err=%v", got, size, err)
	}
	if err := os.Truncate(path, 8<<20); err != nil {
		t.Fatal(err)
	}
	if _, _, err := DigestInventoryRegular(path, int64(len(body))); err == nil || !strings.Contains(err.Error(), "changed size") {
		t.Fatalf("oversized sparse cache file passed bounded identity check: %v", err)
	}
}

func TestCopyBoundRegularStreamsExactSignedBytesFromOneVerifiedHandle(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "signed-source")
	body := []byte("portable verified source bytes")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	var copied bytes.Buffer
	digest, n, err := CopyBoundRegular(path, int64(len(body)), &copied)
	if err != nil || n != int64(len(body)) || digest != hex.EncodeToString(sum[:]) || !bytes.Equal(copied.Bytes(), body) {
		t.Fatalf("same-descriptor signed copy rejected: n=%d digest=%q err=%v", n, digest, err)
	}
	for _, size := range []int64{0, -1, int64(len(body) - 1), int64(len(body) + 1), int64(^uint64(0) >> 1)} {
		var output bytes.Buffer
		if _, _, err := CopyBoundRegular(path, size, &output); err == nil || output.Len() != 0 {
			t.Fatalf("invalid bound %d read donor: bytes=%d err=%v", size, output.Len(), err)
		}
	}
	if _, _, err := CopyBoundRegular(path, int64(len(body)), nil); err == nil {
		t.Fatal("nil staging writer accepted")
	}
	if err := os.WriteFile(path, []byte("Portable verified source bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	var altered bytes.Buffer
	actualHash, _, err := CopyBoundRegular(path, int64(len(body)), &altered)
	if err != nil || actualHash == hex.EncodeToString(sum[:]) {
		t.Fatalf("same-length modified source must return different digest: digest=%s err=%v", actualHash, err)
	}
}

func TestCopyBoundRegularRejectsUnsafeDonorWithoutCopying(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	if err := os.WriteFile(source, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{root, filepath.Join(root, "missing")} {
		var output bytes.Buffer
		if _, _, err := CopyBoundRegular(path, 1, &output); err == nil || output.Len() != 0 {
			t.Fatalf("unsafe source %q was copied: err=%v n=%d", path, err, output.Len())
		}
	}
	symlink := filepath.Join(root, "symlink")
	if err := os.Symlink(source, symlink); err == nil {
		var output bytes.Buffer
		if _, _, err := CopyBoundRegular(symlink, 1, &output); err == nil || output.Len() != 0 {
			t.Fatalf("symlink donor passed signed copy: err=%v n=%d", err, output.Len())
		}
	} else {
		t.Logf("symlinks unavailable: %v", err)
	}
	if err := os.Truncate(source, 64<<20); err != nil {
		t.Skipf("sparse truncation unavailable: %v", err)
	}
	var output bytes.Buffer
	if _, _, err := CopyBoundRegular(source, 1, &output); err == nil || output.Len() != 0 {
		t.Fatalf("oversized sparse donor copied: err=%v n=%d", err, output.Len())
	}
}

type failCopyWriter struct{}
func (failCopyWriter) Write([]byte) (int, error) { return 0, errors.New("synthetic staging disk error") }

func TestCopyBoundRegularPropagatesStagingWriteError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source")
	if err := os.WriteFile(path, []byte("signed content"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := CopyBoundRegular(path, int64(len("signed content")), failCopyWriter{}); err == nil || !strings.Contains(err.Error(), "staging disk error") {
		t.Fatalf("staging failure was silently accepted: %v", err)
	}
}

type swappingCopyWriter struct {
	source string
	replacement string
	buf bytes.Buffer
	swapped bool
}
func (w *swappingCopyWriter) Write(data []byte) (int, error) {
	if !w.swapped {
		if err := os.Rename(w.replacement, w.source); err != nil {
			return 0, err
		}
		w.swapped = true
	}
	return w.buf.Write(data)
}

func TestCopyBoundRegularDoesNotReopenSwappedSourcePath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows denies replacing a source path while its handle remains open")
	}
	root := t.TempDir()
	source := filepath.Join(root, "source")
	replacement := filepath.Join(root, "replacement")
	body := bytes.Repeat([]byte("signed-"), 4096)
	if err := os.WriteFile(source, body, 0o600); err != nil {
		t.Fatal(err)
	}
	evil := bytes.Repeat([]byte("altered"), 4096)
	if err := os.WriteFile(replacement, evil, 0o600); err != nil {
		t.Fatal(err)
	}
	w := &swappingCopyWriter{source: source, replacement: replacement}
	got, n, err := CopyBoundRegular(source, int64(len(body)), w)
	sum := sha256.Sum256(body)
	if err != nil || !w.swapped || n != int64(len(body)) || !bytes.Equal(w.buf.Bytes(), body) || got != hex.EncodeToString(sum[:]) {
		t.Fatalf("verified copy reopened swapped path: n=%d sha=%q swapped=%t err=%v", n, got, w.swapped, err)
	}
	if now, err := os.ReadFile(source); err != nil || !bytes.Equal(now, evil) {
		t.Fatalf("test did not actually swap source path: err=%v", err)
	}
}
