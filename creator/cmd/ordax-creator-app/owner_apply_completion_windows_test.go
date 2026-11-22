//go:build windows && ordax_owner_prototype && ordax_single_exe && ordax_raw_backend

package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFinalizeOwnerApplyUsesVerifiedCompletionSidecarWithoutStdout(t *testing.T) {
	progressPath := filepath.Join(t.TempDir(), "ordax-physical-progress.json")
	stdoutCalled := false
	err := finalizeOwnerApply(progressPath, func() error {
		stdoutCalled = true
		return errors.New("write /dev/stdout: invalid handle")
	})
	if err != nil {
		t.Fatalf("verified physical completion depended on the elevated process stdout: %v", err)
	}
	if stdoutCalled {
		t.Fatal("elevated Windows apply must not write a JSON receipt to unbound stdout")
	}
	raw, err := os.ReadFile(progressPath)
	if err != nil {
		t.Fatalf("completed sidecar missing: %v", err)
	}
	var progress ownerApplyProgressDocument
	if err := json.Unmarshal(raw, &progress); err != nil {
		t.Fatalf("completed sidecar is not valid JSON: %v", err)
	}
	if progress.Schema != physicalProgressSchema || progress.Phase != "complete" ||
		progress.CompletedBytes != 1 || progress.TotalBytes != 1 {
		t.Fatalf("completed physical-write receipt is invalid: %+v", progress)
	}
}

func TestFinalizeOwnerApplyKeepsDirectCLIJSONReceipt(t *testing.T) {
	calls := 0
	err := finalizeOwnerApply("", func() error {
		calls++
		return nil
	})
	if err != nil || calls != 1 {
		t.Fatalf("normal CLI receipt was not emitted exactly once: calls=%d error=%v", calls, err)
	}
	wanted := errors.New("CLI JSON writer unavailable")
	if err := finalizeOwnerApply("", func() error { return wanted }); !errors.Is(err, wanted) {
		t.Fatalf("direct CLI JSON output error was ignored: %v", err)
	}
}

func TestFinalizeOwnerApplyFailsClosedWhenProgressReceiptCannotPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing", "ordax-physical-progress.json")
	stdoutCalled := false
	err := finalizeOwnerApply(path, func() error {
		stdoutCalled = true
		return nil
	})
	if err == nil {
		t.Fatal("completed physical apply was accepted without its required progress receipt")
	}
	if stdoutCalled {
		t.Fatal("failure to persist progress must not fall back to unbound stdout")
	}
}
