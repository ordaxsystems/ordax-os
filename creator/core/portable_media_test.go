package creatorcore

import (
	"encoding/json"
	"strings"
	"testing"
)

func portableBindingsFixture() PortableMediaBindings {
	ids := []string{"systemd-boot","loader-config","loader-normal","loader-recovery","kernel","initramfs","bootstrap-capsule","release-trust","stable-base","persistent-state","system-image","surface-runtime-image","surface-runtime-ref","local-ai-runtime-image","local-ai-runtime-ref","release-manifest","release-envelope"}
	value := PortableMediaBindings{Schema: PortableMediaBindingsSchema, Artifacts: make([]PortableMediaArtifactBinding, 0, len(ids))}
	for index, id := range ids {
		value.Artifacts = append(value.Artifacts, PortableMediaArtifactBinding{ID: id, SHA256: strings.Repeat(string("abcdef0123456789"[index%16]), 64), SizeBytes: uint64(index + 1)})
	}
	return value
}

func TestPlanPortableMediaOwnsExactFinalDestinations(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	plan, err := PlanPortableMedia(8<<30, commit, portableBindingsFixture())
	if err != nil { t.Fatal(err) }
	if plan.Schema != PortableMediaPlanSchema || plan.Profile != "portable-usb" { t.Fatalf("unexpected plan identity: %#v", plan) }
	if plan.PhysicalWriteAuthorized { t.Fatal("portable media plan must not authorize physical write") }
	if len(plan.Artifacts) != 17 { t.Fatalf("artifact count=%d want=17", len(plan.Artifacts)) }
	got := map[string]PortableMediaArtifactPlan{}
	for _, artifact := range plan.Artifacts { got[artifact.ID] = artifact }
	expected := map[string][2]string{
		"systemd-boot": {"ORDAX-ESP","/EFI/BOOT/BOOTX64.EFI"},
		"loader-config": {"ORDAX-ESP","/loader/loader.conf"},
		"loader-normal": {"ORDAX-ESP","/loader/entries/ordax-portable.conf"},
		"loader-recovery": {"ORDAX-ESP","/loader/entries/ordax-portable-recovery.conf"},
		"kernel": {"ORDAX-ESP","/ordax/vmlinuz"},
		"initramfs": {"ORDAX-ESP","/ordax/initrd.gz"},
		"bootstrap-capsule": {"ORDAX-ESP","/ordax/bootstrap/bootstrap.erofs"},
		"release-trust": {"ORDAX-ESP","/ordax/bootstrap/trust/release-ed25519.json"},
		"stable-base": {"ORDAX-DATA","/.ordax/base/stable-base.erofs"},
		"persistent-state": {"ORDAX-DATA","/.ordax/state/persistent-state.img"},
		"system-image": {"ORDAX-DATA","/.ordax/releases/"+commit+"/system.erofs"},
		"surface-runtime-image": {"ORDAX-DATA","/.ordax/runtimes/sha256/"+got["surface-runtime-image"].SHA256+"/native-surface-runtime.erofs"},
		"surface-runtime-ref": {"ORDAX-DATA","/.ordax/releases/"+commit+"/surface-runtime.sha256"},
		"local-ai-runtime-image": {"ORDAX-DATA","/.ordax/ai-runtimes/sha256/"+got["local-ai-runtime-image"].SHA256+"/local-ai-runtime.erofs"},
		"local-ai-runtime-ref": {"ORDAX-DATA","/.ordax/releases/"+commit+"/local-ai-runtime.sha256"},
		"release-manifest": {"ORDAX-DATA","/.ordax/releases/"+commit+"/release-manifest.json"},
		"release-envelope": {"ORDAX-DATA","/.ordax/releases/"+commit+"/release-envelope.json"},
	}
	for id, want := range expected {
		artifact, ok := got[id]
		if !ok { t.Fatalf("missing artifact %q", id) }
		if artifact.Partition != want[0] || artifact.TargetPath != want[1] { t.Fatalf("%s destination=%s:%s want=%s:%s", id, artifact.Partition, artifact.TargetPath, want[0], want[1]) }
	}
}

