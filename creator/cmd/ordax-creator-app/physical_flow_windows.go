//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

const (
	mbOK              = 0x00000000
	mbYesNo           = 0x00000004
	mbIconError       = 0x00000010
	mbIconWarning     = 0x00000030
	mbIconInformation = 0x00000040
	mbDefButton2      = 0x00000100
	idYes             = 6

	seeMaskNoCloseProcess = 0x00000040
	swHide                = 0
	infinite              = 0xffffffff
	waitObject0           = 0x00000000
	waitTimeout           = 0x00000102
	progressPollMillis    = 200
)

var (
	shell32 = syscall.NewLazyDLL("shell32.dll")

	procMessageBoxW         = user32.NewProc("MessageBoxW")
	procShellExecuteExW     = shell32.NewProc("ShellExecuteExW")
	procWaitForSingleObject = kernel32.NewProc("WaitForSingleObject")
	procGetExitCodeProcess  = kernel32.NewProc("GetExitCodeProcess")
	procCloseHandle         = kernel32.NewProc("CloseHandle")

	writeMu    sync.Mutex
	writeState physicalWriteState
)

type shellExecuteInfo struct {
	Size       uint32
	Mask       uint32
	HWND       uintptr
	Verb       *uint16
	File       *uint16
	Parameters *uint16
	Directory  *uint16
	Show       int32
	Instance   uintptr
	IDList     uintptr
	Class      *uint16
	KeyClass   uintptr
	HotKey     uint32
	Icon       uintptr
	Process    uintptr
}

type preparedPhysicalImage struct {
	Path      string `json:"path"`
	SizeBytes int64  `json:"size_bytes"`
	SHA256    string `json:"sha256"`
}

type physicalPreparationDocument struct {
	Schema                   string                `json:"$schema"`
	Target                   physicalTarget        `json:"target"`
	PreparedImage            preparedPhysicalImage `json:"prepared_image"`
	DestructiveAuthorization string                `json:"destructive_authorization"`
}

type physicalWriteState struct {
	Active         bool
	Status         string
	Hint           string
	Success        bool
	Error          string
	DiagnosticPath string
	Determinate    bool
	Percent        int
}

type physicalWriteFailure struct {
	cause          error
	diagnosticPath string
}

func (failure *physicalWriteFailure) Error() string {
	return failure.cause.Error()
}

func (failure *physicalWriteFailure) Unwrap() error {
	return failure.cause
}

func messageBox(text, title string, flags uint32) int {
	result, _, _ := procMessageBoxW.Call(
		mainWindow,
		uintptr(unsafe.Pointer(utf16Ptr(text))),
		uintptr(unsafe.Pointer(utf16Ptr(title))),
		uintptr(flags),
	)
	return int(result)
}

func writeInProgress() bool {
	writeMu.Lock()
	defer writeMu.Unlock()
	return writeState.Active
}

// A terminal physical result owns the UI until the user explicitly starts
// fresh discovery (failure) or finishes (success). A queued selection event
// must never silently clear that result or reuse the former target.
func physicalWriteTerminalFlags() (failed, succeeded bool) {
	writeMu.Lock()
	defer writeMu.Unlock()
	if writeState.Active {
		return false, false
	}
	return writeState.Error != "", writeState.Success
}

func updateWriteProgress(status, hint string) {
	writeMu.Lock()
	writeState.Active = true
	writeState.Status = status
	writeState.Hint = hint
	writeState.Success = false
	writeState.Error = ""
	writeState.DiagnosticPath = ""
	writeState.Determinate = false
	writeState.Percent = 0
	writeMu.Unlock()
	procPostMessageW.Call(mainWindow, wmAppWriteProgress, 0, 0)
}

func updateWritePercentage(status, hint string, percent int) {
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	writeMu.Lock()
	writeState.Active = true
	writeState.Status = status
	writeState.Hint = hint
	writeState.Success = false
	writeState.Error = ""
	writeState.DiagnosticPath = ""
	writeState.Determinate = true
	writeState.Percent = percent
	writeMu.Unlock()
	procPostMessageW.Call(mainWindow, wmAppWriteProgress, 0, 0)
}

