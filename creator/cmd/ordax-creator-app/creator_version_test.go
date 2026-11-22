package main

import (
 "encoding/json"
 "os"
 "path/filepath"
 "testing"
)

func TestCreatorProductVersion(t *testing.T) {
 for _, s := range []string{"0.6.1-dev","1.0.0","1.0.0-rc.2"} {
  if !validCreatorVersion(s) { t.Fatalf("valid version rejected: %q",s) }
 }
 for _, s := range []string{"","owner-2bad2d125d7e","../1.0.0","1.0","1.2.3\n","V1.0.0"} {
  if validCreatorVersion(s) { t.Fatalf("invalid version accepted: %q",s) }
 }
}

func TestCreatorProductVersionSingleSource(t *testing.T) {
 content, err := os.ReadFile(filepath.Join("..","..","version.json"))
 if err != nil { t.Fatal(err) }
 var data struct {
  Schema string `json:"$schema"`
  Version string `json:"version"`
 }
 if err := json.Unmarshal(content, &data); err != nil { t.Fatal(err) }
 if data.Schema != "ordax.creator-product-version/1" || !validCreatorVersion(data.Version) {
  t.Fatalf("invalid canonical Creator version metadata: schema=%q version=%q", data.Schema, data.Version)
 }
 var fields map[string]any
 if err := json.Unmarshal(content, &fields); err != nil { t.Fatal(err) }
 if len(fields) != 2 { t.Fatalf("Creator version source must have exactly schema and version, got %d keys", len(fields)) }
}

func TestCreatorBinaryBuildIdentityRejectsMissingOrForgedValues(t *testing.T) {
	oldVersion, oldSource := buildCreatorVersion, buildCreatorSourceCommit
	t.Cleanup(func() {
		buildCreatorVersion, buildCreatorSourceCommit = oldVersion, oldSource
	})
	const commit = "67517dff22647d531cd31ac834931b12406b1b3f"
	for _, tc := range []struct {
		name, version, commit string
		ok bool
	}{
		{"valid-development", "0.6.3-dev", commit, true},
		{"valid-stable-version-format", "1.0.0", commit, true},
		{"no-binding", "", "", false},
		{"no-commit", "0.6.3-dev", "", false},
		{"wrong-length-commit", "0.6.3-dev", commit[:12], false},
		{"uppercase-commit", "0.6.3-dev", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", false},
		{"invalid-commit", "0.6.3-dev", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", false},
		{"invalid-version", "../0.6.3-dev", commit, false},
		{"newline-version", "0.6.3-dev\n", commit, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			buildCreatorVersion, buildCreatorSourceCommit = tc.version, tc.commit
			version, source, ok := creatorBinaryBuildIdentity()
			if ok != tc.ok {
				t.Fatalf("build binding accepted=%t, want %t", ok, tc.ok)
			}
			if ok && (version != tc.version || source != tc.commit) {
				t.Fatalf("build binding changed identity: version=%q source=%q", version, source)
			}
			if !ok && (version != "" || source != "") {
				t.Fatalf("invalid binding leaked partial identity: %q %q", version, source)
			}
		})
	}
}
