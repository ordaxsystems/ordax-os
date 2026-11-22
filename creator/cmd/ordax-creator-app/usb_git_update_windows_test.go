//go:build windows

package main

import (
    "encoding/json"
    "os"
    "os/exec"
    "errors"
    "path/filepath"
    "strings"
    "testing"
)

func testOwnerUSBTarget() physicalTarget {
    return physicalTarget{
        DiskNumber: 1, DeviceSerial: "6699E36B", PhysicalDiskBytes: 8 << 30,
        ConfirmationToken: strings.Repeat("a", 64), PrototypeSafe: true,
    }
}

func TestOwnerUSBUpdateRequiresDeliberatePhysicalSelection(t *testing.T) {
    device := testOwnerUSBTarget()
    state := appRefreshState{PhysicalReady: true, Targets: []physicalTarget{device}}
    if _, err := ownerUSBSelectedTarget(state, -1); err == nil {
        t.Fatal("missing explicit selection was accepted")
    }
    if _, err := ownerUSBSelectedTarget(state, 1); err == nil {
        t.Fatal("out-of-range selection was accepted")
    }
    if got, err := ownerUSBSelectedTarget(state, 0); err != nil || got.DiskNumber != 1 {
        t.Fatalf("validated selected target unavailable: %+v %v", got, err)
    }
    device.SystemDisk = true
    state.Targets[0] = device
    if _, err := ownerUSBSelectedTarget(state, 0); err == nil {
        t.Fatal("system disk accepted")
    }
    device.SystemDisk = false
    device.ConfirmationToken = "bad"
    state.Targets[0] = device
    if _, err := ownerUSBSelectedTarget(state, 0); err == nil {
        t.Fatal("unverified physical selection accepted")
    }
    // A missing physical RAW full-installer may not block a non-destructive
    // Git/Base transfer. The device token, source and OS hash checks still do.
    state.Targets[0] = testOwnerUSBTarget()
    state.PhysicalReady = false
    if got, err := ownerUSBSelectedTarget(state, 0); err != nil || got.DiskNumber != 1 {
        t.Fatalf("verified USB wrongly requires a destructive installer: %+v %v", got, err)
    }
    state.Error = "device discovery failed"
    if _, err := ownerUSBSelectedTarget(state, 0); err == nil {
        t.Fatal("unsafe device discovery error allowed USB update")
    }
}

