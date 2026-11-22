//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	physicalchannel "github.com/ordaxsystems/ordax-os/creator/physicalchannel"
)

const (
	windowClassName = "OrdaXCreatorWindow"
	windowTitle     = "OrdaX Creator"

	wmDestroy = 0x0002
	wmCommand = 0x0111
	wmClose   = 0x0010
	wmApp     = 0x8000

	wmAppRefreshDone   = wmApp + 1
	wmAppWriteProgress = wmApp + 2
	wmAppWriteDone     = wmApp + 3
	wmAppUpdateDone    = wmApp + 4
	wmAppUSBUpdateDone = wmApp + 5
	wmAppUSBTrustedReady = wmApp + 6

	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	wsChild            = 0x40000000
	wsClipChildren     = 0x02000000
	wsTabStop          = 0x00010000
	wsDisabled         = 0x08000000
	wsVScroll          = 0x00200000

	bsPushButton    = 0x00000000
	bsDefPushButton = 0x00000001
	cbsDropDownList = 0x0003
	pbsMarquee      = 0x00000008

	iccProgressClass = 0x00000020
	pbmSetPos        = 0x0402
	pbmSetMarquee    = 0x040A

	cwUseDefault = 0x80000000
	swShow       = 5

	idDeviceCombo = 1001
	idRefresh     = 1002
	idWrite       = 1003
	idStatus      = 1004
	idVersion     = 1005
	idHint        = 1006
	idUpdate      = 1007
	idProgress    = 1008
	idBootHelp    = 1009
	idLocaleCombo = 1010
	idUSBUpdate = 1011

	cbAddString    = 0x0143
	cbResetContent = 0x014B
	cbSetCurSel    = 0x014E
	cbGetCurSel    = 0x0147
	cbnSelChange   = 1
	bnClicked      = 0

	createNoWindow = 0x08000000
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	comctl32 = syscall.NewLazyDLL("comctl32.dll")

	procRegisterClassExW     = user32.NewProc("RegisterClassExW")
	procCreateWindowExW      = user32.NewProc("CreateWindowExW")
	procDefWindowProcW       = user32.NewProc("DefWindowProcW")
	procShowWindow           = user32.NewProc("ShowWindow")
	procUpdateWindow         = user32.NewProc("UpdateWindow")
	procGetMessageW          = user32.NewProc("GetMessageW")
	procTranslateMessage     = user32.NewProc("TranslateMessage")
	procDispatchMessageW     = user32.NewProc("DispatchMessageW")
	procPostQuitMessage      = user32.NewProc("PostQuitMessage")
	procPostMessageW         = user32.NewProc("PostMessageW")
	procSendMessageW         = user32.NewProc("SendMessageW")
	procSetWindowTextW       = user32.NewProc("SetWindowTextW")
	procEnableWindow         = user32.NewProc("EnableWindow")
	procGetModuleHandleW     = kernel32.NewProc("GetModuleHandleW")
	procGetStockObject       = gdi32.NewProc("GetStockObject")
	procInitCommonControlsEx = comctl32.NewProc("InitCommonControlsEx")

	mainWindow     uintptr
	deviceCombo    uintptr
	localeCombo    uintptr
	refreshButton  uintptr
	updateButton   uintptr
	usbUpdateButton uintptr
	writeButton    uintptr
	bootHelpButton uintptr

	stateMu      sync.Mutex
	refreshState appRefreshState

	// UI-thread-only interlock: a refresh must finish before stale USB state
	// may enable a physical write or another discovery worker.
	refreshInProgress bool

	// UI-thread only. A refresh may preserve an explicitly selected physical
	// USB, but no target is ever implicitly selected on first discovery.
	pendingRefreshSelection *physicalTarget

	// Display-only copy has one owner: the buffered parent painter.
	creatorStatusText    = ""
	creatorHintText      = ""
	creatorVersionText   = ""
	creatorProgressValue = 0
	creatorProgressBusy  = false
)

