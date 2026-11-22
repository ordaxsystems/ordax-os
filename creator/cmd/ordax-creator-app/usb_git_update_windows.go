//go:build windows

package main

import (
    "bytes"
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    "sync"
    "syscall"
    "time"
)

// This is a UI adapter, not another USB updater. Both the GUI and the one
// existing Windows task invoke tools/owner_usb_git_delivery.py, which owns all
// physical identity checks, Git provenance, atomic writes and readback.
type ownerUSBUpdateStatus struct {
    Active bool
    Result string
    Error string
    SourceCommit string
    BaseStatus string
    BaseArtifactCommit string
}
var (
    ownerUSBUpdateMu sync.Mutex
    ownerUSBUpdateResult ownerUSBUpdateStatus
    ownerUSBProbeMu sync.Mutex
    ownerUSBProbeRunning bool
    ownerUSBTrustedCandidate *physicalTarget
)
const ownerUSBTaskName = "OrdaX Creator Dev Release Sync"

type ownerUSBTaskInfo struct {
    Executable string
    Arguments string
    State string
    Concurrency string
}
type ownerUSBTransport struct {
    Python string
    Script string
    Serial string
}
type ownerUSBReceipt struct {
    Status string `json:"status"`
    SourceCommit string `json:"source_commit"`
    SHA256 string `json:"sha256"`
    Bytes int64 `json:"bytes"`
    BaseStatus string `json:"base_status,omitempty"`
    BaseArtifactCommit string `json:"base_artifact_commit,omitempty"`
}

func ownerUSBUpdateInProgress() bool {
    ownerUSBUpdateMu.Lock()
    defer ownerUSBUpdateMu.Unlock()
    return ownerUSBUpdateResult.Active
}

func ownerUSBSelectedTarget(state appRefreshState, index int) (physicalTarget, error) {
    // A signed/raw full-install writer is unrelated to readback-verified
    // non-destructive Owner USB transport. Keep independent exact-target
    // identity and writer/task checks, not the full-media build gate.
    if state.Error != "" || index < 0 || index >= len(state.Targets) {
        return physicalTarget{}, errors.New("no explicitly selected verified USB")
    }
    target := state.Targets[index]
    if target.SystemDisk || !target.PrototypeSafe || target.DiskNumber < 0 ||
        target.PhysicalDiskBytes == 0 || strings.TrimSpace(target.DeviceSerial) == "" ||
        !validLowerHexString(target.ConfirmationToken, 64) {
        return physicalTarget{}, errors.New("selected USB has no trusted physical identity")
    }
    return target, nil
}

// Independent of the destructive RAW installer. No side effects; the
// actual writer still revalidates task binding, live serial, disk, GPT,
// partition identity, version SHA, free space and completed readback.
func ownerUSBCanStageSelected(state appRefreshState, index int) bool {
    failed, succeeded := physicalWriteTerminalFlags()
    if failed || succeeded { return false }
    if _, _, ok := ownerPrototypeBuildInfo(); !ok { return false }
    _, err := ownerUSBSelectedTarget(state, index)
    return err == nil
}

