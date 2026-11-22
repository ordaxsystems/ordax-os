package safefile

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
)

// DigestBoundRegular hashes a cached official artifact using its independently
// verified positive signed size and stable open-file identity. Hashing never
// reads beyond the expected size plus one byte.
func DigestBoundRegular(path string, expectedSize int64) (string, int64, error) {
	if expectedSize <= 0 || expectedSize == int64(^uint64(0)>>1) {
		return "", 0, errors.New("invalid signed Creator artifact size")
	}
	return digestRegular(path, expectedSize, nil)
}

// DigestInventoryRegular uses the same bounded, identity-checked hash path for
// unsigned development cache receipts, which may legitimately contain empty
// files. This verifies local byte integrity, not publisher authenticity.
func DigestInventoryRegular(path string, expectedSize int64) (string, int64, error) {
	if expectedSize < 0 || expectedSize == int64(^uint64(0)>>1) {
		return "", 0, errors.New("invalid Creator development inventory file size")
	}
	return digestRegular(path, expectedSize, nil)
}

// CopyBoundRegular copies exactly one positive-size signed cache artifact to an
// unpublished staging writer, hashing the same opened file descriptor during
// the copy. The caller MUST compare the result against the independently
// verified signed SHA-256, and MUST discard the staging output on any mismatch
// or error before exposing it as an installed artifact.
func CopyBoundRegular(path string, expectedSize int64, staging io.Writer) (string, int64, error) {
	if expectedSize <= 0 || expectedSize == int64(^uint64(0)>>1) || staging == nil {
		return "", 0, errors.New("invalid signed Creator cache copy parameters")
	}
	return digestRegular(path, expectedSize, staging)
}

// digestRegular is the only streamed SHA-256 reader/copy source for Creator
// cache files. Never trust an earlier directory walk or digest if opening the
// same mutable path a second time: verify the identity of the descriptor that
// actually provides the bytes.
func digestRegular(path string, expectedSize int64, staging io.Writer) (string, int64, error) {
	entry, err := os.Lstat(path)
	if err != nil {
		return "", 0, err
	}
	if !entry.Mode().IsRegular() || entry.Size() != expectedSize {
		return "", 0, fmt.Errorf("cached Creator artifact is unsafe or changed size: %s", path)
	}
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return "", 0, err
	}
	if !opened.Mode().IsRegular() || !os.SameFile(entry, opened) || opened.Size() != expectedSize {
		return "", 0, fmt.Errorf("cached Creator artifact changed identity or size while opening: %s", path)
	}

	hash := sha256.New()
	var target io.Writer = hash
	if staging != nil {
		target = io.MultiWriter(staging, hash)
	}
	n, err := io.Copy(target, io.LimitReader(file, expectedSize+1))
	if err != nil {
		return "", 0, err
	}
	if n != expectedSize {
		return "", 0, fmt.Errorf("cached Creator artifact changed size while reading: %s", path)
	}
	return hex.EncodeToString(hash.Sum(nil)), n, nil
}
