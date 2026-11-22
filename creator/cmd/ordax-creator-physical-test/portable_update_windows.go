//go:build windows && ordax_raw_backend

package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	creatorcore "github.com/ordaxsystems/ordax-os/creator/core"
	windowsadapter "github.com/ordaxsystems/ordax-os/creator/host/windows"
	physicalchannel "github.com/ordaxsystems/ordax-os/creator/physicalchannel"
)

const portableUpdatePlanMaxBytes = int64(2 << 20)

type portableUpdateCommandOptions struct {
	Confirm string
	InstalledPlan string
	CandidateDirectory string
	SignedEnvelope string
	Plan string
	Authorize string
	Diagnostic string
	Progress string
}

func parsePortableUpdateCommand(name string, args []string, apply bool) (portableUpdateCommandOptions, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	confirm := fs.String("confirm", "", "confirmation token from the selected USB")
	installed := fs.String("installed-plan", "", "installed canonical Portable media receipt")
	dir := fs.String("candidate-dir", "", "physically signed Creator candidate directory")
	envelope := fs.String("signed-envelope", "", "exact Ed25519 signed physical envelope")
	plan := fs.String("plan", "", "exact Core incremental update plan")
	authorize := fs.String("authorize", "", "USB/plan-bound non-destructive update grant")
	diagnostic := fs.String("diagnostic-log", "", "optional error report")
	progress := fs.String("progress-log", "", "optional progress report")
	if err := fs.Parse(args); err != nil { return portableUpdateCommandOptions{}, err }
	if fs.NArg() != 0 || *confirm == "" || *installed == "" || *dir == "" || *envelope == "" {
		return portableUpdateCommandOptions{}, errors.New("Portable update requires --confirm, --installed-plan, --candidate-dir and --signed-envelope")
	}
	if apply {
		if *plan == "" || *authorize == "" {
			return portableUpdateCommandOptions{}, errors.New("Portable apply requires --plan and --authorize")
		}
	} else if *plan != "" || *authorize != "" || *diagnostic != "" || *progress != "" {
		return portableUpdateCommandOptions{}, errors.New("preflight is read-only and accepts no apply-only arguments")
	}
	return portableUpdateCommandOptions{
		Confirm:*confirm, InstalledPlan:*installed,
		CandidateDirectory:*dir, SignedEnvelope:*envelope,
		Plan:*plan, Authorize:*authorize, Diagnostic:*diagnostic, Progress:*progress,
	},nil
}

func readPortableUpdateRegularFile(path string, max int64) ([]byte,error) {
	info,err:=os.Lstat(path)
	if err!=nil{return nil,err}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink!=0 ||
		info.Size()<=0 || info.Size()>max {
		return nil,errors.New("Portable update input is not a bounded regular file")
	}
	return os.ReadFile(path)
}

func loadPortableInstalledMedia(path string) (creatorcore.PortableMediaPlan,error) {
	data,err:=readPortableUpdateRegularFile(path,portableUpdatePlanMaxBytes)
	if err!=nil{return creatorcore.PortableMediaPlan{},err}
	plan,err:=creatorcore.ParsePortableMediaPlan(data)
	if err!=nil{return creatorcore.PortableMediaPlan{},err}
	if _,err:=creatorcore.PlanPortableApplication(plan);err!=nil{
		return creatorcore.PortableMediaPlan{},err
	}
	return plan,nil
}

func loadPortableUpdatePlan(path string) (creatorcore.PortableUpdatePlan,error) {
	data,err:=readPortableUpdateRegularFile(path,portableUpdatePlanMaxBytes)
	if err!=nil{return creatorcore.PortableUpdatePlan{},err}
	decoder:=json.NewDecoder(&boundedPortableReader{data:data})
	decoder.DisallowUnknownFields()
	var plan creatorcore.PortableUpdatePlan
	if err:=decoder.Decode(&plan);err!=nil{return creatorcore.PortableUpdatePlan{},err}
	var trailing any
	if err:=decoder.Decode(&trailing);err!=io.EOF {
		return creatorcore.PortableUpdatePlan{},errors.New("Portable update plan contains trailing JSON")
	}
	return plan,nil
}

// Small wrapper avoids an independent parser or re-encoding of the candidate.
type boundedPortableReader struct { data []byte }
func (r *boundedPortableReader) Read(p []byte) (int,error) {
	if len(r.data)==0 {return 0,io.EOF}
	n:=copy(p,r.data);r.data=r.data[n:];return n,nil
}