func ownerUSBTransportFromTask(task ownerUSBTaskInfo, target physicalTarget, executable string) (ownerUSBTransport, error) {
    if (task.State != "Ready" && task.State != "Running") || task.Concurrency != "IgnoreNew" {
        return ownerUSBTransport{}, errors.New("canonical Owner Dev synchronizer is busy or not protected")
    }
    if !strings.EqualFold(filepath.Base(task.Executable), "python.exe") || !filepath.IsAbs(task.Executable) {
        return ownerUSBTransport{}, errors.New("Owner Dev task interpreter is not trusted")
    }
    // Read the registered task's *exact* arguments; no environment-supplied
    // paths or shell interpolation can select an arbitrary updater.
    fields := strings.Split(task.Arguments, "\"")
    if len(fields) != 5 || fields[0] != "" || fields[2] != " --install-root " {
        return ownerUSBTransport{}, errors.New("Owner Dev task arguments are not canonical")
    }
    serialField := " --stage-owner-dev-usb-serial "
    if !strings.HasPrefix(fields[4], serialField) {
        return ownerUSBTransport{}, errors.New("Owner Dev task does not bind an authorized USB serial")
    }
    serial := strings.TrimPrefix(fields[4], serialField)
    if len(serial) < 4 || len(serial) > 64 || !strings.EqualFold(serial, target.DeviceSerial) {
        return ownerUSBTransport{}, errors.New("Owner Dev task does not own the selected physical USB")
    }
    for _, r := range serial {
        if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '.' || r == '-' || r == '_') {
            return ownerUSBTransport{}, errors.New("Owner Dev serial is malformed")
        }
    }
    installRoot := filepath.Dir(filepath.Dir(filepath.Dir(executable)))
    if !filepath.IsAbs(fields[1]) || !filepath.IsAbs(fields[3]) ||
        !strings.EqualFold(filepath.Clean(fields[3]), filepath.Clean(installRoot)) ||
        !strings.EqualFold(filepath.Base(fields[1]), "owner_local_sync.py") {
        return ownerUSBTransport{}, errors.New("Owner Dev task does not match this Creator installation")
    }
    creatorModule := filepath.Dir(filepath.Dir(fields[1]))
    if !strings.EqualFold(filepath.Base(creatorModule), "creator") {
        return ownerUSBTransport{}, errors.New("Owner Dev task must use the canonical OS creator/ module")
    }
    // Accept a full OS checkout or a Git worktree dedicated to main. Do not
    // rely on a fixed developer folder, and never accept the retired owner.
    osRoot := filepath.Dir(creatorModule)
    rootInfo, rootErr := os.Lstat(osRoot)
    marker, markerErr := os.Lstat(filepath.Join(osRoot, ".git"))
    if strings.EqualFold(filepath.Base(osRoot), "ordax-creator") ||
        rootErr != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 ||
        markerErr != nil || marker.Mode()&os.ModeSymlink != 0 ||
        (!marker.IsDir() && !marker.Mode().IsRegular()) {
        return ownerUSBTransport{}, errors.New("Owner Dev task is outside a real OS Git checkout")
    }
    // The exact Git origin, clean main and executable's source ancestry are
    // verified by verifyCanonicalCreatorSource before either script executes.
    script := filepath.Join(creatorModule, "tools", "owner_usb_git_delivery.py")
    for _, name := range []string{task.Executable, fields[1], script} {
        info, err := os.Lstat(name)
        if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
            return ownerUSBTransport{}, errors.New("Owner Dev transport is not an installed regular file")
        }
    }
    return ownerUSBTransport{Python: task.Executable, Script: script, Serial: serial}, nil
}

// The USB topology observer only proposes staging for the one USB already
// authorized in the existing Windows task. It never selects a raw-write target.
func ownerUSBTrustedTargetFromTask(state appRefreshState, task ownerUSBTaskInfo,
    executable string) (physicalTarget, bool) {
    if state.Error != "" { return physicalTarget{}, false }
    var candidate physicalTarget
    found := false
    for index := range state.Targets {
        target, err := ownerUSBSelectedTarget(state, index)
        if err != nil { continue }
        if _, err := ownerUSBTransportFromTask(task, target, executable); err != nil { continue }
        if found { return physicalTarget{}, false } // Ambiguous trusted identity.
        candidate, found = target, true
    }
    return candidate, found
}

