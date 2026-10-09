//go:build windows && ordax_raw_backend

package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	creatorcore "github.com/ordaxsystems/ordax-os/tools/creator/core"
)

type portableSourceHandle struct {
	file *os.File
	core creatorcore.PortableApplicationSource
}

type portableWindowsRuntime struct {
	target  Target
	sources map[string]portableSourceHandle
	roots   map[string]string
	synced  map[string]bool
	report  func(PhysicalApplyProgress)
}

type PortablePhysicalApplyResult struct {
	Schema                 string
	Status                 string
	DiskNumber             uint32
	ApplicationPlanSHA256  string
	OperationCount         int
	MaterializedArtifacts  int
	ReadbackArtifacts      int
	WholeDiskRawImageUsed  bool
}

func psSingle(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func runPortablePS(script string) (string, error) {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" { msg = err.Error() }
		return "", errors.New(msg)
	}
	return strings.TrimSpace(string(out)), nil
}

func revalidatePortableTarget(target Target) error {
	if target.SystemDisk || !target.PrototypeSafe || target.BusType != "usb" {
		return errors.New("portable physical target is not eligible")
	}
	systemDisk, err := windowsSystemDiskNumber()
	if err != nil { return fmt.Errorf("resolve Windows system disk: %w", err) }
	if target.DiskNumber == systemDisk {
		return errors.New("portable target now resolves to Windows system disk")
	}
	bus, removable, serial, size, err := physicalDeviceIdentity(target.DiskNumber)
	if err != nil { return fmt.Errorf("revalidate PhysicalDrive%d: %w", target.DiskNumber, err) }
	if bus != BusTypeUSB || size != target.PhysicalDiskBytes || removable != target.DeviceRemovable {
		return errors.New("portable target identity changed")
	}
	if want := strings.TrimSpace(target.DeviceSerial); want != "" && strings.TrimSpace(serial) != want {
		return errors.New("portable target serial changed")
	}
	return nil
}

func openPortableSourceHandles(request PortablePhysicalApplyRequest) (map[string]portableSourceHandle, []creatorcore.PortableApplicationSource, error) {
	handles := map[string]portableSourceHandle{}
	coreSources := make([]creatorcore.PortableApplicationSource, 0, len(request.Sources))
	closeAll := func() { for _, h := range handles { _ = h.file.Close() } }
	for _, source := range request.Sources {
		file, verified, err := openVerifiedRawImageForApply(source.Path, source.SHA256, int64(source.SizeBytes))
		if err != nil {
			closeAll()
			return nil, nil, fmt.Errorf("verify portable source %q: %w", source.ArtifactID, err)
		}
		core := creatorcore.PortableApplicationSource{
			ArtifactID: source.ArtifactID,
			SHA256: verified.SHA256,
			SizeBytes: uint64(verified.SizeBytes),
		}
		handles[source.ArtifactID] = portableSourceHandle{file: file, core: core}
		coreSources = append(coreSources, core)
	}
	return handles, coreSources, nil
}

func (r *portableWindowsRuntime) close() {
	for _, h := range r.sources { _ = h.file.Close() }
}

func (r *portableWindowsRuntime) progress(phase string, done, total int64) {
	if r.report != nil {
		r.report(PhysicalApplyProgress{Phase: phase, CompletedBytes: done, TotalBytes: total})
	}
}

func portablePartitionBytes(p creatorcore.PortableApplicationPartition) (uint64, uint64, error) {
	if p.StartLBA == 0 || p.LastLBA < p.StartLBA { return 0, 0, errors.New("invalid partition geometry") }
	sectors := p.LastLBA - p.StartLBA + 1
	return p.StartLBA * 512, sectors * 512, nil
}

