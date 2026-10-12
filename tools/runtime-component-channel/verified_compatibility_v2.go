package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

const verifiedSlotCompatibilitySchema = "ordax.verified-slot-compatibility/1"

// This result is verified against caller-supplied public trust. It is not a
// system-pinned trust assertion, activation receipt, installed-state snapshot,
// or grant to stage/promote the component.
type verifiedSlotCompatibility struct {
	Schema           string                           `json:"schema"`
	Authority        string                           `json:"authority"`
	TrustScope       string                           `json:"trustScope"`
	ActivationStatus string                           `json:"activationStatus"`
	ComponentID      string                           `json:"componentId"`
	Version          string                           `json:"version"`
	SourceCommit     string                           `json:"sourceCommit"`
	Descriptor       componentCompatibilityDescriptor `json:"descriptor"`
}

func inspectVerifiedSlotCompatibilityV2(
	slot string,
	trustBytes []byte,
) (verifiedSlotCompatibility, error) {
	// The existing verifier checks the signed release/2 envelope, package
	// manifest, every package file, immutable slot and sidecar hash.
	release, err := verifySlotV2WithTrustBytes(slot, trustBytes)
	if err != nil {
		return verifiedSlotCompatibility{}, err
	}
	absolute, err := filepath.Abs(slot)
	if err != nil {
		return verifiedSlotCompatibility{}, err
	}
	// Read again after verification; bind the bytes returned to the signed
	// compatibility SHA-256 to prevent a substituted or racing sidecar.
	bytes, err := readRegular(
		filepath.Join(absolute, release.Compatibility.Name),
		maxCompatibilityBytes,
		false,
	)
	if err != nil {
		return verifiedSlotCompatibility{}, err
	}
	if err := validateCompatibilityBytes(
		release,
		release.Compatibility.Name,
		bytes,
	); err != nil {
		return verifiedSlotCompatibility{}, err
	}
	var descriptor componentCompatibilityDescriptor
	if err := decodeStrict(bytes, int(maxCompatibilityBytes), &descriptor); err != nil {
		return verifiedSlotCompatibility{}, err
	}
	return verifiedSlotCompatibility{
		Schema:           verifiedSlotCompatibilitySchema,
		Authority:        "none",
		TrustScope:       "caller-supplied-public-anchor",
		ActivationStatus: "not-evaluated",
		ComponentID:      release.Component.ID,
		Version:          release.Component.Version,
		SourceCommit:     release.SourceCommit,
		Descriptor:       descriptor,
	}, nil
}

func inspectSlotCompatibilityV2Command(args []string) error {
	flags := flag.NewFlagSet("inspect-slot-compatibility-v2", flag.ContinueOnError)
	slot := flags.String("slot", "", "staged or installed immutable runtime component release/2 slot")
	trustPath := flags.String("trust", "", "runtime component public trust file")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *slot == "" || *trustPath == "" || flags.NArg() != 0 {
		return errors.New("inspect-slot-compatibility-v2 requires --slot and --trust")
	}
	trustBytes, err := readRegular(*trustPath, maxTrustBytes, false)
	if err != nil {
		return err
	}
	report, err := inspectVerifiedSlotCompatibilityV2(*slot, trustBytes)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(report); err != nil {
		return fmt.Errorf("write verified slot compatibility report: %w", err)
	}
	return nil
}