func beginOwnerUSBTrustedProbe(state appRefreshState) {
    failed, succeeded := physicalWriteTerminalFlags()
    if refreshInProgress || writeInProgress() || ownerUSBUpdateInProgress() ||
        failed || succeeded || state.Error != "" ||
        len(state.Targets) == 0 {
        return
    }
    if _, _, ok := ownerPrototypeBuildInfo(); !ok { return }
    ownerUSBProbeMu.Lock()
    if ownerUSBProbeRunning { ownerUSBProbeMu.Unlock(); return }
    ownerUSBProbeRunning = true
    ownerUSBProbeMu.Unlock()
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        task, err := ownerUSBTaskConfiguration(ctx)
        if err != nil { finishOwnerUSBTrustedProbe(nil); return }
        executable, err := os.Executable()
        if err != nil { finishOwnerUSBTrustedProbe(nil); return }
        target, ok := ownerUSBTrustedTargetFromTask(state, task, executable)
        if !ok { finishOwnerUSBTrustedProbe(nil); return }
        finishOwnerUSBTrustedProbe(&target)
    }()
}

func finishOwnerUSBTrustedProbe(target *physicalTarget) {
    ownerUSBProbeMu.Lock()
    ownerUSBProbeRunning = false
    ownerUSBTrustedCandidate = target
    ownerUSBProbeMu.Unlock()
    if target != nil { procPostMessageW.Call(mainWindow, wmAppUSBTrustedReady, 0, 0) }
}

func renderOwnerUSBTrustedReady() {
    ownerUSBProbeMu.Lock()
    candidate := ownerUSBTrustedCandidate
    ownerUSBTrustedCandidate = nil
    ownerUSBProbeMu.Unlock()
    if candidate == nil { return }
    if refreshInProgress {
        pendingOwnerUSBStage = true // Retry after the latest topology snapshot.
        return
    }
    if writeInProgress() || ownerUSBUpdateInProgress() { return }
    failed, succeeded := physicalWriteTerminalFlags()
    if failed || succeeded { return }
    stateMu.Lock()
    state := refreshState
    stateMu.Unlock()
    index := restoredUSBSelectionIndex(candidate, state.Targets)
    if index < 0 || state.Error != "" { return }
    if selected := selectedTargetIndex(); selected >= 0 && selected != index { return }
    // A prior locally trusted serial is consent for non-destructive Git
    // transport only. The device is revalidated again inside the writer.
    startOwnerUSBUpdate(state.Targets[index])
}

func ownerUSBTaskConfiguration(ctx context.Context) (ownerUSBTaskInfo, error) {
    const ps = "$ErrorActionPreference='Stop';" +
        "$t=Get-ScheduledTask -TaskName 'OrdaX Creator Dev Release Sync' -ErrorAction Stop;" +
        "if($t.Actions.Count -ne 1){throw 'unexpected action count'};" +
        "[pscustomobject]@{Executable=$t.Actions[0].Execute;Arguments=$t.Actions[0].Arguments;" +
        "State=$t.State.ToString();Concurrency=$t.Settings.MultipleInstances.ToString()}|ConvertTo-Json -Compress"
    cmd := exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ps)
    cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
    output, err := cmd.Output()
    if err != nil || len(output) == 0 || len(output) > 16384 {
        return ownerUSBTaskInfo{}, errors.New("canonical Owner Dev task is unavailable")
    }
    var task ownerUSBTaskInfo
    decoder := json.NewDecoder(bytes.NewReader(output))
    decoder.DisallowUnknownFields()
    if err := decoder.Decode(&task); err != nil {
        return ownerUSBTaskInfo{}, errors.New("canonical Owner Dev task configuration is invalid")
    }
    return task, nil
}