func (r *portableWindowsRuntime) WriteGPT(parts []creatorcore.PortableApplicationPartition, targetBytes uint64) error {
	if len(parts) != 2 || targetBytes != r.target.PhysicalDiskBytes ||
		parts[0].Name != "ORDAX-ESP" || parts[1].Name != "ORDAX-DATA" {
		return errors.New("Portable GPT differs from canonical plan")
	}
	if err := revalidatePortableTarget(r.target); err != nil { return err }
	espOff, espSize, err := portablePartitionBytes(parts[0]); if err != nil { return err }
	dataOff, dataSize, err := portablePartitionBytes(parts[1]); if err != nil { return err }
	if dataOff > ^uint64(0)-dataSize || dataOff+dataSize < espOff {
		return errors.New("Portable GPT extent overflow")
	}
	requiredExtent := dataOff + dataSize - espOff
	r.progress("partitioning-portable", 0, 1)
	script := fmt.Sprintf(`
$ErrorActionPreference='Stop'
$d=%d; $bytes=[UInt64]%d; $required=[UInt64]%d
$disk=Get-Disk -Number $d -ErrorAction Stop
if ([UInt64]$disk.Size -ne $bytes -or ([string]$disk.BusType).ToUpperInvariant() -ne 'USB' -or [bool]$disk.IsSystem -or [bool]$disk.IsBoot) { throw 'unsafe Portable target' }
try { Set-Disk -Number $d -IsReadOnly $false -ErrorAction Stop } catch {}
'ORDAX_PORTABLE_GPT_STAGE=clear'
Clear-Disk -Number $d -RemoveData -RemoveOEM -Confirm:$false -ErrorAction Stop
Update-HostStorageCache -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 250
$disk=Get-Disk -Number $d -ErrorAction Stop
$existing=@(Get-Partition -DiskNumber $d -ErrorAction SilentlyContinue)
$style=([string]$disk.PartitionStyle).ToUpperInvariant()
if ($existing.Count -ne 0) { throw 'Portable disk still has partitions after Clear-Disk' }
if ($style -eq 'RAW') {
    'ORDAX_PORTABLE_GPT_STAGE=initialize'
    Initialize-Disk -Number $d -PartitionStyle GPT -ErrorAction Stop
} elseif ($style -eq 'GPT') {
    'ORDAX_PORTABLE_GPT_STAGE=reuse-gpt'
} else {
    throw ('Portable disk has unsupported partition style after Clear-Disk: {0}' -f $style)
}
'ORDAX_PORTABLE_GPT_STAGE=wait-stable'
$ready=$false
$last='unobserved'
for ($i=0; $i -lt 120; $i++) {
    Update-HostStorageCache -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 250
    $disk=Get-Disk -Number $d -ErrorAction Stop
    $existing=@(Get-Partition -DiskNumber $d -ErrorAction SilentlyContinue)
    $largest=[UInt64]$disk.LargestFreeExtent
    $last=('style={0} partitions={1} largest_free_extent={2} size={3} bus={4}' -f ([string]$disk.PartitionStyle),$existing.Count,$largest,[UInt64]$disk.Size,[string]$disk.BusType)
    if ([UInt64]$disk.Size -eq $bytes -and ([string]$disk.BusType).ToUpperInvariant() -eq 'USB' -and -not [bool]$disk.IsSystem -and -not [bool]$disk.IsBoot -and ([string]$disk.PartitionStyle).ToUpperInvariant() -eq 'GPT' -and $existing.Count -eq 0 -and $largest -ge $required) {
        $ready=$true
        break
    }
}
if (-not $ready) { throw ('Portable GPT initialization did not stabilize before partition creation: {0} required_extent={1}' -f $last,$required) }
'ORDAX_PORTABLE_GPT_STAGE=stable'
'ORDAX_PORTABLE_GPT_STAGE=create-esp'
$p1=New-Partition -DiskNumber $d -Offset ([UInt64]%d) -Size ([UInt64]%d) -GptType '{C12A7328-F81F-11D2-BA4B-00A0C93EC93B}' -ErrorAction Stop
Update-HostStorageCache -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 250
'ORDAX_PORTABLE_GPT_STAGE=create-data'
$p2=New-Partition -DiskNumber $d -Offset ([UInt64]%d) -Size ([UInt64]%d) -GptType '{EBD0A0A2-B9E5-4433-87C0-68B6B72699C7}' -ErrorAction Stop
Update-HostStorageCache -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 250
$parts=@(Get-Partition -DiskNumber $d -ErrorAction Stop | Sort-Object PartitionNumber)
if ($parts.Count -ne 2 -or $p1.PartitionNumber -ne 1 -or $p2.PartitionNumber -ne 2) { throw 'Portable GPT partition count mismatch' }
if ([UInt64]$parts[0].Offset -ne [UInt64]%d -or [UInt64]$parts[0].Size -ne [UInt64]%d) { throw 'ORDAX-ESP geometry mismatch' }
if ([UInt64]$parts[1].Offset -ne [UInt64]%d -or [UInt64]$parts[1].Size -ne [UInt64]%d) { throw 'ORDAX-DATA geometry mismatch' }
'ORDAX_PORTABLE_GPT=PASS'
`, r.target.DiskNumber, targetBytes, requiredExtent, espOff, espSize, dataOff, dataSize, espOff, espSize, dataOff, dataSize)
	out, err := runPortablePS(script)
	if err != nil { return fmt.Errorf("write Portable GPT: %w", err) }
	if !strings.Contains(out, "ORDAX_PORTABLE_GPT=PASS") { return errors.New("Portable GPT success marker missing") }
	r.progress("partitioning-portable", 1, 1)
	return nil
}

