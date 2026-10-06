package main

import "testing"

func canonicalSourceRelease(componentID, repository string) releaseDescriptor {
	return releaseDescriptor{
		Schema:            releaseSchema,
		SourceRepository:  repository,
		SourceCommit:      "0123456789abcdef0123456789abcdef01234567",
		CreatedFromRecipe: createdFromRecipe,
		Component: releaseComponent{
			ID:            componentID,
			Version:       "0.1.0",
			ReleaseMode:   "component-slot",
			PackageSchema: packageSchema,
		},
		Package: packageBinding{
			Name:           componentID + ".zip",
			SHA256:         "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			Size:           1,
			ManifestSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		},
		Activation: activationPolicy{
			DirectActivationAllowed: false,
			PendingHealthRequired:    true,
		},
	}
}

func TestCanonicalComponentSourceRepositoryPolicy(t *testing.T) {
	cases := []struct {
		name       string
		component  string
		repository string
		wantOK     bool
	}{
		{name: "platform component stays in OS repository", component: "internet", repository: sourceRepository, wantOK: true},
		{name: "Notes is sourced from ordax-apps", component: "notes", repository: appsSourceRepository, wantOK: true},
		{name: "Studio is sourced from ordax-apps", component: "studio", repository: appsSourceRepository, wantOK: true},
		{name: "Notes cannot claim OS repository", component: "notes", repository: sourceRepository, wantOK: false},
		{name: "platform component cannot claim ordax-apps", component: "internet", repository: appsSourceRepository, wantOK: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateReleaseDescriptor(canonicalSourceRelease(tc.component, tc.repository))
			if tc.wantOK && err != nil {
				t.Fatalf("expected canonical source repository to pass: %v", err)
			}
			if !tc.wantOK && err == nil {
				t.Fatal("non-canonical source repository unexpectedly passed")
			}
		})
	}
}

func TestUnknownComponentDefaultsToPlatformRepository(t *testing.T) {
	if got := canonicalSourceRepository("future-component"); got != sourceRepository {
		t.Fatalf("unexpected default source repository: %q", got)
	}
}
