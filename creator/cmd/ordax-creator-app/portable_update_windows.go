//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	creatorcore "github.com/ordaxsystems/ordax-os/creator/core"
	physicalchannel "github.com/ordaxsystems/ordax-os/creator/physicalchannel"
)

// The same Creator "Atualizar USB" action selects the canonical transport
// according to the installed media contract, never by guessing a disk format.
func portableUSBInstalledReceiptPath(target physicalTarget) (string,error) {
	drive:=strings.ToUpper(strings.TrimSpace(target.DriveLetter))
	if len(drive)!=2 || drive[1]!=':' ||
		drive[0]<'A' || drive[0]>'Z' ||
		target.SystemDisk || !target.PrototypeSafe ||
		target.PhysicalDiskBytes==0 || target.ConfirmationToken=="" {
		return "",errors.New("Portable USB requires one selected and identifiable data volume")
	}
	return filepath.Join(drive+string(os.PathSeparator),
		".ordax","installation","portable-media-plan.json"),nil
}

func portableUSBUpdateEligible(state appRefreshState,index int) bool {
	if index<0 || index>=len(state.Targets) ||
		state.PhysicalMode!="portable-public" ||
		!state.PhysicalReady ||
		state.PortablePayload==nil ||
		state.PhysicalCandidate==nil ||
		len(state.PhysicalCandidate.SignedEnvelope)==0 {
		return false
	}
	path,err:=portableUSBInstalledReceiptPath(state.Targets[index])
	if err!=nil{return false}
	info,err:=os.Lstat(path)
	return err==nil && info.Mode().IsRegular() && info.Mode()&os.ModeSymlink==0 &&
		info.Size()>0 && info.Size()<2<<20
}

func creatorUSBUpdateEligible(state appRefreshState,index int) bool {
	if state.PhysicalMode=="portable-public" {
		return portableUSBUpdateEligible(state,index)
	}
	return ownerUSBCanStageSelected(state,index)
}

func beginCreatorUSBUpdate() {
	stateMu.Lock()
	state:=refreshState
	stateMu.Unlock()
	if state.PhysicalMode!="portable-public" {
		beginOwnerUSBUpdate()
		return
	}
	if refreshInProgress || writeInProgress() || ownerUSBUpdateInProgress() {return}
	index:=selectedTargetIndex()
	if !portableUSBUpdateEligible(state,index) {
		messageBox("A instalação do pendrive ainda não tem o formato Portable verificável. Use Criar USB para a migração única do perfil Dev.",windowTitle,mbOK|mbIconWarning)
		return
	}
	target:=state.Targets[index]
	message:=fmt.Sprintf(
		"Atualizar a release e a Surface diretamente no pendrive %s (disco %d, serial %s), sem formatar?\n\nOs dados e a versão anterior serão preservados. A nova release será testada no próximo boot antes de ser ativada.",
		targetDisplayName(target),target.DiskNumber,target.DeviceSerial,
	)
	if messageBox(message,windowTitle,mbYesNo|mbIconWarning|mbDefButton2)!=idYes{return}
	startCreatorUSBUpdateTask("portable",func()(ownerUSBReceipt,error){
		return executePortableUSBUpdate(state,target)
	})
}

type portableUSBUpdatePreparation struct {
	Schema string `json:"$schema"`
	Target physicalTarget `json:"target"`
	UpdatePlan creatorcore.PortableUpdatePlan `json:"update_plan"`
	PlanSHA256 string `json:"plan_sha256"`
	Authorization string `json:"authorization"`
	FormatsOrRepartitions bool `json:"formats_or_repartitions"`
}

func checkPortableUSBPreparation(prep portableUSBUpdatePreparation,target physicalTarget,plan creatorcore.PortableUpdatePlan,sha string) error {
	if prep.Schema!="ordax.creator-portable-update-preparation/1" ||
		prep.FormatsOrRepartitions ||
		prep.Target.DiskNumber!=target.DiskNumber ||
		prep.Target.DeviceSerial!=target.DeviceSerial ||
		prep.Target.ConfirmationToken!=target.ConfirmationToken ||
		prep.Target.PhysicalDiskBytes!=target.PhysicalDiskBytes ||
		prep.Target.SystemDisk || !prep.Target.PrototypeSafe ||
		prep.PlanSHA256!=sha ||
		!validLowerHexString(prep.Authorization,64) {
		return errors.New("o preflight da atualização alterou a autorização ou a identidade física")
	}
	expected,err:=creatorcore.PortableUpdatePlanCanonicalBytes(plan)
	if err!=nil{return err}
	actual,err:=creatorcore.PortableUpdatePlanCanonicalBytes(prep.UpdatePlan)
	if err!=nil || string(expected)!=string(actual) {
		return errors.New("o backend retornou plano de atualização diferente do Core")
	}
	return nil
}

