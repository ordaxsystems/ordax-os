//go:build windows

package main

import (
	"strings"
	"testing"
)

func validOwnerUpdateManifestForTest() ownerUpdateManifest {
	return ownerUpdateManifest{
		Schema:       "prototype-ordax.creator-owner-bundle-update/2",
		Channel:      "owner-prototype",
		Version:      "0.6.2-dev",
		SourceCommit: strings.Repeat("b", 40),
		CreatorSourceCommit: strings.Repeat("d", 40),
		Artifact:     "OrdaX-Creator-Owner-Prototype.zip",
		DownloadURL:  "https://github.com/ordaxsystems/ordax-os/releases/download/creator-owner-prototype/OrdaX-Creator-Owner-Prototype.zip",
		SHA256:       strings.Repeat("c", 64),
		Size:         889240014, // Regression: official 2026-11-01 owner bundle exceeds the old 512 MiB limit.
	}
}

func TestOfficialOwnerBundleSizeAcceptedWithoutRelaxingManifestPolicy(t *testing.T) {
	for _, tc := range []struct {
		name string
		size int64
		wantValid bool
	}{
		{"published-size-over-512-mib", 889240014, true},
		{"at-maximum", maxOwnerUpdateBundleBytes, true},
		{"zero", 0, false},
		{"negative", -1, false},
		{"over-maximum", maxOwnerUpdateBundleBytes + 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			manifest := validOwnerUpdateManifestForTest()
			manifest.Size = tc.size
			if err := validateOwnerUpdateManifest(manifest); (err == nil) != tc.wantValid {
				t.Fatalf("bundle size=%d valid=%v error=%v, want valid=%v", tc.size, err == nil, err, tc.wantValid)
			}
		})
	}
	for _, mutate := range []func(*ownerUpdateManifest){
		func(m *ownerUpdateManifest) { m.Channel = "development" },
		func(m *ownerUpdateManifest) { m.SourceCommit = "untrusted" },
		func(m *ownerUpdateManifest) { m.CreatorSourceCommit = "untrusted" },
		func(m *ownerUpdateManifest) { m.SHA256 = strings.Repeat("z", 64) },
		func(m *ownerUpdateManifest) { m.DownloadURL = "http://github.com/ordaxsystems/ordax-os/releases/download/creator-owner-prototype/OrdaX-Creator-Owner-Prototype.zip" },
		func(m *ownerUpdateManifest) { m.AutomaticInAppUpdate = true },
	} {
		manifest := validOwnerUpdateManifestForTest()
		mutate(&manifest)
		if err := validateOwnerUpdateManifest(manifest); err == nil {
			t.Fatalf("unsafe owner manifest accepted: %+v", manifest)
		}
	}
}

func TestOwnerManualUpdateMessageSeparatesInstalledAndAvailableForBothLocales(t *testing.T) {
	previous := currentCreatorLocale()
	t.Cleanup(func() { setCreatorLocale(string(previous)) })
	candidate := updateUIState{
		Available: true,
		Version: "0.6.2-dev",
		SourceCommit: strings.Repeat("b", 40),
	}
	for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
		setCreatorLocale(string(locale))
		got := ownerUpdateManualMessage("0.6.1-dev", strings.Repeat("a", 40), candidate)
		for _, phrase := range []string{"0.6.1-dev (aaaaaaaa)", "0.6.2-dev (bbbbbbbb)", "OrdaX-Creator-Owner-Prototype.zip"} {
			if !strings.Contains(got, phrase) {
				t.Fatalf("locale %s lost version/bundle identity %q: %q", locale, phrase, got)
			}
		}
		if strings.Contains(got, "{installed}") || strings.Contains(got, "{available}") {
			t.Fatalf("locale %s has unexpanded version placeholders: %q", locale, got)
		}
	}

	candidate.Error = "lineage check failed"
	got := ownerUpdateManualMessage("0.6.1-dev", strings.Repeat("a", 40), candidate)
	if strings.Contains(got, "bbbbbbbb") {
		t.Fatalf("failed lineage was presented as validated available update: %q", got)
	}
}

func TestAvailableUpdateNeverReplacesInstalledVersionLabel(t *testing.T) {
	oldLabel := creatorVersionText
	updateMu.Lock()
	previous := currentUpdateState
	currentUpdateState = updateUIState{
		Available: true,
		Version: "0.6.2-dev",
		SourceCommit: strings.Repeat("b", 40),
		Manual: false,
	}
	updateMu.Unlock()
	t.Cleanup(func() {
		creatorVersionText = oldLabel
		updateMu.Lock()
		currentUpdateState = previous
		updateMu.Unlock()
	})

	installed := "OrdaX Creator • 0.6.1-dev • aaaaaaaa"
	creatorVersionText = installed
	renderUpdateDone() // No window, network, download or physical device access.
	if creatorVersionText != installed {
		t.Fatalf("advertised update masqueraded as installed: got %q, want %q", creatorVersionText, installed)
	}
}