func parseOwnerUSBReceipt(data []byte) (ownerUSBReceipt, error) {
    if len(data) == 0 || len(data) > 8192 {
        return ownerUSBReceipt{}, errors.New("Owner USB transport receipt size is invalid")
    }
    var result ownerUSBReceipt
    decoder := json.NewDecoder(bytes.NewReader(data))
    decoder.DisallowUnknownFields()
    if err := decoder.Decode(&result); err != nil {
        return ownerUSBReceipt{}, errors.New("Owner USB transport receipt is malformed")
    }
    var trailing any
    if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
        return ownerUSBReceipt{}, errors.New("Owner USB transport receipt has trailing content")
    }
    if !validLowerHexString(result.SourceCommit, 40) {
        return ownerUSBReceipt{}, errors.New("Owner USB transport revision is invalid")
    }
    switch result.Status {
    case "CURRENT":
        if result.SHA256 != "" || result.Bytes != 0 {
            return ownerUSBReceipt{}, errors.New("current USB receipt contains invalid claims")
        }
    case "STAGED_NOT_ACTIVATED":
        if !validLowerHexString(result.SHA256, 64) || result.Bytes <= 0 || result.Bytes > 1_000_000_000 {
            return ownerUSBReceipt{}, errors.New("Owner USB transport readback receipt is invalid")
        }
    default:
        return ownerUSBReceipt{}, errors.New("Owner USB transport did not confirm staging")
    }
    // Published-remote-only evidence is not OS activation or USB binary staging.
    if result.BaseStatus == "" {
        if result.BaseArtifactCommit != "" {
            return ownerUSBReceipt{}, errors.New("unbound Owner Base candidate identity")
        }
    } else if (result.BaseStatus != "AVAILABLE_NOT_STAGED" &&
               result.BaseStatus != "STAGED_NOT_ACTIVATED") ||
        !validLowerHexString(result.BaseArtifactCommit, 40) {
        return ownerUSBReceipt{}, errors.New("Owner Base candidate evidence is invalid")
    }
    return result, nil
}

func verifyCanonicalCreatorSource(ctx context.Context, repo string) error {
    // Do not execute a mutable local Python file merely because a scheduled
    // task points to it. Require the exact Creator source bound into this
    // published EXE and the canonical remote main, with a clean worktree.
    if !validLowerHexString(buildCreatorSourceCommit, 40) {
        return errors.New("Creator executable has no canonical source binding")
    }
    runGit := func(args ...string) (string, error) {
        callCtx, cancel := context.WithTimeout(ctx, 35*time.Second)
        defer cancel()
        parameters := append([]string{"-C", repo}, args...)
        cmd := exec.CommandContext(callCtx, "git", parameters...)
        cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
        output, err := cmd.Output()
        if err != nil || len(output) > 8192 {
            return "", errors.New("canonical Creator source verification failed")
        }
        return strings.TrimSpace(string(output)), nil
    }
    origin, err := runGit("remote", "get-url", "origin")
    if err != nil || origin != "https://github.com/ordaxsystems/ordax-os.git" {
        return errors.New("Creator source origin differs from canonical GitHub")
    }
    branch, err := runGit("branch", "--show-current")
    if err != nil || branch != "main" { return errors.New("Creator source is not on main") }
    head, err := runGit("rev-parse", "HEAD")
    if err != nil { return errors.New("canonical Creator HEAD is unavailable") }
    if head != buildCreatorSourceCommit {
        // An installed Creator can lag canonical main: a fast-forward must not
        // disable its USB updater while the verified local scripts advance.
        if _, err := runGit("cat-file", "-e", buildCreatorSourceCommit+"^{commit}"); err != nil {
            return errors.New("installed Creator source revision is not available")
        }
        if _, err := runGit("merge-base", "--is-ancestor", buildCreatorSourceCommit, head); err != nil {
            return errors.New("Creator source is not an ancestor of canonical main")
        }
    }
    dirty, err := runGit("status", "--porcelain=v1")
    if err != nil || dirty != "" { return errors.New("Creator source has unverified local changes") }
    remote, err := runGit("ls-remote", "--heads", "origin", "refs/heads/main")
    if err != nil || remote != head + "\trefs/heads/main" {
        return errors.New("Creator local source is not current GitHub main")
    }
    return nil
}

