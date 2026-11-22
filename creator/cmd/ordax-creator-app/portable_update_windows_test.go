//go:build windows

package main

import (
	"strings"
	"testing"

	creatorcore "github.com/ordaxsystems/ordax-os/creator/core"
)

func TestPortableUSBReceiptPathExcludesSystemDisksAndUnknownIdentity(t *testing.T) {
	target:=physicalTarget{
		DriveLetter:"Z:",DiskNumber:7,DeviceSerial:"fixture-usb",
		PhysicalDiskBytes:8<<30,PrototypeSafe:true,
		ConfirmationToken:strings.Repeat("a",64),
	}
	path,err:=portableUSBInstalledReceiptPath(target)
	if err!=nil || !strings.Contains(path,"portable-media-plan.json") {
		t.Fatalf("safe USB must have canonical receipt path: %q %v",path,err)
	}
	target.SystemDisk=true
	if _,err:=portableUSBInstalledReceiptPath(target);err==nil {t.Fatal("system disk accepted")}
	target.SystemDisk=false;target.DriveLetter="C:/Windows"
	if _,err:=portableUSBInstalledReceiptPath(target);err==nil {t.Fatal("arbitrary path accepted")}
	target.DriveLetter="Z:";target.ConfirmationToken=""
	if _,err:=portableUSBInstalledReceiptPath(target);err==nil {t.Fatal("unconfirmed target accepted")}
}

func TestCreatorPortableUSBUpdateCannotUseLegacyOrUnsignedCandidate(t *testing.T) {
	target:=physicalTarget{
		DriveLetter:"Z:",DiskNumber:7,DeviceSerial:"fixture-usb",
		PhysicalDiskBytes:8<<30,PrototypeSafe:true,
		ConfirmationToken:strings.Repeat("a",64),
	}
	state:=appRefreshState{
		PhysicalMode:"portable-public",PhysicalReady:true,
		Targets:[]physicalTarget{target},
	}
	if portableUSBUpdateEligible(state,0) {t.Fatal("unsigned candidate allowed")}
	if creatorUSBUpdateEligible(state,0) {t.Fatal("Portable UI enabled without signed candidate and installed receipt")}
}

func TestPortableUSBCompletionRequiresExactElevatedCoreReceipt(t *testing.T) {
	from := strings.Repeat("a",40)
	to := strings.Repeat("b",40)
	sha := strings.Repeat("c",64)
	installed := creatorcore.PortableMediaPlan{SourceCommit:from,Artifacts:make([]creatorcore.PortableMediaArtifactPlan,17)}
	candidate := creatorcore.PortableMediaPlan{SourceCommit:to}
	plan := creatorcore.PortableUpdatePlan{
		Operations: []creatorcore.PortableApplicationOperation{
			{Kind:"materialize-artifact"},
			{Kind:"readback-sha256-size"},
		},
	}
	base := creatorcore.PortableUpdateReceipt{
		Schema:creatorcore.PortableUpdateReceiptSchema,
		Status:"staged-not-activated",
		FromSourceCommit:from,ToSourceCommit:to,
		PlanSHA256:sha,InstalledReadbacks:17,
		ReleaseMaterialized:1,ReleaseReadbacks:1,
		CandidateRequestArmed:true,Activated:false,
	}
	makeProgress:=func(receipt *creatorcore.PortableUpdateReceipt)physicalProgressDocument{
		return physicalProgressDocument{
			Schema:physicalProgressSchema,Phase:"complete-portable-update",
			CompletedBytes:1,TotalBytes:1,PortableReceipt:receipt,
		}
	}
	if err:=verifyPortableUSBCompletion(makeProgress(&base),installed,candidate,plan,sha);err!=nil{
		t.Fatalf("verified elevated Core receipt rejected: %v",err)
	}
	if err:=verifyPortableUSBCompletion(makeProgress(nil),installed,candidate,plan,sha);err==nil{
		t.Fatal("zero exit with missing physical receipt accepted")
	}
	for name,mutate:=range map[string]func(*creatorcore.PortableUpdateReceipt){
		"wrong-plan":func(r *creatorcore.PortableUpdateReceipt){r.PlanSHA256=strings.Repeat("f",64)},
		"wrong-release":func(r *creatorcore.PortableUpdateReceipt){r.ToSourceCommit=strings.Repeat("f",40)},
		"wrong-installed":func(r *creatorcore.PortableUpdateReceipt){r.FromSourceCommit=strings.Repeat("f",40)},
		"missing-readback":func(r *creatorcore.PortableUpdateReceipt){r.ReleaseReadbacks=0},
		"incomplete-source":func(r *creatorcore.PortableUpdateReceipt){r.InstalledReadbacks=16},
		"unarmed":func(r *creatorcore.PortableUpdateReceipt){r.CandidateRequestArmed=false},
		"already-active":func(r *creatorcore.PortableUpdateReceipt){r.Activated=true},
		"fake-status":func(r *creatorcore.PortableUpdateReceipt){r.Status="complete"},
	}{
		t.Run(name,func(t *testing.T){
			copy:=base
			mutate(&copy)
			if err:=verifyPortableUSBCompletion(makeProgress(&copy),installed,candidate,plan,sha);err==nil{
				t.Fatal("unverified physical receipt was accepted")
			}
		})
	}
	fakePhase:=makeProgress(&base)
	fakePhase.Phase="complete-portable"
	if err:=verifyPortableUSBCompletion(fakePhase,installed,candidate,plan,sha);err==nil{
		t.Fatal("generic physical completion was accepted as portable update receipt")
	}
}

func TestPortableUSBUpdatePreparationBindsOnePlanAndDisk(t *testing.T) {
	target:=physicalTarget{
		DiskNumber:7,DeviceSerial:"fixture-usb",PhysicalDiskBytes:8<<30,
		PrototypeSafe:true,ConfirmationToken:strings.Repeat("a",64),
	}
	plan:=creatorcore.PortableUpdatePlan{
		Schema:creatorcore.PortableUpdatePlanSchema,
		Status:"planned-not-authorized",
		FromSourceCommit:strings.Repeat("a",40),
		ToSourceCommit:strings.Repeat("b",40),
		TargetBytes:target.PhysicalDiskBytes,
		RequiresSignedRelease:true,RequiresPostbootHealth:true,
	}
	sha,err:=creatorcore.PortableUpdatePlanSHA256(plan)
	if err!=nil {t.Fatal(err)}
	prep:=portableUSBUpdatePreparation{
		Schema:"ordax.creator-portable-update-preparation/1",
		Target:target,UpdatePlan:plan,PlanSHA256:sha,
		Authorization:strings.Repeat("c",64),
	}
	if err:=checkPortableUSBPreparation(prep,target,plan,sha);err!=nil{t.Fatal(err)}
	mutated:=prep;mutated.Target.DiskNumber++
	if checkPortableUSBPreparation(mutated,target,plan,sha)==nil {t.Fatal("wrong disk admitted")}
	mutated=prep;mutated.FormatsOrRepartitions=true
	if checkPortableUSBPreparation(mutated,target,plan,sha)==nil {t.Fatal("destructive operation admitted")}
	mutated=prep;mutated.UpdatePlan.ToSourceCommit=strings.Repeat("d",40)
	if checkPortableUSBPreparation(mutated,target,plan,sha)==nil {t.Fatal("changed signed revision admitted")}
	mutated=prep;mutated.Authorization=strings.Repeat("e",32)
	if checkPortableUSBPreparation(mutated,target,plan,sha)==nil {t.Fatal("invalid physical authorization admitted")}
}
