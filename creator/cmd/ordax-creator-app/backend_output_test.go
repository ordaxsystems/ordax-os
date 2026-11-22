package main

import (
	"bytes"
	"testing"
	"time"
)

func TestBoundedBackendOutputRetainsOnlyAllowedBytes(t *testing.T) {
	output := &boundedBackendOutput{maxBytes: 8}
	first := []byte("123456")
	if n, err := output.Write(first); n != len(first) || err != nil {
		t.Fatalf("first write n=%d err=%v", n, err)
	}
	if output.overflow || !bytes.Equal(output.Bytes(), first) {
		t.Fatalf("valid backend output was unexpectedly truncated: %q", output.Bytes())
	}
	second := []byte("78")
	if n, err := output.Write(second); n != len(second) || err != nil {
		t.Fatalf("second write n=%d err=%v", n, err)
	}
	if output.overflow || string(output.Bytes()) != "12345678" {
		t.Fatalf("exactly bounded output was rejected: %q", output.Bytes())
	}
	large := bytes.Repeat([]byte("X"), 1024*1024)
	if n, err := output.Write(large); n != len(large) || err != nil {
		t.Fatalf("noisy helper write n=%d err=%v", n, err)
	}
	if !output.overflow || len(output.Bytes()) != 8 {
		t.Fatalf("unbounded or undetected backend output: len=%d overflow=%t", len(output.Bytes()), output.overflow)
	}
}

func TestBackendOutputReturnsIndependentSnapshot(t *testing.T) {
	output := &boundedBackendOutput{maxBytes: 4}
	_, _ = output.Write([]byte("AB"))
	snapshot := output.Bytes()
	snapshot[0] = 'Z'
	if string(output.Bytes()) != "AB" {
		t.Fatal("backend output buffer escaped to caller")
	}
}

func TestBackendOutputLimitsAndTimeoutsArePurposeBound(t *testing.T) {
	if maxBackendStdoutBytes <= 0 || maxBackendStderrBytes <= 0 ||
		maxBackendStderrBytes > maxBackendStdoutBytes {
		t.Fatal("invalid backend process output limits")
	}
	for _, operation := range []string{"targets", "status"} {
		if got := backendOperationTimeout(operation); got != 90*time.Second {
			t.Fatalf("discovery operation %q timeout=%s", operation, got)
		}
	}
	for _, operation := range []string{"prepare", "prepare-portable"} {
		if got := backendOperationTimeout(operation); got != 30*time.Minute {
			t.Fatalf("image preparation operation %q timeout=%s", operation, got)
		}
	}
	if got := backendOperationTimeout("unknown"); got != 90*time.Second {
		t.Fatalf("unknown backend operation had unbounded timeout=%s", got)
	}
}

func TestUnelevatedBackendRejectsDestructiveAndUnknownOperations(t *testing.T) {
	for _, operation := range []string{"targets", "status", "prepare", "prepare-portable"} {
		if !backendReadOnlyOperation(operation) {
			t.Fatalf("expected safe operation rejected: %s", operation)
		}
	}
	for _, operation := range []string{"", "apply", "apply-portable", "write", "format", "delete", "unknown"} {
		if backendReadOnlyOperation(operation) {
			t.Fatalf("unsafe operation accepted in UI helper: %q", operation)
		}
	}
}
