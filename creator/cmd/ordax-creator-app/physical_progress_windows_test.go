//go:build windows

package main

import (
	"encoding/json"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPhysicalProgressPresentationUsesByteProgressForWriteAndVerify(t *testing.T) {
	write := physicalProgressDocument{Schema: physicalProgressSchema, Phase: "writing", CompletedBytes: 50, TotalBytes: 100}
	_, _, writePercent, ok := physicalProgressPresentation(write)
	if !ok {
		t.Fatal("writing phase must be recognized")
	}
	if writePercent != 37 {
		t.Fatalf("writing percent=%d want=37", writePercent)
	}

	verify := physicalProgressDocument{Schema: physicalProgressSchema, Phase: "verifying", CompletedBytes: 50, TotalBytes: 100}
	_, _, verifyPercent, ok := physicalProgressPresentation(verify)
	if !ok {
		t.Fatal("verifying phase must be recognized")
	}
	if verifyPercent != 76 {
		t.Fatalf("verifying percent=%d want=76", verifyPercent)
	}
}

func TestPhysicalProgressPresentationCompletesAtOneHundred(t *testing.T) {
	_, _, percent, ok := physicalProgressPresentation(physicalProgressDocument{Schema: physicalProgressSchema, Phase: "complete", CompletedBytes: 1, TotalBytes: 1})
	if !ok || percent != 100 {
		t.Fatalf("complete progress=(%d,%v) want=(100,true)", percent, ok)
	}
}

func TestGuidedPhysicalProgressCopyKeepsLocalizedSafetyInstructionVisible(t *testing.T) {
	statusInput := creatorT(msgProgressWritingStatus)
	hintInput := creatorTValues(msgProgressWritingBytes, map[string]string{
		"completed": "1.0",
		"total":     "2.0",
	})
	status, hint := guidedPhysicalProgressCopy(statusInput, hintInput)
	if !strings.Contains(status, creatorT(msgCreatingEyebrow)) {
		t.Fatalf("status=%q must carry localized guided creation stage", status)
	}
	if !strings.Contains(hint, creatorT(msgCreatingTitle)) {
		t.Fatalf("hint=%q must keep localized removal warning visible", hint)
	}
	if !strings.Contains(hint, hintInput) {
		t.Fatalf("hint=%q must preserve localized backend byte progress %q", hint, hintInput)
	}
}

func TestPhysicalProgressSafetyCompositionWorksInBundledLocales(t *testing.T) {
	previous := currentCreatorLocale()
	t.Cleanup(func() { setCreatorLocale(string(previous)) })

	for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
		setCreatorLocale(string(locale))
		statusInput := creatorT(msgProgressWritingStatus)
		hintInput := creatorTValues(msgProgressWritingBytes, map[string]string{"completed": "1.0", "total": "2.0"})
		status, hint := guidedPhysicalProgressCopy(statusInput, hintInput)
		if !strings.Contains(status, creatorMessageFor(locale, msgCreatingEyebrow, nil)) || !strings.Contains(hint, creatorMessageFor(locale, msgCreatingTitle, nil)) {
			t.Fatalf("locale %s lost guided safety copy: status=%q hint=%q", locale, status, hint)
		}
	}
}

func TestReadPhysicalProgressUsesBoundedRegularFile(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "progress.json")
	body := []byte(`{"$schema":"prototype-ordax.creator-physical-progress/1","phase":"writing","completed_bytes":1,"total_bytes":2}`)
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	document, err := readPhysicalProgress(path)
	if err != nil || document.Phase != "writing" {
		t.Fatalf("safe progress snapshot rejected: %+v, %v", document, err)
	}
	if err := os.Truncate(path, 4097); err != nil {
		t.Fatal(err)
	}
	if _, err := readPhysicalProgress(path); err == nil {
		t.Fatal("oversized progress evidence was accepted")
	}
}

func TestReadPhysicalProgressRejectsRedirectedFile(t *testing.T) {
	root := t.TempDir()
	realFile := filepath.Join(root, "real-progress.json")
	if err := os.WriteFile(realFile, []byte(`{"$schema":"prototype-ordax.creator-physical-progress/1","phase":"complete","completed_bytes":2,"total_bytes":2}`), 0o600); err != nil {
		t.Fatal(err)
	}
	linked := filepath.Join(root, "progress.json")
	if err := os.Symlink(realFile, linked); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := readPhysicalProgress(linked); err == nil {
		t.Fatal("symlinked progress evidence was accepted")
	}
}


