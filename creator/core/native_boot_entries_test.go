package creatorcore

import (
	"strings"
	"testing"
)

func TestPlanNativeBootEntriesNormalizesPublicLUKSIdentity(t *testing.T) {
	plan, err := PlanNativeBootEntries(" 01234567-89AB-CDEF-0123-456789ABCDEF ")
	if err != nil {
		t.Fatal(err)
	}
	if plan.PoolUUID != "01234567-89ab-cdef-0123-456789abcdef" {
		t.Fatalf("unexpected normalized UUID: %s", plan.PoolUUID)
	}
	if plan.PoolUUIDIsSecret || plan.SecretMaterialIncluded || plan.PhysicalWriteAllowed {
		t.Fatal("Native boot identity plan crossed secret/write boundary")
	}
	if plan.NormalTargetPath != "loader/entries/ordax-native.conf" {
		t.Fatalf("unexpected normal entry target: %s", plan.NormalTargetPath)
	}
	if plan.RecoveryTargetPath != "loader/entries/ordax-native-recovery.conf" {
		t.Fatalf("unexpected recovery entry target: %s", plan.RecoveryTargetPath)
	}
}

func TestRenderNativeBootEntryTemplateRequiresOnePlaceholder(t *testing.T) {
	template := "options ordax.product_mode=native-disk ordax.pool_uuid=@ORDAX_POOL_UUID@\n"
	rendered, err := RenderNativeBootEntryTemplate(template, "01234567-89ab-cdef-0123-456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rendered, "ordax.pool_uuid=01234567-89ab-cdef-0123-456789abcdef") {
		t.Fatalf("rendered entry did not bind exact UUID: %q", rendered)
	}
	if strings.Contains(rendered, nativePoolUUIDPlaceholder) {
		t.Fatal("placeholder survived Native entry rendering")
	}

	for _, invalid := range []string{
		"options no-placeholder\n",
		"@ORDAX_POOL_UUID@ @ORDAX_POOL_UUID@\n",
	} {
		if _, err := RenderNativeBootEntryTemplate(invalid, "01234567-89ab-cdef-0123-456789abcdef"); err == nil {
			t.Fatalf("invalid template unexpectedly accepted: %q", invalid)
		}
	}
}

func TestRenderNativeBootEntryTemplateRejectsSecretMaterial(t *testing.T) {
	for _, template := range []string{
		"options password=secret ordax.pool_uuid=@ORDAX_POOL_UUID@\n",
		"options keyfile=/secret ordax.pool_uuid=@ORDAX_POOL_UUID@\n",
		"options ordax.pool_key=x ordax.pool_uuid=@ORDAX_POOL_UUID@\n",
	} {
		if _, err := RenderNativeBootEntryTemplate(template, "01234567-89ab-cdef-0123-456789abcdef"); err == nil {
			t.Fatalf("secret-bearing template unexpectedly accepted: %q", template)
		}
	}
}

func TestNativePoolUUIDRejectsNonCanonicalIdentity(t *testing.T) {
	for _, value := range []string{
		"",
		"not-a-uuid",
		"01234567-89ab-cdef-0123-456789abcdeg",
		"0123456789ab-cdef-0123-456789abcdef",
	} {
		if _, err := NormalizeNativePoolUUID(value); err == nil {
			t.Fatalf("invalid UUID unexpectedly accepted: %q", value)
		}
	}
}
