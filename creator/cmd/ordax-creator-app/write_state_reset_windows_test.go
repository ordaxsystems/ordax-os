//go:build windows

package main

import (
    "os"
    "path/filepath"
    "testing"
)

func TestResetWriteResultClearsTerminalState(t *testing.T) {
	writeMu.Lock()
	writeState = physicalWriteState{
		Success:     true,
		Error:       "old error",
        DiagnosticPath: "stale-physical-error.txt",
		Status:      "old status",
		Hint:        "old hint",
		Determinate: true,
		Percent:     100,
	}
	writeMu.Unlock()

	resetWriteResult()

	writeMu.Lock()
	state := writeState
	writeMu.Unlock()
	if state.Active || state.Success || state.Error != "" || state.DiagnosticPath != "" || state.Status != "" || state.Hint != "" || state.Determinate || state.Percent != 0 {
		t.Fatalf("terminal write state was not reset: %+v", state)
	}
}

func TestResetWriteResultDoesNotTouchActiveWrite(t *testing.T) {
	writeMu.Lock()
	writeState = physicalWriteState{Active: true, Status: "writing", Percent: 42}
	writeMu.Unlock()

	resetWriteResult()

	writeMu.Lock()
	state := writeState
	writeState = physicalWriteState{}
	writeMu.Unlock()
	if !state.Active || state.Status != "writing" || state.Percent != 42 {
		t.Fatalf("active write state changed unexpectedly: %+v", state)
	}
}

func TestResetWriteResultDoesNotDeletePersistedDiagnosticOnRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "physical-write-error.txt")
	if err := os.WriteFile(path, []byte("portable writer failed after partitioning"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeMu.Lock()
	writeState = physicalWriteState{
		Error: "readback failed", DiagnosticPath: path,
		Status: "previous failure",
	}
	writeMu.Unlock()

	resetWriteResult()

	writeMu.Lock()
	state := writeState
	writeState = physicalWriteState{}
	writeMu.Unlock()
	if state.Error != "" || state.DiagnosticPath != "" || state.Status != "" {
		t.Fatalf("old failure metadata leaked into new operation: %+v", state)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "portable writer failed after partitioning" {
		t.Fatalf("retry deleted or changed preserved physical report: data=%q err=%v", data, err)
	}
}