func TestOwnerUSBTaskReusesCanonicalInstalledTransport(t *testing.T) {
    home := t.TempDir()
    // A main worktree can live outside a fixed GitHub/ordax-os path.
    ownerRoot := filepath.Join(home, "_worktrees", "owner-main")
    creator := filepath.Join(ownerRoot, "creator")
    tools := filepath.Join(creator, "tools")
    if err := os.MkdirAll(tools, 0700); err != nil { t.Fatal(err) }
    if err := os.WriteFile(filepath.Join(ownerRoot, ".git"), []byte("gitdir: fixture"), 0600); err != nil {
        t.Fatal(err)
    }
    for _, p := range []string{filepath.Join(tools, "owner_local_sync.py"),
        filepath.Join(tools, "owner_usb_git_delivery.py"), filepath.Join(home, "python.exe")} {
        if err := os.WriteFile(p, []byte("test"), 0600); err != nil { t.Fatal(err) }
    }
    app := filepath.Join(home, "install", "OrdaX-Creator-Owner-Prototype", "current",
        "OrdaX-Creator", "OrdaX-Creator.exe")
    script := filepath.Join(tools, "owner_local_sync.py")
    install := filepath.Join(home, "install", "OrdaX-Creator-Owner-Prototype")
    task := ownerUSBTaskInfo{
        Executable: filepath.Join(home, "python.exe"),
        Arguments: `"` + script + `" --install-root "` + install + `" --stage-owner-dev-usb-serial 6699E36B`,
        State: "Ready", Concurrency: "IgnoreNew",
    }
    value, err := ownerUSBTransportFromTask(task, testOwnerUSBTarget(), app)
    if err != nil || value.Script != filepath.Join(tools, "owner_usb_git_delivery.py") {
        t.Fatalf("canonical Owner Dev transport rejected: %+v %v", value, err)
    }
    task.Concurrency = "Parallel"
    if _, err := ownerUSBTransportFromTask(task, testOwnerUSBTarget(), app); err == nil {
        t.Fatal("parallel scheduled task accepted")
    }
    task.Concurrency = "IgnoreNew"
    task.Arguments = strings.Replace(task.Arguments, "6699E36B", "UNTRUSTED", 1)
    if _, err := ownerUSBTransportFromTask(task, testOwnerUSBTarget(), app); err == nil {
        t.Fatal("unselected physical serial was accepted")
    }
    task.Arguments = strings.Replace(task.Arguments, "UNTRUSTED", "6699E36B", 1)
    task.State = "Running"
    if _, err := ownerUSBTransportFromTask(task, testOwnerUSBTarget(), app); err != nil {
        t.Fatalf("running scheduled task must share the existing lock: %v", err)
    }
    task.State = "Disabled"
    if _, err := ownerUSBTransportFromTask(task, testOwnerUSBTarget(), app); err == nil {
        t.Fatal("disabled scheduled task accepted")
    }
    task.State = "Ready"
    if err := os.Remove(filepath.Join(ownerRoot, ".git")); err != nil { t.Fatal(err) }
    if _, err := ownerUSBTransportFromTask(task, testOwnerUSBTarget(), app); err == nil {
        t.Fatal("task source without Git ownership accepted")
    }
    retiredRoot := filepath.Join(home, "GitHub", "ordax-creator")
    retiredTools := filepath.Join(retiredRoot, "creator", "tools")
    if err := os.MkdirAll(retiredTools, 0700); err != nil { t.Fatal(err) }
    if err := os.MkdirAll(filepath.Join(retiredRoot, ".git"), 0700); err != nil { t.Fatal(err) }
    retiredScript := filepath.Join(retiredTools, "owner_local_sync.py")
    if err := os.WriteFile(retiredScript, []byte("untrusted"), 0600); err != nil { t.Fatal(err) }
    task.Arguments = strings.Replace(task.Arguments, script, retiredScript, 1)
    if _, err := ownerUSBTransportFromTask(task, testOwnerUSBTarget(), app); err == nil {
        t.Fatal("former Git owner must not be selected for the Creator task")
    }
}

