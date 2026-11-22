//go:build windows && ordax_raw_backend

package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	creatorcore "github.com/ordaxsystems/ordax-os/creator/core"
)

// This is an adapter of the canonical Core Update transaction, not another
// updater. It never formats, repartitions, edits an ext4 volume, or writes EFI.
type portableWindowsUpdateRuntime struct {
	base *portableWindowsRuntime
	expectedCopies int
}

type portableUpdateRoots struct {
	ESP string `json:"esp"`
	Data string `json:"data"`
	TemporaryESP bool `json:"temporary_esp"`
}

// Mount the existing exact two-partition media. Windows normally hides EFI;
// temporarily assign it a letter for hash verification only. The local source
// of truth remains the Core partition layout and physical target identity.
func openInstalledPortableRoots(target Target, parts []creatorcore.PortableApplicationPartition) (portableUpdateRoots, error) {
	if len(parts)!=2 || parts[0].Name!="ORDAX-ESP" || parts[1].Name!="ORDAX-DATA" {
		return portableUpdateRoots{}, errors.New("unexpected installed Portable layout")
	}
	if err:=revalidatePortableTarget(target);err!=nil{return portableUpdateRoots{},err}
	for _,p:=range parts {
		if p.StartLBA==0 || p.LastLBA<p.StartLBA {return portableUpdateRoots{},errors.New("invalid Portable partition geometry")}
	}
	script:=strings.Join([]string{
		"$ErrorActionPreference='Stop'",
		fmt.Sprintf("$d=%d;$bytes=[UInt64]%d",target.DiskNumber,target.PhysicalDiskBytes),
		"$disk=Get-Disk -Number $d -ErrorAction Stop",
		"if ([UInt64]$disk.Size -ne $bytes -or ([string]$disk.BusType).ToUpperInvariant() -ne 'USB' -or [bool]$disk.IsSystem -or [bool]$disk.IsBoot) {throw 'unsafe existing Portable disk'}",
		"$ps=@(Get-Partition -DiskNumber $d -ErrorAction Stop | Sort-Object PartitionNumber)",
		"if($ps.Count -ne 2){throw 'existing Portable media must have exactly two partitions'}",
		fmt.Sprintf("$off1=[UInt64]%d;$size1=[UInt64]%d;$off2=[UInt64]%d;$size2=[UInt64]%d",
			parts[0].StartLBA*512,(parts[0].LastLBA-parts[0].StartLBA+1)*512,
			parts[1].StartLBA*512,(parts[1].LastLBA-parts[1].StartLBA+1)*512),
		"if([UInt64]$ps[0].Offset -ne $off1 -or [UInt64]$ps[0].Size -ne $size1 -or [UInt64]$ps[1].Offset -ne $off2 -or [UInt64]$ps[1].Size -ne $size2){throw 'installed Portable geometry changed'}",
		"$espTemp=$false",
		"try{",
		"  $esp=$ps[0];$data=$ps[1]",
		"  $e=$esp | Get-Volume -ErrorAction Stop;$v=$data | Get-Volume -ErrorAction Stop",
		"  if([string]$e.FileSystemLabel -ne 'ORDAX-ESP' -or [string]$v.FileSystemLabel -ne 'ORDAX-DATA' -or [string]$e.FileSystem -ne 'FAT32' -or [string]$v.FileSystem -notmatch '^(?i:exfat)$'){throw 'existing Portable filesystem identity mismatch'}",
		"  if([int][char]$esp.DriveLetter -eq 0){",
		"    $esp | Add-PartitionAccessPath -AssignDriveLetter -ErrorAction Stop | Out-Null",
		"    $espTemp=$true;Update-HostStorageCache -ErrorAction SilentlyContinue",
		"    $esp=Get-Partition -DiskNumber $d -PartitionNumber 1 -ErrorAction Stop",
		"  }",
		"  $data=Get-Partition -DiskNumber $d -PartitionNumber 2 -ErrorAction Stop",
		"  if([int][char]$esp.DriveLetter -eq 0 -or [int][char]$data.DriveLetter -eq 0){throw 'mounted Portable partitions lack a drive letter'}",
		"  [pscustomobject]@{esp=([string]$esp.DriveLetter)+':\';data=([string]$data.DriveLetter)+':\';temporary_esp=$espTemp}|ConvertTo-Json -Compress",
		"}catch{",
		"  if($espTemp){$mounted=Get-Partition -DiskNumber $d -PartitionNumber 1 -ErrorAction SilentlyContinue;if($mounted -and [int][char]$mounted.DriveLetter -ne 0){try{$mounted|Remove-PartitionAccessPath -AccessPath (([string]$mounted.DriveLetter)+':\') -ErrorAction Stop|Out-Null}catch{}}}",
		"  throw",
		"}",
	},"\n")
	out,err:=runPortablePS(script)
	if err!=nil{return portableUpdateRoots{},fmt.Errorf("existing Portable mount: %w",err)}
	var roots portableUpdateRoots
	if json.Unmarshal([]byte(out),&roots)!=nil || len(roots.ESP)!=3 || len(roots.Data)!=3 ||
		roots.ESP[1:]!=":\" || roots.Data[1:]!=":\" || strings.EqualFold(roots.ESP,roots.Data) {
		return portableUpdateRoots{},errors.New("existing Portable mount returned unsafe volume roots")
	}
	return roots,nil
}

