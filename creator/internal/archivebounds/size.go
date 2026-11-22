// Package archivebounds enforces the single size boundary for ZIP extraction
// in Creator's Dev and signed distribution consumers. A ZIP header is untrusted
// metadata even if its enclosing archive has a verified digest.
package archivebounds

import (
	"errors"
	"fmt"
	"io"
)

var errSize = errors.New("Creator ZIP expanded size exceeds allowed limit")

// Add rejects oversized and overflowing unsigned ZIP64 headers before any
// allocation or file write. total and max are nonnegative signed size limits.
func Add(total int64, entrySize uint64, max int64) (int64, error) {
	if max < 0 || total < 0 || total > max || entrySize > uint64(max-total) {
		return 0, errSize
	}
	return total + int64(entrySize), nil
}

// CopyExact bounds actual decompression to the validated ZIP header size and
// rejects both short and extra output. Call Add first with the consumer's own
// expansion budget; this function does not decide publisher trust.
func CopyExact(dst io.Writer, src io.Reader, expected uint64) (int64, error) {
	const maxInt64 = int64(^uint64(0) >> 1)
	if expected >= uint64(maxInt64) {
		return 0, errSize
	}
	n, err := io.Copy(dst, io.LimitReader(src, int64(expected)+1))
	if err != nil {
		return n, err
	}
	if uint64(n) != expected {
		return n, fmt.Errorf("Creator ZIP entry extracted size mismatch: expected=%d actual=%d", expected, n)
	}
	return n, nil
}