// physicalWriteResultCopy is the single localized presentation for both the
// worker's terminal state and subsequent UI repaint or locale changes. Never
// treat diagnostic metadata as a new write authorization.
func physicalWriteResultCopy(state physicalWriteState) (status, hint string) {
	if state.Success {
		view := creatorExperience(creatorExperienceInput{WriteComplete: true})
		return creatorT(msgWriteCompleteStatus) + " " + view.Title,
			strings.TrimSpace(view.Body + " " + view.Detail)
	}
	view := creatorExperience(creatorExperienceInput{ErrorMessageID: msgPhysicalWriteFailedDetail, ErrorStepNumber: 4})
	hint = strings.TrimSpace(view.Body + " " + view.Detail)
	if state.DiagnosticPath != "" {
		hint += " " + creatorTValues(msgWriteDiagnosticLocation, map[string]string{
			"path": filepath.Base(state.DiagnosticPath),
		})
	}
	return view.Title, hint
}

const maxPhysicalFailureDetailRunes = 3000

// Show the diagnostic location and bounded error explanation on demand.
// Do not open untrusted files, execute commands or consume the diagnostic as
// a grant. A preserved report remains available after retry and temp cleanup.
func physicalWriteFailureDetails(state physicalWriteState) string {
	if state.Active || state.Error == "" {
		return ""
	}
	detail := []rune(strings.TrimSpace(state.Error))
	if len(detail) > maxPhysicalFailureDetailRunes {
		detail = append(detail[:maxPhysicalFailureDetailRunes], '…')
	}
	body := string(detail)
	if state.DiagnosticPath != "" {
		body = creatorTValues(msgWriteDiagnosticLocation, map[string]string{
			"path": state.DiagnosticPath,
		}) + "\n\n" + body
	}
	return body
}

func completeWrite(err error) {
	writeMu.Lock()
	writeState.Active = false
	if err != nil {
		writeState.Success = false
		writeState.Error = err.Error()
		writeState.DiagnosticPath = ""
		var failure *physicalWriteFailure
		if errors.As(err, &failure) {
			writeState.DiagnosticPath = failure.diagnosticPath
		}
		writeState.Determinate = false
		writeState.Percent = 0
	} else {
		writeState.Success = true
		writeState.Error = ""
		writeState.DiagnosticPath = ""
		writeState.Determinate = true
		writeState.Percent = 100
	}
	writeState.Status, writeState.Hint = physicalWriteResultCopy(writeState)
	writeMu.Unlock()
	procPostMessageW.Call(mainWindow, wmAppWriteDone, 0, 0)
}

func renderWriteProgress() {
	// Ignore stale queued progress after the previous operation has ended
	// and a new discovery has locked the selection controls.
	if refreshInProgress {
		return
	}
	writeMu.Lock()
	state := writeState
	writeMu.Unlock()
	if !state.Active {
		// A WM_APP progress message may outlive its corresponding worker;
		// do not replace a terminal result with old in-progress controls.
		return
	}
	setCreatorStatus(state.Status)
	setCreatorHint(state.Hint)
	if state.Determinate {
		setProgressPercent(state.Percent)
	} else {
		setProgressActive()
	}
	enable(refreshButton, false)
	enable(updateButton, false)
	enable(usbUpdateButton, false)
	enable(writeButton, false)
	enable(deviceCombo, false)
	enable(localeCombo, false)
	enable(bootHelpButton, false)
}

func renderWriteDone() {
	// A completion message can be queued before a new refresh starts.
	// Do not paint the previous result or reenable old-device actions.
	if refreshInProgress {
		return
	}
	writeMu.Lock()
	state := writeState
	writeMu.Unlock()
	if state.Active || (!state.Success && state.Error == "") {
		// Ignore stale completion events while a newer operation is active.
		return
	}

	status, hint := physicalWriteResultCopy(state)
	setCreatorStatus(status)
	setCreatorHint(hint)
	if state.Success {
		setProgressComplete()
		setText(writeButton, creatorT(msgActionFinish))
		setText(bootHelpButton, creatorT(msgActionBootHelp))
	} else {
		setProgressIdle()
		setText(writeButton, creatorT(msgActionRetry))
		setText(bootHelpButton, creatorT(msgActionFailureDetails))
	}

	enable(refreshButton, !state.Success)
	enable(localeCombo, !state.Success)
	// Never let the previous USB selection overwrite a terminal write
	// result. Recovery is discovery-only and requires a fresh explicit pick.
	enable(deviceCombo, false)
	// A failed operation's retry only refreshes the target list; it never
	// invokes the writer. Therefore retry stays available even if no
	// cached candidate or connected USB is currently usable.
	enable(writeButton, true)
	enable(bootHelpButton, true)
	renderUpdateUI()
	enable(usbUpdateButton, false) // Re-select only after refreshed discovery.
	if state.Success {
		enable(updateButton, false)
	}
	invalidateGuidedVisual()
}

