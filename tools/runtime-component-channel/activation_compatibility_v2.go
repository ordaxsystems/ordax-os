package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"reflect"
)

const activationCompatibilitySnapshotSchema = "ordax.activation-slot-compatibility-snapshot/1"

// This is a read-only projection of the EXISTING activation-state.json.
// No second installed-component registry or activation authority is created.
type activationCompatibilitySnapshot struct {
	Schema          string                        `json:"schema"`
	Authority       string                        `json:"authority"`
	ComponentID     string                        `json:"componentId"`
	Target          string                        `json:"target"`
	Revision        int64                         `json:"revision"`
	PendingHealth   string                        `json:"pendingHealth"`
	TrustScope      string                        `json:"trustScope"`
	TrustSHA256     string                        `json:"trustSHA256"`
	VerifiedSlot    verifiedSlotCompatibility     `json:"verifiedSlot"`
}

// inspectActiveCompatibilityV2 binds a cryptographically verified release/2
// descriptor to the selected canonical activation-state identity and revision.
// It never makes the supplied trust public key the system's pinned authority.
func inspectActiveCompatibilityV2(
	root, componentID, target string, expectedRevision int64, trustBytes []byte,
) (activationCompatibilitySnapshot, error) {
	if !componentPattern.MatchString(componentID) {
		return activationCompatibilitySnapshot{}, errors.New("activation compatibility component id is invalid")
	}
	if target != "current" && target != "pending" {
		return activationCompatibilitySnapshot{}, errors.New("activation compatibility target must be current or pending")
	}
	if expectedRevision < 1 {
		return activationCompatibilitySnapshot{}, errors.New("activation compatibility requires explicit positive expected revision")
	}
	initial, err := readActivationState(root, componentID)
	if err != nil {
		return activationCompatibilitySnapshot{}, err
	}
	if initial.Revision != expectedRevision {
		return activationCompatibilitySnapshot{}, errors.New("activation compatibility revision is stale")
	}
	if initial.UserRemoved && target == "current" {
		return activationCompatibilitySnapshot{}, errors.New("removed component has no current activation")
	}
	var identity *slotIdentity
	switch target {
	case "current":
		identity = initial.Current
	case "pending":
		identity = initial.Pending
	}
	if identity == nil {
		return activationCompatibilitySnapshot{}, errors.New("activation compatibility selected slot is absent")
	}
	slot, err := canonicalSlotPath(root, componentID, *identity)
	if err != nil {
		return activationCompatibilitySnapshot{}, err
	}
	verified, err := inspectVerifiedSlotCompatibilityV2(slot, trustBytes)
	if err != nil {
		return activationCompatibilitySnapshot{}, err
	}
	if verified.ComponentID != componentID ||
		verified.Version != identity.Version ||
		verified.SourceCommit != identity.SourceCommit {
		return activationCompatibilitySnapshot{}, errors.New("verified release/2 does not match exact activation identity")
	}
	// A concurrent writer is detected before returning the diagnostic snapshot.
	// This is not a substitute for lock/revision rechecking in arm/promote.
	latest, err := readActivationState(root, componentID)
	if err != nil {
		return activationCompatibilitySnapshot{}, err
	}
	if !reflect.DeepEqual(initial, latest) {
		return activationCompatibilitySnapshot{}, errors.New("activation compatibility state changed during inspection")
	}
	digest := sha256.Sum256(trustBytes)
	return activationCompatibilitySnapshot{
		Schema:        activationCompatibilitySnapshotSchema,
		Authority:     "none",
		ComponentID:   componentID,
		Target:        target,
		Revision:      initial.Revision,
		PendingHealth: initial.PendingHealth,
		TrustScope:    "caller-supplied-public-anchor",
		TrustSHA256:   hex.EncodeToString(digest[:]),
		VerifiedSlot:  verified,
	}, nil
}

func inspectActiveCompatibilityV2Command(args []string) error {
	flags := flag.NewFlagSet("inspect-activation-compatibility-v2", flag.ContinueOnError)
	root := flags.String("root", defaultSlotRoot, "canonical runtime component root")
	componentID := flags.String("component", "", "canonical component id")
	target := flags.String("target", "", "current or pending activation")
	trustPath := flags.String("trust", "", "caller-supplied public component trust")
	revision := flags.Int64("expected-revision", 0, "expected canonical activation-state revision")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *componentID == "" || *target == "" || *trustPath == "" || *revision < 1 || flags.NArg() != 0 {
		return errors.New("inspect-activation-compatibility-v2 requires --component, --target, --trust, --expected-revision and no extra arguments")
	}
	trustBytes, err := readRegular(*trustPath, maxTrustBytes, false)
	if err != nil {
		return err
	}
	result, err := inspectActiveCompatibilityV2(*root, *componentID, *target, *revision, trustBytes)
	if err != nil {
		return err
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		return fmt.Errorf("output activation compatibility diagnostic: %w", err)
	}
	return nil
}
