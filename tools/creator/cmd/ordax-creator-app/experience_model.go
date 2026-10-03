package main

type creatorExperienceStep string

const (
	creatorStepConnect  creatorExperienceStep = "connect-usb"
	creatorStepSelect   creatorExperienceStep = "select-usb"
	creatorStepReview   creatorExperienceStep = "review-and-confirm"
	creatorStepCreating creatorExperienceStep = "creating-ordax"
	creatorStepComplete creatorExperienceStep = "complete"
	creatorStepBlocked  creatorExperienceStep = "blocked"
)

type creatorExperienceInput struct {
	TargetCount    int
	TargetSelected bool
	PhysicalReady  bool
	WriteActive    bool
	WriteComplete  bool
	ErrorMessageID creatorMessageID
}

type creatorExperienceView struct {
	Step            creatorExperienceStep
	StepNumber      int
	StepCount       int
	Eyebrow         string
	Title           string
	Body            string
	Detail          string
	PrimaryAction   string
	SecondaryAction string
	Illustration    string
	Destructive     bool
	CanContinue     bool
}

func creatorExperience(input creatorExperienceInput) creatorExperienceView {
	const steps = 4
	locale := currentCreatorLocale()
	t := func(id creatorMessageID) string { return creatorMessageFor(locale, id, nil) }

	if input.ErrorMessageID != "" {
		return creatorExperienceView{
			Step:            creatorStepBlocked,
			StepNumber:      0,
			StepCount:       steps,
			Eyebrow:         t(msgExperienceErrorEyebrow),
			Title:           t(msgExperienceErrorTitle),
			Body:            t(msgExperienceErrorBody),
			Detail:          t(input.ErrorMessageID),
			PrimaryAction:   t(msgActionRetry),
			SecondaryAction: t(msgActionClose),
			Illustration:    "shield-alert",
		}
	}

	if input.WriteComplete {
		return creatorExperienceView{
			Step:            creatorStepComplete,
			StepNumber:      steps,
			StepCount:       steps,
			Eyebrow:         t(msgCompleteEyebrow),
			Title:           t(msgCompleteTitle),
			Body:            t(msgCompleteBody),
			Detail:          t(msgCompleteDetail),
			PrimaryAction:   t(msgActionFinish),
			SecondaryAction: t(msgActionBootHelp),
			Illustration:    "usb-ready",
			CanContinue:     true,
		}
	}

	if input.WriteActive {
		return creatorExperienceView{
			Step:         creatorStepCreating,
			StepNumber:   steps,
			StepCount:    steps,
			Eyebrow:      t(msgCreatingEyebrow),
			Title:        t(msgCreatingTitle),
			Body:         t(msgCreatingBody),
			Detail:       t(msgCreatingDetail),
			Illustration: "write-progress",
			CanContinue:  false,
		}
	}

	if input.TargetCount == 0 {
		return creatorExperienceView{
			Step:          creatorStepConnect,
			StepNumber:    1,
			StepCount:     steps,
			Eyebrow:       t(msgConnectEyebrow),
			Title:         t(msgConnectTitle),
			Body:          t(msgConnectBody),
			Detail:        t(msgConnectDetail),
			PrimaryAction: t(msgActionReloadUSB),
			Illustration:  "usb-connect",
			CanContinue:   false,
		}
	}

	if !input.TargetSelected {
		return creatorExperienceView{
			Step:            creatorStepSelect,
			StepNumber:      2,
			StepCount:       steps,
			Eyebrow:         t(msgSelectEyebrow),
			Title:           t(msgSelectTitle),
			Body:            t(msgSelectBody),
			Detail:          t(msgSelectDetail),
			PrimaryAction:   t(msgActionContinue),
			SecondaryAction: t(msgActionReloadUSB),
			Illustration:    "usb-select",
			CanContinue:     false,
		}
	}

	if !input.PhysicalReady {
		return creatorExperienceView{
			Step:          creatorStepBlocked,
			StepNumber:    3,
			StepCount:     steps,
			Eyebrow:       t(msgBlockedEyebrow),
			Title:         t(msgBlockedTitle),
			Body:          t(msgBlockedBody),
			Detail:        t(msgBlockedDetail),
			PrimaryAction: t(msgActionReload),
			Illustration:  "shield-lock",
			CanContinue:   false,
		}
	}

	return creatorExperienceView{
		Step:            creatorStepReview,
		StepNumber:      3,
		StepCount:       steps,
		Eyebrow:         t(msgReviewEyebrow),
		Title:           t(msgReviewTitle),
		Body:            t(msgReviewBody),
		Detail:          t(msgReviewDetail),
		PrimaryAction:   t(msgActionCreate),
		SecondaryAction: t(msgActionBack),
		Illustration:    "shield-check",
		Destructive:     true,
		CanContinue:     true,
	}
}