func TestPlanPortableMediaRejectsInvalidBindings(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	b := portableBindingsFixture(); b.Artifacts = b.Artifacts[:len(b.Artifacts)-1]
	if _, err := PlanPortableMedia(8<<30, commit, b); err == nil { t.Fatal("missing binding accepted") }
	b = portableBindingsFixture(); b.Artifacts[0].ID = "unknown"
	if _, err := PlanPortableMedia(8<<30, commit, b); err == nil { t.Fatal("unknown binding accepted") }
	b = portableBindingsFixture(); b.Artifacts[1].ID = b.Artifacts[0].ID
	if _, err := PlanPortableMedia(8<<30, commit, b); err == nil { t.Fatal("duplicate binding accepted") }
	b = portableBindingsFixture(); b.Artifacts[0].SHA256 = "AA"
	if _, err := PlanPortableMedia(8<<30, commit, b); err == nil { t.Fatal("invalid digest accepted") }
	if _, err := PlanPortableMedia(8<<30, "not-a-commit", portableBindingsFixture()); err == nil { t.Fatal("invalid source commit accepted") }
}

func TestPlanPortableMediaRejectsOvercommittedPartitionsBeforeWrite(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	const target = uint64(8053063680) // exact physical Lidermix capacity
	layout, err := PlanPortableTargetStorage(target)
	if err != nil { t.Fatal(err) }
	for _, tc := range []struct{ id string; size uint64 }{
		{"kernel", layout.ESPBytes},
		{"surface-runtime-image", layout.PayloadBytes},
	} {
		bindings := portableBindingsFixture()
		for i := range bindings.Artifacts {
			if bindings.Artifacts[i].ID == tc.id { bindings.Artifacts[i].SizeBytes = tc.size }
		}
		if _, err := PlanPortableMedia(target, commit, bindings); err == nil {
			t.Fatalf("oversized artifact %q was admitted", tc.id)
		}
	}
}

func TestPlanPortableMediaPreservesExactConservativeBoundary(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	const target = uint64(8053063680)
	layout, err := PlanPortableTargetStorage(target)
	if err != nil { t.Fatal(err) }
	reserveData := layout.PayloadBytes / portableMediaDataReserveDivisor
	if reserveData < portableMediaDataMinReserveBytes { reserveData = portableMediaDataMinReserveBytes }
	for _, tc := range []struct { partition, artifactID string; budget uint64 }{
		{"ORDAX-ESP", "kernel", layout.ESPBytes - portableMediaESPReserveBytes},
		{"ORDAX-DATA", "surface-runtime-image", layout.PayloadBytes - reserveData},
	} {
		bindings := portableBindingsFixture()
		var otherSize uint64
		for _, artifact := range bindings.Artifacts {
			if portableMediaTargets[artifact.ID].partition == tc.partition && artifact.ID != tc.artifactID {
				otherSize += artifact.SizeBytes
			}
		}
		var index int
		for i := range bindings.Artifacts {
			if bindings.Artifacts[i].ID == tc.artifactID {
				index = i
				bindings.Artifacts[i].SizeBytes = tc.budget - otherSize
			}
		}
		if _, err := PlanPortableMedia(target, commit, bindings); err != nil {
			t.Fatalf("%s conservative boundary rejected: %v", tc.partition, err)
		}
		bindings.Artifacts[index].SizeBytes++
		if _, err := PlanPortableMedia(target, commit, bindings); err == nil {
			t.Fatalf("%s was overcommitted by one byte", tc.partition)
		}
	}
}

func TestPlanPortableApplicationRejectsOvercommittedMediaAfterParse(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	const target = uint64(8053063680)
	media, err := PlanPortableMedia(target, commit, portableBindingsFixture())
	if err != nil { t.Fatal(err) }
	layout, err := PlanPortableTargetStorage(target)
	if err != nil { t.Fatal(err) }
	for i := range media.Artifacts {
		if media.Artifacts[i].ID == "surface-runtime-image" {
			media.Artifacts[i].SizeBytes = layout.PayloadBytes
		}
	}
	if _, err := PlanPortableApplication(media); err == nil {
		t.Fatal("application planner accepted oversized parsed media plan")
	}
}

func TestParsePortableMediaBindingsIsStrict(t *testing.T) {
	payload, err := json.Marshal(portableBindingsFixture())
	if err != nil { t.Fatal(err) }
	parsed, err := ParsePortableMediaBindings(payload)
	if err != nil { t.Fatal(err) }
	if len(parsed.Artifacts) != 17 { t.Fatalf("artifact count=%d", len(parsed.Artifacts)) }
	payload = append(payload, []byte("\n{}")...)
	if _, err := ParsePortableMediaBindings(payload); err == nil { t.Fatal("trailing JSON accepted") }
}

