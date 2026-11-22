package creatorcore

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const nativePoolUUIDPlaceholder = "@ORDAX_POOL_UUID@"

var nativePoolUUIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type NativeBootEntryPlan struct {
	Schema                  string `json:"schema"`
	Status                  string `json:"status"`
	PoolUUID                string `json:"pool_uuid"`
	PoolUUIDIsSecret        bool   `json:"pool_uuid_is_secret"`
	NormalTargetPath        string `json:"normal_target_path"`
	RecoveryTargetPath      string `json:"recovery_target_path"`
	PhysicalWriteAllowed    bool   `json:"physical_write_allowed"`
	SecretMaterialIncluded  bool   `json:"secret_material_included"`
}

func NormalizeNativePoolUUID(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if !nativePoolUUIDPattern.MatchString(normalized) {
		return "", errors.New("Native LUKS2 pool UUID must be canonical 8-4-4-4-12 lowercase hexadecimal")
	}
	return normalized, nil
}

func PlanNativeBootEntries(poolUUID string) (NativeBootEntryPlan, error) {
	normalized, err := NormalizeNativePoolUUID(poolUUID)
	if err != nil {
		return NativeBootEntryPlan{}, err
	}
	return NativeBootEntryPlan{
		Schema:                 "prototype-ordax.native-boot-entry-plan/1",
		Status:                 "plan-only",
		PoolUUID:               normalized,
		PoolUUIDIsSecret:       false,
		NormalTargetPath:       "loader/entries/ordax-native.conf",
		RecoveryTargetPath:     "loader/entries/ordax-native-recovery.conf",
		PhysicalWriteAllowed:   false,
		SecretMaterialIncluded: false,
	}, nil
}

func RenderNativeBootEntryTemplate(template, poolUUID string) (string, error) {
	plan, err := PlanNativeBootEntries(poolUUID)
	if err != nil {
		return "", err
	}
	if strings.Count(template, nativePoolUUIDPlaceholder) != 1 {
		return "", fmt.Errorf("Native boot entry template must contain exactly one %s placeholder", nativePoolUUIDPlaceholder)
	}
	lower := strings.ToLower(template)
	for _, forbidden := range []string{"passphrase", "password=", "keyfile", "key-file", "ordax.pool_key"} {
		if strings.Contains(lower, forbidden) {
			return "", errors.New("Native boot entry template contains forbidden secret material")
		}
	}
	rendered := strings.Replace(template, nativePoolUUIDPlaceholder, plan.PoolUUID, 1)
	if strings.Contains(rendered, nativePoolUUIDPlaceholder) {
		return "", errors.New("Native boot entry placeholder remained after rendering")
	}
	return rendered, nil
}
