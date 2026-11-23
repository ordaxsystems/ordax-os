//go:build windows

package main

import (
    "errors"
    "os"
    "runtime"
    "strings"
    "testing"
    "unsafe"
)

// This smoke test creates the same native Win32 UI controls as production,
// but NEVER starts device discovery, refresh, updates, UAC or a writer.
// It exercises Windows DLL imports and actual control creation on a Windows runner.
func TestWindowsNativeUIInitializesWithoutAnyPhysicalIO(t *testing.T) {
    if os.Getenv("ORDAX_CREATOR_WINDOWS_UI_SMOKE") != "1" {
        t.Skip("native Win32 smoke runs only in explicitly guarded Windows CI")
    }
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    setCreatorLocale(string(creatorSourceLocale))
    createMainWindow(false)
    if mainWindow == 0 {
        t.Fatal("Win32 main window was not created")
    }
    defer func() {
        hwnd := mainWindow
        if hwnd != 0 {
            destroyed, _, err := procDestroyWindow.Call(hwnd)
            if destroyed == 0 {
                t.Errorf("DestroyWindow failed: %v", err)
            }
        }
        mainWindow = 0
    }()

    for name, handle := range map[string]uintptr{
        "locale": localeCombo,
        "device": deviceCombo,
        "update": updateButton,
        "refresh": refreshButton,
        "write": writeButton,
        "boot-help": bootHelpButton,
    } {
        if handle == 0 {
            t.Errorf("missing native %s control", name)
        }
    }
    if writeButton != 0 {
        enabled, _, _ := user32.NewProc("IsWindowEnabled").Call(writeButton)
        if enabled != 0 {
            t.Fatal("physical write button enabled without any signed physical candidate")
        }
    }
    stateMu.Lock()
    state := refreshState
    stateMu.Unlock()
    if state.PhysicalReady || state.BackendDirectory != "" || len(state.Targets) > 0 || state.PhysicalCandidate != nil {
        t.Fatal("Win32 startup smoke unexpectedly acquired a physical candidate or target")
    }
    t.Log("Win32 controls created with physical write disabled; no enumeration or update started")

    // Reproduce the stale-selection bug using synthetic in-memory state only.
    // The test window has no services and never enumerates or opens any disk.
    previousLocale := currentCreatorLocale()
    defer func() {
        refreshInProgress = false
        setCreatorLocale(string(previousLocale))
        stateMu.Lock()
        refreshState = appRefreshState{}
        stateMu.Unlock()
    }()
    fixture := appRefreshState{
        Targets: []physicalTarget{{DiskNumber: 9, PrototypeSafe: true}},
        PhysicalReady: true,
        BackendDirectory: "synthetic-only-not-an-installed-backend",
    }
    send(deviceCombo, cbAddString, 0, uintptr(unsafe.Pointer(utf16Ptr("Synthetic USB — no device"))))
    send(deviceCombo, cbSetCurSel, 0, 0)
    stateMu.Lock()
    refreshState = fixture
    stateMu.Unlock()
    renderSelectionExperience(fixture)
    isEnabled := func() bool {
        value, _, _ := user32.NewProc("IsWindowEnabled").Call(writeButton)
        return value != 0
    }
    if !isEnabled() {
        t.Fatal("synthetic pre-refresh review could not reproduce enabled creation control")
    }
    refreshInProgress = true
    enable(writeButton, false) // beginRefresh's synchronous UI lockout.
    setCreatorLocale(string(creatorLocaleENUS))
    renderCreatorLocaleUI()
    if isEnabled() {
        t.Fatal("changing locale during refresh reenabled a stale USB write action")
    }
    if creatorStatusText != creatorT(msgRefreshSearching) || creatorHintText != creatorT(msgRefreshHint) {
        t.Fatalf("changing locale replaced refresh notice with stale state: %q / %q", creatorStatusText, creatorHintText)
    }
    if _, _, err := selectedPhysicalTarget(); err == nil {
        t.Fatal("a physical target was selectable while the list was being refreshed")
    }
    // A queued terminal completion must not reenable a stale control.
    renderWriteDone()
    if isEnabled() {
        t.Fatal("queued write completion reenabled a target during refresh")
    }
    t.Log("Locale change and queued completion kept write unavailable during synthetic refresh")

    // Exercise actual owner-drawn update controls, without starting a
    // network request, physical discovery, elevation or writing.
    refreshInProgress = false
    updateMu.Lock()
    savedUpdateState := currentUpdateState
    updateMu.Unlock()
    defer func() {
        updateMu.Lock()
        currentUpdateState = savedUpdateState
        updateMu.Unlock()
    }()
    for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
        setCreatorLocale(string(locale))
        for _, tc := range []struct {
            state updateUIState
            message creatorMessageID
            enabled bool
        }{
            {updateUIState{}, msgUpdateControl, true},
            {updateUIState{Checking: true}, msgUpdateChecking, false},
            {updateUIState{Error: "network offline"}, msgUpdateRetryAction, true},
            {updateUIState{Checked: true}, msgUpdateCurrentAction, true},
            {updateUIState{Checked: true, Available: true}, msgUpdateAvailableAction, true},
        } {
            updateMu.Lock()
            currentUpdateState = tc.state
            updateMu.Unlock()
            renderUpdateUI()
            if label := creatorControlCaption(updateButton); label != creatorT(tc.message) {
                t.Fatalf("locale %s native update caption = %q, want %q", locale, label, creatorT(tc.message))
            }
            enabled, _, _ := user32.NewProc("IsWindowEnabled").Call(updateButton)
            if (enabled != 0) != tc.enabled {
                t.Fatalf("locale %s update button enabled=%t, want %t for %s", locale, enabled != 0, tc.enabled, tc.message)
            }
        }
    }
    t.Log("Native update controls reflect retry, current and available states in both locales without external I/O")

    // Delayed WM_APP_PROGRESS and WM_APP_DONE can be delivered after the
    // worker has transitioned to a terminal state or a new active run.
    // Test the actual Win32 rendering guards with synthetic state only.
    writeMu.Lock()
    savedWriteState := writeState
    writeState = physicalWriteState{Success: true, Status: "finished"}
    writeMu.Unlock()
    savedStatus := creatorStatusText
    defer func() {
        writeMu.Lock()
        writeState = savedWriteState
        writeMu.Unlock()
        setCreatorStatus(savedStatus)
    }()
    setCreatorStatus("terminal status retained")
    enable(writeButton, true)
    renderWriteProgress()
    if creatorStatusText != "terminal status retained" {
        t.Fatal("queued progress overwrote a terminal UI result")
    }
    enabled, _, _ := user32.NewProc("IsWindowEnabled").Call(writeButton)
    if enabled == 0 {
        t.Fatal("queued progress disabled the final Finish action")
    }

    writeMu.Lock()
    writeState = physicalWriteState{Active: true, Status: "writing in progress"}
    writeMu.Unlock()
    setCreatorStatus("active status retained")
    renderWriteDone()
    if creatorStatusText != "active status retained" {
        t.Fatal("queued completion overwrote an active physical run")
    }
    t.Log("Delayed native progress and completion messages cannot replace another lifecycle state")

    // Physical failure presentation and retry are exercised with actual
    // native controls but no physical discovery, UAC, process or disk access.
    stateMu.Lock()
    priorRefreshState := refreshState
    refreshState = appRefreshState{} // retry must not require a cached USB.
    stateMu.Unlock()
    defer func() {
        stateMu.Lock()
        refreshState = priorRefreshState
        stateMu.Unlock()
    }()
    writeMu.Lock()
    writeState = physicalWriteState{
        Error: "synthetic Portable readback failure",
        DiagnosticPath: `C:\Temp\ordax-physical-write-report.txt`,
    }
    writeMu.Unlock()
    setCreatorLocale(string(creatorLocalePTBR))
    renderWriteDone()
    if caption := creatorControlCaption(writeButton); caption != creatorT(msgActionRetry) || !isEnabled() {
        t.Fatalf("no-target failure did not keep safe retry available: caption=%q enabled=%t", caption, isEnabled())
    }
    if caption := creatorControlCaption(bootHelpButton); caption != creatorT(msgActionFailureDetails) {
        t.Fatalf("failure detail action not displayed: %q", caption)
    }
    setCreatorLocale(string(creatorLocaleENUS))
    renderCreatorLocaleUI()
    expected := creatorExperience(creatorExperienceInput{ErrorMessageID:msgPhysicalWriteFailedDetail, ErrorStepNumber:4})
    if creatorStatusText != expected.Title || creatorControlCaption(writeButton) != creatorT(msgActionRetry) ||
        creatorControlCaption(bootHelpButton) != creatorT(msgActionFailureDetails) ||
        !isEnabled() {
        t.Fatalf("locale change erased failed-write state: status=%q retry=%q details=%q",
            creatorStatusText, creatorControlCaption(writeButton), creatorControlCaption(bootHelpButton))
    }
    if !strings.Contains(creatorHintText, "ordax-physical-write-report.txt") {
        t.Fatalf("localized failure lost diagnostic reference: %q",creatorHintText)
    }
    send(deviceCombo, cbSetCurSel, 0, 0)
    if selectedTargetIndex() != 0 {
        t.Fatal("synthetic selection not established for recovery test")
    }
    clearUSBSelectionForRecovery()
    if selectedTargetIndex() != -1 {
        t.Fatal("recovery retained an old physical target without a new explicit choice")
    }
    t.Log("Native retry remains available without USB, error survives locale change, and previous target is cleared")

    // A failed attempt can leave its old USB in the cached discovery state.
    // Even a queued selection event must not remove the failure and enable
    // another destructive action. An explicit Refresh and the Retry button
    // must both start with no selected target.
    stateMu.Lock()
    refreshState = fixture
    stateMu.Unlock()
    send(deviceCombo, cbSetCurSel, 0, 0)
    writeMu.Lock()
    writeState = physicalWriteState{
        Error: "synthetic partial Portable USB failure",
        DiagnosticPath: `C:\Temp\previous-writer-diagnostic.txt`,
    }
    writeMu.Unlock()
    renderWriteDone()
    comboEnabled, _, _ := user32.NewProc("IsWindowEnabled").Call(deviceCombo)
    if comboEnabled != 0 {
        t.Fatal("failed physical write left the previous USB combo interactive")
    }
    if !isEnabled() || creatorControlCaption(writeButton) != creatorT(msgActionRetry) {
        t.Fatal("terminal failure no longer offered read-only Retry")
    }
    updateSelectionUI() // Simulate a previously queued CBN_SELCHANGE.
    writeMu.Lock()
    failureRetained := writeState.Error != "" && !writeState.Active
    writeMu.Unlock()
    if !failureRetained || creatorControlCaption(writeButton) != creatorT(msgActionRetry) {
        t.Fatal("queued old USB selection erased the terminal failure")
    }
    captureUSBSelectionForRefresh() // Shared by Refresh and Retry, no services.
    if selectedTargetIndex() != -1 || pendingRefreshSelection != nil {
        t.Fatal("recovery refresh kept an old physical USB selected")
    }

    // Ordinary read-only refresh remains unchanged: an already explicitly
    // selected safe target may be restored only by exact identity check.
    writeMu.Lock()
    writeState = physicalWriteState{}
    writeMu.Unlock()
    send(deviceCombo, cbSetCurSel, 0, 0)
    captureUSBSelectionForRefresh()
    if pendingRefreshSelection == nil || pendingRefreshSelection.DiskNumber != fixture.Targets[0].DiskNumber {
        t.Fatal("ordinary USB refresh unexpectedly lost explicit selection history")
    }
    pendingRefreshSelection = nil

    // A queued Refresh click must not unwind a verified successful write
    // and accidentally reactivate selection or start a discovery worker.
    writeMu.Lock()
    writeState = physicalWriteState{Success: true}
    writeMu.Unlock()
    refreshInProgress = false
    beginRefresh()
    if refreshInProgress || pendingRefreshSelection != nil {
        t.Fatal("queued Refresh after successful write started a new discovery")
    }
    t.Log("Failed USB retries and stale selection events are fail-closed; completed write ignores queued Refresh")

    // Integrated native lifecycle, still entirely synthetic: preparation,
    // elevated failure, diagnostic UI, and a separately verified success.
    // No discovery, authorization prompt, subprocess or physical write runs.
    updateWriteProgress("synthetic preparation", "no USB access")
    renderWriteProgress()
    if !writeInProgress() || isEnabled() {
        t.Fatal("synthetic preparation left the destructive action enabled")
    }
    helpEnabled, _, _ := user32.NewProc("IsWindowEnabled").Call(bootHelpButton)
    if helpEnabled != 0 {
        t.Fatal("failure-detail action was enabled during active preparation")
    }
    completeWrite(&physicalWriteFailure{
        cause: errors.New("synthetic Portable readback integrity failure"),
        diagnosticPath: `C:\Temp\synthetic-creator-report.txt`,
    })
    renderWriteDone()
    if isEnabled() == false ||
       creatorControlCaption(writeButton) != creatorT(msgActionRetry) ||
       creatorControlCaption(bootHelpButton) != creatorT(msgActionFailureDetails) ||
       !strings.Contains(creatorHintText, "synthetic-creator-report.txt") {
        t.Fatalf("failed synthetic writer was not recoverable: retry=%q details=%q hint=%q",
            creatorControlCaption(writeButton), creatorControlCaption(bootHelpButton), creatorHintText)
    }
    updateWriteProgress("new synthetic preparation", "still no USB access")
    renderWriteProgress()
    completeWrite(nil) // Models verified zero process exit, not sidecar.
    renderWriteDone()
    comboEnabled, _, _ = user32.NewProc("IsWindowEnabled").Call(deviceCombo)
    refreshEnabled, _, _ := user32.NewProc("IsWindowEnabled").Call(refreshButton)
    if !isEnabled() || comboEnabled != 0 || refreshEnabled != 0 ||
       creatorControlCaption(writeButton) != creatorT(msgActionFinish) ||
       creatorProgressValue != 100 {
        t.Fatalf("successful synthetic writer exposed stale actions: write=%q enabled=%t USB=%d refresh=%d progress=%d",
            creatorControlCaption(writeButton), isEnabled(), comboEnabled, refreshEnabled, creatorProgressValue)
    }
    t.Log("Synthetic native lifecycle: preparing -> failed -> safe retry -> verified success, no physical I/O")






}
