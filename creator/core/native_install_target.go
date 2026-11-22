package creatorcore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const nativeInstallLogicalSectorBytes = uint64(512)

// NativeInstallTargetIdentity is the host-neutral identity that a Native
// adapter must prove before a destructive installation can ever be authorized.
// It contains no writable handle and no permission to mutate the device.
type NativeInstallTargetIdentity struct {
	StableID           string `json:"stable_id"`
	DevicePath         string `json:"device_path"`
	Model              string `json:"model,omitempty"`
	Serial             string `json:"serial,omitempty"`
	Transport          string `json:"transport,omitempty"`
	PhysicalBytes      uint64 `json:"physical_bytes"`
	LogicalSectorBytes uint64 `json:"logical_sector_bytes"`
	Removable          bool   `json:"removable"`
	ReadOnly           bool   `json:"read_only"`
	SourceBootMedia    bool   `json:"source_boot_media"`
	Eligible           bool   `json:"eligible"`
	ConfirmationToken  string `json:"confirmation_token"`
}

func normalizedNativeIdentityField(value string) string {
	return strings.TrimSpace(value)
}

func validateNativeIdentityShape(target NativeInstallTargetIdentity) error {
	if normalizedNativeIdentityField(target.StableID) == "" {
		return errors.New("native install target stable identity is required")
	}
	if normalizedNativeIdentityField(target.DevicePath) == "" {
		return errors.New("native install target device path is required")
	}
	if target.PhysicalBytes == 0 || target.PhysicalBytes%nativeInstallLogicalSectorBytes != 0 {
		return errors.New("native install target capacity must be positive and 512-byte aligned")
	}
	if target.LogicalSectorBytes != nativeInstallLogicalSectorBytes {
		return fmt.Errorf("native install target logical sector size %d is not supported by MVP", target.LogicalSectorBytes)
	}
	return nil
}

// NativeInstallTargetConfirmationToken binds the user-visible selection to the
// exact re-enumerated identity. The token is a fingerprint, not a secret.
// The v2 domain and canonical JSON struct unambiguously frame each field,
// including untrusted sysfs strings that may themselves contain '|'. A token
// issued under the previous ambiguous v1 encoding is deliberately invalid:
// confirmation is ephemeral and must be obtained from fresh enumeration.
func NativeInstallTargetConfirmationToken(target NativeInstallTargetIdentity) (string, error) {
	if err := validateNativeIdentityShape(target); err != nil {
		return "", err
	}
	// A fixed-field struct (not a map) gives one stable order and type for
	// every field. No optional identity fields may be omitted from the hash.
	identity := struct {
		StableID           string `json:"stable_id"`
		DevicePath         string `json:"device_path"`
		Model              string `json:"model"`
		Serial             string `json:"serial"`
		Transport          string `json:"transport"`
		PhysicalBytes      uint64 `json:"physical_bytes"`
		LogicalSectorBytes uint64 `json:"logical_sector_bytes"`
		Removable          bool   `json:"removable"`
		ReadOnly           bool   `json:"read_only"`
		SourceBootMedia    bool   `json:"source_boot_media"`
	}{
		StableID:           normalizedNativeIdentityField(target.StableID),
		DevicePath:         normalizedNativeIdentityField(target.DevicePath),
		Model:              normalizedNativeIdentityField(target.Model),
		Serial:             normalizedNativeIdentityField(target.Serial),
		Transport:          normalizedNativeIdentityField(target.Transport),
		PhysicalBytes:      target.PhysicalBytes,
		LogicalSectorBytes: target.LogicalSectorBytes,
		Removable:          target.Removable,
		ReadOnly:           target.ReadOnly,
		SourceBootMedia:    target.SourceBootMedia,
	}
	encoded, err := json.Marshal(identity)
	if err != nil {
		return "", fmt.Errorf("encode native install target identity: %w", err)
	}
	digest := sha256.Sum256(append([]byte("ordax-native-install-target-v2\x00"), encoded...))
	return hex.EncodeToString(digest[:]), nil
}

