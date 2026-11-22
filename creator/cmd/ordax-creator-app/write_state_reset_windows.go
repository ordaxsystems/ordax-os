//go:build windows

package main

func resetWriteResult() {
	writeMu.Lock()
	defer writeMu.Unlock()
	if writeState.Active {
		return
	}
	writeState.Success = false
	writeState.Error = ""
	// Clear only the pointer in UI state. A preserved diagnostic report is
	// intentionally not deleted when the user starts a fresh attempt.
	writeState.DiagnosticPath = ""
	writeState.Status = ""
	writeState.Hint = ""
	writeState.Determinate = false
	writeState.Percent = 0
}
