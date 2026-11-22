package windowsadapter

import (
	"strings"
	"testing"

	creatorcore "github.com/ordaxsystems/ordax-os/creator/core"
)

func portableUpdateHostFixture(t *testing.T) PortablePhysicalUpdateRequest {
	t.Helper()
	installed := portablePhysicalRequestFixture(t)
	bindings := creatorcore.PortableMediaBindings{Schema: creatorcore.PortableMediaBindingsSchema}
	for _, source := range installed.Sources {
		bindings.Artifacts=append(bindings.Artifacts,creatorcore.PortableMediaArtifactBinding{
			ID:source.ArtifactID,SHA256:source.SHA256,SizeBytes:source.SizeBytes,
		})
	}
	current,err:=creatorcore.PlanPortableMedia(installed.Target.PhysicalDiskBytes,
		installed.ApplicationPlan.SourceCommit,bindings)
	if err!=nil {t.Fatal(err)}
	candidate,err:=creatorcore.PlanPortableMedia(installed.Target.PhysicalDiskBytes,
		"89abcdef0123456789abcdef0123456789abcdef",bindings)
	if err!=nil {t.Fatal(err)}
	plan,err:=creatorcore.PlanPortableUpdate(current,candidate)
	if err!=nil {t.Fatal(err)}
	byID:=map[string]PortablePhysicalArtifactSource{}
	for _,s:=range installed.Sources {byID[s.ArtifactID]=s}
	sources:=[]PortablePhysicalArtifactSource{}
	for _,op:=range plan.Operations {
		if op.Kind=="materialize-artifact" {sources=append(sources,byID[op.ArtifactID])}
	}
	hash,err:=creatorcore.PortableUpdatePlanSHA256(plan)
	if err!=nil {t.Fatal(err)}
	return PortablePhysicalUpdateRequest{
		Target:installed.Target,ConfirmationToken:installed.ConfirmationToken,
		InstalledMediaPlan:current,CandidateMediaPlan:candidate,
		UpdatePlan:plan,Sources:sources,
		VerifiedSignedSourceCommit:candidate.SourceCommit,
		CanonicalTrustResolved:true,PhysicalUpdateAuthorized:true,
		UpdateAuthorization:PortablePhysicalUpdateAuthorizationToken(installed.Target,hash),
	}
}

func TestPortableHostUpdateBindsSignedCandidateAndNonDestructivePlan(t *testing.T) {
	request:=portableUpdateHostFixture(t)
	if err:=ValidatePortablePhysicalUpdateRequest(request);err!=nil {t.Fatal(err)}
	for _,op:=range request.UpdatePlan.Operations {
		if op.Kind=="format-exfat" || op.Kind=="format-fat32" ||
			op.Kind=="partition-table-gpt-two-partition" {
			t.Fatal("host update accepted a disk-destructive operation")
		}
	}
}

func TestPortableHostUpdateRejectsUnauthorizedOrTamperedRequest(t *testing.T) {
	cases:=[]struct{name string; mutate func(*PortablePhysicalUpdateRequest)}{
		{"wrong-disk",func(r *PortablePhysicalUpdateRequest){r.Target.DiskNumber++}},
		{"wrong-physical-size",func(r *PortablePhysicalUpdateRequest){r.Target.PhysicalDiskBytes++}},
		{"trust-unresolved",func(r *PortablePhysicalUpdateRequest){r.CanonicalTrustResolved=false}},
		{"not-authorized",func(r *PortablePhysicalUpdateRequest){r.PhysicalUpdateAuthorized=false}},
		{"unsigned-candidate",func(r *PortablePhysicalUpdateRequest){r.VerifiedSignedSourceCommit=strings.Repeat("0",40)}},
		{"stale-grant",func(r *PortablePhysicalUpdateRequest){r.UpdateAuthorization=strings.Repeat("0",64)}},
		{"changed-plan",func(r *PortablePhysicalUpdateRequest){r.UpdatePlan.Operations[0].Kind="format-exfat"}},
		{"changed-foundation",func(r *PortablePhysicalUpdateRequest){
			for i:=range r.CandidateMediaPlan.Artifacts {
				if r.CandidateMediaPlan.Artifacts[i].ID=="kernel" {r.CandidateMediaPlan.Artifacts[i].SHA256=strings.Repeat("0",64)}
			}
		}},
		{"missing-sources",func(r *PortablePhysicalUpdateRequest){r.Sources=r.Sources[:len(r.Sources)-1]}},
		{"source-mismatch",func(r *PortablePhysicalUpdateRequest){r.Sources[0].SHA256=strings.Repeat("0",64)}},
	}
	for _,tc:=range cases {
		t.Run(tc.name,func(t *testing.T){
			r:=portableUpdateHostFixture(t)
			tc.mutate(&r)
			if err:=ValidatePortablePhysicalUpdateRequest(r);err==nil {t.Fatal("unsafe update request accepted")}
		})
	}
}


func TestPortableUpdateVolumeGUIDMustStayOnExactPhysicalDisk(t *testing.T) {
	for _,tc:=range []struct {
		name string
		expected string
		observed string
		disk uint32
		disks []uint32
		pass bool
	}{
		{"same-volume","volume-guid-a","VOLUME-GUID-A",1,[]uint32{1},true},
		{"wrong-drive-letter","volume-guid-a","volume-guid-b",1,[]uint32{1},false},
		{"wrong-disk","volume-guid-a","volume-guid-a",1,[]uint32{0},false},
		{"spanned-volume","volume-guid-a","volume-guid-a",1,[]uint32{1,0},false},
		{"no-extent","volume-guid-a","volume-guid-a",1,nil,false},
		{"missing-volume-id","","",1,[]uint32{1},false},
	} {
		t.Run(tc.name,func(t *testing.T){
			err:=validatePortableVolumeBinding(tc.expected,tc.observed,tc.disk,tc.disks)
			if (err==nil)!=tc.pass{t.Fatalf("allowed=%v expected=%v error=%v",err==nil,tc.pass,err)}
		})
	}
}