type point struct {
	X int32
	Y int32
}

type msg struct {
	HWnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
	Private uint32
}

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

type initCommonControlsEx struct {
	Size uint32
	ICC  uint32
}

type physicalTargetsDocument struct {
	Schema  string           `json:"$schema"`
	Mode    string           `json:"mode"`
	Targets []physicalTarget `json:"targets"`
}

type physicalTarget struct {
	DriveLetter       string `json:"drive_letter"`
	VolumeLabel       string `json:"volume_label"`
	DriveType         string `json:"drive_type"`
	DiskNumber        int    `json:"disk_number"`
	PhysicalDiskBytes uint64 `json:"physical_disk_bytes"`
	DeviceSerial      string `json:"device_serial"`
	SystemDisk        bool   `json:"system_disk"`
	PrototypeSafe     bool   `json:"prototype_safe"`
	ConfirmationToken string `json:"confirmation_token"`
}

type appRefreshState struct {
	Version          string
	SourceCommit     string
	Updated          bool
	NoticeID         creatorMessageID
	Targets          []physicalTarget
	Error            string
	PhysicalReady    bool
	PhysicalMode     string
	BackendDirectory string
	PortablePayload  *physicalchannel.PortablePayloadManifest
	// Retain the exact already-verified physical manifest for fail-closed
	// revalidation of the privileged writer before preparation and UAC.
	PhysicalCandidate *physicalchannel.Installed
}

type physicalBackendReadiness struct {
	LegacyOwner bool
	Portable    bool
}

func utf16Ptr(value string) *uint16 {
	ptr, err := syscall.UTF16PtrFromString(value)
	if err != nil {
		panic(err)
	}
	return ptr
}

func loword(value uintptr) uint16 { return uint16(value & 0xffff) }
func hiword(value uintptr) uint16 { return uint16((value >> 16) & 0xffff) }

func setText(hwnd uintptr, text string) {
	if hwnd != 0 {
		procSetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(utf16Ptr(text))))
	}
}

func setCreatorStatus(text string)  { creatorStatusText = text; invalidateGuidedVisual() }
func setCreatorHint(text string)    { creatorHintText = text; invalidateGuidedVisual() }
func setCreatorVersion(text string) { creatorVersionText = text; invalidateGuidedVisual() }

func enable(hwnd uintptr, enabled bool) {
	value := uintptr(0)
	if enabled {
		value = 1
	}
	procEnableWindow.Call(hwnd, value)
}

func send(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	result, _, _ := procSendMessageW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func createControl(class, text string, style uint32, x, y, width, height int32, id int) uintptr {
	hwnd, _, err := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(utf16Ptr(class))),
		uintptr(unsafe.Pointer(utf16Ptr(text))),
		uintptr(style|wsChild|wsVisible),
		uintptr(x), uintptr(y), uintptr(width), uintptr(height),
		mainWindow,
		uintptr(id),
		0,
		0,
	)
	if hwnd == 0 {
		panic(fmt.Sprintf("CreateWindowExW(%s): %v", class, err))
	}
	font, _, _ := procGetStockObject.Call(17)
	procSendMessageW.Call(hwnd, 0x0030, font, 1)
	return hwnd
}

// Progress is painted by the same buffered parent surface as the rest of the
// noninteractive UI. No native white-themed progress window or marquee timer.
func setProgressIdle() {
	creatorProgressValue = 0
	creatorProgressBusy = false
	invalidateGuidedVisual()
}
func setProgressActive() {
	creatorProgressValue = 0
	creatorProgressBusy = true
	invalidateGuidedVisual()
}
func setProgressComplete() {
	creatorProgressValue = 100
	creatorProgressBusy = false
	invalidateGuidedVisual()
}

func formatBytes(value uint64) string {
	const gib = uint64(1024 * 1024 * 1024)
	const mib = uint64(1024 * 1024)
	if value >= gib {
		return fmt.Sprintf("%.1f GB", float64(value)/float64(gib))
	}
	return fmt.Sprintf("%.0f MB", float64(value)/float64(mib))
}

