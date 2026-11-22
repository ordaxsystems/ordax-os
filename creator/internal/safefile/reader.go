// Package safefile owns bounded reads of cached Creator evidence.
// It does not authenticate signatures or authorize physical media writes.
package safefile

import (
	"errors"
	"fmt"
	"io"
	"os"
)

// ReadBoundedRegular opens an existing non-symlink regular file without ever
// allocating more than maxBytes+1 bytes for its contents. The file identity
// is checked after opening to reject a replaced entry, including a symlink
// substituted between Lstat and Open. The consumer must still verify the
// document's cryptographic signature, size and content bindings.
func ReadBoundedRegular(path string, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 || maxBytes == int64(^uint64(0)>>1) {
		return nil, errors.New("invalid Creator evidence size limit")
	}
	entry, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !entry.Mode().IsRegular() || entry.Size() <= 0 || entry.Size() > maxBytes {
		return nil, fmt.Errorf("cached Creator evidence is unsafe or outside allowed size: %s", path)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !opened.Mode().IsRegular() || !os.SameFile(entry, opened) ||
		opened.Size() <= 0 || opened.Size() > maxBytes {
		return nil, fmt.Errorf("cached Creator evidence changed identity or size: %s", path)
	}
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) != opened.Size() || len(data) == 0 || int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("cached Creator evidence changed size while reading: %s", path)
	}
	return data, nil
}
