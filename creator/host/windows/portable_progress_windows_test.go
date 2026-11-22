//go:build windows && ordax_raw_backend

package windowsadapter

import (
	"math"
	"testing"

	creatorcore "github.com/ordaxsystems/ordax-os/creator/core"
)

func TestPortableProgressTotalUsesOnlyCanonicalArtifactOperations(t *testing.T) {
	plan := creatorcore.PortableApplicationPlan{
		Operations: []creatorcore.PortableApplicationOperation{
			{Kind: "partition-table-gpt-two-partition"},
			{Kind: "materialize-artifact", SizeBytes: 12 << 20},
			{Kind: "readback-sha256-size", SizeBytes: 12 << 20},
			{Kind: "materialize-artifact", SizeBytes: 8 << 20},
			{Kind: "verify-gpt-filesystem-labels-and-capacity"},
		},
	}
	if got, want := portableArtifactProgressTotal(plan), int64(20<<20); got != want {
		t.Fatalf("artifact progress total = %d, want %d", got, want)
	}
	plan.Operations[3].SizeBytes = math.MaxUint64
	if got := portableArtifactProgressTotal(plan); got != 0 {
		t.Fatalf("unrepresentable progress total must remain unknown, got %d", got)
	}
	plan.Operations[3].SizeBytes = 0
	if got := portableArtifactProgressTotal(plan); got != 0 {
		t.Fatalf("zero-size artifact must not invent a progress total, got %d", got)
	}
}

func TestPortableProgressReportsOnlyCompletedArtifactBytes(t *testing.T) {
	var samples []PhysicalApplyProgress
	runtime := &portableWindowsRuntime{
		totalProgressBytes: 20 << 20,
		report: func(progress PhysicalApplyProgress) {
			samples = append(samples, progress)
		},
	}
	runtime.progress("materializing-portable", runtime.copiedProgressBytes, runtime.totalProgressBytes)
	runtime.progressArtifactCompleted("materializing-portable", &runtime.copiedProgressBytes, 12<<20)
	runtime.progressArtifactCompleted("materializing-portable", &runtime.copiedProgressBytes, 8<<20)
	runtime.progress("flushing-portable", 0, 0)
	runtime.progress("verifying-portable", runtime.readbackProgressBytes, runtime.totalProgressBytes)
	runtime.progressArtifactCompleted("verifying-portable", &runtime.readbackProgressBytes, 12<<20)
	runtime.progressArtifactCompleted("verifying-portable", &runtime.readbackProgressBytes, 8<<20)
	runtime.progress("checking-layout-portable", 0, 0)

	expected := []PhysicalApplyProgress{
		{Phase: "materializing-portable", CompletedBytes: 0, TotalBytes: 20<<20},
		{Phase: "materializing-portable", CompletedBytes: 12<<20, TotalBytes: 20<<20},
		{Phase: "materializing-portable", CompletedBytes: 20<<20, TotalBytes: 20<<20},
		{Phase: "flushing-portable"},
		{Phase: "verifying-portable", CompletedBytes: 0, TotalBytes: 20<<20},
		{Phase: "verifying-portable", CompletedBytes: 12<<20, TotalBytes: 20<<20},
		{Phase: "verifying-portable", CompletedBytes: 20<<20, TotalBytes: 20<<20},
		{Phase: "checking-layout-portable"},
	}
	if len(samples) != len(expected) {
		t.Fatalf("received %d progress events, want %d", len(samples), len(expected))
	}
	for i, want := range expected {
		if got := samples[i]; got != want {
			t.Fatalf("progress event %d = %+v, want %+v", i, got, want)
		}
	}
	if runtime.copiedProgressBytes != runtime.totalProgressBytes ||
		runtime.readbackProgressBytes != runtime.totalProgressBytes {
		t.Fatalf("portable write/readback counters not complete: %+v", runtime)
	}
}

func TestPortableProgressUnknownTotalDoesNotFabricateByteCounts(t *testing.T) {
	var samples []PhysicalApplyProgress
	runtime := &portableWindowsRuntime{
		report: func(progress PhysicalApplyProgress) { samples = append(samples, progress) },
	}
	runtime.progressArtifactCompleted("materializing-portable", &runtime.copiedProgressBytes, math.MaxUint64)
	if len(samples) != 1 || samples[0] != (PhysicalApplyProgress{Phase: "materializing-portable"}) {
		t.Fatalf("unrepresentable bytes were presented as known: %+v", samples)
	}
	if runtime.copiedProgressBytes != 0 {
		t.Fatalf("unknown total advanced bytes: %d", runtime.copiedProgressBytes)
	}
}
