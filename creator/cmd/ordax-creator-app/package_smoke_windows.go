//go:build windows

package main

import "os"

// offlinePackageUISmoke exercises the *distributed executable*, not a
// separately compiled test binary. It must remain hermetic: no refreshAsync,
// update check, device discovery, elevation, network, write or saved settings.
// The CI invokes this only on a development ZIP whose SHA-256/provenance and
// read-only authority have already been checked independently.
func offlinePackageUISmoke() bool {
	// CI verifies the packaged receipt first; the EXE must independently
	// expose that same version and source Git commit. These are read-only,
	// display-only bindings, not signing material or hardware grants.
	version, source, bound := creatorBinaryBuildIdentity()
	if !bound ||
		os.Getenv("ORDAX_CREATOR_PACKAGE_EXPECT_VERSION") != version ||
		os.Getenv("ORDAX_CREATOR_PACKAGE_EXPECT_SOURCE") != source {
		return false
	}
	setCreatorLocale(string(creatorSourceLocale))
	createMainWindow(false)
	if mainWindow == 0 {
		return false
	}
	// Do not show a window or start a message pump; creation of the native
	// controls and Windows imports is the subject of this package smoke.
	controls := []uintptr{
		mainWindow, localeCombo, deviceCombo, updateButton,
		refreshButton, writeButton, bootHelpButton,
	}
	complete := true
	for _, handle := range controls {
		if handle == 0 {
			complete = false
		}
	}
	if complete {
		writeEnabled, _, _ := user32.NewProc("IsWindowEnabled").Call(writeButton)
		deviceEnabled, _, _ := user32.NewProc("IsWindowEnabled").Call(deviceCombo)
		complete = writeEnabled == 0 && deviceEnabled == 0
	}
	if refreshInProgress || writeInProgress() {
		complete = false
	}
	expectedLabel := creatorBuildLabel(appRefreshState{
		Version: version, SourceCommit: source,
	})
	if creatorVersionText != expectedLabel ||
		creatorDisplayedBuildLabel(appRefreshState{
			Version: "9.9.9-dev",
			SourceCommit: "ffffffffffffffffffffffffffffffffffffffff",
		}) != expectedLabel {
		// The GUI must not mistake a downloaded/dependent component
		// release for the identity of the packaged GUI binary.
		complete = false
	}
	stateMu.Lock()
	state := refreshState
	stateMu.Unlock()
	if state.PhysicalReady || state.BackendDirectory != "" ||
		state.PhysicalCandidate != nil || len(state.Targets) != 0 {
		complete = false
	}
	destroyed, _, _ := procDestroyWindow.Call(mainWindow)
	mainWindow = 0
	return complete && destroyed != 0
}
