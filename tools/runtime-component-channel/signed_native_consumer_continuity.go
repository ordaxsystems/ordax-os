package main

import (
	"errors"
	"fmt"
)

// The graph lock is held by mutateActivationState before this is called.
// A signed release/2 peer requiring an interface that the target currently
// supplies must not be stranded by uninstall or rollback. Neither an
// unsigned report nor a caller-selected active-consumer subset can waive it.
func verifySignedNativeConsumerContinuityUnderGraphLock(
	root, componentID string,
	replacement []providedCompatibilityContract,
	trustBytes []byte,
) error {
	absolute, err := secureExistingDirectory(root)
	if err != nil {
		return err
	}
	graph, err := inspectActiveCompatibilityCatalogV2UnderGraphLock(absolute, trustBytes)
	if err != nil {
		return err
	}
	return checkSignedNativeConsumerContinuity(graph, componentID, replacement)
}

// Called only while the canonical graph lock is held by the Native
// activation writer. Reuse the same authenticated current-slot graph used
// for uninstall and rollback; there is no caller-controlled provider list.
// This checks requirements of the *incoming* signed release, not just the
// continuity of consumers of an outgoing provider.
func verifySignedNativeCandidateGraphUnderLock(
	root, componentID string,
	descriptor componentCompatibilityDescriptor,
	trustBytes []byte,
	replacingCurrent bool,
) error {
	absolute, err := secureExistingDirectory(root)
	if err != nil {
		return err
	}
	graph, err := inspectActiveCompatibilityCatalogV2UnderGraphLock(absolute, trustBytes)
	if err != nil {
		return err
	}
	if replacingCurrent {
		if err := checkSignedNativeConsumerContinuity(
			graph, componentID, descriptor.Provides,
		); err != nil {
			return err
		}
	}
	return checkSignedNativeCandidateRequirements(graph, componentID, descriptor.Requires)
}

// Host interfaces have distinct owners from independently signed components.
// The exact ABI declarations are generated from the canonical OS contract policy.
// Recognition here only classifies a dependency: no port is injected, no
// capability is granted, and component runtime health remains mandatory.
func declaredNativeHostInterfaceRequirement(required requiredCompatibilityContract) (bool, error) {
	major, ownedByHost := nativeHostInterfaceContractMajors[required.ID]
	if !ownedByHost {
		return false, nil
	}
	if major < required.MinMajor || major > required.MaxMajor {
		return true, fmt.Errorf(
			"component requires unsupported OS host interface %s@%d-%d (OS declares %d)",
			required.ID, required.MinMajor, required.MaxMajor, major,
		)
	}
	return true, nil
}

// A required provider is acceptable only when another currently installed
// release/2 slot actually signs a matching provided contract. A bundled
// fallback and release/1 have no equivalent attestation: neither may be
// silently counted as an available provider. Optional requires do not block.
func checkSignedNativeCandidateRequirements(
	graph activeCompatibilityCatalog,
	componentID string,
	requires []requiredCompatibilityContract,
) error {
	for _, required := range requires {
		if required.Optional {
			continue
		}
		hostInterface, err := declaredNativeHostInterfaceRequirement(required)
		if err != nil {
			return err
		}
		if hostInterface {
			// Host-owned interfaces are validated by the Native host at mount
			// and probation. Never invent a signed component slot for them.
			continue
		}
		available := false
		for _, peer := range graph.Components {
			if peer.ComponentID == componentID {
				// An incoming candidate cannot satisfy its own external requires.
				continue
			}
			if signedInterfaceSatisfiesRequirement(
				peer.VerifiedSlot.Descriptor.Provides, required,
			) {
				available = true
				break
			}
		}
		if !available {
			return fmt.Errorf(
				"component %s requires unavailable signed native provider %s@%d-%d",
				componentID, required.ID, required.MinMajor, required.MaxMajor,
			)
		}
	}
	return nil
}

