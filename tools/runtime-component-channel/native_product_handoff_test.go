package main

import (
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "os"
    "path/filepath"
    "runtime"
    "strings"
    "testing"
)

func nativeProductHandoffFixture(t *testing.T) (string, string, string, string, string) {
    t.Helper()
    fixture := nativePackageFixture(t, true, 0o555)
    root := filepath.Join(fixture.dir, "slots")
    t.Cleanup(func() { allowTestTreeCleanup(root) })
    _, slot, changed, err := stageComponent(
        fixture.envelopePath, fixture.trustPath, fixture.packagePath, root,
    )
    if err != nil || !changed { t.Fatalf("signed stage: %v", err) }
    lock := nativeProductSourceLock{}
    lock.Schema = productRuntimeLockSchema
    lock.Source.Repository = productRuntimeSourceURL
    lock.Source.Commit = testSourceCommit
    lock.CandidateEvidence.SourceCommit = testSourceCommit
    executable, err := os.ReadFile(filepath.Join(slot, filepath.FromSlash(productRuntimeExecutablePath)))
    if err != nil { t.Fatal(err) }
    binaryDigest := sha256.Sum256(executable)
    lock.CandidateEvidence.ExecutableSHA256 = hex.EncodeToString(binaryDigest[:])
    lock.CandidateEvidence.ExecutableSizeBytes = int64(len(executable))
    lock.CandidateEvidence.IndependentBaseABIReady = true // fixture only; never physical evidence
    lock.CandidateEvidence.IndependentBaseABIBlockers = []string{}
    lock.CandidateEvidence.SignedDistributionAuthorized = true
    lock.CandidateEvidence.EmbeddedELFInventory.IndependentBaseCompatibilityProven = true
    lock.CandidateEvidence.EmbeddedELFInventory.InstallAuthorized = true
    lock.Distribution.RuntimeArtifactClaimed = true
    lock.Distribution.SignedRuntimeSlotAvailable = true
    lock.Activation.RequiresSignedRuntimeSlot = true
    lock.Activation.RequiresRuntimeHealthProof = true
    lock.Activation.RequiresNativePolicy = true
    lock.Activation.RequiresOAuthGrants = true
    lock.Activation.RequiresDeviceGrants = true

    trust, err := os.ReadFile(fixture.trustPath)
    if err != nil { t.Fatal(err) }
    digest := sha256.Sum256(trust)
    policy := nativeProductTrustPolicy{}
    policy.Schema = productRuntimeTrustPolicySchema
    policy.Status = "canonical-public-trust-pinned"
    policy.TrustDomain = "runtime-components"
    policy.PublicAnchor.Pinned = true
    policy.PublicAnchor.SHA256 = hex.EncodeToString(digest[:])
    policy.CurrentGates.CanonicalComponentTrustAnchorPinned = true
    lockFile := filepath.Join(fixture.dir, "source-lock.json")
    policyFile := filepath.Join(fixture.dir, "trust-policy.json")
    save := func(path string, obj any) {
        t.Helper()
        data, err := json.Marshal(obj)
        if err != nil { t.Fatal(err) }
        if err := os.WriteFile(path, data, 0o600); err != nil { t.Fatal(err) }
    }
    save(lockFile, lock)
    save(policyFile, policy)
    return lockFile, policyFile, fixture.trustPath, root, slot
}

func TestNativeProductHandoffCurrentSourceLockStaysClosed(t *testing.T) {
    source := filepath.Join("..", "..", "system", "services", "device-agent", "studio-runtime-source-lock.json")
    data, err := os.ReadFile(source)
    if err != nil { t.Fatal(err) }
    var lock nativeProductSourceLock
    if err := json.Unmarshal(data, &lock); err != nil { t.Fatal(err) }
    if err := validateNativeProductSourceLock(lock); err == nil ||
        !strings.Contains(err.Error(), "ABI/distribution not proven") {
        t.Fatalf("unsigned, non-ABI-ready OS source lock authorized handoff: %v", err)
    }
}

func TestNativeProductHandoffRejectsContradictoryABIEvidence(t *testing.T) {
    lockPath, _, _, _, _ := nativeProductHandoffFixture(t)
    data, err := os.ReadFile(lockPath)
    if err != nil { t.Fatal(err) }
    var lock nativeProductSourceLock
    if err := json.Unmarshal(data, &lock); err != nil { t.Fatal(err) }
    // ABI success flags must not erase an explicitly recorded blocker.
    lock.CandidateEvidence.IndependentBaseABIBlockers = []string{"external-shared-libraries"}
    if err := validateNativeProductSourceLock(lock); err == nil ||
        !strings.Contains(err.Error(), "unresolved independent base ABI blockers") {
        t.Fatalf("contradictory ABI proof accepted: %v", err)
    }
    // Omitting the evidence array is not an affirmative zero-blocker proof.
    lock.CandidateEvidence.IndependentBaseABIBlockers = nil
    if err := validateNativeProductSourceLock(lock); err == nil ||
        !strings.Contains(err.Error(), "unresolved independent base ABI blockers") {
        t.Fatalf("missing zero-blocker proof accepted: %v", err)
    }
}

func TestNativeProductHandoffRejectsStagedNotInstalled(t *testing.T) {
    lock, policy, trust, root, _ := nativeProductHandoffFixture(t)
    if _, err := verifiedNativeProductHandoff(lock, policy, trust, root); err == nil ||
        !strings.Contains(err.Error(), "installed Product Runtime") {
        t.Fatalf("staged slot incorrectly treated as current: %v", err)
    }
}

