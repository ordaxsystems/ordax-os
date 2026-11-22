//go:build windows

package main

import (
	"errors"
	"strings"
	"testing"
)

func TestCachedChannelFallbackSeparatesVerifiedCacheFromFatalFailure(t *testing.T) {
	networkErr := errors.New("update endpoint unavailable")
	missingCache := errors.New("offline cache has no valid receipt")
	for _, tc := range []struct {
		name       string
		signed     bool
		currentErr error
		wantNotice creatorMessageID
		wantFatal  bool
	}{
		{"verified-dev", false, nil, msgRefreshDevCacheNotice, false},
		{"verified-signed", true, nil, msgRefreshSignedCacheNotice, false},
		{"missing-dev", false, missingCache, "", true},
		{"missing-signed", true, missingCache, "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var state appRefreshState
			markCachedChannelFallback(&state, tc.signed, networkErr, tc.currentErr)
			if state.NoticeID != tc.wantNotice {
				t.Fatalf("cache notice = %q, want %q", state.NoticeID, tc.wantNotice)
			}
			if (state.Error != "") != tc.wantFatal {
				t.Fatalf("fatal state = %q, want fatal=%t", state.Error, tc.wantFatal)
			}
		})
	}
}

func TestCreatorOfflineFallbackCannotBypassPhysicalReadiness(t *testing.T) {
	targets := []physicalTarget{{DiskNumber: 3, PrototypeSafe: true}}
	state := appRefreshState{
		Targets: targets,
		NoticeID: msgRefreshSignedCacheNotice,
	}
	view := selectionExperienceForState(state, true)
	if view.Step != creatorStepBlocked || view.CanContinue || view.Destructive {
		t.Fatalf("cache notice accidentally authorized a physical writer: %+v", view)
	}
}

func TestCreatorOfflineFallbackPreservesIndependentlyVerifiedReadiness(t *testing.T) {
	state := appRefreshState{
		Targets:       []physicalTarget{{DiskNumber: 3, PrototypeSafe: true}},
		PhysicalReady: true,
		NoticeID:      msgRefreshSignedCacheNotice,
	}
	view := selectionExperienceForState(state, true)
	if view.Step != creatorStepReview || !view.CanContinue || !view.Destructive {
		t.Fatalf("verified physical backend was blocked by an update notice: %+v", view)
	}
	state.Error = "physical device enumeration failed"
	view = selectionExperienceForState(state, true)
	if view.Step != creatorStepBlocked || view.CanContinue || view.Destructive {
		t.Fatalf("fatal target failure did not block the physical path: %+v", view)
	}
}

func TestCreatorCacheNoticesHaveCompleteDistinctLocalizations(t *testing.T) {
	for _, id := range []creatorMessageID{msgRefreshSignedCacheNotice, msgRefreshDevCacheNotice} {
		pt := creatorMessageFor(creatorLocalePTBR, id, nil)
		en := creatorMessageFor(creatorLocaleENUS, id, nil)
		if pt == "" || en == "" || pt == en || pt == string(id) || en == string(id) {
			t.Fatalf("cache notice %s not translated in both supported locales", id)
		}
	}
	signed := creatorMessageFor(creatorLocaleENUS, msgRefreshSignedCacheNotice, nil)
	dev := creatorMessageFor(creatorLocaleENUS, msgRefreshDevCacheNotice, nil)
	if !strings.Contains(signed, "signed") || strings.Contains(dev, "signed") {
		t.Fatal("development cache is incorrectly represented as signed")
	}
}