func closeInstalledPortableRoots(target Target, roots portableUpdateRoots) {
	if !roots.TemporaryESP {return}
	if revalidatePortableTarget(target)!=nil{return}
	script:=fmt.Sprintf("$ErrorActionPreference='Stop';$p=Get-Partition -DiskNumber %d -PartitionNumber 1 -ErrorAction Stop;if(([string]$p.DriveLetter)+':\' -ne %s){throw 'Portable ESP access path changed'};$p|Remove-PartitionAccessPath -AccessPath %s -ErrorAction Stop|Out-Null",
		target.DiskNumber,psSingle(roots.ESP),psSingle(roots.ESP))
	_,_=runPortablePS(script)
}

func checkPortableUpdateParent(root,target string) (string,error) {
	path,err:=portableDestination(root,target)
	if err!=nil{return "",err}
	parent:=filepath.Dir(path)
	rootClean:=filepath.Clean(root)
	rel,err:=filepath.Rel(rootClean,parent)
	if err!=nil{return "",err}
	if rel==".." || strings.HasPrefix(rel,".."+string(os.PathSeparator)) {return "",errors.New("Portable update destination escapes volume")}
	current:=rootClean
	for _,part:=range strings.Split(rel,string(os.PathSeparator)) {
		if part=="" || part=="." {continue}
		current=filepath.Join(current,part)
		info,err:=os.Lstat(current)
		if os.IsNotExist(err) {
			if err=os.Mkdir(current,0o755);err!=nil{return "",err}
			info,err=os.Lstat(current)
		}
		if err!=nil || info.Mode()&os.ModeSymlink!=0 || !info.IsDir() {
			return "",errors.New("unsafe Portable destination parent")
		}
	}
	return path,nil
}

func (u *portableWindowsUpdateRuntime) VerifyLayout(parts []creatorcore.PortableApplicationPartition, bytes uint64) error {
	return u.base.VerifyLayout(parts,bytes)
}

func (u *portableWindowsUpdateRuntime) Readback(op creatorcore.PortableApplicationOperation) error {
	return u.base.Readback(op)
}

// Reuse verified locked source handles and the common destination and
// readback semantics. Unlike first-install, this never writes a release
// directly to its final name before SHA-256 and size are verified.
func (u *portableWindowsUpdateRuntime) Materialize(op creatorcore.PortableApplicationOperation, source creatorcore.PortableApplicationSource) error {
	r:=u.base
	if err:=revalidatePortableTarget(r.target);err!=nil{return err}
	h,ok:=r.sources[source.ArtifactID]
	if !ok || h.core!=source{return errors.New("unsigned or unlocked update source")}
	dest,err:=checkPortableUpdateParent(r.roots[op.Partition],op.TargetPath)
	if err!=nil{return err}
	if stat,err:=os.Lstat(dest);err==nil {
		if !stat.Mode().IsRegular() || stat.Mode()&os.ModeSymlink!=0 {return errors.New("existing candidate destination is unsafe")}
		if err:=r.Readback(op);err!=nil {return errors.New("existing candidate destination conflicts with signed hash")}
		r.synced[op.ArtifactID]=true
		return nil
	}else if !os.IsNotExist(err) {return err}
	if _,err:=h.file.Seek(0,io.SeekStart);err!=nil{return err}
	pending,err:=os.CreateTemp(filepath.Dir(dest),".ordax-update-pending-*")
	if err!=nil{return err}
	pendingPath:=pending.Name()
	defer os.Remove(pendingPath)
	hash:=sha256.New()
	count,copyErr:=io.Copy(io.MultiWriter(pending,hash),io.LimitReader(h.file,int64(source.SizeBytes)))
	if copyErr!=nil || count!=int64(source.SizeBytes) {
		pending.Close()
		return fmt.Errorf("candidate file copy failed for %q",source.ArtifactID)
	}
	var extra [1]byte
	n,readErr:=h.file.Read(extra[:])
	if n!=0 || (readErr!=nil && !errors.Is(readErr,io.EOF)) {
		pending.Close();return errors.New("signed update source changed during copy")
	}
	if hex.EncodeToString(hash.Sum(nil))!=source.SHA256 {pending.Close();return errors.New("signed update source SHA-256 changed")}
	if err:=pending.Sync();err!=nil{pending.Close();return err}
	if err:=pending.Close();err!=nil{return err}
	if err:=revalidatePortableTarget(r.target);err!=nil{return err}
	if _,err:=os.Lstat(dest);err==nil{return errors.New("candidate destination changed during staging")}
	if err:=os.Rename(pendingPath,dest);err!=nil{return err}
	if err:=r.Readback(op);err!=nil{return fmt.Errorf("candidate post-rename readback: %w",err)}
	r.synced[op.ArtifactID]=true
	return nil
}