func TestPhysicalProgressPercentExactForLargeByteCounters(t *testing.T) {
	for _, tc := range []struct {
		name       string
		completed  int64
		total      int64
		start      int
		span       int
	}{
		{"writing-half-small", 50, 100, 15, 45},
		{"verifying-half-small", 50, 100, 62, 28},
		{"writing-half-maxint64", math.MaxInt64 / 2, math.MaxInt64, 15, 45},
		{"verifying-half-maxint64", math.MaxInt64 / 2, math.MaxInt64, 62, 28},
		{"writing-full-maxint64", math.MaxInt64, math.MaxInt64, 15, 45},
		{"verifying-full-maxint64", math.MaxInt64, math.MaxInt64, 62, 28},
		{"writing-near-full-maxint64", math.MaxInt64 - 1, math.MaxInt64, 15, 45},
		{"verifying-near-full-maxint64", math.MaxInt64 - 1, math.MaxInt64, 62, 28},
		{"writing-quarter-maxint64", math.MaxInt64 / 4, math.MaxInt64, 15, 45},
		{"writing-near-zero", 1, math.MaxInt64, 15, 45},
		{"verifying-one-byte", 1, 1, 62, 28},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Independent arbitrary-precision reference, not susceptible to
			// the signed int64 multiplication overflow in the former GUI.
			product := new(big.Int).Mul(big.NewInt(tc.completed), big.NewInt(int64(tc.span)))
			want := tc.start + int(product.Div(product, big.NewInt(tc.total)).Int64())
			got := physicalProgressPercent(tc.completed, tc.total, tc.start, tc.span)
			if got != want || got < tc.start || got > tc.start+tc.span {
				t.Fatalf("scaled progress=%d, exact=%d, range=[%d,%d]", got, want, tc.start, tc.start+tc.span)
			}
		})
	}
	for _, tc := range []struct {
		completed int64
		total     int64
		span      int
	}{
		{0, 0, 45},
		{0, math.MaxInt64, 45},
		{-1, math.MaxInt64, 28},
		{math.MaxInt64, 0, 45},
		{math.MaxInt64, 1, 0},
	} {
		if got := physicalProgressPercent(tc.completed, tc.total, 15, tc.span); got != 15 {
			t.Fatalf("zero/unknown/invalid total must remain at phase start: %d", got)
		}
	}
}

func TestPhysicalProgressPresentationScalesHugeValidSnapshots(t *testing.T) {
	for _, tc := range []struct {
		phase string
		completed int64
		want int
	}{
		{"writing", math.MaxInt64 / 2, 37},
		{"writing", math.MaxInt64 - 1, 59},
		{"writing", math.MaxInt64, 60},
		{"verifying", math.MaxInt64 / 2, 75},
		{"verifying", math.MaxInt64 - 1, 89},
		{"verifying", math.MaxInt64, 90},
	} {
		doc := physicalProgressDocument{Schema: physicalProgressSchema, Phase: tc.phase, CompletedBytes: tc.completed, TotalBytes: math.MaxInt64}
		_, _, got, ok := physicalProgressPresentation(doc)
		if !ok || got != tc.want {
			t.Fatalf("phase %q bytes %d/%d gave %d (ok=%v), want %d", tc.phase, tc.completed, doc.TotalBytes, got, ok, tc.want)
		}
	}
}

func TestReadPhysicalProgressRejectsIncoherentByteCounters(t *testing.T) {
	path := filepath.Join(t.TempDir(), "progress.json")
	for _, tc := range []struct {
		name string
		completed int64
		total int64
		valid bool
	}{
		{"starting-zero", 0, 0, true},
		{"unknown-total-but-positive-bytes", 1, 0, false},
		{"more-completed-than-total", 100, 99, false},
		{"negative-completed", -1, 10, false},
		{"negative-total", 0, -1, false},
		{"large-valid", math.MaxInt64 - 1, math.MaxInt64, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := json.Marshal(physicalProgressDocument{
				Schema: physicalProgressSchema, Phase: "writing",
				CompletedBytes: tc.completed, TotalBytes: tc.total,
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, body, 0o600); err != nil {
				t.Fatal(err)
			}
			_, err = readPhysicalProgress(path)
			if (err == nil) != tc.valid {
				t.Fatalf("counters %d/%d accepted=%v, want=%v: %v", tc.completed, tc.total, err == nil, tc.valid, err)
			}
		})
	}
}