func executePortableUSBUpdate(state appRefreshState,target physicalTarget) (ownerUSBReceipt,error) {
	blank:=ownerUSBReceipt{}
	payload:=state.PortablePayload
	installed:=state.PhysicalCandidate
	if payload==nil || installed==nil {
		return blank,errors.New("a release Portable assinada está indisponível")
	}
	dir:=state.BackendDirectory
	if err:=verifySignedPortableCandidate(dir,*payload,installed);err!=nil{return blank,err}
	if len(installed.SignedEnvelope)==0 || len(installed.SignedEnvelope)>1<<20 {
		return blank,errors.New("o envelope Ed25519 da release física não está disponível")
	}
	backend:=filepath.Join(dir,"ordax-creator-physical-test.exe")
	info,err:=os.Lstat(backend)
	if err!=nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink!=0 {
		return blank,errors.New("backend físico assinado não está disponível")
	}
	installedPath,err:=portableUSBInstalledReceiptPath(target)
	if err!=nil{return blank,err}
	data,err:=os.ReadFile(installedPath)
	if err!=nil{return blank,fmt.Errorf("ler instalação Portable existente: %w",err)}
	installedPlan,err:=creatorcore.ParsePortableMediaPlan(data)
	if err!=nil{return blank,err}
	bindings,err:=portableMediaBindingsFromSignedPayload(*payload)
	if err!=nil{return blank,err}
	candidatePlan,err:=creatorcore.PlanPortableMedia(target.PhysicalDiskBytes,payload.ReleaseSourceCommit,bindings)
	if err!=nil{return blank,err}
	updatePlan,err:=creatorcore.PlanPortableUpdate(installedPlan,candidatePlan)
	if err!=nil{return blank,fmt.Errorf("planejar atualização preservando a instalação: %w",err)}
	expectedSHA,err:=creatorcore.PortableUpdatePlanSHA256(updatePlan)
	if err!=nil{return blank,err}

	root:=filepath.Join(os.TempDir(),"OrdaX-Creator")
	if err:=os.MkdirAll(root,0o700);err!=nil{return blank,err}
	work,err:=os.MkdirTemp(root,"portable-update-*")
	if err!=nil{return blank,err}
	defer os.RemoveAll(work)
	envelopePath:=filepath.Join(work,"signed-physical-envelope.json")
	planPath:=filepath.Join(work,"portable-incremental-plan.json")
	diagnosticPath:=filepath.Join(work,"ordax-physical-error.txt")
	progressPath:=filepath.Join(work,"ordax-physical-progress.json")
	if err:=os.WriteFile(envelopePath,installed.SignedEnvelope,0o600);err!=nil{return blank,err}
	updateWriteProgress(creatorT(msgPortablePlanStatus),creatorT(msgPortablePlanHint))
	preflight,err:=runBackendHidden(dir,"prepare-portable-update",
		"--confirm",target.ConfirmationToken,
		"--installed-plan",installedPath,
		"--candidate-dir",dir,
		"--signed-envelope",envelopePath)
	if err!=nil{return blank,fmt.Errorf("preflight seguro da atualização: %w",err)}
	var preparation portableUSBUpdatePreparation
	if err:=json.Unmarshal(preflight,&preparation);err!=nil{return blank,err}
	if err:=checkPortableUSBPreparation(preparation,target,updatePlan,expectedSHA);err!=nil{return blank,err}
	bytes,err:=creatorcore.PortableUpdatePlanCanonicalBytes(updatePlan)
	if err!=nil{return blank,err}
	if err:=os.WriteFile(planPath,bytes,0o600);err!=nil{return blank,err}
	// Reverify the signed 17-file physical payload before invoking UAC. The
	// elevated backend independently verifies the Ed25519 envelope again.
	if err:=verifySignedPortableCandidate(dir,*payload,installed);err!=nil{return blank,err}
	updateWriteProgress(creatorT(msgProgressElevationStatus),creatorT(msgPortableElevationHint))
	args:=[]string{
		"apply-portable-update",
		"--confirm",target.ConfirmationToken,
		"--installed-plan",installedPath,
		"--candidate-dir",dir,
		"--signed-envelope",envelopePath,
		"--plan",planPath,
		"--authorize",preparation.Authorization,
		"--diagnostic-log",diagnosticPath,
		"--progress-log",progressPath,
	}
	if err:=runElevatedAndWait(backend,dir,args,diagnosticPath,progressPath);err!=nil {
		return blank,err
	}
	return ownerUSBReceipt{
		Status:"STAGED_NOT_ACTIVATED",
		SourceCommit:payload.ReleaseSourceCommit,
	},nil
}

// Compile-time assertion prevents forgetting the same signed payload owner
// when changing the updater's GUI-facing candidate representation.
var _ physicalchannel.PortablePayloadManifest
