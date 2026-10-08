package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	creatorcore "github.com/ordaxsystems/ordax-os/tools/creator/core"
)

type PortablePhysicalArtifactSource struct {
	ArtifactID string `json:"artifact_id"`
	Path string `json:"path"`
	SHA256 string `json:"sha256"`
	SizeBytes uint64 `json:"size_bytes"`
}

type PortablePhysicalApplyRequest struct {
	Target Target `json:"target"`
	ConfirmationToken string `json:"confirmation_token"`
	ApplicationPlan creatorcore.PortableApplicationPlan `json:"application_plan"`
	Sources []PortablePhysicalArtifactSource `json:"sources"`
	CanonicalTrustResolved bool `json:"canonical_trust_resolved"`
	PhysicalPromotionAuthorized bool `json:"physical_promotion_authorized"`
	DestructiveAuthorization string `json:"destructive_authorization"`
}

func PortableDestructiveAuthorizationToken(target Target, applicationPlanSHA256 string) string {
	identity := strings.Join([]string{
		"ordax-portable-destructive-write-v1",
		target.ConfirmationToken,
		applicationPlanSHA256,
		strconv.FormatUint(target.PhysicalDiskBytes, 10),
	}, "|")
	digest := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(digest[:])
}

func validatePortablePhysicalApplyRequestPolicy(request PortablePhysicalApplyRequest) (Target, string, error) {
	confirmed, err := MatchConfirmedTarget([]Target{request.Target}, request.ConfirmationToken)
	if err != nil {
		return Target{}, "", err
	}
	if confirmed.SystemDisk ||
		confirmed.BusType != "usb" ||
		!confirmed.PrototypeSafe ||
		confirmed.PhysicalDiskBytes == 0 {
		return Target{}, "", errors.New("target is not eligible for portable physical apply")
	}
	if !request.CanonicalTrustResolved {
		return Target{}, "", errors.New("portable physical apply blocked: canonical release trust is unresolved")
	}
	if !request.PhysicalPromotionAuthorized {
		return Target{}, "", errors.New("portable physical apply blocked: physical promotion is not authorized")
	}
	if request.ApplicationPlan.TargetBytes != confirmed.PhysicalDiskBytes {
		return Target{}, "", fmt.Errorf(
			"portable physical apply target capacity mismatch: plan=%d device=%d",
			request.ApplicationPlan.TargetBytes,
			confirmed.PhysicalDiskBytes,
		)
	}
	planSHA, err := creatorcore.PortableApplicationPlanSHA256(request.ApplicationPlan)
	if err != nil {
		return Target{}, "", err
	}
	if request.DestructiveAuthorization != PortableDestructiveAuthorizationToken(confirmed, planSHA) {
		return Target{}, "", errors.New("portable physical apply blocked: destructive authorization does not match current target and plan")
	}
	if len(request.Sources) != 17 {
		return Target{}, "", fmt.Errorf("portable physical apply requires exactly 17 sources; got=%d", len(request.Sources))
	}

	expected := map[string]creatorcore.PortableApplicationOperation{}
	for _, op := range request.ApplicationPlan.Operations {
		if op.Kind == "materialize-artifact" {
			expected[op.ArtifactID] = op
		}
	}
	if len(expected) != 17 {
		return Target{}, "", errors.New("portable physical apply plan does not contain exactly 17 materializations")
	}
	seen := map[string]bool{}
	for _, source := range request.Sources {
		if seen[source.ArtifactID] {
			return Target{}, "", fmt.Errorf("duplicate portable physical source %q", source.ArtifactID)
		}
		seen[source.ArtifactID] = true
		op, ok := expected[source.ArtifactID]
		if !ok ||
			source.SHA256 != op.SHA256 ||
			source.SizeBytes != op.SizeBytes ||
			source.Path == "" {
			return Target{}, "", fmt.Errorf("portable physical source %q differs from canonical plan", source.ArtifactID)
		}
		info, err := os.Lstat(source.Path)
		if err != nil {
			return Target{}, "", fmt.Errorf("stat portable physical source %q: %w", source.ArtifactID, err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() != int64(source.SizeBytes) {
			return Target{}, "", fmt.Errorf("portable physical source %q is not an exact regular file", source.ArtifactID)
		}
	}
	if len(seen) != len(expected) {
		return Target{}, "", errors.New("portable physical source set is incomplete")
	}
	return confirmed, planSHA, nil
}

func ValidatePortablePhysicalApplyRequest(request PortablePhysicalApplyRequest) error {
	_, _, err := validatePortablePhysicalApplyRequestPolicy(request)
	return err
}