func executeOwnerUSBTransport(target physicalTarget) (ownerUSBReceipt, error) {
    if _, _, ok := ownerPrototypeBuildInfo(); !ok {
        return ownerUSBReceipt{}, errors.New("Owner Dev Creator provenance is unavailable")
    }
    ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
    defer cancel()
    task, err := ownerUSBTaskConfiguration(ctx)
    if err != nil { return ownerUSBReceipt{}, err }
    executable, err := os.Executable()
    if err != nil { return ownerUSBReceipt{}, errors.New("cannot establish the running Creator path") }
    transport, err := ownerUSBTransportFromTask(task, target, executable)
    if err != nil { return ownerUSBReceipt{}, err }
    if err := verifyCanonicalCreatorSource(ctx, filepath.Dir(filepath.Dir(filepath.Dir(transport.Script)))); err != nil {
        return ownerUSBReceipt{}, err
    }
    // GUI and scheduled task enter the same cached Git-main synchronizer.
    // The UI stages only: it does not self-update a running EXE or invoke Pull.
    syncScript := filepath.Join(filepath.Dir(transport.Script), "owner_local_sync.py")
    cmd := exec.CommandContext(ctx, transport.Python, "-u", syncScript,
        "--creator-ui-stage", "--stage-owner-dev-usb-serial", transport.Serial,
        "--trusted-disk-number", fmt.Sprint(target.DiskNumber))
    cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
    // All writes are to ORDAX-DATA through the same canonical writer as the
    // scheduled task. Neither this GUI nor the Python helper activates OS.
    output, err := cmd.Output()
    if err != nil {
        return ownerUSBReceipt{}, ownerUSBTransportFailure(err)
    }
    return parseOwnerUSBReceipt(output)
}

// Retain a bounded, single-line diagnostic from the one authorized transport.
// ExitError.Stderr belongs to the existing task, not an arbitrary executable.
// Never report staging failures as successful USB activation.
func ownerUSBTransportFailure(err error) error {
    var exit *exec.ExitError
    if !errors.As(err, &exit) {
        return errors.New("Falha ao iniciar o sincronizador autorizado do pendrive")
    }
    detail := string(exit.Stderr)
    const marker = "OWNER_DEV_USB_GIT_STAGE=BLOCKED:"
    if i := strings.LastIndex(detail, marker); i >= 0 {
        detail = detail[i+len(marker):]
    } else {
        return errors.New("Sincronizador recusou a operação sem diagnóstico válido")
    }
    detail = strings.TrimSpace(detail)
    if i := strings.IndexAny(detail, "\r\n"); i >= 0 {
        detail = detail[:i]
    }
    if detail == "" || len(detail) > 350 {
        return errors.New("Sincronizador recusou a operação; diagnóstico ausente ou extenso")
    }
    for _, ch := range detail {
        if ch < 32 || ch == 127 {
            return errors.New("Sincronizador recusou a operação; diagnóstico inválido")
        }
    }
    return errors.New("Sincronizador bloqueou a atualização: " + detail)
}

func beginOwnerUSBUpdate() {
    if refreshInProgress || writeInProgress() || ownerUSBUpdateInProgress() { return }
    failed, succeeded := physicalWriteTerminalFlags()
    if failed || succeeded { return }
    stateMu.Lock()
    state := refreshState
    stateMu.Unlock()
    target, err := ownerUSBSelectedTarget(state, selectedTargetIndex())
    if err != nil {
        messageBox(creatorT(msgUSBUpdateBlocked), windowTitle, mbOK|mbIconWarning)
        return
    }
    if _, _, ok := ownerPrototypeBuildInfo(); !ok {
        messageBox(creatorT(msgUSBUpdateBlocked), windowTitle, mbOK|mbIconWarning)
        return
    }
    if messageBox(creatorT(msgUSBUpdateConfirm), windowTitle, mbYesNo|mbIconInformation|mbDefButton2) != idYes { return }
    startOwnerUSBUpdate(target)
}

