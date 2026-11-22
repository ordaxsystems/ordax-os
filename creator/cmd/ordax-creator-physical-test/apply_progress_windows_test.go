//go:build windows && ordax_raw_backend

package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	creatorcore "github.com/ordaxsystems/ordax-os/creator/core"
)

func TestValidateApplySidecarPathRequiresPreparedImageDirectory(t *testing.T) {
	dir := t.TempDir()
	image := filepath.Join(dir, "ordax-prepared.raw")
	if err := os.WriteFile(image, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	valid := filepath.Join(dir, "ordax-physical-progress.json")
	resolved, err := validateApplySidecarPath(image, valid, "ordax-physical-progress.json")
	if err != nil {
		t.Fatalf("valid sidecar rejected: %v", err)
	}
	if filepath.Clean(resolved) != filepath.Clean(valid) {
		t.Fatalf("resolved=%q want=%q", resolved, valid)
	}

	outside := filepath.Join(t.TempDir(), "ordax-physical-progress.json")
	if _, err := validateApplySidecarPath(image, outside, "ordax-physical-progress.json"); err == nil {
		t.Fatal("sidecar outside prepared image directory must be rejected")
	}
}

func TestValidateApplySidecarPathRequiresExpectedName(t *testing.T) {
	dir := t.TempDir()
	image := filepath.Join(dir, "ordax-prepared.raw")
	if err := os.WriteFile(image, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := validateApplySidecarPath(image, filepath.Join(dir, "other.txt"), "ordax-physical-error.txt"); err == nil {
		t.Fatal("unexpected sidecar basename must be rejected")
	}
}

func TestElevatedApplyCompletionUsesSidecarRatherThanStdout(t *testing.T) {
	for _, phase := range []string{"complete", "complete-portable"} {
		t.Run(phase, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "ordax-physical-progress.json")
			stdoutCalls := 0
			err := finalizeElevatedApply(path, phase, func() error {
				stdoutCalls++
				return errors.New("write /dev/stdout: invalid handle")
			})
			if err != nil || stdoutCalls != 0 {
				t.Fatalf("elevated completion incorrectly used stdout: calls=%d error=%v", stdoutCalls, err)
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var result applyProgressDocument
			if err := json.Unmarshal(raw, &result); err != nil {
				t.Fatal(err)
			}
			if result.Schema != applyProgressSchema || result.Phase != phase ||
				result.CompletedBytes != 1 || result.TotalBytes != 1 {
				t.Fatalf("unverified completion sidecar: %+v", result)
			}
		})
	}
}

func TestElevatedApplyCompletionKeepsDirectCLIAndFailsClosed(t *testing.T) {
	calls := 0
	if err := finalizeElevatedApply("", "complete", func() error { calls++; return nil }); err != nil || calls != 1 {
		t.Fatalf("CLI receipt lost: calls=%d error=%v", calls, err)
	}
	writerError := errors.New("CLI output unavailable")
	if err := finalizeElevatedApply("", "complete-portable", func() error { return writerError }); !errors.Is(err, writerError) {
		t.Fatalf("CLI write error ignored: %v", err)
	}
	calls = 0
	path := filepath.Join(t.TempDir(), "missing", "ordax-physical-progress.json")
	if err := finalizeElevatedApply(path, "complete", func() error { calls++; return nil }); err == nil || calls != 0 {
		t.Fatalf("missing required success sidecar must fail closed: calls=%d error=%v", calls, err)
	}
}


func TestElevatedPortableReceiptPersistsCoreEvidenceNotJustPhase(t *testing.T) {
	path:=filepath.Join(t.TempDir(),"ordax-physical-progress.json")
	good:=creatorcore.PortableUpdateReceipt{
		Schema:creatorcore.PortableUpdateReceiptSchema,
		Status:"staged-not-activated",
		FromSourceCommit:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		ToSourceCommit:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		PlanSHA256:"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		InstalledReadbacks:17,ReleaseMaterialized:2,ReleaseReadbacks:7,
		CandidateRequestArmed:true,Activated:false,
	}
	if err:=finalizeElevatedPortableUpdate(path,good);err!=nil{
		t.Fatalf("verified Core receipt was not persisted: %v",err)
	}
	data,err:=os.ReadFile(path)
	if err!=nil{t.Fatal(err)}
	var result struct {
		applyProgressDocument
		Receipt creatorcore.PortableUpdateReceipt `json:"portable_update_receipt"`
	}
	if err:=json.Unmarshal(data,&result);err!=nil{t.Fatal(err)}
	if result.Phase!="complete-portable-update" ||
		result.Receipt.PlanSHA256!=good.PlanSHA256 ||
		result.Receipt.ToSourceCommit!=good.ToSourceCommit ||
		!result.Receipt.CandidateRequestArmed {
		t.Fatalf("completion sidecar lost physical Core evidence: %+v",result)
	}
	missing:=good
	missing.CandidateRequestArmed=false
	if err:=finalizeElevatedPortableUpdate(path,missing);err==nil{
		t.Fatal("unarmed Core candidate was presented as complete")
	}
	stored,err:=os.ReadFile(path)
	if err!=nil || string(stored)!=string(data){
		t.Fatal("rejected candidate overwrote verified sidecar")
	}
}