// FinalizeNativeInstallTarget converts read-only adapter metadata into a
// fail-closed target. The source boot medium and read-only devices are never
// eligible, regardless of transport.
func FinalizeNativeInstallTarget(target NativeInstallTargetIdentity) (NativeInstallTargetIdentity, error) {
	if err := validateNativeIdentityShape(target); err != nil {
		return NativeInstallTargetIdentity{}, err
	}
	if _, err := PlanNativeDiskTargetStorage(target.PhysicalBytes); err != nil {
		return NativeInstallTargetIdentity{}, fmt.Errorf("native install target geometry: %w", err)
	}
	target.StableID = normalizedNativeIdentityField(target.StableID)
	target.DevicePath = normalizedNativeIdentityField(target.DevicePath)
	target.Model = normalizedNativeIdentityField(target.Model)
	target.Serial = normalizedNativeIdentityField(target.Serial)
	target.Transport = normalizedNativeIdentityField(target.Transport)
	target.Eligible = !target.ReadOnly && !target.SourceBootMedia
	token, err := NativeInstallTargetConfirmationToken(target)
	if err != nil {
		return NativeInstallTargetIdentity{}, err
	}
	target.ConfirmationToken = token
	return target, nil
}

// MatchConfirmedNativeInstallTarget accepts only a currently eligible target
// whose fingerprint still matches the token obtained from the prior read-only
// enumeration.
func MatchConfirmedNativeInstallTarget(targets []NativeInstallTargetIdentity, token string) (NativeInstallTargetIdentity, error) {
	token = strings.TrimSpace(token)
	if token != strings.ToLower(token) {
		return NativeInstallTargetIdentity{}, errors.New("native install confirmation token must be lowercase 64-hex SHA-256")
	}
	decoded, err := hex.DecodeString(token)
	if err != nil || len(decoded) != sha256.Size {
		return NativeInstallTargetIdentity{}, errors.New("native install confirmation token must be lowercase 64-hex SHA-256")
	}

	var match *NativeInstallTargetIdentity
	for i := range targets {
		candidate := targets[i]
		if !candidate.Eligible || candidate.ReadOnly || candidate.SourceBootMedia {
			continue
		}
		recomputed, err := NativeInstallTargetConfirmationToken(candidate)
		if err != nil {
			return NativeInstallTargetIdentity{}, err
		}
		if candidate.ConfirmationToken != recomputed {
			return NativeInstallTargetIdentity{}, errors.New("native install target identity is internally inconsistent")
		}
		if recomputed != token {
			continue
		}
		if match != nil {
			return NativeInstallTargetIdentity{}, errors.New("native install confirmation token matched multiple targets")
		}
		copy := candidate
		match = &copy
	}
	if match == nil {
		return NativeInstallTargetIdentity{}, errors.New("native install confirmation token no longer matches an eligible target")
	}
	return *match, nil
}

// BoundNativeInstallationPlan combines exact target identity with the pure
// storage plan while still granting no physical write permission.
type BoundNativeInstallationPlan struct {
	Schema               string                      `json:"schema"`
	Status               string                      `json:"status"`
	Target               NativeInstallTargetIdentity `json:"target"`
	Installation         NativeInstallationPlan      `json:"installation"`
	PhysicalDeviceTouched bool                        `json:"physical_device_touched"`
	PhysicalApplyAllowed  bool                        `json:"physical_apply_allowed"`
}

func PlanNativeInstallationForTarget(target NativeInstallTargetIdentity, confirmationToken string) (BoundNativeInstallationPlan, error) {
	confirmed, err := MatchConfirmedNativeInstallTarget(
		[]NativeInstallTargetIdentity{target},
		confirmationToken,
	)
	if err != nil {
		return BoundNativeInstallationPlan{}, err
	}
	installation, err := PlanNativeInstallation(confirmed.PhysicalBytes)
	if err != nil {
		return BoundNativeInstallationPlan{}, err
	}
	return BoundNativeInstallationPlan{
		Schema:                "prototype-ordax.native-install-bound-plan/1",
		Status:                "target-bound-plan-only",
		Target:                confirmed,
		Installation:          installation,
		PhysicalDeviceTouched: false,
		PhysicalApplyAllowed:  false,
	}, nil
}
