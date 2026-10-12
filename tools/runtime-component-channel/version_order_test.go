package main

import (
	"strings"
	"testing"
)

func TestRuntimeComponentVersionPrecedenceMatchesCanonicalManifest(t *testing.T) {
	cases := []struct {
		candidate string
		current   string
		want      int
	}{
		{"1.0.1", "1.0.0", 1},
		{"1.0.0", "1.0.0", 0},
		{"0.9.9", "1.0.0", -1},
		{"1.0.0", "1.0.0-rc.2", 1},
		{"1.0.0-rc.10", "1.0.0-rc.2", 1},
		{"1.0.0-rc.2", "1.0.0-rc.10", -1},
		{"1.0.0-alpha.2", "1.0.0-alpha.10", -1},
		{"1.0.0-alpha", "1.0.0-alpha.1", -1},
		{"1.0.0-1", "1.0.0-alpha", -1},
		{"1.0.0-alpha", "1.0.0-1", 1},
		{"90071992547409931234.0.0", "90071992547409931233.99.99", 1},
		{"1.0.0-9999999999999999999999", "1.0.0-9999999999999999999998", 1},
	}
	for _, tc := range cases {
		got, err := compareRuntimeComponentVersions(tc.candidate, tc.current)
		if err != nil {
			t.Fatalf("%q vs %q: %v", tc.candidate, tc.current, err)
		}
		if got != tc.want {
			t.Fatalf("precedence %q vs %q = %d, expected %d", tc.candidate, tc.current, got, tc.want)
		}
	}
	for _, bad := range []string{"", "1.0", "01.0.0", "1.0.0-rc..1", "1.0.0-", "1.0.0-alpha_1", strings.Repeat("9", 129) + ".0.0"} {
		if _, err := compareRuntimeComponentVersions(bad, "1.0.0"); err == nil {
			t.Fatalf("accepted malformed version %q", bad)
		}
	}
}

func TestArmPendingRejectsEqualAndLowerSignedVersionsWithoutChangingActivationState(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	current := addActivationV2Candidate(
		t, fixture, "2.0.0", "1111111111111111111111111111111111111111",
	)
	state := healthyPromoteV2(t, fixture, current)
	for _, attempted := range []struct {
		version string
		commit  string
	}{
		{"2.0.0", "2222222222222222222222222222222222222222"},
		{"1.9.9", "3333333333333333333333333333333333333333"},
		{"2.0.0-rc.5", "4444444444444444444444444444444444444444"},
	} {
		candidate := addActivationV2Candidate(t, fixture, attempted.version, attempted.commit)
		revision := state.Revision
		if _, err := armPendingStateAtRevision(candidate.slot, fixture.trustPath, fixture.root, &revision); err == nil ||
			!strings.Contains(err.Error(), "newer semantic version") {
			t.Fatalf("arm accepted non-forward signed candidate %s: %v", attempted.version, err)
		}
		unchanged, err := readActivationState(fixture.root, "internet")
		if err != nil {
			t.Fatal(err)
		}
		if unchanged.Revision != state.Revision || !sameSlotIdentity(unchanged.Current, state.Current) ||
			unchanged.Pending != nil || unchanged.Previous != nil {
			t.Fatalf("invalid signed downgrade mutated state: %+v", unchanged)
		}
	}
	newer := addActivationV2Candidate(t, fixture, "2.0.1", "5555555555555555555555555555555555555555")
	revision := state.Revision
	armed, err := armPendingStateAtRevision(newer.slot, fixture.trustPath, fixture.root, &revision)
	if err != nil {
		t.Fatal(err)
	}
	if armed.Pending == nil || armed.Pending.Version != "2.0.1" ||
		armed.Revision != revision+1 || !sameSlotIdentity(armed.Current, state.Current) {
		t.Fatalf("valid forward-only signed candidate not armed correctly: %+v", armed)
	}
}

func TestArmPendingPrereleaseMovesForwardOnly(t *testing.T) {
	fixture := makeActivationV2Fixture(t)
	pre := addActivationV2Candidate(t, fixture, "1.2.0-rc.9", "1111111111111111111111111111111111111111")
	state := healthyPromoteV2(t, fixture, pre)
	older := addActivationV2Candidate(t, fixture, "1.2.0-rc.3", "2222222222222222222222222222222222222222")
	if _, err := armPendingState(older.slot, fixture.trustPath, fixture.root); err == nil {
		t.Fatal("prerelease downgrade bypassed lock without expected revision")
	}
	final := addActivationV2Candidate(t, fixture, "1.2.0", "3333333333333333333333333333333333333333")
	revision := state.Revision
	armed, err := armPendingStateAtRevision(final.slot, fixture.trustPath, fixture.root, &revision)
	if err != nil {
		t.Fatal(err)
	}
	if armed.Pending == nil || armed.Pending.Version != "1.2.0" {
		t.Fatalf("final release did not supersede prerelease: %+v", armed)
	}
}