func (r *portableWindowsRuntime) Format(p creatorcore.PortableApplicationPartition) error {
	if err := revalidatePortableTarget(r.target); err != nil { return err }
	off, size, err := portablePartitionBytes(p); if err != nil { return err }
	fs := map[string]string{"fat32":"FAT32", "exfat":"exFAT"}[p.Filesystem]
	if fs == "" { return fmt.Errorf("unsupported Portable filesystem %q", p.Filesystem) }
	script := fmt.Sprintf(`
$ErrorActionPreference='Stop'
$d=%d; $n=%d; $off=[UInt64]%d; $size=[UInt64]%d
$disk=Get-Disk -Number $d -ErrorAction Stop
if ([UInt64]$disk.Size -ne [UInt64]%d -or ([string]$disk.BusType).ToUpperInvariant() -ne 'USB' -or [bool]$disk.IsSystem -or [bool]$disk.IsBoot) { throw 'unsafe Portable target before format' }
$p=Get-Partition -DiskNumber $d -PartitionNumber $n -ErrorAction Stop
if ([UInt64]$p.Offset -ne $off -or [UInt64]$p.Size -ne $size) { throw 'Portable partition geometry drift' }
$null=$p | Format-Volume -FileSystem %s -NewFileSystemLabel %s -Confirm:$false -Force -ErrorAction Stop
$volumeReady=$false
$last='unobserved'
for ($i=0; $i -lt 120; $i++) {
    Update-HostStorageCache -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 250
    $p=Get-Partition -DiskNumber $d -PartitionNumber $n -ErrorAction Stop
    $letter=[char]$p.DriveLetter
    if ([int]$letter -eq 0) {
        try {
            $p | Add-PartitionAccessPath -AssignDriveLetter -ErrorAction Stop | Out-Null
        } catch {
            $last=('assign-drive-letter: {0}' -f $_.Exception.Message)
            continue
        }
        Update-HostStorageCache -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 250
        $p=Get-Partition -DiskNumber $d -PartitionNumber $n -ErrorAction Stop
        $letter=[char]$p.DriveLetter
    }
    if ([int]$letter -eq 0) {
        $last='drive-letter-unassigned'
        continue
    }
    try {
        $v=$p | Get-Volume -ErrorAction Stop
    } catch {
        $last=('get-volume: {0}' -f $_.Exception.Message)
        continue
    }
    $observed=[string]$v.FileSystem
    if ([string]::IsNullOrWhiteSpace($observed)) { $observed=[string]$v.FileSystemType }
    $label=([string]$v.FileSystemLabel).Trim()
    $last=('letter={0} filesystem={1} label={2}' -f [string]$letter,$observed,$label)
    if ([string]::Equals($observed.Trim(),%s,[System.StringComparison]::OrdinalIgnoreCase) -and [string]::Equals($label,%s,[System.StringComparison]::Ordinal)) {
        $volumeReady=$true
        break
    }
}
if (-not $volumeReady) { throw ('Portable volume did not stabilize after format: {0}' -f $last) }
([string]$letter)+':\'
`, r.target.DiskNumber, p.Index, off, size, r.target.PhysicalDiskBytes, psSingle(fs), psSingle(p.Name), psSingle(fs), psSingle(p.Name))
	out, err := runPortablePS(script)
	if err != nil { return fmt.Errorf("format %s: %w", p.Name, err) }
	fields := strings.Fields(out)
	if len(fields) == 0 { return fmt.Errorf("format %s returned no drive root", p.Name) }
	root := fields[len(fields)-1]
	if len(root) != 3 || root[1:] != ":\\" { return fmt.Errorf("unsafe drive root %q", root) }
	r.roots[p.Name] = root
	return nil
}