// At first installation no current signed slot exists to compare. The
// candidate still needs signed provider checks at BOTH arm and promotion;
// otherwise a mandatory dependency can bypass every forward-upgrade gate.
// release/1 is a separate development-only protocol, never public proof.
func verifyFirstInstallNativeRequirementsUnderGraphLock(
	root, componentID string,
	candidate slotIdentity,
	previouslyRemoved bool,
	trustBytes []byte,
) error {
	slot, err := canonicalSlotPath(root, componentID, candidate)
	if err != nil {
		return err
	}
	schema, err := signedActivationSlotSchema(slot, trustBytes)
	if err != nil {
		return err
	}
	if schema == releaseSchema {
		return nil
	}
	if schema != releaseSchemaV2 {
		return errors.New("runtime component first-install signed schema is unsupported")
	}
	report, err := inspectVerifiedSlotCompatibilityV2(slot, trustBytes)
	if err != nil {
		return err
	}
	if report.ComponentID != componentID || report.Version != candidate.Version ||
		report.SourceCommit != candidate.SourceCommit {
		return errors.New("runtime component first-install signed compatibility identity changed")
	}
	// Current=nil is not proof of first-ever installation. Uninstall retains
	// user data and its source release identity in the very same canonical
	// activation state. Without the Supervisor and App Data recovery
	// transaction, a reinstall with a signed persistent-state contract
	// cannot assume those retained bytes are new or readable.
	//
	// Keep genuine first installs and stateless offline reinstalls working.
	// The guard is checked for both arm and healthy promotion under the
	// original activation graph lock; no separate installed-state registry.
	if previouslyRemoved && report.Descriptor.State != nil {
		return errors.New("runtime component stateful reinstall after uninstall requires verified device-state recovery transaction")
	}
	return verifySignedNativeCandidateGraphUnderLock(
		root, componentID, report.Descriptor, trustBytes, false,
	)
}

// This decision examines ONLY already installed, signed release/2 current
// slots. Bundled services and unaudited filesystem writers remain out of
// scope: the result never authorizes public release or bypasses system trust.
func checkSignedNativeConsumerContinuity(
	graph activeCompatibilityCatalog,
	componentID string,
	replacement []providedCompatibilityContract,
) error {
	var original *activationCompatibilitySnapshot
	for i := range graph.Components {
		if graph.Components[i].ComponentID == componentID {
			original = &graph.Components[i]
			break
		}
	}
	if original == nil {
		return errors.New("native consumer continuity requires signed active current slot")
	}
	provides := original.VerifiedSlot.Descriptor.Provides
	for _, peer := range graph.Components {
		if peer.ComponentID == componentID {
			continue
		}
		for _, required := range peer.VerifiedSlot.Descriptor.Requires {
			hostInterface, err := declaredNativeHostInterfaceRequirement(required)
			if err != nil {
				return err
			}
			if hostInterface || required.Optional || !signedInterfaceSatisfiesRequirement(provides, required) {
				continue
			}
			if signedInterfaceSatisfiesRequirement(replacement, required) {
				continue
			}
			alternative := false
			for _, other := range graph.Components {
				if other.ComponentID == componentID {
					continue
				}
				if signedInterfaceSatisfiesRequirement(
					other.VerifiedSlot.Descriptor.Provides, required,
				) {
					alternative = true
					break
				}
			}
			if !alternative {
				return fmt.Errorf(
					"cannot remove signed contract %s required by active component %s",
					required.ID, peer.ComponentID,
				)
			}
		}
	}
	return nil
}

func signedInterfaceSatisfiesRequirement(
	provided []providedCompatibilityContract,
	required requiredCompatibilityContract,
) bool {
	for _, offered := range provided {
		if offered.ID == required.ID &&
			offered.Major >= required.MinMajor &&
			offered.Major <= required.MaxMajor {
			return true
		}
	}
	return false
}

// A rollback destination must itself have a signed release/2 compatibility
// descriptor; release/1 is not treated as verified consumer compatibility.
func signedReplacementProvidesForRollback(
	root, componentID string,
	previous *slotIdentity,
	trustBytes []byte,
) ([]providedCompatibilityContract, error) {
	if previous == nil {
		return nil, nil
	}
	slot, err := canonicalSlotPath(root, componentID, *previous)
	if err != nil {
		return nil, err
	}
	report, err := inspectVerifiedSlotCompatibilityV2(slot, trustBytes)
	if err != nil {
		return nil, err
	}
	if report.ComponentID != componentID ||
		report.Version != previous.Version ||
		report.SourceCommit != previous.SourceCommit {
		return nil, errors.New("rollback replacement signed compatibility identity mismatch")
	}
	return report.Descriptor.Provides, nil
}
