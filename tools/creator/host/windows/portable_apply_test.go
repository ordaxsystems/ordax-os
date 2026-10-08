package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	creatorcore "github.com/ordaxsystems/ordax-os/tools/creator/core"
)

func portablePhysicalRequestFixture(t *testing.T) PortablePhysicalApplyRequest {
	t.Helper()
	target := Target{
		DiskNumber: 7,
		PhysicalDiskBytes: 8 << 30,
		BusType: "usb",
		PrototypeSafe: true,
		DeviceSerial: "portable-fixture",
	}
	target.ConfirmationToken = ConfirmationToken(target)

	bindings := creatorcore.PortableMediaBindings{
		Schema: creatorcore.PortableMediaBindingsSchema,
	}
	ids := []string{
		"systemd-boot","loader-config","loader-normal","loader-recovery",
		"kernel","initramfs","bootstrap-capsule","release-trust",
		"stable-base","persistent-state","system-image","surface-runtime-image",
		"surface-runtime-ref","local-ai-runtime-image","local-ai-runtime-ref",
		"release-manifest","release-envelope",
	}
	root := t.TempDir()
	for i, id := range ids {
		data := []byte{byte(i + 1)}
		path := filepath.Join(root, id)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		digest := sha256FileForTest(t, path)
		bindings.Artifacts = append(bindings.Artifacts, creatorcore.PortableMediaArtifactBinding{
			ID: id, SHA256: digest, SizeBytes: uint64(len(data)),
		})
	}
	media, err := creatorcore.PlanPortableMedia(target.PhysicalDiskBytes, "0123456789abcdef0123456789abcdef01234567", bindings)
	if err != nil {
		t.Fatal(err)
	}
	application, err := creatorcore.PlanPortableApplication(media)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]creatorcore.PortableApplicationOperation{}
	for _, op := range application.Operations {
		if op.Kind == "materialize-artifact" {
			byID[op.ArtifactID] = op
		}
	}
	sources := make([]PortablePhysicalArtifactSource, 0, len(ids))
	for _, id := range ids {
		op := byID[id]
		sources = append(sources, PortablePhysicalArtifactSource{
			ArtifactID: id,
			Path: filepath.Join(root, id),
			SHA256: op.SHA256,
			SizeBytes: op.SizeBytes,
		})
	}
	planSHA, err := creatorcore.PortableApplicationPlanSHA256(application)
	if err != nil {
		t.Fatal(err)
	}
	return PortablePhysicalApplyRequest{
		Target: target,
		ConfirmationToken: target.ConfirmationToken,
		ApplicationPlan: application,
		Sources: sources,
		CanonicalTrustResolved: true,
		PhysicalPromotionAuthorized: true,
		DestructiveAuthorization: PortableDestructiveAuthorizationToken(target, planSHA),
	}
}

func sha256FileForTest(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func TestPortablePhysicalApplyPolicyBindsTargetPlanAndSources(t *testing.T) {
	request := portablePhysicalRequestFixture(t)
	if err := ValidatePortablePhysicalApplyRequest(request); err != nil {
		t.Fatal(err)
	}

	encoded, err := json.Marshal(request.ApplicationPlan)
	if err != nil || len(encoded) == 0 {
		t.Fatalf("application plan is not serializable: %v", err)
	}
}

func TestPortablePhysicalApplyPolicyRejectsAuthorizationDrift(t *testing.T) {
	request := portablePhysicalRequestFixture(t)

	request.CanonicalTrustResolved = false
	if err := ValidatePortablePhysicalApplyRequest(request); err == nil {
		t.Fatal("unresolved canonical trust was accepted")
	}

	request = portablePhysicalRequestFixture(t)
	request.PhysicalPromotionAuthorized = false
	if err := ValidatePortablePhysicalApplyRequest(request); err == nil {
		t.Fatal("missing physical promotion was accepted")
	}

	request = portablePhysicalRequestFixture(t)
	request.DestructiveAuthorization = strings.Repeat("0", 64)
	if err := ValidatePortablePhysicalApplyRequest(request); err == nil {
		t.Fatal("wrong destructive authorization was accepted")
	}
}

func TestPortablePhysicalApplyPolicyRejectsPlanDriftAfterAuthorization(t *testing.T) {
	request := portablePhysicalRequestFixture(t)
	originalAuthorization := request.DestructiveAuthorization

	request.ApplicationPlan.SourceCommit = strings.Repeat("f", 40)
	planSHA, err := creatorcore.PortableApplicationPlanSHA256(request.ApplicationPlan)
	if err != nil {
		t.Fatal(err)
	}
	if originalAuthorization == PortableDestructiveAuthorizationToken(request.Target, planSHA) {
		t.Fatal("destructive authorization did not change after application-plan drift")
	}
	if err := ValidatePortablePhysicalApplyRequest(request); err == nil ||
		!strings.Contains(err.Error(), "destructive authorization does not match current target and plan") {
		t.Fatalf("application-plan drift was not rejected by destructive authorization: %v", err)
	}
}

func TestPortablePhysicalApplyPolicyRejectsTargetAndSourceDrift(t *testing.T) {
	request := portablePhysicalRequestFixture(t)
	request.Target.PhysicalDiskBytes += 512
	request.Target.ConfirmationToken = ConfirmationToken(request.Target)
	request.ConfirmationToken = request.Target.ConfirmationToken
	planSHA, err := creatorcore.PortableApplicationPlanSHA256(request.ApplicationPlan)
	if err != nil {
		t.Fatal(err)
	}
	request.DestructiveAuthorization = PortableDestructiveAuthorizationToken(request.Target, planSHA)
	if err := ValidatePortablePhysicalApplyRequest(request); err == nil {
		t.Fatal("target capacity drift was accepted")
	}

	request = portablePhysicalRequestFixture(t)
	request.Sources[0].SHA256 = strings.Repeat("a", 64)
	if err := ValidatePortablePhysicalApplyRequest(request); err == nil {
		t.Fatal("source digest drift was accepted")
	}

	request = portablePhysicalRequestFixture(t)
	if err := os.WriteFile(request.Sources[0].Path, []byte("changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePortablePhysicalApplyRequest(request); err == nil {
		t.Fatal("source size drift was accepted")
	}
}
