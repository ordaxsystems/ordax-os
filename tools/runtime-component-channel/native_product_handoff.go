package main

// Native Product Runtime: read-only, fail-closed handoff to the OS lifecycle.
// The existing component-channel remains the single signed-slot verifier.
// This does not start an agent, authorize a client/grant or attest a session.
import (
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "errors"
    "flag"
    "fmt"
    "os"
    "path/filepath"
    "strings"
)

const (
    productRuntimeLockSchema = "prototype-ordax.studio-runtime-source-lock/1"
    productRuntimeTrustPolicySchema = "prototype-ordax.runtime-component-trust-policy/1"
    productRuntimeSourceURL = "https://github.com/ordaxsystems/ordax-runtime"
)

type nativeProductSourceLock struct {
    Schema string `json:"$schema"`
    Source struct {
        Repository string `json:"repository"`
        Commit string `json:"commit"`
    } `json:"source"`
    Distribution struct {
        RuntimeArtifactClaimed bool `json:"runtime_artifact_claimed"`
        SourceBindingOnly bool `json:"source_binding_only"`
        SignedRuntimeSlotAvailable bool `json:"signed_runtime_slot_available"`
    } `json:"distribution"`
    Activation struct {
        BootCritical bool `json:"boot_critical"`
        RequiresSignedRuntimeSlot bool `json:"requires_signed_runtime_slot"`
        RequiresRuntimeHealthProof bool `json:"requires_runtime_health_proof"`
        RequiresNativePolicy bool `json:"requires_native_policy"`
        RequiresOAuthGrants bool `json:"requires_product_oauth_client_consent"`
        RequiresDeviceGrants bool `json:"requires_device_scoped_grants"`
    } `json:"activation"`
    CandidateEvidence struct {
        SourceCommit string `json:"source_commit"`
        ExecutableSHA256 string `json:"executable_sha256"`
        ExecutableSizeBytes int64 `json:"executable_size_bytes"`
        IndependentBaseABIReady bool `json:"independent_base_abi_ready"`
        SignedDistributionAuthorized bool `json:"signed_distribution_authorized"`
        EmbeddedELFInventory struct {
            IndependentBaseCompatibilityProven bool `json:"independent_base_compatibility_proven"`
            InstallAuthorized bool `json:"install_authorized"`
        } `json:"embedded_elf_inventory"`
    } `json:"candidate_evidence"`
}

type nativeProductTrustPolicy struct {
    Schema string `json:"$schema"`
    TrustDomain string `json:"trust_domain"`
    PublicAnchor struct {
        Pinned bool `json:"pinned"`
        SHA256 string `json:"sha256"`
    } `json:"public_anchor"`
    CurrentGates struct {
        CanonicalComponentTrustAnchorPinned bool `json:"canonical_component_trust_anchor_pinned"`
    } `json:"current_gates"`
}

type nativeProductHandoff struct {
    SourceCommit string
    Version string
    Revision int64
    Executable string
}

// A lock may describe candidates but cannot authorize execution by itself.
// These checks consume the OS's existing source/provenance flags rather than
// keeping a parallel list of versions or platform-specific dynamic libraries.
func validateNativeProductSourceLock(lock nativeProductSourceLock) error {
    if lock.Schema != productRuntimeLockSchema ||
        lock.Source.Repository != productRuntimeSourceURL ||
        !commitPattern.MatchString(lock.Source.Commit) ||
        lock.CandidateEvidence.SourceCommit != lock.Source.Commit {

        return errors.New("native Product Runtime source provenance invalid")
    }
    a := lock.Activation
    if a.BootCritical || !a.RequiresSignedRuntimeSlot ||
        !a.RequiresRuntimeHealthProof || !a.RequiresNativePolicy ||
        !a.RequiresOAuthGrants || !a.RequiresDeviceGrants {
        return errors.New("native Product Runtime activation prerequisites invalid")
    }
    d := lock.Distribution
    c := lock.CandidateEvidence
    if !shaPattern.MatchString(c.ExecutableSHA256) || c.ExecutableSizeBytes <= 0 ||
        c.ExecutableSizeBytes > maxProductRuntimeFileBytes {
        return errors.New("native Product Runtime binary provenance missing")
    }
    if !d.RuntimeArtifactClaimed || d.SourceBindingOnly || !d.SignedRuntimeSlotAvailable ||
        !c.IndependentBaseABIReady || !c.SignedDistributionAuthorized ||
        !c.EmbeddedELFInventory.IndependentBaseCompatibilityProven ||
        !c.EmbeddedELFInventory.InstallAuthorized {
        return errors.New("native Product Runtime independent base ABI/distribution not proven")
    }
    return nil
}

