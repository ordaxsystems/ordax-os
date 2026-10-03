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
	Error          string
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

	if input.Error != "" {
		return creatorExperienceView{
			Step:            creatorStepBlocked,
			StepNumber:      0,
			StepCount:       steps,
			Eyebrow:         creatorT(msgExperienceErrorEyebrow),
			Title:           creatorT(msgExperienceErrorTitle),
			Body:            creatorT(msgExperienceErrorBody),
			Detail:          input.Error,
			PrimaryAction:   creatorT(msgActionRetry),
			SecondaryAction: creatorT(msgActionClose),
			Illustration:    "shield-alert",
		}
	}

	if input.WriteComplete {
		return creatorExperienceView{
			Step:            creatorStepComplete,
			StepNumber:      steps,
			StepCount:       steps,
			Eyebrow:         creatorT(msgCompleteEyebrow),
			Title:           creatorT(msgCompleteTitle),
			Body:            creatorT(msgCompleteBody),
			Detail:          creatorT(msgCompleteDetail),
			PrimaryAction:   creatorT(msgActionFinish),
			SecondaryAction: creatorT(msgActionBootHelp),
			Illustration:    "usb-ready",
			CanContinue:     true,
		}
	}

	if input.WriteActive {
		return creatorExperienceView{
			Step:         creatorStepCreating,
			StepNumber:   steps,
			StepCount:    steps,
			Eyebrow:      creatorT(msgCreatingEyebrow),
			Title:        creatorT(msgCreatingTitle),
			Body:         creatorT(msgCreatingBody),
			Detail:       creatorT(msgCreatingDetail),
			Illustration: "write-progress",
			CanContinue:  false,
		}
	}

	if input.TargetCount == 0 {
		return creatorExperienceView{
			Step:          creatorStepConnect,
			StepNumber:    1,
			StepCount:     steps,
			Eyebrow:       creatorT(msgConnectEyebrow),
			Title:         creatorT(msgConnectTitle),
			Body:          creatorT(msgConnectBody),
			Detail:        creatorT(msgConnectDetail),
			PrimaryAction: creatorT(msgActionReloadUSB),
			Illustration:  "usb-connect",
			CanContinue:   false,
		}
	}

	if !input.TargetSelected {
		return creatorExperienceView{
			Step:            creatorStepSelect,
			StepNumber:      2,
			StepCount:       steps,
			Eyebrow:         creatorT(msgSelectEyebrow),
			Title:           creatorT(msgSelectTitle),
			Body:            creatorT(msgSelectBody),
			Detail:          creatorT(msgSelectDetail),
			PrimaryAction:   creatorT(msgActionContinue),
			SecondaryAction: creatorT(msgActionReloadUSB),
			Illustration:    "usb-select",
			CanContinue:     false,
		}
	}

	if !input.PhysicalReady {
		return creatorExperienceView{
			Step:          creatorStepBlocked,
			StepNumber:    3,
			StepCount:     steps,
			Eyebrow:       creatorT(msgBlockedEyebrow),
			Title:         creatorT(msgBlockedTitle),
			Body:          creatorT(msgBlockedBody),
			Detail:        creatorT(msgBlockedDetail),
			PrimaryAction: creatorT(msgActionReload),
			Illustration:  "shield-lock",
			CanContinue:   false,
		}
	}

	return creatorExperienceView{
		Step:            creatorStepReview,
		StepNumber:      3,
		StepCount:       steps,
		Eyebrow:         creatorT(msgReviewEyebrow),
		Title:           creatorT(msgReviewTitle),
		Body:            creatorT(msgReviewBody),
		Detail:          creatorT(msgReviewDetail),
		PrimaryAction:   creatorT(msgActionCreate),
		SecondaryAction: creatorT(msgActionBack),
		Illustration:    "shield-check",
		Destructive:     true,
		CanContinue:     true,
	}
}
