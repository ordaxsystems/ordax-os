//go:build windows

package main

import (
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestPhysicalFailurePresentationSurvivesLocaleChangesWithDiagnostic(t *testing.T) {
	previous := currentCreatorLocale()
	t.Cleanup(func() { setCreatorLocale(string(previous)) })
	report := filepath.Join(t.TempDir(), "physical-write-failed.txt")
	state := physicalWriteState{
		Error: "Portable readback SHA-256 mismatch",
		DiagnosticPath: report,
	}
	for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
		setCreatorLocale(string(locale))
		status, hint := physicalWriteResultCopy(state)
		view := creatorExperience(creatorExperienceInput{
			ErrorMessageID: msgPhysicalWriteFailedDetail, ErrorStepNumber: 4,
		})
		if status != view.Title || !strings.Contains(hint, view.Detail) ||
			!strings.Contains(hint, filepath.Base(report)) {
			t.Fatalf("locale %s lost failed-write context or report location: status=%q hint=%q",
				locale, status, hint)
		}
		if status == creatorT(msgWriteCompleteStatus) {
			t.Fatalf("locale %s presented a failed Portable write as successful", locale)
		}
		details := physicalWriteFailureDetails(state)
		if !strings.Contains(details, report) || !strings.Contains(details, state.Error) {
			t.Fatalf("locale %s cannot access preserved diagnostic path/cause: %q", locale, details)
		}
	}
}

func TestPhysicalWriteFailureDetailsBoundsTextAndRejectsActiveOrEmptyErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "failed.txt")
	state := physicalWriteState{Error: strings.Repeat("X", 10000), DiagnosticPath: path}
	details := physicalWriteFailureDetails(state)
	if len([]rune(details)) > maxPhysicalFailureDetailRunes+len([]rune(path))+100 {
		t.Fatalf("failure dialog exceeded bounded display size: %d", utf8.RuneCountInString(details))
	}
	if !strings.Contains(details, path) || !strings.HasSuffix(details, "…") {
		t.Fatalf("bounded failure dialog lost path or truncation indication: %q", details)
	}
	state.Active = true
	if details := physicalWriteFailureDetails(state); details != "" {
		t.Fatalf("active write exposed stale failure details: %q", details)
	}
	state.Active = false
	state.Error = ""
	if details := physicalWriteFailureDetails(state); details != "" {
		t.Fatalf("successful/idle write exposed old failure details: %q", details)
	}
}

func TestPhysicalWriteSuccessPresentationRemainsSeparateFromFailure(t *testing.T) {
	previous := currentCreatorLocale()
	t.Cleanup(func() { setCreatorLocale(string(previous)) })
	for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
		setCreatorLocale(string(locale))
		status, hint := physicalWriteResultCopy(physicalWriteState{Success: true})
		if !strings.Contains(status, creatorT(msgWriteCompleteStatus)) || hint == "" {
			t.Fatalf("locale %s lost confirmed write success: status=%q hint=%q", locale, status, hint)
		}
		if details := physicalWriteFailureDetails(physicalWriteState{Success: true}); details != "" {
			t.Fatalf("success still offered a failure report: %q", details)
		}
	}
}