func TestOwnerUpdateDownloadTargetRequiresValidatedAvailableCheck(t *testing.T) {
	valid := updateUIState{Checked: true, Available: true}
	if got, ok := ownerUpdateDownloadTarget(valid); !ok || got != ownerUpdateBundleURL {
		t.Fatalf("validated update download target = %q ok=%t", got, ok)
	}
	for _, state := range []updateUIState{
		{},
		{Checking: true, Checked: true, Available: true},
		{Checked: true},
		{Checked: true, Available: true, Error: "lineage failed"},
		{Available: true},
	} {
		if got, ok := ownerUpdateDownloadTarget(state); ok || got != "" {
			t.Fatalf("unsafe update state exposed download: %+v -> %q ok=%t", state, got, ok)
		}
	}
}

func TestOwnerUpdateAvailableActionIsExplicitDownloadInBothLocales(t *testing.T) {
	if got := creatorMessageFor(creatorLocalePTBR, msgUpdateAvailableAction, nil); got != "Baixar atualização" {
		t.Fatalf("pt-BR update action = %q", got)
	}
	if got := creatorMessageFor(creatorLocaleENUS, msgUpdateAvailableAction, nil); got != "Download update" {
		t.Fatalf("en-US update action = %q", got)
	}
	for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
		if got := creatorMessageFor(locale, msgUpdateDownloadFailedBody, nil); got == "" || got == string(msgUpdateDownloadFailedBody) {
			t.Fatalf("missing download failure message for %s", locale)
		}
	}
}

func TestOwnerUpdateCheckActionStates(t *testing.T) {
	for _, tc := range []struct {
		name string
		state updateUIState
		want creatorMessageID
		enabled bool
	}{
		{"uninitialized", updateUIState{}, msgUpdateControl, true},
		{"checking", updateUIState{Checking: true}, msgUpdateChecking, false},
		{"network-error", updateUIState{Error: "network unavailable"}, msgUpdateRetryAction, true},
		{"lineage-error-over-available", updateUIState{Available: true, Checked: true, Error: "untrusted lineage"}, msgUpdateRetryAction, true},
		{"available", updateUIState{Available: true, Checked: true}, msgUpdateAvailableAction, true},
		{"not-newer", updateUIState{Checked: true}, msgUpdateCurrentAction, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, enabled := ownerUpdateAction(tc.state)
			if got != tc.want || enabled != tc.enabled {
				t.Fatalf("owner action = %s enabled=%t, want %s enabled=%t", got, enabled, tc.want, tc.enabled)
			}
		})
	}
}

func TestOwnerUpdateCheckDialogsDeferDuringWriteOrRefresh(t *testing.T) {
	for _, state := range []updateUIState{
		{Manual: true, Checked: true, Available: true},
		{Manual: true, Checked: true},
		{Manual: true, Error: "offline"},
	} {
		if !ownerUpdateMayShowDialog(state, false, false) {
			t.Fatalf("completed manual result cannot be reviewed while idle: %+v", state)
		}
		for _, tc := range []struct { writing, refreshing bool }{
			{true, false}, {false, true}, {true, true},
		} {
			if ownerUpdateMayShowDialog(state, tc.writing, tc.refreshing) {
				t.Fatalf("manual update modal interrupted another operation: %+v %+v", state, tc)
			}
		}
	}
	for _, state := range []updateUIState{
		{},
		{Manual: true},
		{Manual: true, Checking: true},
		{Checked: true, Available: true},
		{Error: "offline"},
	} {
		if ownerUpdateMayShowDialog(state, false, false) {
			t.Fatalf("unrequested or incomplete check opened a modal: %+v", state)
		}
	}
}

func TestOwnerUpdateCheckMessagesAreLocalizedAndReadOnly(t *testing.T) {
	for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
		for _, id := range []creatorMessageID{msgUpdateRetryAction, msgUpdateCurrentAction, msgUpdateFailedBody, msgUpdateCurrentBody} {
			got := creatorMessageFor(locale, id, nil)
			if got == "" || got == string(id) {
				t.Fatalf("missing update state message %q for locale %s", id, locale)
			}
		}
	}
	failure := creatorMessageFor(creatorLocaleENUS, msgUpdateFailedBody, nil)
	if !strings.Contains(failure, "check") || !strings.Contains(failure, "not changed") {
		t.Fatalf("update check failure wrongly implies an installation was attempted: %q", failure)
	}
}