func showWriteBusyMessage() {
	view := creatorExperience(creatorExperienceInput{WriteActive: true})
	messageBox(
		view.Title+"\n\n"+view.Body+"\n\n"+creatorT(msgWriteBusyDetail),
		"OrdaX Creator",
		mbOK|mbIconInformation,
	)
}

func selectedPhysicalTarget() (physicalTarget, appRefreshState, error) {
	if refreshInProgress {
		return physicalTarget{}, appRefreshState{}, fmt.Errorf("a lista de dispositivos USB ainda está sendo atualizada")
	}
	stateMu.Lock()
	state := refreshState
	stateMu.Unlock()
	if !state.PhysicalReady || state.BackendDirectory == "" {
		return physicalTarget{}, state, fmt.Errorf("a versão física do Creator ainda não está pronta para gravação")
	}
	index := int32(send(deviceCombo, cbGetCurSel, 0, 0))
	if index < 0 || int(index) >= len(state.Targets) {
		return physicalTarget{}, state, fmt.Errorf("selecione um pendrive USB válido")
	}
	target := state.Targets[index]
	if target.SystemDisk || !target.PrototypeSafe || len(target.ConfirmationToken) != 64 {
		return physicalTarget{}, state, fmt.Errorf("o dispositivo selecionado não passou pela política de segurança")
	}
	return target, state, nil
}

func beginPhysicalWrite() {
	if refreshInProgress || writeInProgress() {
		return
	}
	target, state, err := selectedPhysicalTarget()
	if err != nil {
		messageBox(creatorT(msgTargetSelectionFailed), windowTitle, mbOK|mbIconError)
		return
	}

	label := targetDisplayName(target)
	// Only one Creator-owned destructive confirmation. Device validation,
	// payload hashes and Windows elevation are internal security gates rather
	// than additional product consent prompts.
	warning := creatorTValues(msgWriteConfirmBody, map[string]string{
		"device": targetDriveLabel(target),
		"name":   label,
		"disk":   strconv.Itoa(target.DiskNumber),
		"size":   formatBytes(target.PhysicalDiskBytes),
		"serial": target.DeviceSerial,
	})
	if messageBox(warning, creatorT(msgWriteConfirmTitle), mbYesNo|mbIconWarning|mbDefButton2) != idYes {
		return
	}

	updateWriteProgress(creatorT(msgWritePreparingStatus), creatorT(msgWritePreparingHint))
	go func() {
		completeWrite(executePhysicalWrite(state, target))
	}()
}

func executeLegacyPhysicalWrite(directory string, target physicalTarget) error {
	backend := filepath.Join(directory, "ordax-creator-physical-test.exe")
	seed := filepath.Join(directory, "ordax-bootstrap-seed.raw")
	for _, path := range []string{backend, seed} {
		info, err := os.Lstat(path)
		if err != nil {
			return fmt.Errorf("pacote físico incompleto: %s não está disponível", filepath.Base(path))
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("pacote físico inválido: %s não é um arquivo regular", filepath.Base(path))
		}
	}

	workRoot := filepath.Join(os.TempDir(), "OrdaX-Creator")
	if err := os.MkdirAll(workRoot, 0o700); err != nil {
		return fmt.Errorf("preparar área temporária: %w", err)
	}
	workDir, err := os.MkdirTemp(workRoot, "physical-write-*")
	if err != nil {
		return fmt.Errorf("criar área temporária: %w", err)
	}
	defer os.RemoveAll(workDir)
	preparedPath := filepath.Join(workDir, "ordax-prepared.raw")
	diagnosticPath := filepath.Join(workDir, "ordax-physical-error.txt")
	progressPath := filepath.Join(workDir, "ordax-physical-progress.json")

	updateWriteProgress(creatorT(msgProgressImageStatus), creatorT(msgWritePreparingHint))
	output, err := runBackendHidden(
		directory,
		"prepare",
		"--confirm", target.ConfirmationToken,
		"--seed", seed,
		"--out", preparedPath,
	)
	if err != nil {
		return fmt.Errorf("preparar imagem física: %w", err)
	}
	var preparation physicalPreparationDocument
	if err := json.Unmarshal(output, &preparation); err != nil {
		return fmt.Errorf("ler resultado da preparação: %w", err)
	}
	if err := validatePhysicalPreparation(preparation, target, preparedPath); err != nil {
		return err
	}

	updateWriteProgress(creatorT(msgProgressElevationStatus), creatorT(msgProgressElevationHint))
	args := []string{
		"apply",
		"--confirm", target.ConfirmationToken,
		"--image", preparation.PreparedImage.Path,
		"--sha256", preparation.PreparedImage.SHA256,
		"--size", strconv.FormatInt(preparation.PreparedImage.SizeBytes, 10),
		"--authorize", preparation.DestructiveAuthorization,
		"--diagnostic-log", diagnosticPath,
		"--progress-log", progressPath,
	}
	if err := runElevatedAndWait(backend, directory, args, diagnosticPath, progressPath); err != nil {
		return err
	}

	updateWritePercentage(creatorT(msgProgressCompleteStatus), creatorT(msgProgressCompleteHint), 100)
	return nil
}

