package releaseidentity

import (
	"strings"
	"testing"
)

type signedTestManifest struct {
	SourceCommit    string
	ReleaseSequence int64
	ArtifactSHA256  string
}

func TestCheckImmutableSignedReleaseIdentity(t *testing.T) {
	const first = "1111111111111111111111111111111111111111"
	const second = "2222222222222222222222222222222222222222"
	base := signedTestManifest{SourceCommit: first, ReleaseSequence: 4, ArtifactSHA256: strings.Repeat("a", 64)}
	for _, tc := range []struct {
		name, commit string
		sequence     int64
		manifest     signedTestManifest
		wantError    string
	}{
		{name: "identical signed release", commit: first, sequence: 4, manifest: base},
		{name: "new source and monotonic sequence", commit: second, sequence: 5, manifest: signedTestManifest{SourceCommit: second, ReleaseSequence: 5, ArtifactSHA256: strings.Repeat("b", 64)}},
		{name: "older signed release", commit: second, sequence: 3, manifest: signedTestManifest{SourceCommit: second, ReleaseSequence: 3}, wantError: "rollback rejected"},
		{name: "sequence reused with different commit", commit: second, sequence: 4, manifest: signedTestManifest{SourceCommit: second, ReleaseSequence: 4}, wantError: "reused"},
		{name: "same source with higher sequence", commit: first, sequence: 5, manifest: signedTestManifest{SourceCommit: first, ReleaseSequence: 5, ArtifactSHA256: base.ArtifactSHA256}, wantError: "source commit"},
		{name: "same source and sequence with different signed artifact", commit: first, sequence: 4, manifest: signedTestManifest{SourceCommit: first, ReleaseSequence: 4, ArtifactSHA256: strings.Repeat("b", 64)}, wantError: "source commit"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := Check("Creator test", tc.commit, tc.sequence, tc.manifest, first, 4, base)
			if tc.wantError == "" && err != nil {
				t.Fatal(err)
			}
			if tc.wantError != "" && (err == nil || !strings.Contains(err.Error(), tc.wantError)) {
				t.Fatalf("expected %q, got %v", tc.wantError, err)
			}
		})
	}
}