func TestVerifyCanonicalCreatorSourceFastForwardsOnlyVerifiedMain(t *testing.T) {
    before := buildCreatorSourceCommit
    defer func() { buildCreatorSourceCommit = before }()
    binary := strings.Repeat("a", 40)
    oldMain := strings.Repeat("b", 40)
    nextMain := strings.Repeat("c", 40)
    buildCreatorSourceCommit = binary

    for _, tc := range []struct {
        name string
        remote string
        dirty string
        diverged bool
        changedDuringFetch bool
        wrongOrigin bool
        shouldPass bool
        expectMerge bool
    }{
        {name: "fresh main", remote: oldMain, shouldPass: true},
        {name: "fast forward unrelated OS changes", remote: nextMain, shouldPass: true, expectMerge: true},
        {name: "reject rewritten main", remote: nextMain, diverged: true},
        {name: "reject remote race", remote: nextMain, changedDuringFetch: true},
        {name: "reject local edits", remote: nextMain, dirty: " M creator/tools/owner_usb_git_delivery.py"},
        {name: "reject foreign origin", remote: nextMain, wrongOrigin: true},
    } {
        t.Run(tc.name, func(t *testing.T) {
            head := oldMain
            merged := false
            fetched := false
            run := func(args ...string) (string, error) {
                key := strings.Join(args, " ")
                switch key {
                case "remote get-url origin":
                    if tc.wrongOrigin { return "https://github.com/ordaxsystems/ordax-creator.git", nil }
                    return "https://github.com/ordaxsystems/ordax-os.git", nil
                case "branch --show-current":
                    return "main", nil
                case "rev-parse HEAD":
                    return head, nil
                case "cat-file -e " + binary + "^{commit}":
                    return "", nil
                case "merge-base --is-ancestor " + binary + " " + oldMain:
                    return "", nil
                case "status --porcelain=v1":
                    return tc.dirty, nil
                case "ls-remote --heads origin refs/heads/main":
                    return tc.remote + "\trefs/heads/main", nil
                case "fetch --no-tags --quiet origin refs/heads/main":
                    fetched = true
                    return "", nil
                case "rev-parse FETCH_HEAD":
                    if tc.changedDuringFetch { return strings.Repeat("d", 40), nil }
                    return tc.remote, nil
                case "merge-base --is-ancestor " + oldMain + " " + nextMain:
                    if tc.diverged { return "", errors.New("not an ancestor") }
                    return "", nil
                case "merge --ff-only --quiet FETCH_HEAD":
                    if !fetched { t.Fatal("merged without verifying fetched remote main") }
                    merged = true
                    head = tc.remote
                    return "", nil
                default:
                    t.Fatalf("unexpected Git verification operation: %s", key)
                    return "", nil
                }
            }
            err := verifyCanonicalCreatorSourceWithGit(run)
            if (err == nil) != tc.shouldPass {
                t.Fatalf("unexpected verification result: err=%v", err)
            }
            if merged != tc.expectMerge {
                t.Fatalf("unexpected main mutation: merged=%v", merged)
            }
        })
    }
}

func TestOwnerUSBTrustedHotplugRequiresUniqueAuthorizedSerial(t *testing.T) {
    home := t.TempDir()
    sourceRoot := filepath.Join(home, "GitHub", "ordax-os")
    creatorRepo := filepath.Join(sourceRoot, "creator")
    tools := filepath.Join(creatorRepo, "tools")
    if err := os.MkdirAll(tools, 0700); err != nil { t.Fatal(err) }
    // A normal checkout owns a .git directory, unlike the linked worktree.
    if err := os.MkdirAll(filepath.Join(sourceRoot, ".git"), 0700); err != nil { t.Fatal(err) }
    python := filepath.Join(home, "python.exe")
    script := filepath.Join(tools, "owner_local_sync.py")
    deliver := filepath.Join(tools, "owner_usb_git_delivery.py")
    for _, path := range []string{python, script, deliver} {
        if err := os.WriteFile(path, []byte("fixture"), 0600); err != nil { t.Fatal(err) }
    }
    install := filepath.Join(home, "install", "OrdaX-Creator-Owner-Prototype")
    executable := filepath.Join(install, "current", "OrdaX-Creator", "OrdaX-Creator.exe")
    task := ownerUSBTaskInfo{
        Executable: python,
        Arguments: "\"" + script + "\" --install-root \"" + install +
            "\" --stage-owner-dev-usb-serial 6699E36B",
        State: "Ready", Concurrency: "IgnoreNew", AutoTriggerEnabled: true,
    }
    state := appRefreshState{PhysicalReady: true, Targets: []physicalTarget{testOwnerUSBTarget()}}
    task.AutoTriggerEnabled = false
    if _, ok := ownerUSBTrustedTargetFromTask(state, task, executable); ok {
        t.Fatal("disabled scheduled trigger must never auto-stage an authorized USB")
    }
    // Disabling unattended staging must not disable the deliberate GUI button.
    if _, err := ownerUSBTransportFromTask(task, testOwnerUSBTarget(), executable); err != nil {
        t.Fatalf("manual Update USB must remain available: %v", err)
    }
    task.AutoTriggerEnabled = true
    target, ok := ownerUSBTrustedTargetFromTask(state, task, executable)
    if !ok || target.DeviceSerial != "6699E36B" {
        t.Fatalf("previously authorized Owner USB not found: %+v %v", target, ok)
    }
    state.Targets = append(state.Targets, testOwnerUSBTarget())
    if _, ok := ownerUSBTrustedTargetFromTask(state, task, executable); ok {
        t.Fatal("ambiguous physical USB was auto-staged")
    }
    state.Targets = state.Targets[:1]
    task.Arguments = strings.Replace(task.Arguments, "6699E36B", "UNTRUSTED", 1)
    if _, ok := ownerUSBTrustedTargetFromTask(state, task, executable); ok {
        t.Fatal("USB without previous local serial authorization was auto-staged")
    }
    // Restore the exact approved task identity before testing independent
    // transfer with a deliberately unavailable destructive full-media writer.
    task.Arguments = strings.Replace(task.Arguments, "UNTRUSTED", "6699E36B", 1)
    state.PhysicalReady = false
    if _, ok := ownerUSBTrustedTargetFromTask(state, task, executable); !ok {
        t.Fatal("preauthorized USB transport wrongly tied to RAW installer readiness")
    }
    state.Targets[0].DeviceSerial = "OTHER"
    if _, ok := ownerUSBTrustedTargetFromTask(state, task, executable); ok {
        t.Fatal("unrecognized physical USB serial was auto-staged")
    }
}

