package main

import (
	"strings"
	"testing"
)

func TestReleaseV2CLIRequiresExplicitCompatibilityInputs(t *testing.T) {
	tests := []struct {
		name string
		call func([]string) error
		want string
	}{
		{name: "sign-v2", call: signV2Command, want: "sign-v2 requires"},
		{name: "verify-envelope-v2", call: verifyEnvelopeV2Command, want: "verify-envelope-v2 requires"},
		{name: "stage-v2", call: stageV2Command, want: "stage-v2 requires"},
		{name: "verify-slot-v2", call: verifySlotV2Command, want: "verify-slot-v2 requires"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.call(nil)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want substring %q", err, test.want)
			}
		})
	}
}
