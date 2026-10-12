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
			if required.Optional || !signedInterfaceSatisfiesRequirement(provides, required) {
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

