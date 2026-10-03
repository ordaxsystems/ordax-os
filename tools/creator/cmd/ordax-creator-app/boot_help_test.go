package main

import (
	"strings"
	"testing"
)

func TestCreatorBootHelpUsesLocalizationOwner(t *testing.T) {
	text := creatorBootHelpText()
	if text != creatorT(msgBootHelp) {
		t.Fatalf("boot help bypassed localization owner: %q", text)
	}
	for _, neutralBoundary := range []string{"USB/UEFI", "SSD", "USB"} {
		if !strings.Contains(text, neutralBoundary) {
			t.Fatalf("boot help missing boundary token %q: %q", neutralBoundary, text)
		}
	}
}

func TestCreatorBootHelpAvailableInBundledLocales(t *testing.T) {
	previous := currentCreatorLocale()
	t.Cleanup(func() { setCreatorLocale(string(previous)) })

	for _, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
		setCreatorLocale(string(locale))
		if got, want := creatorBootHelpText(), creatorMessageFor(locale, msgBootHelp, nil); got != want {
			t.Fatalf("locale %s boot help = %q, want owner copy %q", locale, got, want)
		}
	}
}