func TestPhysicalProgressTrackerPreservesPhaseAndCounterMonotonicity(t *testing.T) {
	var tracker physicalProgressTracker
	snapshot := func(phase string, completed, total int64) physicalProgressDocument {
		return physicalProgressDocument{
			Schema: physicalProgressSchema, Phase: phase,
			CompletedBytes: completed, TotalBytes: total,
		}
	}
	for _, tc := range []struct {
		name string
		doc physicalProgressDocument
		accept bool
		percent int
	}{
		{"starting", snapshot("starting", 0, 0), true, 2},
		{"target", snapshot("revalidating-target", 0, 0), true, 5},
		{"writing-start", snapshot("writing", 0, 100), true, 15},
		{"writing-middle", snapshot("writing", 50, 100), true, 37},
		{"duplicate", snapshot("writing", 50, 100), false, 0},
		{"older-same-stage", snapshot("writing", 40, 100), false, 0},
		{"changed-total-same-stage", snapshot("writing", 80, 200), false, 0},
		{"older-phase-even-if-higher-bytes", snapshot("validating-image", 100, 100), false, 0},
		{"writing-complete", snapshot("writing", 100, 100), true, 60},
		{"flushing", snapshot("flushing", 0, 0), true, 62},
		{"late-writing", snapshot("writing", 100, 100), false, 0},
		{"verifying-start", snapshot("verifying", 0, 100), true, 62},
		{"late-flush-at-same-percent", snapshot("flushing", 0, 0), false, 0},
		{"verifying-middle", snapshot("verifying", 50, 100), true, 76},
		{"verifying-backwards", snapshot("verifying", 49, 100), false, 0},
		{"verified", snapshot("verified", 100, 100), true, 92},
		{"data-formatting", snapshot("formatting-data", 0, 0), true, 96},
		{"late-verification", snapshot("verifying", 100, 100), false, 0},
		{"child-claims-complete-before-exit", snapshot("complete", 1, 1), false, 0},
		{"unrecognized-phase", snapshot("unknown", 0, 0), false, 0},
		{"not-even-late-complete", snapshot("complete", 1, 1), false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, percent, ok := tracker.accept(tc.doc)
			if ok != tc.accept || (ok && percent != tc.percent) {
				t.Fatalf("progress tracker accept=%t percent=%d; want accept=%t percent=%d",
					ok, percent, tc.accept, tc.percent)
			}
			if tracker.lastPercent > 96 {
				t.Fatalf("telemetry falsely claimed terminal success: %d%%", tracker.lastPercent)
			}
		})
	}
}

func TestPhysicalProgressTrackerRejectsInvalidAndUnownedSnapshots(t *testing.T) {
	var tracker physicalProgressTracker
	for _, tc := range []physicalProgressDocument{
		{Schema: physicalProgressSchema, Phase: "writing", CompletedBytes: -1, TotalBytes: 100},
		{Schema: physicalProgressSchema, Phase: "writing", CompletedBytes: 101, TotalBytes: 100},
		{Schema: physicalProgressSchema, Phase: "writing", CompletedBytes: 1, TotalBytes: 0},
		{Schema: physicalProgressSchema, Phase: "complete", CompletedBytes: 1, TotalBytes: 1},
	} {
		if _, _, _, ok := tracker.accept(tc); ok {
			t.Fatalf("untrusted progress passed: %+v", tc)
		}
	}
	if tracker.lastKey != "" || tracker.lastStage != 0 || tracker.lastPercent != 0 {
		t.Fatalf("rejected progress mutated accepted state: %+v", tracker)
	}
	if _, _, _, ok := (*physicalProgressTracker)(nil).accept(physicalProgressDocument{Phase: "writing", TotalBytes: 10}); ok {
		t.Fatal("missing progress tracker accepted untracked evidence")
	}
}

func TestPhysicalProgressTrackerProtectsFailedElevatedExitFromPrematureCompletion(t *testing.T) {
	var tracker physicalProgressTracker
	// The helper may have written a complete phase immediately before a
	// nonzero exit status. The last visible progress must remain nonterminal;
	// success is established separately by runElevatedAndWait/completeWrite.
	valid := physicalProgressDocument{Schema: physicalProgressSchema, Phase: "verified"}
	if _, _, percent, ok := tracker.accept(valid); !ok || percent != 92 {
		t.Fatalf("preterminal verified snapshot rejected: percent=%d accepted=%t", percent, ok)
	}
	terminal := physicalProgressDocument{
		Schema: physicalProgressSchema, Phase: "complete", CompletedBytes: 1, TotalBytes: 1,
	}
	if _, _, percent, ok := tracker.accept(terminal); ok || percent != 0 {
		t.Fatalf("unsigned terminal evidence reached the UI: percent=%d accepted=%t", percent, ok)
	}
	if tracker.lastStage != 10 || tracker.lastPercent != 92 {
		t.Fatalf("terminal snapshot changed UI before process exit: %+v", tracker)
	}
}