func targetIsPhysicalRecovery(target physicalTarget) bool {
	return target.DriveType == "physical-unmounted" || strings.TrimSpace(target.DriveLetter) == ""
}

func targetDisplayName(target physicalTarget) string {
	label := strings.TrimSpace(target.VolumeLabel)
	if targetIsPhysicalRecovery(target) {
		return creatorT(msgTargetRecoveryName)
	}
	if label == "" {
		return creatorT(msgTargetUnnamed)
	}
	return label
}

func targetDiskLabel(target physicalTarget) string {
	return creatorTValues(msgTargetDiskLabel, map[string]string{"disk": fmt.Sprintf("%d", target.DiskNumber)})
}

func targetDriveLabel(target physicalTarget) string {
	if targetIsPhysicalRecovery(target) {
		return creatorT(msgTargetRecoveryDrive)
	}
	return strings.TrimSpace(target.DriveLetter)
}

func targetPrimaryIdentity(target physicalTarget) string {
	if targetIsPhysicalRecovery(target) {
		return targetDisplayName(target)
	}
	return strings.TrimSpace(target.DriveLetter + " · " + targetDisplayName(target))
}

func targetSecondaryIdentity(target physicalTarget) string {
	return targetDiskLabel(target) + " · " + formatBytes(target.PhysicalDiskBytes)
}

func targetLabel(target physicalTarget) string {
	return targetPrimaryIdentity(target) + "  —  " + targetSecondaryIdentity(target)
}

func shortSourceCommit(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 40 {
		return ""
	}
	for _, ch := range value {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
			return ""
		}
	}
	return value[:8]
}

func creatorBuildLabel(state appRefreshState) string {
	if state.Version == "" {
		return "OrdaX Creator • " + creatorT(msgVersionChecking)
	}
	label := "OrdaX Creator • " + state.Version
	if commit := shortSourceCommit(state.SourceCommit); commit != "" {
		label += " • " + commit
	}
	if state.Updated {
		label += " • " + creatorT(msgVersionUpdated)
	}
	return label
}

// A packaged development GUI must identify the *executable* actually opened,
// even when creator-dev cannot be downloaded or a cached helper is older.
// Owner/publisher builds which omit this display-only -X binding retain their
// separately validated provenance and canonical channel label.
func creatorDisplayedBuildLabel(state appRefreshState) string {
	if version, source, ok := creatorBinaryBuildIdentity(); ok {
		return creatorBuildLabel(appRefreshState{
			Version:      version,
			SourceCommit: source,
		})
	}
	return creatorBuildLabel(state)
}

// The backend is read only in this path. Do not include raw command arguments
// or helper stderr in UI errors: --confirm and other values are sensitive.
func runBackendHidden(directory string, args ...string) ([]byte, error) {
	if len(args) == 0 {
		return nil, fmt.Errorf("Creator backend operation was not specified")
	}
	operation := args[0]
	if !backendReadOnlyOperation(operation) {
		return nil, fmt.Errorf("Creator backend operation is not allowed in the unelevated UI")
	}
	exe := filepath.Join(directory, "ordax-creator-physical-test.exe")
	if direct, ok := ownerReadOnlyBackendExecutable(directory); ok {
		exe = direct // Same verified Owner EXE; no 700 MB Temp duplication on discovery.
	}
	ctx, cancel := context.WithTimeout(context.Background(), backendOperationTimeout(operation))
	defer cancel()

	command := exec.CommandContext(ctx, exe, args...)
	command.Dir = directory
	command.WaitDelay = 2 * time.Second
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	stdout := &boundedBackendOutput{maxBytes: maxBackendStdoutBytes}
	stderr := &boundedBackendOutput{maxBytes: maxBackendStderrBytes}
	command.Stdout = stdout
	command.Stderr = stderr
	runErr := command.Run()
	if ctx.Err() != nil {
		return nil, fmt.Errorf("Creator backend %s timed out: %w", operation, ctx.Err())
	}
	if stdout.overflow || stderr.overflow {
		return nil, fmt.Errorf("Creator backend %s exceeded the output size limit", operation)
	}
	if runErr != nil {
		return nil, fmt.Errorf("Creator backend %s failed: %w", operation, runErr)
	}
	return stdout.Bytes(), nil
}