func verifiedNativeProductHandoff(lockPath, policyPath, trustPath, slotRoot string) (nativeProductHandoff, error) {
    var result nativeProductHandoff
    lockBytes, err := readRegular(lockPath, 64<<10, false)
    if err != nil { return result, fmt.Errorf("source lock unavailable: %w", err) }
    var lock nativeProductSourceLock
    if err := json.Unmarshal(lockBytes, &lock); err != nil {
        return result, errors.New("native Product Runtime source lock invalid")
    }
    if err := validateNativeProductSourceLock(lock); err != nil { return result, err }

    policyBytes, err := readRegular(policyPath, 64<<10, false)
    if err != nil { return result, fmt.Errorf("component trust policy unavailable: %w", err) }
    var policy nativeProductTrustPolicy
    if err := json.Unmarshal(policyBytes, &policy); err != nil {
        return result, errors.New("canonical component trust policy invalid")
    }
    if policy.Schema != productRuntimeTrustPolicySchema ||
        policy.TrustDomain != "runtime-components" ||
        !policy.PublicAnchor.Pinned ||
        !policy.CurrentGates.CanonicalComponentTrustAnchorPinned ||
        !shaPattern.MatchString(policy.PublicAnchor.SHA256) {
        return result, errors.New("canonical component public trust anchor not pinned")
    }
    trust, err := readRegular(trustPath, maxTrustBytes, false)
    if err != nil { return result, fmt.Errorf("component trust unavailable: %w", err) }
    digest := sha256.Sum256(trust)
    if hex.EncodeToString(digest[:]) != policy.PublicAnchor.SHA256 {
        return result, errors.New("component trust anchor fingerprint mismatch")
    }

    state, slot, manifest, bundled, err := resolveRuntimeSlot(slotRoot, "product-runtime", trustPath, "current")
    if err != nil { return result, fmt.Errorf("verified product runtime slot unavailable: %w", err) }
    if bundled || state.Current == nil || state.UserRemoved ||
        state.Current.SourceCommit != lock.Source.Commit ||
        manifest.SourceCommit != lock.Source.Commit ||
        manifest.Entrypoint != productRuntimeExecutablePath ||
        len(manifest.Files) != 1 ||
        !executablePackageFile("product-runtime", manifest.Files[0]) {
        return result, errors.New("installed Product Runtime does not match the canonical pinned source")
    }
    // The signed package digest and the OS-owned CI provenance must bind the
    // exact *same bytes*. Matching the source commit alone is insufficient.
    if manifest.Files[0].SHA256 != lock.CandidateEvidence.ExecutableSHA256 ||
        manifest.Files[0].Size != lock.CandidateEvidence.ExecutableSizeBytes {
        return result, errors.New("signed Product Runtime binary differs from pinned provenance")
    }
    entry := filepath.Join(slot, filepath.FromSlash(productRuntimeExecutablePath))
    if strings.ContainsAny(entry, "\r\n\x00") {
        return result, errors.New("invalid product runtime executable path")
    }
    // The shared slot verifier already validates this file's signed hash and
    // immutable 0555 mode; reject a changed inode type before handoff too.
    info, err := os.Lstat(entry)
    if err != nil { return result, err }
    if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
        info.Mode().Perm() != 0o555 {
        return result, errors.New("installed Product Runtime executable is not immutable")
    }
    return nativeProductHandoff{
        SourceCommit: lock.Source.Commit, Version: state.Current.Version,
        Revision: state.Revision, Executable: entry,
    }, nil
}

func inspectNativeProductHandoffCommand(args []string) error {
    flags := flag.NewFlagSet("inspect-native-product-handoff", flag.ContinueOnError)
    lock := flags.String("source-lock", "", "OS-owned canonical Runtime source lock")
    policy := flags.String("trust-policy", "", "OS-owned canonical component trust policy")
    trust := flags.String("trust", "", "pinned canonical public component trust")
    root := flags.String("root", defaultSlotRoot, "canonical signed runtime slot root")
    if err := flags.Parse(args); err != nil { return err }
    if *lock == "" || *policy == "" || *trust == "" || flags.NArg() != 0 {
        return errors.New("inspect-native-product-handoff requires --source-lock, --trust-policy and --trust")
    }
    plan, err := verifiedNativeProductHandoff(*lock, *policy, *trust, *root)
    if err != nil { return err }
    fmt.Printf("PRODUCT_RUNTIME_HANDOFF_VERIFIED=YES\nSOURCE_COMMIT=%s\nVERSION=%s\nREVISION=%d\nEXECUTABLE=%s\nRUNTIME_STARTED=NO\nCENTRAL_SESSION_ATTESTED=NO\n",
        plan.SourceCommit, plan.Version, plan.Revision, plan.Executable)
    return nil
}
