package creatorcore

import (
	"errors"
	"strings"
	"testing"
)

type portableUpdateFakeRuntime struct {
	events []string
	fail string
}
func (r *portableUpdateFakeRuntime) event(v string) error {
	r.events=append(r.events,v)
	if r.fail==v { return errors.New("injected failure") }
	return nil
}
func (r *portableUpdateFakeRuntime) VerifyLayout(_ []PortableApplicationPartition, _ uint64) error {
	return r.event("layout")
}
func (r *portableUpdateFakeRuntime) Readback(op PortableApplicationOperation) error {
	return r.event("readback:"+op.ArtifactID)
}
func (r *portableUpdateFakeRuntime) Materialize(op PortableApplicationOperation, source PortableApplicationSource) error {
	if op.ArtifactID!=source.ArtifactID || op.SizeBytes!=source.SizeBytes || op.SHA256!=source.SHA256 {
		return errors.New("source mismatch")
	}
	return r.event("copy:"+op.ArtifactID)
}
func (r *portableUpdateFakeRuntime) Flush() error { return r.event("flush") }
func (r *portableUpdateFakeRuntime) ArmCandidate(sha string) error {
	return r.event("arm:"+sha)
}
func portableUpdateExecutionFixture(t *testing.T) (PortableMediaPlan, PortableMediaPlan, PortableUpdatePlan, []PortableApplicationSource, PortableUpdateGrant) {
	t.Helper()
	old,next:=portableUpdateFixture(t)
	plan,err:=PlanPortableUpdate(old,next)
	if err!=nil { t.Fatal(err) }
	sources:=[]PortableApplicationSource{}
	for _,op:=range plan.Operations {
		if op.Kind=="materialize-artifact" {
			sources=append(sources,PortableApplicationSource{ArtifactID:op.ArtifactID,SHA256:op.SHA256,SizeBytes:op.SizeBytes})
		}
	}
	hash,err:=PortableUpdatePlanSHA256(plan)
	if err!=nil {t.Fatal(err)}
	return old,next,plan,sources,PortableUpdateGrant{
		PlanSHA256:hash,SignedSourceCommit:next.SourceCommit,PhysicalWriteAuthorized:true,
	}
}

func TestPortableUpdateExecutesNoReformatAndArmsOnlyAfterReadback(t *testing.T) {
	old,next,plan,sources,grant:=portableUpdateExecutionFixture(t)
	runtime:=&portableUpdateFakeRuntime{}
	receipt,err:=ExecutePortableUpdate(old,next,plan,sources,grant,runtime)
	if err!=nil { t.Fatal(err) }
	if receipt.Status!="staged-not-activated" || receipt.Activated ||
		!receipt.CandidateRequestArmed || receipt.ImmutableReadbacks!=10 ||
		receipt.ReleaseReadbacks!=7 || receipt.ReleaseMaterialized!=len(sources) {
		t.Fatalf("incorrect physical update receipt: %+v",receipt)
	}
	for _,event:=range runtime.events {
		if strings.Contains(event,"format") || strings.Contains(event,"gpt") {
			t.Fatalf("destructive operation %q",event)
		}
	}
	if len(runtime.events)<18 || runtime.events[0]!="layout" ||
		runtime.events[len(runtime.events)-1]!="arm:"+next.SourceCommit {
		t.Fatalf("wrong gate order: %v",runtime.events)
	}
}

func TestPortableUpdateNeverWritesWithoutExactSignedGrant(t *testing.T) {
	old,next,plan,sources,grant:=portableUpdateExecutionFixture(t)
	for _,change:=range []func(*PortableUpdateGrant){
		func(g *PortableUpdateGrant){g.PhysicalWriteAuthorized=false},
		func(g *PortableUpdateGrant){g.SignedSourceCommit=strings.Repeat("0",40)},
		func(g *PortableUpdateGrant){g.PlanSHA256=strings.Repeat("0",64)},
	} {
		g:=grant;change(&g)
		r:=&portableUpdateFakeRuntime{}
		if _,err:=ExecutePortableUpdate(old,next,plan,sources,g,r);err==nil {
			t.Fatal("invalid grant accepted")
		}
		if len(r.events)!=0 { t.Fatal("physical I/O occurred before grant") }
	}
}

func TestPortableUpdateNeverArmsAfterReadbackOrCopyFailure(t *testing.T) {
	old,next,plan,sources,grant:=portableUpdateExecutionFixture(t)
	for _,failing:=range []string{"layout","readback:kernel","copy:system-image","readback:system-image","flush"} {
		r:=&portableUpdateFakeRuntime{fail:failing}
		if _,err:=ExecutePortableUpdate(old,next,plan,sources,grant,r);err==nil {
			t.Fatalf("injected failure %q was accepted",failing)
		}
		for _,event:=range r.events {
			if strings.HasPrefix(event,"arm:") {
				t.Fatalf("candidate armed after %q failure",failing)
			}
		}
	}
}

func TestPortableUpdateRejectsModifiedPlanAndSourcesBeforeIO(t *testing.T) {
	old,next,plan,sources,grant:=portableUpdateExecutionFixture(t)
	mutated:=plan
	mutated.Operations=append([]PortableApplicationOperation(nil),plan.Operations...)
	mutated.Operations[0].Kind="format-exfat"
	r:=&portableUpdateFakeRuntime{}
	if _,err:=ExecutePortableUpdate(old,next,mutated,sources,grant,r);err==nil {
		t.Fatal("mutated operation was accepted")
	}
	if len(r.events)!=0 {t.Fatal("I/O started for mutated plan")}
	if len(sources)==0 {t.Fatal("expected materialization sources")}
	sources[0].SHA256=strings.Repeat("e",64)
	if _,err:=ExecutePortableUpdate(old,next,plan,sources,grant,r);err==nil {
		t.Fatal("wrong release source admitted")
	}
	if len(r.events)!=0 {t.Fatal("I/O started for tampered sources")}
}