func loadSignedPortableUpdateCandidate(
	options portableUpdateCommandOptions,
	b buildBinding, target windowsadapter.Target,
) (creatorcore.PortableMediaPlan, []windowsadapter.PortablePhysicalArtifactSource,error) {
	envelope,err:=readPortableUpdateRegularFile(options.SignedEnvelope,1<<20)
	if err!=nil{return creatorcore.PortableMediaPlan{},nil,fmt.Errorf("read physical signed envelope: %w",err)}
	trust,err:=readPortableUpdateRegularFile(filepath.Join(options.CandidateDirectory,"release-ed25519.json"),16<<10)
	if err!=nil{return creatorcore.PortableMediaPlan{},nil,fmt.Errorf("read canonical release trust: %w",err)}
	manifest,err:=physicalchannel.VerifyEnvelope(envelope,trust,b.CanonicalTrustSHA256)
	if err!=nil{return creatorcore.PortableMediaPlan{},nil,fmt.Errorf("verify candidate Ed25519 signature: %w",err)}
	payload:=manifest.PortablePayload
	if manifest.Schema!=physicalchannel.ManifestSchemaPortable ||
		manifest.SourceCommit!=b.SourceCommit || payload==nil ||
		payload.ReleaseSourceCommit!=b.ReleaseSourceCommit {
		return creatorcore.PortableMediaPlan{},nil,errors.New("candidate signed identities differ from authorized physical binary")
	}
	if err:=physicalchannel.VerifyInstalled(options.CandidateDirectory,manifest);err!=nil{
		return creatorcore.PortableMediaPlan{},nil,fmt.Errorf("verify signed writer and all Portable candidate artifacts: %w",err)
	}
	bindings:=creatorcore.PortableMediaBindings{
		Schema:creatorcore.PortableMediaBindingsSchema,
		Artifacts:make([]creatorcore.PortableMediaArtifactBinding,0,len(payload.Artifacts)),
	}
	paths:=map[string]string{}
	for _,artifact:=range payload.Artifacts {
		if artifact.SizeBytes<=0 {
			return creatorcore.PortableMediaPlan{},nil,errors.New("signed payload contains an invalid size")
		}
		path,err:=physicalchannel.PortablePayloadSourcePath(options.CandidateDirectory,artifact.ID)
		if err!=nil{return creatorcore.PortableMediaPlan{},nil,err}
		paths[artifact.ID]=path
		bindings.Artifacts=append(bindings.Artifacts,creatorcore.PortableMediaArtifactBinding{
			ID:artifact.ID,SHA256:artifact.SHA256,SizeBytes:uint64(artifact.SizeBytes),
		})
	}
	candidate,err:=creatorcore.PlanPortableMedia(target.PhysicalDiskBytes,payload.ReleaseSourceCommit,bindings)
	if err!=nil{return creatorcore.PortableMediaPlan{},nil,err}
	// Only release artifacts selected by the Core incremental planner become
	// write sources. Foundation and persistent-state images are never offered.
	result:=[]windowsadapter.PortablePhysicalArtifactSource{}
	for _,artifact:=range candidate.Artifacts {
		if _,ok:=paths[artifact.ID];!ok {return creatorcore.PortableMediaPlan{},nil,errors.New("signed artifact is missing")}
		result=append(result,windowsadapter.PortablePhysicalArtifactSource{
			ArtifactID:artifact.ID,Path:paths[artifact.ID],
			SHA256:artifact.SHA256,SizeBytes:artifact.SizeBytes,
		})
	}
	return candidate,result,nil
}