func loadTargets(directory string) ([]physicalTarget, physicalBackendReadiness, error) {
	output, err := runBackendHidden(directory, "targets")
	if err != nil {
		return nil, physicalBackendReadiness{}, fmt.Errorf("detectar pendrives: %w", err)
	}
	var document physicalTargetsDocument
	if err := json.Unmarshal(output, &document); err != nil {
		return nil, physicalBackendReadiness{}, fmt.Errorf("ler lista de pendrives: %w", err)
	}
	if document.Schema != "prototype-ordax.creator-physical-test-targets/1" || document.Mode != "read-only" {
		return nil, physicalBackendReadiness{}, fmt.Errorf("resposta de dispositivos inesperada")
	}
	for _, target := range document.Targets {
		if target.SystemDisk || !target.PrototypeSafe || len(target.ConfirmationToken) != 64 {
			return nil, physicalBackendReadiness{}, fmt.Errorf("o backend retornou um alvo que não passou pela política de segurança")
		}
	}

	statusOutput, err := runBackendHidden(directory, "status")
	if err != nil {
		return nil, physicalBackendReadiness{}, fmt.Errorf("consultar estado físico: %w", err)
	}
	var status struct {
		RawBackendLinked    bool `json:"raw_backend_linked"`
		PortableWriterReady bool `json:"portable_writer_ready"`
		Build               struct {
			PhysicalWriteAuthorized bool `json:"physical_write_authorized"`
			Ready                   bool `json:"ready"`
		} `json:"build"`
	}
	if err := json.Unmarshal(statusOutput, &status); err != nil {
		return nil, physicalBackendReadiness{}, fmt.Errorf("ler estado físico: %w", err)
	}
	return document.Targets, physicalBackendReadiness{
		LegacyOwner: status.RawBackendLinked && status.Build.PhysicalWriteAuthorized && status.Build.Ready,
		Portable:    status.RawBackendLinked && status.Build.PhysicalWriteAuthorized && status.PortableWriterReady,
	}, nil
}

func refreshAsync() {
	go func() {
		result := resolveRefreshState()
		stateMu.Lock()
		refreshState = result
		stateMu.Unlock()
		procPostMessageW.Call(mainWindow, wmAppRefreshDone, 0, 0)
	}()
}

func selectedTargetIndex() int {
	index := int32(send(deviceCombo, cbGetCurSel, 0, 0))
	if index < 0 {
		return -1
	}
	return int(index)
}

func selectionExperience(state appRefreshState) creatorExperienceView {
	index := selectedTargetIndex()
	selected := index >= 0 && index < len(state.Targets)
	return selectionExperienceForState(state, selected)
}

// Cached-channel notices never substitute for a verified physical writer.
// Only fatal acquisition/target errors can turn an otherwise valid state
// into a blocked experience; the physical readiness gate remains unchanged.
func selectionExperienceForState(state appRefreshState, selected bool) creatorExperienceView {
	var errorMessageID creatorMessageID
	errorStep := 0
	if state.Error != "" {
		errorMessageID = msgRefreshFailedDetail
		errorStep = 1
	}
	return creatorExperience(creatorExperienceInput{TargetCount: len(state.Targets), TargetSelected: selected, PhysicalReady: state.PhysicalReady, ErrorMessageID: errorMessageID, ErrorStepNumber: errorStep})
}

