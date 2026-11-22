//go:build windows

package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	appchannel "github.com/ordaxsystems/ordax-os/creator/appchannel"
)

func TestLauncherHealthProofRequiresOneCompleteExactLine(t *testing.T) {
	for _, tc := range []struct{
		name string
		output string
		ok bool
	}{
		{name:"LF",output:"ORDAX_CREATOR_APP_HEALTH=PASS\n",ok:true},
		{name:"CRLF",output:"ORDAX_CREATOR_APP_HEALTH=PASS\r\n",ok:true},
		{name:"no-newline",output:"ORDAX_CREATOR_APP_HEALTH=PASS"},
		{name:"suffix",output:"ORDAX_CREATOR_APP_HEALTH=PASSED\n"},
		{name:"prefix",output:"NOT_ORDAX_CREATOR_APP_HEALTH=PASS\n"},
		{name:"false-then-pass",output:"ORDAX_CREATOR_APP_HEALTH=FAIL\nORDAX_CREATOR_APP_HEALTH=PASS\n"},
		{name:"duplicated",output:"ORDAX_CREATOR_APP_HEALTH=PASS\nORDAX_CREATOR_APP_HEALTH=PASS\n"},
		{name:"extra-log",output:"INFO: startup failed\nORDAX_CREATOR_APP_HEALTH=PASS\n"},
		{name:"empty"},
		{name:"embedded-nul",output:"ORDAX_CREATOR_APP_HEALTH=PASS\x00\n"},
	} {
		t.Run(tc.name,func(t *testing.T){
			if got:=validLauncherHealthProof([]byte(tc.output));got!=tc.ok {
				t.Fatalf("health output accepted=%t, want=%t for %q",got,tc.ok,tc.output)
			}
		})
	}
}

func TestLauncherHealthOutputIsStrictlyMemoryBounded(t *testing.T) {
	out := &cappedHealthOutput{}
	first := bytes.Repeat([]byte("a"), maxLauncherHealthOutputBytes-1)
	if n,err:=out.Write(first);err!=nil || n!=len(first){
		t.Fatalf("first health output write n=%d err=%v",n,err)
	}
	snapshot,overflow:=out.result()
	if overflow || len(snapshot)!=len(first) {t.Fatalf("valid output was truncated: len=%d overflow=%t",len(snapshot),overflow)}
	large:=bytes.Repeat([]byte("b"), maxLauncherHealthOutputBytes*4)
	if n,err:=out.Write(large);err!=nil || n!=len(large) {t.Fatalf("bounded writer failed to accept caller write: n=%d err=%v",n,err)}
	snapshot,overflow=out.result()
	if !overflow || len(snapshot)!=maxLauncherHealthOutputBytes {
		t.Fatalf("unbounded or undetected health output: len=%d overflow=%t",len(snapshot),overflow)
	}
}

func TestLauncherFailedStartUsesOnlyDistinctVerifiedPrevious(t *testing.T) {
	current:=appchannel.Installed{SourceCommit:strings.Repeat("a",40),Version:"2"}
	previous:=appchannel.Installed{SourceCommit:strings.Repeat("b",40),Version:"1"}
	for _,tc:=range []struct{
		name string
		startFails bool
		previousApp appchannel.Installed
		previousErr error
		fallbackFails bool
		wantSequence string
		wantPreviousReads int
		wantError bool
	}{
		{name:"current-starts",previousApp:previous,wantSequence:"a",wantPreviousReads:0},
		{name:"fallback-starts",startFails:true,previousApp:previous,wantSequence:"ab",wantPreviousReads:1},
		{name:"no-previous",startFails:true,previousErr:errors.New("no signed previous"),wantSequence:"a",wantPreviousReads:1,wantError:true},
		{name:"same-source",startFails:true,previousApp:current,wantSequence:"a",wantPreviousReads:1,wantError:true},
		{name:"fallback-fails",startFails:true,previousApp:previous,fallbackFails:true,wantSequence:"ab",wantPreviousReads:1,wantError:true},
	}{
		t.Run(tc.name,func(t *testing.T){
			launches:=""
			previousReads:=0
			err:=startWithPrevious(current,func()(appchannel.Installed,error){
				previousReads++
				return tc.previousApp,tc.previousErr
			},func(inst appchannel.Installed)error{
				switch inst.SourceCommit {
				case current.SourceCommit:
					launches+="a"
					if tc.startFails {return errors.New("verified app failed to spawn")}
				case previous.SourceCommit:
					launches+="b"
					if tc.fallbackFails {return errors.New("previous failed to spawn")}
				default:
					t.Fatalf("unknown source selected for launch: %q",inst.SourceCommit)
				}
				return nil
			})
			if launches!=tc.wantSequence || previousReads!=tc.wantPreviousReads || (err!=nil)!=tc.wantError {
				t.Fatalf("unsafe startup fallback: launches=%q previousReads=%d err=%v",launches,previousReads,err)
			}
		})
	}
}
