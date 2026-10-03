package main

import "testing"

func TestCreatorExperienceConnectExplainsSafety(t *testing.T) {
	view := creatorExperience(creatorExperienceInput{})
	if view.Step != creatorStepConnect {
		t.Fatalf("step = %q, want %q", view.Step, creatorStepConnect)
	}
	if view.StepNumber != 1 || view.StepCount != 4 {
		t.Fatalf("unexpected progress: %d/%d", view.StepNumber, view.StepCount)
	}
	if view.Detail != creatorT(msgConnectDetail) {
		t.Fatalf("connect safety copy bypassed localization owner: %q", view.Detail)
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
	if view.Body != creatorT(msgReviewBody) {
		t.Fatalf("review destructive copy bypassed localization owner: %q", view.Body)
	}
	if view.Detail != creatorT(msgReviewDetail) {
		t.Fatalf("review internal-disk boundary bypassed localization owner: %q", view.Detail)
	}
	if view.PrimaryAction != creatorT(msgActionCreate) {
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
	if view.Title != creatorT(msgCreatingTitle) {
		t.Fatalf("write removal warning bypassed localization owner: %q", view.Title)
	}
	if view.Detail != creatorT(msgCreatingDetail) {
		t.Fatalf("write verification detail bypassed localization owner: %q", view.Detail)
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
	if view.Body != creatorT(msgCompleteBody) {
		t.Fatalf("completion next-boot copy bypassed localization owner: %q", view.Body)
	}
	if view.SecondaryAction != creatorT(msgActionBootHelp) {
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
	if view.Detail != creatorT(msgBlockedDetail) {
		t.Fatalf("blocked untouched-media copy bypassed localization owner: %q", view.Detail)
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

func TestCreatorExperienceSafetyStateIsLocaleIndependent(t *testing.T) {
	previous := currentCreatorLocale()
	t.Cleanup(func() { setCreatorLocale(string(previous)) })

	var baseline creatorExperienceView
	for index, locale := range []creatorLocale{creatorLocalePTBR, creatorLocaleENUS} {
		setCreatorLocale(string(locale))
		view := creatorExperience(creatorExperienceInput{
			TargetCount:    1,
			TargetSelected: true,
			PhysicalReady:  true,
		})
		if index == 0 {
			baseline = view
			continue
		}
		if view.Step != baseline.Step || view.StepNumber != baseline.StepNumber || view.StepCount != baseline.StepCount || view.Destructive != baseline.Destructive || view.CanContinue != baseline.CanContinue || view.Illustration != baseline.Illustration {
			t.Fatalf("safety/navigation state changed with locale: pt=%+v en=%+v", baseline, view)
		}
	}
}