func TestPlanPortableApplicationIsDeterministicHostNeutralAndUnauthorized(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	media, err := PlanPortableMedia(8<<30, commit, portableBindingsFixture())
	if err != nil { t.Fatal(err) }
	first, err := PlanPortableApplication(media)
	if err != nil { t.Fatal(err) }
	second, err := PlanPortableApplication(media)
	if err != nil { t.Fatal(err) }
	a, _ := json.Marshal(first)
	b, _ := json.Marshal(second)
	if string(a) != string(b) { t.Fatal("portable application plan is not deterministic") }
	if first.Schema != PortableApplicationPlanSchema || first.Status != "planned-not-authorized" {
		t.Fatalf("unexpected application plan identity: %#v", first)
	}
	if first.PhysicalWriteAuthorized || first.PhysicalDeviceBound || first.PublicPromotionAllowed {
		t.Fatalf("portable application plan crossed authorization boundary: %#v", first)
	}
	if first.WholeDiskRawImageNeeded {
		t.Fatal("portable v2 application unexpectedly requires a whole-disk raw image")
	}
	if len(first.Partitions) != 2 ||
		first.Partitions[0].Name != "ORDAX-ESP" ||
		first.Partitions[1].Name != "ORDAX-DATA" {
		t.Fatalf("portable application partition plan is wrong: %#v", first.Partitions)
	}
	if len(first.Operations) != 3+17+1+17+1 {
		t.Fatalf("operation count=%d", len(first.Operations))
	}
	if first.Operations[0].Kind != "partition-table-gpt-two-partition" ||
		first.Operations[1].Kind != "format-fat32" ||
		first.Operations[2].Kind != "format-exfat" {
		t.Fatalf("portable application destructive prefix is wrong: %#v", first.Operations[:3])
	}
	for _, artifact := range media.Artifacts {
		foundMaterialize := false
		foundReadback := false
		for _, operation := range first.Operations {
			if operation.ArtifactID != artifact.ID { continue }
			if operation.Kind == "materialize-artifact" &&
				operation.SHA256 == artifact.SHA256 &&
				operation.SizeBytes == artifact.SizeBytes &&
				operation.ReadbackRequired {
				foundMaterialize = true
			}
			if operation.Kind == "readback-sha256-size" &&
				operation.SHA256 == artifact.SHA256 &&
				operation.SizeBytes == artifact.SizeBytes &&
				operation.ReadbackRequired {
				foundReadback = true
			}
		}
		if !foundMaterialize || !foundReadback {
			t.Fatalf("artifact %q is not fully bound into apply+readback", artifact.ID)
		}
	}
}

func TestPlanPortableApplicationRejectsMutatedMediaPlan(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	base, err := PlanPortableMedia(8<<30, commit, portableBindingsFixture())
	if err != nil { t.Fatal(err) }

	cases := []func(*PortableMediaPlan){
		func(p *PortableMediaPlan) { p.PhysicalWriteAuthorized = true },
		func(p *PortableMediaPlan) { p.Profile = "native-disk" },
		func(p *PortableMediaPlan) { p.DataStartLBA++ },
		func(p *PortableMediaPlan) { p.Artifacts[0].TargetPath = "/wrong" },
		func(p *PortableMediaPlan) { p.Artifacts[0].SHA256 = "bad" },
	}
	for index, mutate := range cases {
		copyPlan := base
		copyPlan.Artifacts = append([]PortableMediaArtifactPlan(nil), base.Artifacts...)
		mutate(&copyPlan)
		if _, err := PlanPortableApplication(copyPlan); err == nil {
			t.Fatalf("mutated application plan case %d was accepted", index)
		}
	}
}

func TestParsePortableMediaPlanIsStrict(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	media, err := PlanPortableMedia(8<<30, commit, portableBindingsFixture())
	if err != nil { t.Fatal(err) }
	payload, err := json.Marshal(media)
	if err != nil { t.Fatal(err) }
	parsed, err := ParsePortableMediaPlan(payload)
	if err != nil { t.Fatal(err) }
	if parsed.SourceCommit != commit { t.Fatalf("source commit=%q", parsed.SourceCommit) }
	payload = append(payload, []byte("\n{}")...)
	if _, err := ParsePortableMediaPlan(payload); err == nil {
		t.Fatal("portable media plan parser accepted trailing JSON")
	}
}