func TestOwnerUSBUpdateAcceptsOnlyVerifiedStagingReceipts(t *testing.T) {
    commit := strings.Repeat("a", 40)
    for _, status := range []string{"CURRENT", "STAGED_NOT_ACTIVATED"} {
        receipt := ownerUSBReceipt{Status: status, SourceCommit: commit}
        if status == "STAGED_NOT_ACTIVATED" {
            receipt.SHA256 = strings.Repeat("b", 64)
            receipt.Bytes = 28163491
        }
        data, err := json.Marshal(receipt)
        if err != nil { t.Fatal(err) }
        result, err := parseOwnerUSBReceipt(data)
        if err != nil || result.Status != status {
            t.Fatalf("expected verified %s receipt: %+v %v", status, result, err)
        }
    }
    available := ownerUSBReceipt{
        Status: "CURRENT", SourceCommit: commit,
        BaseStatus: "AVAILABLE_NOT_STAGED", BaseArtifactCommit: strings.Repeat("c", 40),
    }
    valid, _ := json.Marshal(available)
    if read, err := parseOwnerUSBReceipt(valid); err != nil ||
        read.BaseArtifactCommit != available.BaseArtifactCommit {
        t.Fatalf("canonical remote Base candidate missing: %+v %v", read, err)
    }
    stagedBase := ownerUSBReceipt{
        Status: "STAGED_NOT_ACTIVATED", SourceCommit: commit,
        SHA256: strings.Repeat("b", 64), Bytes: 28163491,
        BaseStatus: "STAGED_NOT_ACTIVATED", BaseArtifactCommit: strings.Repeat("c", 40),
    }
    stagedData, _ := json.Marshal(stagedBase)
    if got, err := parseOwnerUSBReceipt(stagedData); err != nil ||
        got.BaseStatus != "STAGED_NOT_ACTIVATED" {
        t.Fatalf("verified Base copy not accepted: %+v %v", got, err)
    }
    for _, invalid := range []ownerUSBReceipt{
        {Status: "CURRENT", SourceCommit: commit, BaseStatus: "AVAILABLE_NOT_STAGED"},
        {Status: "CURRENT", SourceCommit: commit, BaseArtifactCommit: commit},
        {Status: "CURRENT", SourceCommit: commit, BaseStatus: "ACTIVATED", BaseArtifactCommit: commit},
    } {
        payload, _ := json.Marshal(invalid)
        if _, err := parseOwnerUSBReceipt(payload); err == nil {
            t.Fatalf("unverified Base status accepted: %+v", invalid)
        }
    }
    cases := []string{
        "{}", `{"status":"SKIP_TRUSTED_USB_NOT_PRESENT","source_commit":"` + commit + `"}`,
        `{"status":"STAGED_NOT_ACTIVATED","source_commit":"` + commit + `","sha256":"bad","bytes":10}`,
        `{"status":"CURRENT","source_commit":"` + commit + `"} {"extra":true}`,
    }
    for _, text := range cases {
        if _, err := parseOwnerUSBReceipt([]byte(text)); err == nil {
            t.Fatalf("malformed or unauthorized receipt accepted: %q", text)
        }
    }
}

