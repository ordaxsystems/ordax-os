//go:build windows && ordax_owner_prototype && ordax_single_exe && ordax_raw_backend

package main

import (
    "os"
    "path/filepath"
    "strings"
    "testing"
)

// Synthetic embedded provenance is supplied only by the Windows CI test.
// No OS image, physical USB enumeration or external writer is involved.
func TestOwnerStandaloneReadOnlyUsesInstalledExeWithoutStaging(t *testing.T) {
    oldVersion, oldCommit := buildCreatorVersion, buildCreatorSourceCommit
    defer func() { buildCreatorVersion, buildCreatorSourceCommit = oldVersion, oldCommit }()
    buildCreatorVersion = "0.6.6-dev"
    buildCreatorSourceCommit = strings.Repeat("b", 40)

    if _, err := decodeOwnerProvenance(); err != nil {
        t.Fatalf("synthetic embedded Owner provenance is invalid: %v", err)
    }
    if ownerRuntimeDir != "" || ownerRuntimeErr != nil {
        t.Fatal("read-only test started with a materialized physical runtime")
    }

    executable, err := os.Executable()
    if err != nil { t.Fatal(err) }
    directory, ok := ownerPrototypePhysicalBackend()
    if !ok || !strings.EqualFold(directory, filepath.Dir(executable)) {
        t.Fatalf("read-only backend must use installed EXE directory: %q (%v)", directory, ok)
    }
    direct, ok := ownerReadOnlyBackendExecutable(directory)
    if !ok || !strings.EqualFold(direct, executable) {
        t.Fatalf("read-only target must use installed EXE: %q (%v)", direct, ok)
    }
    if _, ok := ownerReadOnlyBackendExecutable(filepath.Dir(directory)); ok {
        t.Fatal("unrelated backend directory was accepted")
    }
    if ownerRuntimeDir != "" || ownerRuntimeErr != nil {
        t.Fatal("USB discovery unexpectedly materialized a second EXE or seed")
    }
}