// restoredUSBSelectionIndex preserves a user's explicit selection only when
// the refreshed device has an unambiguous, stable physical identity. Drive
// letter and volume label may change between scans. If the device has no
// serial, was replaced or appears twice, force deliberate reselection.
// This is UX only: actual writing revalidates the live target independently.
func restoredUSBSelectionIndex(previous *physicalTarget, targets []physicalTarget) int {
	if previous == nil || previous.SystemDisk || !previous.PrototypeSafe ||
		strings.TrimSpace(previous.DeviceSerial) == "" ||
		!validLowerHexString(previous.ConfirmationToken, 64) {
		return -1
	}
	found := -1
	for index, target := range targets {
		if target.SystemDisk || !target.PrototypeSafe ||
			target.DiskNumber != previous.DiskNumber ||
			target.PhysicalDiskBytes != previous.PhysicalDiskBytes ||
			target.DeviceSerial != previous.DeviceSerial ||
			target.ConfirmationToken != previous.ConfirmationToken {
			continue
		}
		if found >= 0 {
			return -1
		}
		found = index
	}
	return found
}

func renderSelectionExperience(state appRefreshState) {
	if refreshInProgress {
		setCreatorStatus(creatorT(msgRefreshSearching))
		setCreatorHint(creatorT(msgRefreshHint))
		enable(writeButton, false)
		enable(usbUpdateButton, false)
		return
	}
	setText(bootHelpButton, creatorT(msgActionBootHelp))
	enable(bootHelpButton, true)
	view := selectionExperience(state)
	status := view.Title
	if view.Eyebrow != "" {
		status = view.Eyebrow + " · " + status
	}
	setCreatorStatus(status)
	hint := strings.TrimSpace(view.Body + " " + view.Detail)
	if state.Error == "" && state.NoticeID != "" {
		hint = strings.TrimSpace(hint + " " + creatorT(state.NoticeID))
	}
	if !state.PhysicalReady && ownerUSBCanStageSelected(state, selectedTargetIndex()) {
        hint = strings.TrimSpace(hint + " " + creatorT(msgUSBTransportAvailable))
    }
	setCreatorHint(hint)

	busy := writeInProgress() || ownerUSBUpdateInProgress()
	enable(writeButton, !busy && view.Step == creatorStepReview && view.CanContinue)
	enable(usbUpdateButton, !busy && ownerUSBCanStageSelected(state, selectedTargetIndex()))
	if view.Step == creatorStepReview && view.PrimaryAction != "" {
		setText(writeButton, view.PrimaryAction)
	} else {
		setText(writeButton, creatorT(msgActionCreate))
	}
	invalidateGuidedVisual()
}

// A destructive failure can leave the selected USB repartitioned. The
// recovery refresh must not silently restore the previous target choice.
// It still requires fresh discovery, explicit selection and new consent.
func clearUSBSelectionForRecovery() {
	if deviceCombo != 0 {
		send(deviceCombo, cbSetCurSel, ^uintptr(0), 0)
	}
}

func updateSelectionUI() {
	stateMu.Lock()
	state := refreshState
	stateMu.Unlock()

	// Combo notifications already queued before a write fails can arrive
	// after its terminal result. Never discard that result or promote a
	// stale selection into another destructive confirmation.
	failed, succeeded := physicalWriteTerminalFlags()
	if refreshInProgress || writeInProgress() || failed || succeeded || len(state.Targets) == 0 {
		return
	}
	resetWriteResult()
	renderSelectionExperience(state)
}

