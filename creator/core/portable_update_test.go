package creatorcore

import (
	"encoding/json"
	"strings"
	"testing"
)

const portableUpdateOld = "0123456789abcdef0123456789abcdef01234567"
const portableUpdateNew = "89abcdef0123456789abcdef0123456789abcdef"

func portableUpdateFixture(t *testing.T) (PortableMediaPlan, PortableMediaPlan) {
	t.Helper()
	bindings := portableBindingsFixture()
	old, err := PlanPortableMedia(8<<30, portableUpdateOld, bindings)
	if err != nil { t.Fatal(err) }
	newer, err := PlanPortableMedia(8<<30, portableUpdateNew, bindings)
	if err != nil { t.Fatal(err) }
	return old, newer
}

func TestPortableUpdateChangesOnlyVersionedReleaseAndPreservesBootAndState(t *testing.T) {
	old, newer := portableUpdateFixture(t)
	plan, err := PlanPortableUpdate(old, newer)
	if err != nil { t.Fatal(err) }
	if plan.Schema != PortableUpdatePlanSchema || plan.Status != "planned-not-authorized" ||
		plan.PhysicalWriteAuthorized || plan.WholeDiskRewriteRequired ||
		!plan.RequiresSignedRelease || !plan.RequiresPostbootHealth {
		t.Fatalf("unsafe or incorrect update plan: %#v", plan)
	}
	counts := map[string]int{}
	for _, op := range plan.Operations {
		counts[op.Kind]++
		if op.DestructiveClass { t.Fatalf("destructive update operation %q", op.ID) }
		if op.Kind == "materialize-artifact" || op.Kind == "readback-sha256-size" {
			if !portableReleaseArtifacts[op.ArtifactID] || op.Partition != "ORDAX-DATA" {
				t.Fatalf("update writes outside signed release: %#v", op)
			}
			if !strings.HasPrefix(op.TargetPath, "/.ordax/") { t.Fatalf("escape: %q", op.TargetPath) }
		}
	}
	if counts["partition-table-gpt-two-partition"] != 0 || counts["format-fat32"] != 0 ||
		counts["format-exfat"] != 0 || counts["flush-and-sync"] != 1 ||
		counts["verify-gpt-filesystem-labels-and-capacity"] != 2 ||
		counts["readback-sha256-size"] != 7 {
		t.Fatalf("incorrect non-destructive operation policy: %#v", counts)
	}
	if counts["materialize-artifact"] == 0 || counts["materialize-artifact"] > 7 {
		t.Fatalf("unexpected file update count: %#v", counts)
	}
	again, err := PlanPortableUpdate(old, newer)
	if err != nil { t.Fatal(err) }
	a, _ := json.Marshal(plan)
	b, _ := json.Marshal(again)
	if string(a) != string(b) { t.Fatal("update plan is nondeterministic") }
}

func TestPortableUpdateFailsClosedOnKernelOrStateChange(t *testing.T) {
	for _, id := range []string{"systemd-boot", "kernel", "initramfs",
		"bootstrap-capsule", "release-trust", "stable-base", "persistent-state"} {
		t.Run(id, func(t *testing.T) {
			old, newer := portableUpdateFixture(t)
			for i := range newer.Artifacts {
				if newer.Artifacts[i].ID == id {
					replacement := strings.Repeat("f", 64)
					if newer.Artifacts[i].SHA256 == replacement {
						replacement = strings.Repeat("0", 64)
					}
					newer.Artifacts[i].SHA256 = replacement
				}
			}
			if _, err := PlanPortableUpdate(old, newer); err == nil {
				t.Fatalf("foundation/state change %q admitted as hot update", id)
			}
		})
	}
}

func TestPortableUpdateRejectsWrongGeometryIdentityAndTampering(t *testing.T) {
	old, newer := portableUpdateFixture(t)
	if _, err := PlanPortableUpdate(old, old); err == nil {
		t.Fatal("same SHA admitted as update")
	}
	newer.TargetBytes++
	if _, err := PlanPortableUpdate(old, newer); err == nil {
		t.Fatal("changed physical size admitted")
	}
	_, newer = portableUpdateFixture(t)
	for i := range newer.Artifacts {
		if newer.Artifacts[i].ID == "system-image" {
			newer.Artifacts[i].TargetPath = "/.ordax/releases/attacker/system.erofs"
		}
	}
	if _, err := PlanPortableUpdate(old, newer); err == nil {
		t.Fatal("noncanonical release destination admitted")
	}
	_, newer = portableUpdateFixture(t)
	for i := range newer.Artifacts {
		if newer.Artifacts[i].ID == "surface-runtime-image" {
			newer.Artifacts[i].SizeBytes = 0
		}
	}
	if _, err := PlanPortableUpdate(old, newer); err == nil {
		t.Fatal("missing Surface runtime admitted")
	}
}

func TestPortableUpdateRefusesInPlaceModification(t *testing.T) {
	old, newer := portableUpdateFixture(t)
	for i := range newer.Artifacts {
		if newer.Artifacts[i].ID == "system-image" {
			newer.Artifacts[i].TargetPath = old.Artifacts[i].TargetPath
			newer.Artifacts[i].SHA256 = strings.Repeat("f",64)
		}
	}
	if _, err := PlanPortableUpdate(old, newer); err == nil {
		t.Fatal("in-place replacement admitted")
	}
}