func validatePhysicalPreparation(preparation physicalPreparationDocument, target physicalTarget, preparedPath string) error {
	if preparation.Schema != "prototype-ordax.creator-physical-test-preparation/2" {
		return fmt.Errorf("o backend retornou uma preparação incompatível")
	}
	if preparation.Target.DiskNumber != target.DiskNumber ||
		preparation.Target.ConfirmationToken != target.ConfirmationToken ||
		preparation.Target.SystemDisk || !preparation.Target.PrototypeSafe {
		return fmt.Errorf("o dispositivo mudou durante a preparação; operação cancelada")
	}
	if preparation.PreparedImage.Path != preparedPath ||
		preparation.PreparedImage.SizeBytes != int64(target.PhysicalDiskBytes) ||
		len(preparation.PreparedImage.SHA256) != 64 ||
		len(preparation.DestructiveAuthorization) != 64 {
		return fmt.Errorf("a preparação física não produziu os vínculos esperados")
	}
	return nil
}

func runElevatedAndWait(executable, directory string, args []string, diagnosticPath, progressPath string) error {
	parameters := make([]string, 0, len(args))
	for _, arg := range args {
		parameters = append(parameters, syscall.EscapeArg(arg))
	}
	info := shellExecuteInfo{
		Size:       uint32(unsafe.Sizeof(shellExecuteInfo{})),
		Mask:       seeMaskNoCloseProcess,
		HWND:       mainWindow,
		Verb:       utf16Ptr("runas"),
		File:       utf16Ptr(executable),
		Parameters: utf16Ptr(strings.Join(parameters, " ")),
		Directory:  utf16Ptr(directory),
		Show:       swHide,
	}
	ok, _, callErr := procShellExecuteExW.Call(uintptr(unsafe.Pointer(&info)))
	if ok == 0 {
		if errno, ok := callErr.(syscall.Errno); ok && errno == 1223 {
			return fmt.Errorf("a autorização do Windows foi cancelada")
		}
		return fmt.Errorf("não foi possível solicitar autorização administrativa: %v", callErr)
	}
	if info.Process == 0 {
		return fmt.Errorf("o Windows não retornou o processo elevado")
	}
	defer procCloseHandle.Call(info.Process)

	updateWriteProgress(creatorT(msgCreatingEyebrow), creatorT(msgCreatingTitle)+" "+creatorT(msgCreatingDetail))

	var progress physicalProgressTracker
	for {
		wait, _, waitErr := procWaitForSingleObject.Call(info.Process, progressPollMillis)
		applyPhysicalProgressSnapshot(progressPath, &progress)
		if wait == waitObject0 {
			break
		}
		if wait == waitTimeout {
			continue
		}
		return fmt.Errorf("falha aguardando a gravação elevada: %v", waitErr)
	}
	applyPhysicalProgressSnapshot(progressPath, &progress)

	var exitCode uint32
	ok, _, exitErr := procGetExitCodeProcess.Call(info.Process, uintptr(unsafe.Pointer(&exitCode)))
	if ok == 0 {
		return fmt.Errorf("não foi possível ler o resultado da gravação: %v", exitErr)
	}
	if exitCode != 0 {
		if diagnosticPath != "" {
			if data, readErr := readPhysicalDiagnostic(diagnosticPath); readErr == nil {
				if detail := strings.TrimSpace(string(data)); detail != "" {
					cause := fmt.Errorf("a gravação física falhou: %s", detail)
					persistedPath, persistErr := persistPhysicalDiagnostic(diagnosticPath)
					if persistErr != nil {
						return &physicalWriteFailure{cause: fmt.Errorf("%w; não foi possível preservar o diagnóstico: %v", cause, persistErr)}
					}
					return &physicalWriteFailure{cause: cause, diagnosticPath: persistedPath}
				}
			}
		}
		return fmt.Errorf("a gravação física foi interrompida ou falhou (código %d)", exitCode)
	}
	return nil
}