func renderRefresh() {
	// Only the UI thread changes this gate, after the worker has published
	// the new snapshot. All controls are reconciled with that snapshot below.
	refreshInProgress = false
	stateMu.Lock()
	state := refreshState
	stateMu.Unlock()

	selection := -1
	if state.Error == "" {
		selection = restoredUSBSelectionIndex(pendingRefreshSelection, state.Targets)
	}
	pendingRefreshSelection = nil
	send(deviceCombo, cbResetContent, 0, 0)
	for _, target := range state.Targets {
		label := targetLabel(target)
		send(deviceCombo, cbAddString, 0, uintptr(unsafe.Pointer(utf16Ptr(label))))
	}
	if selection >= 0 {
		send(deviceCombo, cbSetCurSel, uintptr(selection), 0)
	}

	setCreatorVersion(creatorDisplayedBuildLabel(state))

	if !writeInProgress() {
		setProgressIdle()
	}
	busy := writeInProgress()
	enable(refreshButton, !busy)
	enable(deviceCombo, !busy && len(state.Targets) > 0)
	if !busy {
		renderSelectionExperience(state)
	}
	renderUpdateUI()
	if pendingUSBRefresh && !writeInProgress() {
		pendingUSBRefresh = false
		beginRefresh() // Coalesce hotplug events arriving during a discovery.
		return
	}
	if pendingOwnerUSBStage {
		pendingOwnerUSBStage = false
		beginOwnerUSBTrustedProbe(state)
	}
}

// Preserve an explicit USB selection only during an ordinary read-only
// refresh. After a failed physical write the device may have changed layout,
// so discovery must begin unselected even if its hardware identity survives.
func captureUSBSelectionForRefresh() {
	pendingRefreshSelection = nil
	failed, succeeded := physicalWriteTerminalFlags()
	if failed || succeeded {
		clearUSBSelectionForRecovery()
		return
	}
	stateMu.Lock()
	previous := refreshState
	stateMu.Unlock()
	if index := selectedTargetIndex(); index >= 0 && index < len(previous.Targets) {
		selected := previous.Targets[index]
		pendingRefreshSelection = &selected
	}
}

func beginRefresh() {
	_, succeeded := physicalWriteTerminalFlags()
	if refreshInProgress || writeInProgress() || succeeded {
		return
	}
	refreshInProgress = true
	captureUSBSelectionForRefresh()
	resetWriteResult()
	setText(bootHelpButton, creatorT(msgActionBootHelp))
	enable(bootHelpButton, true)
	setCreatorStatus(creatorT(msgRefreshSearching))
	setCreatorHint(creatorT(msgRefreshHint))
	enable(refreshButton, false)
	enable(writeButton, false)
	enable(deviceCombo, false)
	invalidateGuidedVisual()
	refreshAsync()
}

func selectedCreatorLocale() (creatorLocale, bool) {
	index := int32(send(localeCombo, cbGetCurSel, 0, 0))
	locales := creatorSupportedLocales()
	if index < 0 || int(index) >= len(locales) {
		return creatorSourceLocale, false
	}
	return locales[index], true
}

func renderCreatorLocaleUI() {
	setText(refreshButton, creatorT(msgActionReloadUSB))
	setText(bootHelpButton, creatorT(msgActionBootHelp))
	stateMu.Lock()
	state := refreshState
	stateMu.Unlock()
	setCreatorVersion(creatorDisplayedBuildLabel(state))
	writeMu.Lock()
	terminal := !writeState.Active && (writeState.Success || writeState.Error != "")
	writeMu.Unlock()
	if terminal && !refreshInProgress {
		renderWriteDone()
	} else if !writeInProgress() {
		renderSelectionExperience(state)
	}
	renderUpdateUI()
	invalidateGuidedVisual()
}

func wndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case wmDeviceChange:
		reconcileUSBDeviceChange(wParam)
		return 0
	case wmPaint:
		return paintGuidedVisual(hwnd)
	case wmEraseBkgnd:
		return 1
	case wmDrawItem:
		return drawCreatorNativeItem(lParam)
	case wmMeasureItem:
		return measureCreatorItem(lParam)
	case wmCtlColorStatic, wmCtlColorEdit, wmCtlColorListBox:
		if brush := creatorControlColor(message, wParam, lParam); brush != 0 {
			return brush
		}
	case wmSize:
		layoutCreatorControls(int32(loword(lParam)), int32(hiword(lParam)))
		return 0
	case wmGetMinMaxInfo:
		if lParam != 0 {
			// WM_GETMINMAXINFO LPARAM is a synchronous Windows-owned MINMAXINFO*.
            // Borrow only during this native callback; never retain the pointer.
            info := (*creatorMinMaxInfo)(unsafe.Pointer(lParam))
			info.MinTrackSize = point{X: 1120, Y: 710}
		}
		return 0
	case wmCommand:
		id := int(loword(wParam))
		notify := hiword(wParam)
		if id == idLocaleCombo && notify == cbnSelChange && !writeInProgress() && !ownerUSBUpdateInProgress() {
			if locale, ok := selectedCreatorLocale(); ok && locale != currentCreatorLocale() {
				setCreatorLocale(string(locale))
				_ = saveCreatorLocalePreference(locale)
				renderCreatorLocaleUI()
			}
			return 0
		}
		if id == idDeviceCombo && notify == cbnSelChange {
			if ownerUSBUpdateInProgress() { return 0 }
			updateSelectionUI()
			return 0
		}
		if id == idRefresh && notify == bnClicked {
			if ownerUSBUpdateInProgress() { return 0 }
			beginRefresh()
			return 0
		}
		if id == idUSBUpdate && notify == bnClicked {
			beginOwnerUSBUpdate()
			return 0
		}
		if id == idUpdate && notify == bnClicked {
			if ownerUSBUpdateInProgress() { return 0 }
			handleUpdateButton()
			return 0
		}
		if id == idBootHelp && notify == bnClicked {
			writeMu.Lock()
			state := writeState
			writeMu.Unlock()
			if state.Active {
				return 0
			}
			if details := physicalWriteFailureDetails(state); details != "" {
				messageBox(details, creatorT(msgActionFailureDetails), mbOK|mbIconInformation)
			} else {
				messageBox(creatorBootHelpText(), creatorT(msgActionBootHelp), mbOK|mbIconInformation)
			}
			return 0
		}
		if id == idWrite && notify == bnClicked {
			// Disabled controls can still have queued WM_COMMAND messages.
			// Never consume a stale selection during an asynchronous refresh.
			if refreshInProgress || ownerUSBUpdateInProgress() {
				return 0
			}
			terminalError, terminalSuccess := physicalWriteTerminalFlags()
			if terminalSuccess {
				procDestroyWindow.Call(mainWindow)
				return 0
			}
			if terminalError {
				beginRefresh() // Captures no prior USB after any failed write.
				return 0
			}
			beginPhysicalWrite()
			return 0
		}
	case wmAppRefreshDone:
		renderRefresh()
		invalidateGuidedVisual()
		return 0
	case wmAppWriteProgress:
		renderWriteProgress()
		invalidateGuidedVisual()
		return 0
	case wmAppWriteDone:
		renderWriteDone()
		invalidateGuidedVisual()
		return 0
	case wmAppUSBUpdateDone:
		renderOwnerUSBUpdateDone()
		return 0
	case wmAppUSBTrustedReady:
		renderOwnerUSBTrustedReady()
		return 0
	case wmAppUpdateDone:
		renderUpdateDone()
		return 0
	case wmClose:
		if ownerUSBUpdateInProgress() {
			messageBox(creatorT(msgUSBUpdateWorkingHint), windowTitle, mbOK|mbIconInformation)
			return 0
		}
		if writeInProgress() {
			showWriteBusyMessage()
			return 0
		}
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		shutdownCreatorControls()
		releaseCreatorVisualTheme()
		procPostQuitMessage.Call(0)
		return 0
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func createMainWindow(startServices bool) {
	loadCreatorVisualTheme()
	controls := initCommonControlsEx{Size: uint32(unsafe.Sizeof(initCommonControlsEx{})), ICC: iccProgressClass}
	procInitCommonControlsEx.Call(uintptr(unsafe.Pointer(&controls)))

	instance, _, _ := procGetModuleHandleW.Call(0)
	className := utf16Ptr(windowClassName)
	class := wndClassEx{
		Size:       uint32(unsafe.Sizeof(wndClassEx{})),
		WndProc:    syscall.NewCallback(wndProc),
		Instance:   instance,
		Background: 0,
		ClassName:  className,
	}
	atom, _, err := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&class)))
	if atom == 0 {
		panic(fmt.Sprintf("RegisterClassExW: %v", err))
	}

	hwnd, _, err := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16Ptr(windowTitle))),
		wsOverlappedWindow|wsClipChildren,
		cwUseDefault, cwUseDefault,
		1148, 726,
		0, 0, instance, 0,
	)
	if hwnd == 0 {
		panic(fmt.Sprintf("CreateWindowExW(main): %v", err))
	}
	mainWindow = hwnd
	creatorEnableNativeDarkTitlebar(hwnd)

	localeCombo = createControl("COMBOBOX", "", wsTabStop|cbsDropDownList|cbsOwnerDrawFixed|cbsHasStrings, 45, 224, 268, 216, idLocaleCombo)
	for index, locale := range creatorSupportedLocales() {
		label := creatorLocaleDisplayName(locale)
		send(localeCombo, cbAddString, 0, uintptr(unsafe.Pointer(utf16Ptr(label))))
		if locale == currentCreatorLocale() {
			send(localeCombo, cbSetCurSel, uintptr(index), 0)
		}
	}
	deviceCombo = createControl("COMBOBOX", "", wsTabStop|wsVScroll|cbsDropDownList|cbsOwnerDrawFixed|cbsHasStrings|wsDisabled, 364, 224, 415, 216, idDeviceCombo)
	updateButton = createControl("BUTTON", creatorT(msgUpdateControl), wsTabStop|bsOwnerDraw, 365, 630, 128, 43, idUpdate)
	usbUpdateButton = createControl("BUTTON", creatorT(msgUSBUpdateAction), wsTabStop|bsOwnerDraw|wsDisabled, 855, 553, 255, 43, idUSBUpdate)
	refreshButton = createControl("BUTTON", creatorT(msgActionReloadUSB), wsTabStop|bsOwnerDraw, 501, 630, 138, 43, idRefresh)
	writeButton = createControl("BUTTON", creatorT(msgActionCreate), wsTabStop|bsOwnerDraw|wsDisabled, 648, 630, 150, 43, idWrite)
	bootHelpButton = createControl("BUTTON", creatorT(msgActionBootHelp), wsTabStop|bsOwnerDraw, 855, 610, 255, 43, idBootHelp)
	initializeCreatorControls()
	setCreatorVersion(creatorDisplayedBuildLabel(appRefreshState{}))
	setCreatorStatus(creatorT(msgRefreshSearching))
	setProgressIdle()

	// Native smoke tests create the real Win32 controls without starting
	// discovery, downloads, update checks, elevation or any physical I/O.
	if startServices {
		creatorServicesStarted = true
		pendingOwnerUSBStage = true // Trusted USB already connected at launch.
		procShowWindow.Call(mainWindow, swShow)
		procUpdateWindow.Call(mainWindow)
		beginRefresh()
		beginUpdateCheck(false)
	}
}

func messageLoop() int {
	var message msg
	for {
		result, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if int32(result) == -1 {
			return 1
		}
		if result == 0 {
			return 0
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&message)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&message)))
	}
}

func main() {
	runtime.LockOSThread()
	// This exact opt-in mode is used by the Windows package smoke. It
	// constructs the distributed Win32 executable's real controls without
	// starting discovery, networking, updates, UAC or a physical writer.
	// No persisted locale preference is read in this isolated path.
	if len(os.Args) > 1 && os.Args[1] == "--offline-package-smoke" {
		if len(os.Args) != 2 || !offlinePackageUISmoke() {
			os.Exit(2)
		}
		return
	}
	setCreatorLocale(string(loadCreatorLocalePreference()))
	createMainWindow(true)
	if code := messageLoop(); code != 0 {
		panic("Windows message loop failed")
	}
}