// A staged source bundle must never be presented as an activated system update.
func TestOwnerUSBComponentSummaryDoesNotClaimExecutableInstallation(t *testing.T) {
    for _, result := range []string{"CURRENT", "STAGED_NOT_ACTIVATED"} {
        view := ownerUSBComponentSummary(ownerUSBUpdateStatus{
            Result: result, SourceCommit: strings.Repeat("a", 40),
        })
        for _, expected := range []string{"Git", "Surface", "Base", "aaaaaaaaaaaa"} {
            if !strings.Contains(view, expected) {
                t.Fatalf("missing %q in component evidence %q", expected, view)
            }
        }
    }
    view := ownerUSBComponentSummary(ownerUSBUpdateStatus{
        Result: "CURRENT", SourceCommit: strings.Repeat("a", 40),
        BaseStatus: "AVAILABLE_NOT_STAGED", BaseArtifactCommit: strings.Repeat("c", 40),
    })
    if !strings.Contains(view, "cccccccccccc") || !strings.Contains(view, "Base") ||
        !strings.Contains(view, "não transferida") {
        t.Fatalf("available-only Base evidence is missing: %q", view)
    }
    stagedView := ownerUSBComponentSummary(ownerUSBUpdateStatus{
        Result: "CURRENT", SourceCommit: strings.Repeat("a", 40),
        BaseStatus: "STAGED_NOT_ACTIVATED", BaseArtifactCommit: strings.Repeat("c", 40),
    })
    if !strings.Contains(stagedView, "arquivos verificados") ||
        !strings.Contains(stagedView, "boot não atualizado") {
        t.Fatalf("physical Base transport misreported as boot activation: %q", stagedView)
    }
    for _, input := range []ownerUSBUpdateStatus{
        {Result: "AVAILABLE", SourceCommit: strings.Repeat("a", 40)},
        {Result: "CURRENT", SourceCommit: "invalid"},
        {Result: ""},
    } {
        if got := ownerUSBComponentSummary(input); got != "" {
            t.Fatalf("unverified transport generated evidence: %q", got)
        }
    }
}

func TestOwnerUSBRemoteBaseAvailabilityTranslationIsExplicit(t *testing.T) {
    for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
        message := strings.ToLower(creatorMessageFor(locale, msgUSBUpdateBaseAvailable, nil))
        if locale == creatorLocalePTBR && !strings.Contains(message, "não transferida") {
            t.Fatalf("PT-BR binary remote-only disclaimer missing: %q", message)
        }
        if locale == creatorLocaleENUS && !strings.Contains(message, "not transferred") {
            t.Fatalf("EN-US binary remote-only disclaimer missing: %q", message)
        }
    }
}

func TestOwnerUSBStagingPresentationNeverClaimsOSActivated(t *testing.T) {
    for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
        current := strings.ToLower(creatorMessageFor(locale, msgUSBUpdateCurrent, nil))
        staged := strings.ToLower(creatorMessageFor(locale, msgUSBUpdateComplete, nil))
        if locale == creatorLocalePTBR {
            if !strings.Contains(current, "não verificado") || !strings.Contains(staged, "não atualizado") {
                t.Fatalf("Portuguese Git staging must not be reported as OS activation: %q / %q", current, staged)
            }
        } else if !strings.Contains(current, "unverified") || !strings.Contains(staged, "not updated") {
            t.Fatalf("English Git staging must not be reported as OS activation: %q / %q", current, staged)
        }
    }
}

