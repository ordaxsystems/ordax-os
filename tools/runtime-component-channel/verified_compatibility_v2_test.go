package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectVerifiedSlotCompatibilityV2IsSignedAndReadOnly(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	trust, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	result, err := inspectVerifiedSlotCompatibilityV2(candidate.slot, trust)
	if err != nil {
		t.Fatal(err)
	}
	if result.Schema != verifiedSlotCompatibilitySchema ||
		result.Authority != "none" ||
		result.TrustScope != "caller-supplied-public-anchor" ||
		result.ActivationStatus != "not-evaluated" {
		t.Fatalf("inspection must not claim pinned trust or activation: %+v", result)
	}
	if result.ComponentID != "internet" ||
		result.Version != "1.0.0" ||
		result.SourceCommit != candidate.release.SourceCommit ||
		result.Descriptor.ComponentID != "internet" ||
		result.Descriptor.ComponentVersion != "1.0.0" ||
		len(result.Descriptor.Provides) != 1 ||
		result.Descriptor.Provides[0].ID != "ordax.internet" ||
		result.Descriptor.Provides[0].Major != 1 {
		t.Fatalf("inspection is not the exact signed compatibility: %+v", result)
	}
	// Staging/inspection must never arm or promote the slot.
	state, err := readActivationState(fixture.root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	if state.Current != nil || state.Pending != nil || state.Revision != 0 {
		t.Fatalf("read-only inspection mutated activation state: %+v", state)
	}
}

func TestInspectVerifiedSlotCompatibilityV2RejectsWrongTrustAndSidecarTamper(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	candidate := addActivationV2Candidate(
		t, fixture, "1.0.0", "1111111111111111111111111111111111111111",
	)
	trust, err := readRegular(fixture.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	other := makeActivationV2Fixture(t)
	wrongTrust, err := readRegular(other.trustPath, maxTrustBytes, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inspectVerifiedSlotCompatibilityV2(candidate.slot, wrongTrust); err == nil {
		t.Fatal("signed compatibility accepted foreign caller-supplied public key")
	}
	path := filepath.Join(candidate.slot, candidate.release.Compatibility.Name)
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	// Even a canonical JSON sidecar is rejected when its content differs
	// from the original signature-bound SHA-256.
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	revised := strings.Replace(string(data), "ordax.internet", "ordax.changed", 1)
	if revised == string(data) {
		t.Fatal("fixture did not contain the expected contract")
	}
	if err := os.WriteFile(path, []byte(revised), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectVerifiedSlotCompatibilityV2(candidate.slot, trust); err == nil {
		t.Fatal("inspection accepted tampered signed compatibility")
	}
}

func TestInspectSlotCompatibilityV2CommandValidatesArguments(t *testing.T) {
	for _, args := range [][]string{
		nil,
		{"--slot", "some/slot"},
		{"--trust", "some/trust"},
		{"--slot", "some/slot", "--trust", "some/trust", "extra"},
	} {
		if err := inspectSlotCompatibilityV2Command(args); err == nil {
			t.Fatalf("inspection accepted missing or unexpected arguments: %v", args)
		}
	}
}
