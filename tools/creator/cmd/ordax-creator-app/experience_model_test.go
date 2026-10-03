package main

import (
	"strings"
	"testing"
)

func TestCreatorExperienceConnectExplainsSafety(t *testing.T) {
	view := creatorExperience(creatorExperienceInput{})
	if view.Step != creatorStepConnect {
		t.Fatalf("step = %q, want %q", view.Step, creatorStepConnect)
	}
	if view.StepNumber != 1 || view.StepCount != 4 {
		t.Fatalf("unexpected progress: %d/%d", view.StepNumber, view.StepCount)
	}
	if !strings.Contains(view.Detail, "discos internos") {
		t.Fatalf("connect safety copy must mention internal disks: %q", view.Detail)
	}
	if view.Illustration != "usb-connect" {
		t.Fatalf("illustration = %q", view.Illustration)
	}
}

func TestCreatorExperienceReviewMakesDestructiveBoundaryExplicit(t *testing.T) {
	view := creatorExperience(creatorExperienceInput{
		TargetCount:    1,
		TargetSelected: true,
		PhysicalReady:  true,
	})
	if view.Step != creatorStepReview {
		t.Fatalf("step = %q, want %q", view.Step, creatorStepReview)
	}
	if !view.Destructive || !view.CanContinue {
		t.Fatalf("review must be an explicit actionable destructive boundary: %+v", view)
	}
	if !strings.Contains(view.Body, "apagado") {
		t.Fatalf("review copy must say the USB will be erased: %q", view.Body)
	}
	if !strings.Contains(view.Detail, "SSD ou HD interno") {
		t.Fatalf("review copy must distinguish USB from internal disks: %q", view.Detail)
	}
	if view.PrimaryAction != "Criar OrdaX" {
		t.Fatalf("primary action = %q", view.PrimaryAction)
	}
}

func TestCreatorExperienceWriteProgressPreventsNavigation(t *testing.T) {
	view := creatorExperience(creatorExperienceInput{WriteActive: true})
	if view.Step != creatorStepCreating {
		t.Fatalf("step = %q, want %q", view.Step, creatorStepCreating)
	}
	if view.CanContinue {
		t.Fatal("write progress must not expose forward navigation")
	}
	if !strings.Contains(view.Title, "Não remova") {
		t.Fatalf("write title must warn against removing USB: %q", view.Title)
	}
	if !strings.Contains(view.Detail, "verificação") {
		t.Fatalf("write detail should explain verification: %q", view.Detail)
	}
}

func TestCreatorExperienceCompleteTeachesNextBootStep(t *testing.T) {
	view := creatorExperience(creatorExperienceInput{WriteComplete: true})
	if view.Step != creatorStepComplete {
		t.Fatalf("step = %q, want %q", view.Step, creatorStepComplete)
	}
	if !view.CanContinue {
		t.Fatal("complete state must allow finishing")
	}
	if !strings.Contains(view.Body, "iniciar pelo USB") {
		t.Fatalf("completion copy must explain next boot step: %q", view.Body)
	}
	if view.SecondaryAction != "Como iniciar pelo USB" {
		t.Fatalf("secondary action = %q", view.SecondaryAction)
	}
}

func TestCreatorExperienceBlockedChannelNeverLooksReady(t *testing.T) {
	view := creatorExperience(creatorExperienceInput{
		TargetCount:    1,
		TargetSelected: true,
		PhysicalReady:  false,
	})
	if view.Step != creatorStepBlocked {
		t.Fatalf("step = %q, want %q", view.Step, creatorStepBlocked)
	}
	if view.CanContinue || view.Destructive {
		t.Fatalf("blocked channel must remain non-destructive: %+v", view)
	}
	if !strings.Contains(view.Detail, "Nenhuma alteração") {
		t.Fatalf("blocked copy must state that media was untouched: %q", view.Detail)
	}
}

func TestCreatorExperienceErrorFailsClosed(t *testing.T) {
	view := creatorExperience(creatorExperienceInput{ErrorMessageID: msgPhysicalWriteFailedDetail})
	if view.Step != creatorStepBlocked {
		t.Fatalf("step = %q, want %q", view.Step, creatorStepBlocked)
	}
	if view.CanContinue || view.Destructive {
		t.Fatalf("error state must fail closed: %+v", view)
	}
	if view.Detail != creatorT(msgPhysicalWriteFailedDetail) {
		t.Fatalf("detail = %q", view.Detail)
	}
}
