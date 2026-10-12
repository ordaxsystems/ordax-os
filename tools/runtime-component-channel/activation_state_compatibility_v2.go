package main

import "errors"

// The native activation writer must enforce the state-local portion of the
// canonical system/contracts/component-update-compatibility.mjs evaluator.
// No native state-migration implementation is currently registered, so an
// upgrade requiring data migration is rejected before pending activation.
// This complements (but does not replace) full active-consumer verification.
func validateForwardStateCompatibility(
	current, candidate *compatibilityState,
) error {
	if current == nil {
		// New state ownership is allowed by the canonical source contract.
		return nil
	}
	if candidate == nil {
		return errors.New("runtime component candidate removes an existing state owner")
	}
	if current.ID != candidate.ID {
		return errors.New("runtime component candidate changes state owner without verified migration")
	}
	if current.WriteVersion != candidate.WriteVersion {
		return errors.New("runtime component candidate changes state write version without verified migration")
	}
	if current.WriteVersion < candidate.ReadableFrom ||
		current.WriteVersion > candidate.ReadableThrough {
		return errors.New("runtime component candidate cannot read current signed state version")
	}
	return nil
}

// With bundled consumers not yet independently attested, a signed upgrade
// must retain every previously offered contract at its prior major version.
// This is a conservative native floor, not an invented declaration of
// complete consumer compatibility or an alternate contract catalog.
func validateForwardProvidedContracts(
	current, candidate []providedCompatibilityContract,
) error {
	for _, existing := range current {
		preserved := false
		for _, next := range candidate {
			if next.ID == existing.ID && next.Major == existing.Major {
				preserved = true
				break
			}
		}
		if !preserved {
			return errors.New("runtime component candidate drops an existing signed provided contract")
		}
	}
	return nil
}

// Called only from the existing activation-state mutation lock. The current
// and candidate slots must both be signed with the caller's public trust.
// Crossing signed schema generations is not silently compatible.
func verifyArmPendingStateCompatibility(
	root, componentID string,
	current slotIdentity,
	candidate slotIdentity,
	trustBytes []byte,
) error {
	currentSlot, err := canonicalSlotPath(root, componentID, current)
	if err != nil {
		return err
	}
	candidateSlot, err := canonicalSlotPath(root, componentID, candidate)
	if err != nil {
		return err
	}
	currentSchema, err := signedActivationSlotSchema(currentSlot, trustBytes)
	if err != nil {
		return err
	}
	candidateSchema, err := signedActivationSlotSchema(candidateSlot, trustBytes)
	if err != nil {
		return err
	}
	if currentSchema != candidateSchema {
		return errors.New("runtime component activation across signed release schemas requires explicit compatibility proof")
	}
	if currentSchema == releaseSchema {
		// Preserve release/1 development behavior without falsely inventing
		// compatibility sidecars. Production activation remains disabled.
		return nil
	}
	if currentSchema != releaseSchemaV2 {
		return errors.New("runtime component activation signed release schema is unsupported")
	}
	before, err := inspectVerifiedSlotCompatibilityV2(currentSlot, trustBytes)
	if err != nil {
		return err
	}
	after, err := inspectVerifiedSlotCompatibilityV2(candidateSlot, trustBytes)
	if err != nil {
		return err
	}
	if before.ComponentID != componentID || after.ComponentID != componentID ||
		before.Version != current.Version || before.SourceCommit != current.SourceCommit ||
		after.Version != candidate.Version || after.SourceCommit != candidate.SourceCommit {
		return errors.New("runtime component activation signed state contract identity changed")
	}
	if err := validateForwardProvidedContracts(
		before.Descriptor.Provides, after.Descriptor.Provides,
	); err != nil {
		return err
	}
	return validateForwardStateCompatibility(before.Descriptor.State, after.Descriptor.State)
}
