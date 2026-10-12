package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"reflect"
)

const activeCompatibilityCatalogSchema = "ordax.active-slot-compatibility-catalog/1"
const maxActiveCompatibilityEntries = 128

// Only the signed CURRENT component-slot installations can be derived from
// the existing activation-state owner. Bundled services and release/1 slots
// do not have this evidence and must never be silently deemed compatible.
type activeCompatibilityCatalog struct {
	Schema                string                            `json:"schema"`
	Authority             string                            `json:"authority"`
	Scope                 string                            `json:"scope"`
	CompleteForActivation bool                              `json:"completeForActivation"`
	TrustScope            string                            `json:"trustScope"`
	Components            []activationCompatibilitySnapshot `json:"components"`
}

// A snapshot of signed current slots serialized against *all native
// activation-state writers* through the existing component root. The lock
// guarantees an internally consistent observation for cooperating native
// writers, NOT lasting authority after return, bundled-service coverage,
// protection against external filesystem edits, or a release grant.
// Native must still lock/revalidate the complete graph at arm-pending time.
func inspectActiveCompatibilityCatalogV2(
	root string, trustBytes []byte,
) (activeCompatibilityCatalog, error) {
	absolute, err := secureExistingDirectory(root)
	if err != nil {
		return activeCompatibilityCatalog{}, err
	}
	releaseGraph, err := acquireActivationGraphLock(absolute)
	if err != nil {
		return activeCompatibilityCatalog{}, err
	}
	defer releaseGraph()
	entries, err := os.ReadDir(absolute)
	if err != nil {
		return activeCompatibilityCatalog{}, err
	}
	if len(entries) > maxActiveCompatibilityEntries+1 {
		return activeCompatibilityCatalog{}, errors.New("active component root exceeds audit bound")
	}

	result := activeCompatibilityCatalog{
		Schema:                activeCompatibilityCatalogSchema,
		Authority:             "none",
		Scope:                 "signed-independent-current-slots-only",
		CompleteForActivation: false,
		TrustScope:            "caller-supplied-public-anchor",
		Components:            make([]activationCompatibilitySnapshot, 0),
	}
	// Retain source state for a second-pass check. The output is explicitly
	// incomplete even when all observations remain unchanged.
	observed := make(map[string]activationState)
	for _, entry := range entries {
		if entry.Name() == activationGraphLockName {
			if !entry.IsDir() {
				return activeCompatibilityCatalog{}, errors.New("active component graph lock has unsafe file type")
			}
			continue
		}
		if !componentPattern.MatchString(entry.Name()) || !entry.IsDir() {
			return activeCompatibilityCatalog{}, fmt.Errorf(
				"active component root has unsupported or unsafe entry: %q", entry.Name(),
			)
		}
		state, err := readActivationState(absolute, entry.Name())
		if err != nil {
			return activeCompatibilityCatalog{}, err
		}
		observed[entry.Name()] = state
		if state.Current == nil {
			continue
		}
		report, err := inspectActiveCompatibilityV2(
			absolute, entry.Name(), "current", state.Revision, trustBytes,
		)
		if err != nil {
			return activeCompatibilityCatalog{}, err
		}
		result.Components = append(result.Components, report)
	}
	finalEntries, err := os.ReadDir(absolute)
	if err != nil {
		return activeCompatibilityCatalog{}, err
	}
	if !reflect.DeepEqual(entries, finalEntries) {
		return activeCompatibilityCatalog{}, errors.New("active component root changed during inspection")
	}
	for id, original := range observed {
		now, err := readActivationState(absolute, id)
		if err != nil {
			return activeCompatibilityCatalog{}, err
		}
		if !reflect.DeepEqual(original, now) {
			return activeCompatibilityCatalog{}, fmt.Errorf(
				"activation state for %q changed during active catalog inspection", id,
			)
		}
	}
	return result, nil
}

func inspectActiveCompatibilityCatalogV2Command(args []string) error {
	flags := flag.NewFlagSet("inspect-active-compatibility-catalog-v2", flag.ContinueOnError)
	root := flags.String("root", defaultSlotRoot, "canonical component root")
	trust := flags.String("trust", "", "caller-supplied public component trust")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *trust == "" || flags.NArg() != 0 {
		return errors.New("inspect-active-compatibility-catalog-v2 requires --trust and no positional arguments")
	}
	trustBytes, err := readRegular(*trust, maxTrustBytes, false)
	if err != nil {
		return err
	}
	value, err := inspectActiveCompatibilityCatalogV2(*root, trustBytes)
	if err != nil {
		return err
	}
	if err := json.NewEncoder(os.Stdout).Encode(value); err != nil {
		return fmt.Errorf("write active signed compatibility catalog: %w", err)
	}
	return nil
}
