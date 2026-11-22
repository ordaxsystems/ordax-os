package creatorcore

import (
    "os"
    "path/filepath"
    "testing"
)

// canonicalContractPathForTest separates ordinary offline Core tests from
// read-only integration tests against the exact pinned OS contract source.
// Without external inputs, only integration-dependent cases are skipped.
// An explicitly configured but missing contract root fails, never skips.
func canonicalContractPathForTest(t *testing.T, name string) string {
    t.Helper()
    root := os.Getenv("ORDAX_OS_CONTRACTS_DIR")
    if root == "" {
        t.Skip("OS contract integration test requires ORDAX_OS_CONTRACTS_DIR from exact revision")
    }
    info, err := os.Stat(root)
    if err != nil || !info.IsDir() {
        t.Fatalf("canonical OS contract directory is unavailable: %v", err)
    }
    return filepath.Join(root, name)
}