func (u *portableWindowsUpdateRuntime) Flush() error {
	if err:=revalidatePortableTarget(u.base.target);err!=nil{return err}
	if len(u.base.synced)!=u.expectedCopies {
		return fmt.Errorf("Portable update copied %d of %d required sources",len(u.base.synced),u.expectedCopies)
	}
	return nil
}

func (u *portableWindowsUpdateRuntime) ArmCandidate(sha string) error {
	if len(sha)!=40 || strings.Trim(sha,"0123456789abcdef")!="" {
		return errors.New("candidate source commit is invalid")
	}
	if err:=revalidatePortableTarget(u.base.target);err!=nil{return err}
	target,err:=checkPortableUpdateParent(u.base.roots["ORDAX-DATA"],"/.ordax/updates/portable-release-request.txt")
	if err!=nil{return err}
	payload:=[]byte("schema=ordax.portable-update-request/1
source_commit="+sha+"
")
	pending,err:=os.CreateTemp(filepath.Dir(target),".ordax-activation-pending-*")
	if err!=nil{return err}
	defer os.Remove(pending.Name())
	if _,err:=pending.Write(payload);err!=nil{pending.Close();return err}
	if err:=pending.Sync();err!=nil{pending.Close();return err}
	if err:=pending.Close();err!=nil{return err}
	if err:=revalidatePortableTarget(u.base.target);err!=nil{return err}
	if info,err:=os.Lstat(target);err==nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink!=0){
		return errors.New("activation request path is unsafe")
	}else if err!=nil && !os.IsNotExist(err){return err}
	if err:=os.Rename(pending.Name(),target);err!=nil{return err}
	readback,err:=os.ReadFile(target)
	if err!=nil || string(readback)!=string(payload){return errors.New("candidate request readback failed")}
	return nil
}

// ApplyPortablePhysicalUpdateWithProgress performs the same Core policy on a
// previously installed, exact-layout USB. It never invokes WriteGPT/Format.
func ApplyPortablePhysicalUpdateWithProgress(request PortablePhysicalUpdateRequest, report func(PhysicalApplyProgress)) (creatorcore.PortableUpdateReceipt,error) {
	elevated,err:=currentProcessElevated()
	if err!=nil{return creatorcore.PortableUpdateReceipt{},err}
	if !elevated{return creatorcore.PortableUpdateReceipt{},errors.New("Portable update requires UAC elevation")}
	target,planSHA,err:=validatePortablePhysicalUpdateRequest(request)
	if err!=nil{return creatorcore.PortableUpdateReceipt{},err}
	live,err:=EnumerateRemovableTargets()
	if err!=nil{return creatorcore.PortableUpdateReceipt{},err}
	confirmed,err:=MatchConfirmedTarget(live,request.ConfirmationToken)
	if err!=nil{return creatorcore.PortableUpdateReceipt{},err}
	if confirmed.DiskNumber!=target.DiskNumber ||
		confirmed.PhysicalDiskBytes!=target.PhysicalDiskBytes ||
		confirmed.DeviceSerial!=target.DeviceSerial {
		return creatorcore.PortableUpdateReceipt{},errors.New("Portable update physical USB changed")
	}
	inspection,err:=InspectRemovableTargetReadOnly(confirmed)
	if err!=nil{return creatorcore.PortableUpdateReceipt{},err}
	if inspection.Profile!="portable-stable-candidate" || len(inspection.Partitions)!=2 {
		return creatorcore.PortableUpdateReceipt{},errors.New("USB requires one-time conversion to two-partition Portable layout before direct updates")
	}
	handles,sources,err:=openPortableSourceHandles(PortablePhysicalApplyRequest{Sources:request.Sources})
	if err!=nil{return creatorcore.PortableUpdateReceipt{},err}
	roots,err:=openInstalledPortableRoots(confirmed,request.UpdatePlan.Partitions)
	if err!=nil{
		for _,h:=range handles{_ = h.file.Close()}
		return creatorcore.PortableUpdateReceipt{},err
	}
	defer closeInstalledPortableRoots(confirmed,roots)
	base:=&portableWindowsRuntime{
		target:confirmed,sources:handles,
		roots:map[string]string{"ORDAX-ESP":roots.ESP,"ORDAX-DATA":roots.Data},
		synced:map[string]bool{},report:report,
		totalProgressBytes:portableArtifactProgressTotal(creatorcore.PortableApplicationPlan{
			Operations:request.UpdatePlan.Operations,
		}),
	}
	defer base.close()
	runtime:=&portableWindowsUpdateRuntime{base:base,expectedCopies:len(sources)}
	receipt,err:=creatorcore.ExecutePortableUpdate(
		request.InstalledMediaPlan,request.CandidateMediaPlan,request.UpdatePlan,
		sources,creatorcore.PortableUpdateGrant{
			PlanSHA256:planSHA,SignedSourceCommit:request.VerifiedSignedSourceCommit,
			PhysicalWriteAuthorized:true,
		},runtime)
	if err!=nil{return creatorcore.PortableUpdateReceipt{},err}
	return receipt,nil
}