func portableDestination(root, target string) (string, error) {
	if len(root) != 3 || root[1:] != ":\\" || !strings.HasPrefix(target, "/") || strings.Contains(target, "\\") {
		return "", errors.New("non-canonical Portable destination")
	}
	rel := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(target, "/")))
	if rel == "." || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", errors.New("Portable destination escapes partition")
	}
	full := filepath.Join(root, rel)
	if !strings.HasPrefix(strings.ToLower(filepath.Clean(full)), strings.ToLower(filepath.Clean(root))) {
		return "", errors.New("Portable destination escaped drive root")
	}
	return full, nil
}

func (r *portableWindowsRuntime) Materialize(op creatorcore.PortableApplicationOperation, source creatorcore.PortableApplicationSource) error {
	if err := revalidatePortableTarget(r.target); err != nil { return err }
	h, ok := r.sources[source.ArtifactID]
	if !ok || h.core != source { return fmt.Errorf("source %q is not locked", source.ArtifactID) }
	root := r.roots[op.Partition]
	dest, err := portableDestination(root, op.TargetPath); if err != nil { return err }
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil { return err }
	if _, err := os.Lstat(dest); err == nil { return fmt.Errorf("destination already exists for %q", op.ArtifactID) }
	if _, err := h.file.Seek(0, io.SeekStart); err != nil { return err }
	dst, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil { return err }
	remove := true
	defer func(){ _=dst.Close(); if remove { _=os.Remove(dest) } }()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(dst, hash), io.LimitReader(h.file, int64(source.SizeBytes)))
	if err != nil || n != int64(source.SizeBytes) { return fmt.Errorf("copy %q failed or changed size", op.ArtifactID) }
	var extra [1]byte
	if m, e := h.file.Read(extra[:]); m != 0 || (e != nil && !errors.Is(e, io.EOF)) { return fmt.Errorf("source %q grew while copying", op.ArtifactID) }
	if hex.EncodeToString(hash.Sum(nil)) != source.SHA256 { return fmt.Errorf("source %q digest changed while copying", op.ArtifactID) }
	if err := dst.Sync(); err != nil { return err }
	if err := dst.Close(); err != nil { return err }
	remove=false
	r.synced[op.ArtifactID]=true
	return nil
}

func (r *portableWindowsRuntime) Flush() error {
	if len(r.synced) != 17 { return fmt.Errorf("Portable flush before all 17 artifacts were synced: %d", len(r.synced)) }
	return nil
}

func (r *portableWindowsRuntime) Readback(op creatorcore.PortableApplicationOperation) error {
	if err := revalidatePortableTarget(r.target); err != nil { return err }
	path, err := portableDestination(r.roots[op.Partition], op.TargetPath); if err != nil { return err }
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || uint64(info.Size()) != op.SizeBytes {
		return fmt.Errorf("readback identity/size failed for %q", op.ArtifactID)
	}
	f, err := os.Open(path); if err != nil { return err }
	defer f.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, f)
	if err != nil || uint64(n) != op.SizeBytes || hex.EncodeToString(hash.Sum(nil)) != op.SHA256 {
		return fmt.Errorf("readback SHA-256 failed for %q", op.ArtifactID)
	}
	return nil
}

