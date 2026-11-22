package archivebounds

import (
	"bytes"
	"strings"
	"testing"
)

func TestAddRejectsZip64OverflowAndCumulativeExpansion(t *testing.T) {
	for _, tc := range []struct {
		name string
		total int64
		entry uint64
		max int64
		want int64
		ok bool
	}{
		{name:"zero",total:0,entry:0,max:100,want:0,ok:true},
		{name:"exact-limit",total:70,entry:30,max:100,want:100,ok:true},
		{name:"cumulative-over-limit",total:70,entry:31,max:100},
		{name:"entry-over-limit",total:0,entry:101,max:100},
		{name:"max-uint64-wrap",total:1,entry:^uint64(0),max:100},
		{name:"uint64-greater-than-int64",total:0,entry:uint64((^uint64(0) >> 1))+1,max:100},
		{name:"negative-max",total:0,entry:0,max:-1},
		{name:"negative-total",total:-1,entry:1,max:100},
		{name:"total-exceeds-max",total:101,entry:0,max:100},
	} {
		t.Run(tc.name,func(t *testing.T){
			got,err:=Add(tc.total,tc.entry,tc.max)
			if tc.ok {
				if err!=nil || got!=tc.want {t.Fatalf("valid size rejected: got=%d err=%v",got,err)}
			} else if err==nil {t.Fatalf("oversized ZIP header accepted: got=%d",got)}
		})
	}
}

func TestCopyExactLimitsActualExpandedBytes(t *testing.T) {
	for _, tc := range []struct{
		name string
		body string
		expected uint64
		ok bool
	}{
		{name:"exact",body:"abc",expected:3,ok:true},
		{name:"empty",body:"",expected:0,ok:true},
		{name:"underreported",body:"abcdef",expected:3},
		{name:"truncated",body:"abc",expected:6},
		{name:"invalid-large",body:"a",expected:^uint64(0)},
	} {
		t.Run(tc.name,func(t *testing.T){
			var out bytes.Buffer
			n,err:=CopyExact(&out,strings.NewReader(tc.body),tc.expected)
			if tc.ok {
				if err!=nil || n!=int64(tc.expected) || out.String()!=tc.body {t.Fatalf("exact ZIP extraction failed: n=%d err=%v body=%q",n,err,out.String())}
			} else {
				if err==nil {t.Fatalf("invalid ZIP extraction accepted: n=%d",n)}
				if int64(out.Len())>int64(len(tc.body)) {t.Fatalf("copy exceeded input length: %d",out.Len())}
				if tc.name=="underreported" && out.Len()!=4 {t.Fatalf("underreported entry exceeded header+1 byte: %d",out.Len())}
			}
		})
	}
}
