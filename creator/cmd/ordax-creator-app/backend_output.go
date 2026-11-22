package main

import (
	"bytes"
	"time"
)

// The native Creator backend is an untrusted process-output boundary even
// during read-only inspection. A noisy helper must not exhaust GUI memory.
const (
	maxBackendStdoutBytes = 256 << 10
	maxBackendStderrBytes = 32 << 10
)

type boundedBackendOutput struct {
	buffer   bytes.Buffer
	maxBytes int
	overflow bool
}

func (output *boundedBackendOutput) Write(data []byte) (int, error) {
	remaining := output.maxBytes - output.buffer.Len()
	if remaining > 0 {
		keep := len(data)
		if keep > remaining {
			keep = remaining
		}
		_, _ = output.buffer.Write(data[:keep])
	}
	if len(data) > remaining {
		output.overflow = true
	}
	return len(data), nil
}

func (output *boundedBackendOutput) Bytes() []byte {
	return bytes.Clone(output.buffer.Bytes())
}

// The hidden, unelevated UI backend is exclusively for discovery and
// preparation. Never let this convenience wrapper become a second apply path.
func backendReadOnlyOperation(operation string) bool {
	switch operation {
	case "targets", "status", "prepare", "prepare-portable":
		return true
	default:
		return false
	}
}

// Discovery must not leave a permanently spinning first-use screen. Preparing
// an image can legitimately take longer, but is still bounded. No timeout
// authorizes writing: elevated apply has its independent consent and gates.
func backendOperationTimeout(operation string) time.Duration {
	switch operation {
	case "prepare", "prepare-portable":
		return 30 * time.Minute
	default:
		return 90 * time.Second
	}
}