func portableUpdateInputs(
	options portableUpdateCommandOptions,
) (windowsadapter.Target,creatorcore.PortableMediaPlan,creatorcore.PortableMediaPlan,
	creatorcore.PortableUpdatePlan,[]windowsadapter.PortablePhysicalArtifactSource,string,error) {
	b:=requirePortableReady()
	target,err:=enumerateConfirmed(options.Confirm)
	if err!=nil{return windowsadapter.Target{},creatorcore.PortableMediaPlan{},creatorcore.PortableMediaPlan{},creatorcore.PortableUpdatePlan{},nil,"",err}
	inspection,err:=windowsadapter.InspectRemovableTargetReadOnly(target)
	if err!=nil{return windowsadapter.Target{},creatorcore.PortableMediaPlan{},creatorcore.PortableMediaPlan{},creatorcore.PortableUpdatePlan{},nil,"",err}
	if inspection.Profile!="portable-stable-candidate" || len(inspection.Partitions)!=2 {
		return windowsadapter.Target{},creatorcore.PortableMediaPlan{},creatorcore.PortableMediaPlan{},creatorcore.PortableUpdatePlan{},nil,"",
			errors.New("USB is not in the canonical two-partition Portable format; it must be installed once before incremental updates")
	}
	installed,err:=loadPortableInstalledMedia(options.InstalledPlan)
	if err!=nil{return windowsadapter.Target{},creatorcore.PortableMediaPlan{},creatorcore.PortableMediaPlan{},creatorcore.PortableUpdatePlan{},nil,"",err}
	candidate,allSources,err:=loadSignedPortableUpdateCandidate(options,b,target)
	if err!=nil{return windowsadapter.Target{},creatorcore.PortableMediaPlan{},creatorcore.PortableMediaPlan{},creatorcore.PortableUpdatePlan{},nil,"",err}
	plan,err:=creatorcore.PlanPortableUpdate(installed,candidate)
	if err!=nil{return windowsadapter.Target{},creatorcore.PortableMediaPlan{},creatorcore.PortableMediaPlan{},creatorcore.PortableUpdatePlan{},nil,"",err}
	required:=map[string]bool{}
	for _,operation:=range plan.Operations {
		if operation.Kind=="materialize-artifact" {required[operation.ArtifactID]=true}
	}
	sources:=make([]windowsadapter.PortablePhysicalArtifactSource,0,len(required))
	for _,source:=range allSources {
		if required[source.ArtifactID] {sources=append(sources,source)}
	}
	if len(sources)!=len(required) {
		return windowsadapter.Target{},creatorcore.PortableMediaPlan{},creatorcore.PortableMediaPlan{},creatorcore.PortableUpdatePlan{},nil,"",errors.New("signed update source set incomplete")
	}
	sha,err:=creatorcore.PortableUpdatePlanSHA256(plan)
	if err!=nil{return windowsadapter.Target{},creatorcore.PortableMediaPlan{},creatorcore.PortableMediaPlan{},creatorcore.PortableUpdatePlan{},nil,"",err}
	return target,installed,candidate,plan,sources,sha,nil
}

func runPreparePortableUpdate(args []string) error {
	opt,err:=parsePortableUpdateCommand("prepare-portable-update",args,false)
	if err!=nil{return err}
	target,_,_,plan,_,sha,err:=portableUpdateInputs(opt)
	if err!=nil{return err}
	return encode(struct{
		Schema string `json:"$schema"`
		Target windowsadapter.Target `json:"target"`
		UpdatePlan creatorcore.PortableUpdatePlan `json:"update_plan"`
		PlanSHA256 string `json:"plan_sha256"`
		Authorization string `json:"authorization"`
		FormatsOrRepartitions bool `json:"formats_or_repartitions"`
	}{
		Schema:"ordax.creator-portable-update-preparation/1",
		Target:target,UpdatePlan:plan,PlanSHA256:sha,
		Authorization:windowsadapter.PortablePhysicalUpdateAuthorizationToken(target,sha),
		FormatsOrRepartitions:false,
	})
}

func runApplyPortableUpdate(args []string) error {
	opt,err:=parsePortableUpdateCommand("apply-portable-update",args,true)
	if err!=nil{return err}
	target,installed,candidate,expected,sources,_,err:=portableUpdateInputs(opt)
	if err!=nil{return err}
	provided,err:=loadPortableUpdatePlan(opt.Plan)
	if err!=nil{return err}
	// Physical IO is impossible if UAC changed any plan, signer, target or source.
	expectedBytes,err:=creatorcore.PortableUpdatePlanCanonicalBytes(expected)
	if err!=nil{return err}
	providedBytes,err:=creatorcore.PortableUpdatePlanCanonicalBytes(provided)
	if err!=nil || string(expectedBytes)!=string(providedBytes) {
		return errors.New("elevated Portable update plan differs from signed Core policy")
	}
	diagnosticPath,err:=validateApplySidecarPath(opt.Plan,opt.Diagnostic,"ordax-physical-error.txt")
	if err!=nil{return err}
	progressPath,err:=validateApplySidecarPath(opt.Plan,opt.Progress,"ordax-physical-progress.json")
	if err!=nil{return err}
	applyDiagnosticLog=diagnosticPath
	if diagnosticPath!="" { _=os.Remove(diagnosticPath) }
	if progressPath!="" { _=os.Remove(progressPath) }
	report:=newApplyProgressReporter(progressPath)
	report(windowsadapter.PhysicalApplyProgress{Phase:"starting-portable-update"})
	receipt,err:=windowsadapter.ApplyPortablePhysicalUpdateWithProgress(windowsadapter.PortablePhysicalUpdateRequest{
		Target:target,ConfirmationToken:opt.Confirm,
		InstalledMediaPlan:installed,CandidateMediaPlan:candidate,UpdatePlan:provided,
		Sources:sources,VerifiedSignedSourceCommit:candidate.SourceCommit,
		CanonicalTrustResolved:validLowerHex(binding().CanonicalTrustSHA256,sha256.Size),
		PhysicalUpdateAuthorized:binding().PhysicalWriteAuthorized,
		UpdateAuthorization:opt.Authorize,
	},report)
	if err!=nil{return err}
	return finalizeElevatedPortableUpdate(progressPath,receipt)
}
