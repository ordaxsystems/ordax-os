package main

import (
	"errors"
	"path/filepath"
)

// Rollback is not automatically data-safe merely because the previous slot
// still verifies cryptographically. In particular, a prior component may not
// understand state written by a newer release. This guard reads only signed
// release/2 compatibility sidecars from the canonical activation slots and
// runs inside the existing activation mutation lock.
func verifyRollbackStateReadable(
	root, componentID string,
	current slotIdentity,
	previous *slotIdentity,
	trustBytes []byte,
) error {
	currentSlot, err := canonicalSlotPath(root, componentID, current)
	if err != nil {
		return err
	}
	currentSchema, err := signedActivationSlotSchema(currentSlot, trustBytes)
	if err != nil {
		return err
	}

	var previousSlot string
	if previous != nil {
		previousSlot, err = canonicalSlotPath(root, componentID, *previous)
		if err != nil {
			return err
		}
		previousSchema, err := signedActivationSlotSchema(previousSlot, trustBytes)
		if err != nil {
			return err
		}
		if previousSchema != currentSchema {
			// No evidence that an older release/1 and release/2 have a
			// compatible state contract. Do not assume compatibility.
			return errors.New("runtime component rollback across release schemas requires explicit state compatibility proof")
		}
	}

	if currentSchema == releaseSchema {
		// Preserve existing release/1 behavior: it has no versioned
		// compatibility sidecar. Do not fabricate a state contract for it.
		return nil
	}
	if currentSchema != releaseSchemaV2 {
		return errors.New("runtime component rollback release schema is unsupported")
	}

	currentReport, err := inspectVerifiedSlotCompatibilityV2(currentSlot, trustBytes)
	if err != nil {
		return err
	}
	if currentReport.ComponentID != componentID ||
		currentReport.Version != current.Version ||
		currentReport.SourceCommit != current.SourceCommit {
		return errors.New("runtime component rollback current signed identity changed")
	}
	currentState := currentReport.Descriptor.State
	if previous == nil {
		if currentState != nil {
			return errors.New("runtime component rollback to bundled fallback cannot prove state readability")
		}
		return nil
	}

	previousReport, err := inspectVerifiedSlotCompatibilityV2(previousSlot, trustBytes)
	if err != nil {
		return err
	}
	if previousReport.ComponentID != componentID ||
		previousReport.Version != previous.Version ||
		previousReport.SourceCommit != previous.SourceCommit {
		return errors.New("runtime component rollback previous signed identity changed")
	}

	previousState := previousReport.Descriptor.State
	if currentState == nil && previousState == nil {
		return nil
	}
	if currentState == nil || previousState == nil ||
		currentState.ID != previousState.ID ||
		currentState.WriteVersion < previousState.ReadableFrom ||
		currentState.WriteVersion > previousState.ReadableThrough {
		return errors.New("runtime component rollback target cannot read current signed state contract")
	}
	return nil
}

func signedActivationSlotSchema(slot string, trustBytes []byte) (string, error) {
	envelope, err := readRegular(filepath.Join(slot, slotEnvelopeName), maxEnvelopeBytes, false)
	if err != nil {
		return "", err
	}
	return signedReleaseSchemaForActivation(envelope, trustBytes)
}
