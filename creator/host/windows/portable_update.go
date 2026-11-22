package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	creatorcore "github.com/ordaxsystems/ordax-os/creator/core"
)

// PortablePhysicalUpdateRequest binds the exact signed candidate to an
// already-installed Portable USB. Unlike a clean install, it may never
// format, repartition or rewrite the immutable bootstrap and persistent state.
type PortablePhysicalUpdateRequest struct {
	Target                      Target                             `json:"target"`
	ConfirmationToken           string                             `json:"confirmation_token"`
	InstalledMediaPlan          creatorcore.PortableMediaPlan      `json:"installed_media_plan"`
	CandidateMediaPlan          creatorcore.PortableMediaPlan      `json:"candidate_media_plan"`
	UpdatePlan                  creatorcore.PortableUpdatePlan     `json:"update_plan"`
	Sources                     []PortablePhysicalArtifactSource   `json:"sources"`
	VerifiedSignedSourceCommit  string                             `json:"verified_signed_source_commit"`
	CanonicalTrustResolved      bool                               `json:"canonical_trust_resolved"`
	PhysicalUpdateAuthorized    bool                               `json:"physical_update_authorized"`
	UpdateAuthorization         string                             `json:"update_authorization"`
}

func PortablePhysicalUpdateAuthorizationToken(target Target, planSHA string) string {
	identity := strings.Join([]string{
		"ordax-portable-physical-update-v1",
		target.ConfirmationToken, planSHA,
		strconv.FormatUint(target.PhysicalDiskBytes, 10),
	}, "|")
	digest := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(digest[:])
}

func validatePortablePhysicalUpdateRequest(request PortablePhysicalUpdateRequest) (Target, string, error) {
	target, err := MatchConfirmedTarget([]Target{request.Target}, request.ConfirmationToken)
	if err != nil { return Target{}, "", err }
	if target.SystemDisk || target.BusType != "usb" || !target.PrototypeSafe ||
		target.PhysicalDiskBytes == 0 {
		return Target{}, "", errors.New("physical update target is not an eligible USB")
	}
	if !request.CanonicalTrustResolved || !request.PhysicalUpdateAuthorized ||
		request.VerifiedSignedSourceCommit != request.CandidateMediaPlan.SourceCommit {
		return Target{}, "", errors.New("physical update requires exact independently verified signed-release trust")
	}
	if request.InstalledMediaPlan.TargetBytes != target.PhysicalDiskBytes ||
		request.CandidateMediaPlan.TargetBytes != target.PhysicalDiskBytes {
		return Target{}, "", errors.New("physical update media size differs from selected USB")
	}
	expected, err := creatorcore.PlanPortableUpdate(request.InstalledMediaPlan, request.CandidateMediaPlan)
	if err != nil { return Target{}, "", err }
	// A fresh canonical plan must match the authorized plan byte-for-byte.
	planBytes, err := creatorcore.PortableUpdatePlanCanonicalBytes(expected)
	if err != nil { return Target{}, "", err }
	requestBytes, err := creatorcore.PortableUpdatePlanCanonicalBytes(request.UpdatePlan)
	if err != nil || string(planBytes) != string(requestBytes) {
		return Target{}, "", errors.New("physical update plan was modified after canonical planning")
	}
	planSHA, err := creatorcore.PortableUpdatePlanSHA256(expected)
	if err != nil { return Target{}, "", err }
	if request.UpdateAuthorization != PortablePhysicalUpdateAuthorizationToken(target, planSHA) {
		return Target{}, "", errors.New("physical update authorization is not bound to this disk and plan")
	}
	expectedSource := map[string]creatorcore.PortableApplicationOperation{}
	for _, op := range expected.Operations {
		if op.Kind == "materialize-artifact" { expectedSource[op.ArtifactID] = op }
	}
	if len(request.Sources) != len(expectedSource) {
		return Target{}, "", errors.New("physical update source set is incomplete")
	}
	seen := map[string]bool{}
	for _, source := range request.Sources {
		if seen[source.ArtifactID] {
			return Target{}, "", fmt.Errorf("duplicate physical update source %q",source.ArtifactID)
		}
		seen[source.ArtifactID] = true
		op, ok := expectedSource[source.ArtifactID]
		if !ok || op.SHA256 != source.SHA256 || op.SizeBytes != source.SizeBytes ||
			source.SizeBytes == 0 || source.Path == "" {
			return Target{}, "", fmt.Errorf("physical update source %q differs from signed plan",source.ArtifactID)
		}
		info, err := os.Lstat(source.Path)
		if err != nil { return Target{}, "", err }
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || uint64(info.Size()) != source.SizeBytes {
			return Target{}, "", fmt.Errorf("physical update source %q is not an exact regular file",source.ArtifactID)
		}
	}
	return target,planSHA,nil
}


func validatePortableVolumeBinding(expectedGUID, observedGUID string, expectedDisk uint32, diskNumbers []uint32) error {
	if expectedGUID == "" || observedGUID == "" || !strings.EqualFold(expectedGUID, observedGUID) {
		return errors.New("Portable USB drive letter no longer resolves to the originally verified volume")
	}
	if len(diskNumbers) != 1 || diskNumbers[0] != expectedDisk {
		return errors.New("Portable volume is not exclusively owned by the confirmed physical disk")
	}
	return nil
}

func ValidatePortablePhysicalUpdateRequest(request PortablePhysicalUpdateRequest) error {
	_,_,err:=validatePortablePhysicalUpdateRequest(request)
	return err
}