func TestPortableProgressPresentationTracksRealWriterStagesAndBytes(t *testing.T) {
	for _, tc := range []struct {
		phase string
		done int64
		total int64
		wantPercent int
		wantStage int
	}{
		{"starting-portable", 0, 0, 2, 1},
		{"partitioning-portable", 0, 1, 7, 2},
		{"partitioning-portable", 1, 1, 20, 2},
		{"formatting-portable", 0, 0, 22, 3},
		{"materializing-portable", 0, 20 << 20, 27, 4},
		{"materializing-portable", 12 << 20, 20 << 20, 49, 4},
		{"materializing-portable", 20 << 20, 20 << 20, 65, 4},
		{"flushing-portable", 0, 0, 68, 5},
		{"verifying-portable", 0, 20 << 20, 70, 6},
		{"verifying-portable", 12 << 20, 20 << 20, 83, 6},
		{"verifying-portable", 20 << 20, 20 << 20, 93, 6},
		{"checking-layout-portable", 0, 0, 95, 7},
		{"complete-portable", 1, 1, 100, 8},
	} {
		doc := physicalProgressDocument{
			Schema: physicalProgressSchema, Phase: tc.phase,
			CompletedBytes: tc.done, TotalBytes: tc.total,
		}
		status, _, percent, stage, ok := physicalProgressPresentationWithStage(doc)
		if !ok || status == "" || percent != tc.wantPercent || stage != tc.wantStage {
			t.Fatalf("portable phase %s (%d/%d) returned status=%q progress=%d stage=%d recognized=%t; want %d stage=%d",
				tc.phase, tc.done, tc.total, status, percent, stage, ok, tc.wantPercent, tc.wantStage)
		}
	}
	if _, _, _, _, ok := physicalProgressPresentationWithStage(physicalProgressDocument{Phase: "unsupported-portable"}); ok {
		t.Fatal("unrecognized Portable phase must be ignored")
	}
}

func TestPortableProgressTrackerPreservesOrderAndDefersTerminalSuccess(t *testing.T) {
	var tracker physicalProgressTracker
	for _, tc := range []struct {
		phase string
		done int64
		total int64
		accepted bool
	}{
		{"starting-portable", 0, 0, true},
		{"partitioning-portable", 0, 1, true},
		{"partitioning-portable", 1, 1, true},
		{"formatting-portable", 0, 0, true},
		{"materializing-portable", 0, 20 << 20, true},
		{"materializing-portable", 12 << 20, 20 << 20, true},
		{"materializing-portable", 4 << 20, 20 << 20, false},
		{"materializing-portable", 12 << 20, 21 << 20, false},
		{"materializing-portable", 20 << 20, 20 << 20, true},
		{"flushing-portable", 0, 0, true},
		{"materializing-portable", 20 << 20, 20 << 20, false},
		{"verifying-portable", 0, 20 << 20, true},
		{"verifying-portable", 12 << 20, 20 << 20, true},
		{"verifying-portable", 20 << 20, 20 << 20, true},
		{"checking-layout-portable", 0, 0, true},
		{"verifying-portable", 20 << 20, 20 << 20, false},
		{"complete-portable", 1, 1, false},
	} {
		doc := physicalProgressDocument{
			Schema: physicalProgressSchema, Phase: tc.phase,
			CompletedBytes: tc.done, TotalBytes: tc.total,
		}
		_, _, percent, ok := tracker.accept(doc)
		if ok != tc.accepted {
			t.Fatalf("phase %q (%d/%d) accepted=%t, want %t", tc.phase, tc.done, tc.total, ok, tc.accepted)
		}
		if ok && (percent < 0 || percent > 95) {
			t.Fatalf("Portable helper telemetry falsely declared completion at %d%%", percent)
		}
	}
	if tracker.lastStage != 7 || tracker.lastPercent != 95 {
		t.Fatalf("terminal helper snapshot changed result before confirmed exit: %+v", tracker)
	}
}

func TestPortableProgressStatusAndByteLabelsAreLocalized(t *testing.T) {
	previous := currentCreatorLocale()
	t.Cleanup(func() { setCreatorLocale(string(previous)) })
	doc := physicalProgressDocument{
		Schema: physicalProgressSchema, Phase: "materializing-portable",
		CompletedBytes: 12 << 20, TotalBytes: 20 << 20,
	}
	for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
		setCreatorLocale(string(locale))
		status, hint, percent, ok := physicalProgressPresentation(doc)
		if !ok || percent != 49 || !strings.Contains(status, "17") ||
			!strings.Contains(hint, "12.0") || !strings.Contains(hint, "20.0") {
			t.Fatalf("Portable progress locale=%s status=%q hint=%q percent=%d ok=%t", locale, status, hint, percent, ok)
		}
	}
}
