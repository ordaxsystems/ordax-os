package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// No second installed-state authority is created. The graph lock serializes
// the existing per-component activation-state writers and native inventory
// readers so two components cannot change current identities mid-snapshot.
func TestActivationGraphLockSerializesIndependentComponentWriters(t *testing.T) {
	root := t.TempDir()
	releaseGraph, err := acquireActivationGraphLock(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, componentID := range []string{"internet", "notes"} {
		_, err := mutateActivationState(root, componentID, func(state activationState) (activationState, error) {
			state.Revision++
			return state, nil
		})
		if err == nil || !strings.Contains(err.Error(), "graph is already locked") {
			t.Fatalf("writer for %s bypassed shared lock: %v", componentID, err)
		}
		unchanged, readErr := readActivationState(root, componentID)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if unchanged.Revision != 0 {
			t.Fatalf("writer %s changed state while graph was held: %+v", componentID, unchanged)
		}
	}
	if _, err := inspectActiveCompatibilityCatalogV2(root, nil); err == nil ||
		!strings.Contains(err.Error(), "graph is already locked") {
		t.Fatalf("read-only native catalog bypassed graph lock: %v", err)
	}
	releaseGraph()
	for _, componentID := range []string{"internet", "notes"} {
		state, err := mutateActivationState(root, componentID, func(value activationState) (activationState, error) {
			value.Revision++
			return value, nil
		})
		if err != nil || state.Revision != 1 {
			t.Fatalf("activation writer did not resume after graph release for %s: %v %+v", componentID, err, state)
		}
	}
	if _, err := os.Lstat(filepath.Join(root, activationGraphLockName)); !os.IsNotExist(err) {
		t.Fatalf("shared graph lock remains after completed writes: %v", err)
	}
	report, err := inspectActiveCompatibilityCatalogV2(root, []byte("non-pinned unused test trust"))
	if err != nil {
		t.Fatal(err)
	}
	if report.CompleteForActivation || report.Authority != "none" ||
		len(report.Components) != 0 {
		t.Fatalf("global consistent native readout claimed activation authority: %+v", report)
	}
}

func TestActivationGraphLockIsReleasedIfLocalWriterFails(t *testing.T) {
	root := t.TempDir()
	releaseComponent, err := acquireActivationLock(root, "internet")
	if err != nil {
		t.Fatal(err)
	}
	_, err = mutateActivationState(root, "internet", func(value activationState) (activationState, error) {
		t.Fatal("callback executed despite occupied canonical component lock")
		return value, nil
	})
	if err == nil || !strings.Contains(err.Error(), "mutation is already locked") {
		t.Fatalf("component-local writer bypassed lock: %v", err)
	}
	// Lock order is global -> component. Failed component lock acquisition
	// must release the global lock, not deadlock unrelated services.
	other, err := mutateActivationState(root, "notes", func(value activationState) (activationState, error) {
		value.Revision++
		return value, nil
	})
	if err != nil || other.Revision != 1 {
		t.Fatalf("a rejected local writer stranded the global graph lock: %v %+v", err, other)
	}
	releaseComponent()
	if _, err := os.Lstat(filepath.Join(root, activationGraphLockName)); !os.IsNotExist(err) {
		t.Fatalf("global graph lock remains after local error: %v", err)
	}
}

func TestActivationGraphLockFailsClosedOnUnsafeOrStaleMetadata(t *testing.T) {
	root := t.TempDir()
	lockPath := filepath.Join(root, activationGraphLockName)
	if err := os.WriteFile(lockPath, []byte("untrusted"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := acquireActivationGraphLock(root); err == nil {
		t.Fatal("accepted regular file at graph lock path")
	}
	if _, err := inspectActiveCompatibilityCatalogV2(root, nil); err == nil {
		t.Fatal("native catalog accepted unsafe graph lock path")
	}
	if err := os.Remove(lockPath); err != nil {
		t.Fatal(err)
	}
	releaseGraph, err := acquireActivationGraphLock(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acquireActivationGraphLock(root); err == nil {
		releaseGraph()
		t.Fatal("graph lock can be acquired twice concurrently")
	}
	releaseGraph()
}