func TestNativeProductHandoffVerifiesCurrentIdentityAndAnchor(t *testing.T) {
    if runtime.GOOS == "windows" { t.Skip("native POSIX immutable slot proof") }
    lock, policy, trust, root, slot := nativeProductHandoffFixture(t)
    state := emptyActivationState("product-runtime")
    state.Current = &slotIdentity{Version: "0.3.0", SourceCommit: testSourceCommit}
    state.Revision = 1
    if err := writeActivationState(root, state); err != nil { t.Fatal(err) }

    result, err := verifiedNativeProductHandoff(lock, policy, trust, root)
    if err != nil { t.Fatal(err) }
    if result.Executable != filepath.Join(slot, filepath.FromSlash(productRuntimeExecutablePath)) ||
        result.SourceCommit != testSourceCommit || result.Revision != 1 {
        t.Fatalf("unexpected handoff: %+v", result)
    }

    // This test uses an ephemeral signing key and a synthetic ELF. It proves
    // the metadata gate only, NOT native hardware execution or real ABI.
    tampered, err := os.ReadFile(lock)
    if err != nil { t.Fatal(err) }
    var candidate nativeProductSourceLock
    if err := json.Unmarshal(tampered, &candidate); err != nil { t.Fatal(err) }
    candidate.CandidateEvidence.IndependentBaseABIReady = false
    mutation, _ := json.Marshal(candidate)
    if err := os.WriteFile(lock, mutation, 0o600); err != nil { t.Fatal(err) }
    if _, err := verifiedNativeProductHandoff(lock, policy, trust, root); err == nil {
        t.Fatal("ABI revocation did not close handoff")
    }

    candidate.CandidateEvidence.IndependentBaseABIReady = true
    candidate.CandidateEvidence.ExecutableSHA256 = strings.Repeat("0", 64)
    mutation, _ = json.Marshal(candidate)
    if err := os.WriteFile(lock, mutation, 0o600); err != nil { t.Fatal(err) }
    if _, err := verifiedNativeProductHandoff(lock, policy, trust, root); err == nil ||
        !strings.Contains(err.Error(), "binary differs from pinned provenance") {
        t.Fatalf("different signed binary from pinned CI provenance accepted: %v", err)
    }

    candidate.CandidateEvidence.ExecutableSHA256 = hex.EncodeToString(sha256SumForHandoffFixture(t, result.Executable))
    candidate.Source.Commit = strings.Repeat("e", 40)
    candidate.CandidateEvidence.SourceCommit = candidate.Source.Commit
    mutation, _ = json.Marshal(candidate)
    if err := os.WriteFile(lock, mutation, 0o600); err != nil { t.Fatal(err) }
    if _, err := verifiedNativeProductHandoff(lock, policy, trust, root); err == nil ||
        !strings.Contains(err.Error(), "canonical pinned source") {
        t.Fatalf("signed current accepted mismatched OS source: %v", err)
    }
}

func TestNativeProductHandoffRejectsUnpinnedOrWrongTrust(t *testing.T) {
    lock, policy, trust, root, _ := nativeProductHandoffFixture(t)
    state := emptyActivationState("product-runtime")
    state.Current = &slotIdentity{Version:"0.3.0", SourceCommit:testSourceCommit}
    state.Revision = 1
    if err := writeActivationState(root, state); err != nil { t.Fatal(err) }
    data, err := os.ReadFile(policy)
    if err != nil { t.Fatal(err) }
    var candidate nativeProductTrustPolicy
    if err := json.Unmarshal(data, &candidate); err != nil { t.Fatal(err) }
    candidate.PublicAnchor.Pinned = false
    mutation, _ := json.Marshal(candidate)
    if err := os.WriteFile(policy, mutation, 0o600); err != nil { t.Fatal(err) }
    if _, err := verifiedNativeProductHandoff(lock, policy, trust, root); err == nil ||
        !strings.Contains(err.Error(), "not pinned") {
        t.Fatalf("untrusted anchor authorized Product runtime: %v", err)
    }
    candidate.PublicAnchor.Pinned = true
    candidate.Status = "operator-ceremony-pending"
    mutation, _ = json.Marshal(candidate)
    if err := os.WriteFile(policy, mutation, 0o600); err != nil { t.Fatal(err) }
    if _, err := verifiedNativeProductHandoff(lock, policy, trust, root); err == nil ||
        !strings.Contains(err.Error(), "not pinned") {
        t.Fatalf("unpromoted trust ceremony authorized Product runtime: %v", err)
    }

    candidate.Status = "canonical-public-trust-pinned"
    candidate.PublicAnchor.SHA256 = strings.Repeat("0", 64)
    mutation, _ = json.Marshal(candidate)
    if err := os.WriteFile(policy, mutation, 0o600); err != nil { t.Fatal(err) }
    if _, err := verifiedNativeProductHandoff(lock, policy, trust, root); err == nil ||
        !strings.Contains(err.Error(), "fingerprint mismatch") {
        t.Fatalf("wrong trust fingerprint authorized Product runtime: %v", err)
    }
}

func sha256SumForHandoffFixture(t *testing.T, path string) []byte {
    t.Helper()
    value, err := os.ReadFile(path)
    if err != nil { t.Fatal(err) }
    sum := sha256.Sum256(value)
    return sum[:]
}
