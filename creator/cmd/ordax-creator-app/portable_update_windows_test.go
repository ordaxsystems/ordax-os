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