func (r *portableWindowsRuntime) VerifyLayout(parts []creatorcore.PortableApplicationPartition, targetBytes uint64) error {
	if len(parts)!=2 || targetBytes!=r.target.PhysicalDiskBytes { return errors.New("invalid final Portable layout input") }
	if err := revalidatePortableTarget(r.target); err != nil { return err }
	for _, p := range parts {
		root := r.roots[p.Name]
		if root == "" { return fmt.Errorf("missing mounted root for %s", p.Name) }
	}
	script := fmt.Sprintf(`
$ErrorActionPreference='Stop'
$d=%d; $disk=Get-Disk -Number $d -ErrorAction Stop
if ([UInt64]$disk.Size -ne [UInt64]%d -or ([string]$disk.BusType).ToUpperInvariant() -ne 'USB' -or [bool]$disk.IsSystem -or [bool]$disk.IsBoot) { throw 'unsafe final Portable target' }
$parts=@(Get-Partition -DiskNumber $d -ErrorAction Stop | Sort-Object PartitionNumber)
if ($parts.Count -ne 2) { throw 'final Portable GPT partition count mismatch' }
$v1=Get-Volume -DriveLetter %s -ErrorAction Stop; $v2=Get-Volume -DriveLetter %s -ErrorAction Stop
if (([string]$v1.FileSystemLabel).Trim() -ne 'ORDAX-ESP' -or ([string]$v2.FileSystemLabel).Trim() -ne 'ORDAX-DATA') { throw 'Portable label mismatch' }
'ORDAX_PORTABLE_LAYOUT=VERIFIED'
`, r.target.DiskNumber, targetBytes, psSingle(strings.TrimSuffix(r.roots["ORDAX-ESP"], ":\\")), psSingle(strings.TrimSuffix(r.roots["ORDAX-DATA"], ":\\")))
	out, err := runPortablePS(script)
	if err != nil { return err }
	if !strings.Contains(out, "ORDAX_PORTABLE_LAYOUT=VERIFIED") { return errors.New("final Portable layout marker missing") }
	return nil
}

func ApplyPortablePhysicalWithProgress(request PortablePhysicalApplyRequest, report func(PhysicalApplyProgress)) (PortablePhysicalApplyResult, error) {
	elevated, err := currentProcessElevated()
	if err != nil { return PortablePhysicalApplyResult{}, err }
	if !elevated { return PortablePhysicalApplyResult{}, errors.New("Portable physical apply requires UAC elevation") }

	live, err := EnumerateRemovableTargets()
	if err != nil { return PortablePhysicalApplyResult{}, err }
	confirmed, err := MatchConfirmedTarget(live, request.ConfirmationToken)
	if err != nil { return PortablePhysicalApplyResult{}, err }
	request.Target=confirmed
	confirmed, planSHA, err := validatePortablePhysicalApplyRequestPolicy(request)
	if err != nil { return PortablePhysicalApplyResult{}, err }
	if err := revalidatePortableTarget(confirmed); err != nil { return PortablePhysicalApplyResult{}, err }

	handles, sources, err := openPortableSourceHandles(request)
	if err != nil { return PortablePhysicalApplyResult{}, err }
	runtime := &portableWindowsRuntime{target:confirmed,sources:handles,roots:map[string]string{},synced:map[string]bool{},report:report}
	defer runtime.close()

	receipt, err := creatorcore.ExecutePortableApplication(request.ApplicationPlan, sources, creatorcore.PortableApplicationExecutionGrant{
		ApplicationPlanSHA256: planSHA, PhysicalWriteAuthorized:true,
	}, runtime)
	if err != nil { return PortablePhysicalApplyResult{}, err }

	return PortablePhysicalApplyResult{
		Schema:"prototype-ordax.creator-portable-physical-apply/1",
		Status:"pass-readback-verified",
		DiskNumber:confirmed.DiskNumber,
		ApplicationPlanSHA256:receipt.ApplicationPlanSHA256,
		OperationCount:receipt.OperationCount,
		MaterializedArtifacts:receipt.MaterializedArtifacts,
		ReadbackArtifacts:receipt.ReadbackArtifacts,
		WholeDiskRawImageUsed:receipt.WholeDiskRawImageUsed,
	}, nil
}
