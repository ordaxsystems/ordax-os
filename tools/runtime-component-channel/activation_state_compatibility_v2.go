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
		if candidate != nil {
			// The source compatibility evaluator permits a new owner, but
			// our actual rollback writer cannot yet restore an earlier
			// stateless current from a newly stateful release. Until the
			// Native state owner proves last-known-good recovery, do not
			// stage an upgrade that creates persistent state.
			return errors.New("runtime component candidate introduces persistent state without verified rollback")
		}
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
	// A readable schema range is not a crash-safe rollback strategy. Since
	// the canonical state owner cannot yet prove or restore the persisted
	// generation, even same-schema upgrades are unsafe to arm: otherwise a
	// healthy promotion could become a one-way migration. Revisit only
	// when system/services/state integrates verified last-known-good.
	return errors.New("runtime component stateful upgrade requires verified device-state recovery checkpoint")
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

// The full installed-provider graph is not yet transactionally attested.
// Until it is, upgrading a current signed release may not introduce a new
// mandatory provider or tighten a previously mandatory version interval.
// This follows the existing signed requires[] contract, not a separate
// component allowlist. Optional dependencies do not grant activation.
func validateForwardRequiredContracts(
	current, candidate []requiredCompatibilityContract,
) error {
	for _, next := range candidate {
		if next.Optional {
			continue
		}
		compatibleOldRequirement := false
		for _, old := range current {
			if old.ID == next.ID && !old.Optional &&
				next.MinMajor <= old.MinMajor &&
				next.MaxMajor >= old.MaxMajor {
				compatibleOldRequirement = true
				break
			}
		}
		if !compatibleOldRequirement {
			return errors.New("runtime component candidate adds or tightens a mandatory signed dependency without verified provider graph")
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
	if err := validateForwardRequiredContracts(
		before.Descriptor.Requires, after.Descriptor.Requires,
	); err != nil {
		return err
	}
	if err := validateForwardStateCompatibility(
		before.Descriptor.State, after.Descriptor.State,
	); err != nil {
		return err
	}
	// Re-read the canonical signed current graph while still locked.
	// A replacement must preserve its active consumers AND prove each
	// mandatory requirement of the incoming candidate has an installed,
	// signed release/2 provider. This cannot attest bundled components.
	return verifySignedNativeCandidateGraphUnderLock(
		root, componentID, after.Descriptor, trustBytes, true,
	)
}

// verifyUninstallStateSafety runs inside the canonical activation graph and
// per-component writer locks. Removing a signed stateful current slot without
// quiescing its app processes and coordinating the device-state checkpoint
// would leave live writers operating on a logically absent installation.
//
// An unretired checkpoint alone cannot prove process quiescence or authorize
// a signed activation decision. Until Supervisor, the Go writer and the App
// Data owner share one recoverable transaction, reject both initial removal
// and an idempotent retry claiming previously completed stateful removal.
func verifyUninstallStateSafety(
	root, componentID string,
	identity slotIdentity,
	trustBytes []byte,
) error {
	slot, err := canonicalSlotPath(root, componentID, identity)
	if err != nil {
		return err
	}
	schema, err := signedActivationSlotSchema(slot, trustBytes)
	if err != nil {
		return err
	}
	if schema == releaseSchema {
		// Preserve development release/1 behavior; it has no signed
		// persistent-state contract and grants no production authority.
		return nil
	}
	if schema != releaseSchemaV2 {
		return errors.New("runtime component uninstall signed release schema is unsupported")
	}
	report, err := inspectVerifiedSlotCompatibilityV2(slot, trustBytes)
	if err != nil {
		return err
	}
	if report.ComponentID != componentID ||
		report.Version != identity.Version ||
		report.SourceCommit != identity.SourceCommit {
		return errors.New("runtime component uninstall signed state contract identity changed")
	}
	if report.Descriptor.State != nil {
		return errors.New("runtime component stateful uninstall requires verified Supervisor quiescence and device-state recovery transaction")
	}
	return nil
}