// Shared by the explicit button and the trusted hotplug observer. Neither
// entry point creates an updater or alters the active Linux installation.
func startOwnerUSBUpdate(target physicalTarget) {
    if refreshInProgress || writeInProgress() || ownerUSBUpdateInProgress() { return }
    failed, succeeded := physicalWriteTerminalFlags()
    if failed || succeeded { return }
    ownerUSBUpdateMu.Lock()
    ownerUSBUpdateResult = ownerUSBUpdateStatus{Active: true}
    ownerUSBUpdateMu.Unlock()
    setCreatorStatus(creatorT(msgUSBUpdateWorking))
    setCreatorHint(creatorT(msgUSBUpdateWorkingHint))
    setProgressActive()
    enable(usbUpdateButton, false)
    enable(writeButton, false)
    enable(updateButton, false)
    enable(refreshButton, false)
    enable(deviceCombo, false)
    enable(localeCombo, false)
    go func() {
        receipt, runErr := executeOwnerUSBTransport(target)
        ownerUSBUpdateMu.Lock()
        ownerUSBUpdateResult.Active = false
        ownerUSBUpdateResult.Error = ""
        if runErr != nil {
            ownerUSBUpdateResult.Error = runErr.Error()
        } else {
            ownerUSBUpdateResult.Result = receipt.Status
            ownerUSBUpdateResult.SourceCommit = receipt.SourceCommit
            ownerUSBUpdateResult.BaseStatus = receipt.BaseStatus
            ownerUSBUpdateResult.BaseArtifactCommit = receipt.BaseArtifactCommit
        }
        ownerUSBUpdateMu.Unlock()
        procPostMessageW.Call(mainWindow, wmAppUSBUpdateDone, 0, 0)
    }()
}

// The transport receipt attests to a Git bundle in ORDAX-DATA only.
// It must never imply that the Linux kernel, Base, Surface or boot were updated.
func ownerUSBComponentSummary(state ownerUSBUpdateStatus) string {
    if state.Result != "CURRENT" && state.Result != "STAGED_NOT_ACTIVATED" {
        return ""
    }
    if !validLowerHexString(state.SourceCommit, 40) {
        return ""
    }
    componentEvidence := []string{
        fmt.Sprintf(creatorT(msgUSBUpdateGitEvidence), state.SourceCommit[:12]),
        creatorT(msgUSBUpdateSurfaceEvidence),
        creatorT(msgUSBUpdateBaseEvidence),
    }
    if state.BaseStatus == "AVAILABLE_NOT_STAGED" &&
        validLowerHexString(state.BaseArtifactCommit, 40) {
        // A publication is neither USB readback nor installed/healthy Base.
        componentEvidence = append(componentEvidence,
            fmt.Sprintf(creatorT(msgUSBUpdateBaseAvailable), state.BaseArtifactCommit[:12]))
    }
    if state.BaseStatus == "STAGED_NOT_ACTIVATED" &&
        validLowerHexString(state.BaseArtifactCommit, 40) {
        componentEvidence = append(componentEvidence,
            fmt.Sprintf(creatorT(msgUSBUpdateBaseTransferred), state.BaseArtifactCommit[:12]))
    }
    componentEvidence = append(componentEvidence, creatorT(msgUSBUpdateNotActivated))
    return strings.Join(componentEvidence, "\n")
}

func renderOwnerUSBUpdateDone() {
    ownerUSBUpdateMu.Lock()
    state := ownerUSBUpdateResult
    ownerUSBUpdateMu.Unlock()
    if state.Active || (state.Result == "" && state.Error == "") { return }
    if state.Error != "" {
        setCreatorStatus(creatorT(msgUSBUpdateFailed))
        setCreatorHint(state.Error)
        setProgressIdle()
    } else {
        if state.Result == "CURRENT" {
            setCreatorStatus(creatorT(msgUSBUpdateCurrent))
        } else {
            setCreatorStatus(creatorT(msgUSBUpdateComplete))
        }
        setCreatorHint(ownerUSBComponentSummary(state))
        // Only the Git transport finished. There is no OS activation proof,
        // so a full-system 100% progress indication would be misleading.
        setProgressIdle()
    }
    enable(localeCombo, true)
    enable(refreshButton, true)
    enable(deviceCombo, true)
    enable(usbUpdateButton, false) // Explicit re-selection is required after result.
    enable(writeButton, false)
    renderUpdateUI()
    invalidateGuidedVisual()
}