func TestOwnerUSBGitStageMatchesPinnedOSUpdateCoverage(t *testing.T) {
    root := os.Getenv("ORDAX_OS_CONTRACTS_DIR")
    if root == "" {
        t.Skip("requires the pinned read-only OS contract checkout")
    }
    data, err := os.ReadFile(filepath.Join(root, "device-update-coverage.json"))
    if err != nil { t.Fatal(err) }
    var contract struct {
        Schema string `json:"$schema"`
        Layers []struct {
            ID string `json:"id"`
            Delivery string `json:"development_delivery"`
            ActivationImplemented *bool `json:"activation_implemented"`
            RuntimeOneShot *bool `json:"runtime_one_shot_activation_wiring_implemented"`
            SelfUpdateGap *bool `json:"self_update_gap"`
        } `json:"layers"`
    }
    if err := json.Unmarshal(data, &contract); err != nil { t.Fatal(err) }
    if contract.Schema != "prototype-ordax.device-update-coverage/1" {
        t.Fatalf("unsupported OS coverage authority %q", contract.Schema)
    }
    seen := make(map[string]bool, len(contract.Layers))
    for _, layer := range contract.Layers {
        if seen[layer.ID] { t.Fatalf("duplicate OS layer %q", layer.ID) }
        seen[layer.ID] = true
        switch layer.ID {
        case "development-rootfs":
            if layer.Delivery != "exact-commit-development-base-rootfs-candidate" ||
                layer.ActivationImplemented == nil || *layer.ActivationImplemented ||
                layer.RuntimeOneShot == nil || *layer.RuntimeOneShot {
                t.Fatal("Creator Git-only staging cannot claim Base activation")
            }
        case "kernel-and-initramfs":
            if layer.RuntimeOneShot == nil || *layer.RuntimeOneShot {
                t.Fatal("Creator Git staging cannot claim kernel/initramfs activation")
            }
        case "uefi-fallback-loader":
            if layer.SelfUpdateGap == nil || !*layer.SelfUpdateGap {
                t.Fatal("Creator Git staging cannot claim UEFI loader self-update")
            }
        }
    }
    for _, id := range []string{"development-rootfs", "kernel-and-initramfs", "uefi-fallback-loader"} {
        if !seen[id] { t.Fatalf("missing mandatory OS coverage layer %q", id) }
    }
    for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
        action := strings.ToLower(creatorMessageFor(locale, msgUSBUpdateAction, nil))
        if !strings.Contains(action, "git") {
            t.Fatalf("Git-only Creator action must identify its real scope: %q", action)
        }
    }
}


// The UI must surface the physical synchronizer's real blocking reason rather
// than claiming that a staged Git bundle was an OS install.
func TestOwnerUSBFailureRetainsBoundedSpecificDiagnostic(t *testing.T) {
    msg := "OWNER_DEV_USB_GIT_STAGE=BLOCKED:USB serial differs from locally authorized device"
    err := ownerUSBTransportFailure(&exec.ExitError{Stderr: []byte(msg + "\n")})
    if !strings.Contains(err.Error(), "USB serial differs") {
        t.Fatalf("physical identity cause was hidden: %v", err)
    }
    if got := ownerUSBTransportFailure(errors.New("process launch failed")); !strings.Contains(got.Error(), "iniciar") {
        t.Fatalf("launch error not differentiated: %v", got)
    }
    for _, bad := range []string{
        "untrusted raw error",
        "OWNER_DEV_USB_GIT_STAGE=BLOCKED:",
        "OWNER_DEV_USB_GIT_STAGE=BLOCKED:" + strings.Repeat("x", 351),
        "OWNER_DEV_USB_GIT_STAGE=BLOCKED:invalid\x00data",
    } {
        got := ownerUSBTransportFailure(&exec.ExitError{Stderr: []byte(bad)})
        if strings.Contains(got.Error(), "x00") || len(got.Error()) > 180 {
            t.Fatalf("unbounded or unsafe UI error: %q", got)
        }
    }
}
