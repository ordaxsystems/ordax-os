package creatorcore

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestPortableInstallReceiptCanBeReconstructedExactly(t *testing.T) {
	media, err := PlanPortableMedia(8<<30, portableUpdateOld, portableBindingsFixture())
	if err != nil { t.Fatal(err) }
	app, err := PlanPortableApplication(media)
	if err != nil { t.Fatal(err) }
	reconstructed, err := PortableMediaPlanFromApplication(app)
	if err != nil { t.Fatal(err) }
	if !reflect.DeepEqual(media, reconstructed) { t.Fatalf("media receipt differs: %#v",reconstructed) }
	bytes, err := PortableMediaPlanReceiptBytes(reconstructed)
	if err != nil { t.Fatal(err) }
	parsed, err := ParsePortableMediaPlan(bytes)
	if err != nil { t.Fatal(err) }
	if !reflect.DeepEqual(media,parsed) { t.Fatal("on-disk receipt is not the canonical media plan") }
	if len(bytes)==0 || bytes[len(bytes)-1]!='\n' { t.Fatal("receipt has no terminal newline") }
}

func TestPortableInstallReceiptRejectsChangedMediaOrOperations(t *testing.T) {
	media,err:=PlanPortableMedia(8<<30,portableUpdateOld,portableBindingsFixture())
	if err!=nil{t.Fatal(err)}
	app,err:=PlanPortableApplication(media)
	if err!=nil{t.Fatal(err)}
	cases:=[]struct{name string;change func(*PortableApplicationPlan)}{
		{"media-hash",func(p *PortableApplicationPlan){p.MediaPlanSHA256=strings.Repeat("f",64)}},
		{"status",func(p *PortableApplicationPlan){p.Status="authorized"}},
		{"physical-write",func(p *PortableApplicationPlan){p.PhysicalWriteAuthorized=true}},
		{"operations",func(p *PortableApplicationPlan){p.Operations[0].Kind="format-exfat"}},
		{"source-hash",func(p *PortableApplicationPlan){p.Operations[3].SHA256=strings.Repeat("f",64)}},
	}
	for _,tc:=range cases {
		t.Run(tc.name,func(t *testing.T){
			data,_:=json.Marshal(app)
			var altered PortableApplicationPlan
			if err:=json.Unmarshal(data,&altered);err!=nil{t.Fatal(err)}
			tc.change(&altered)
			if _,err:=PortableMediaPlanFromApplication(altered);err==nil{t.Fatal("mutated installation receipt accepted")}
		})
	}
}
