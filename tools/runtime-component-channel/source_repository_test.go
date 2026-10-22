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
		{name: "unlisted platform component stays in OS repository", component: "settings", repository: sourceRepository, wantOK: true},
		{name: "Internet is sourced from ordax-apps", component: "internet", repository: appsSourceRepository, wantOK: true},
		{name: "Assistant is sourced from ordax-apps", component: "assistant", repository: appsSourceRepository, wantOK: true},
		{name: "Projects is sourced from ordax-apps", component: "projects", repository: appsSourceRepository, wantOK: true},
		{name: "Activity is sourced from ordax-apps", component: "activity", repository: appsSourceRepository, wantOK: true},
		{name: "Network is sourced from ordax-apps", component: "network", repository: appsSourceRepository, wantOK: true},
		{name: "Notes is sourced from ordax-apps", component: "notes", repository: appsSourceRepository, wantOK: true},
		{name: "Studio is sourced from ordax-apps", component: "studio", repository: appsSourceRepository, wantOK: true},
		{name: "Product Runtime is sourced from canonical Runtime", component: "product-runtime", repository: productRuntimeSourceRepository, wantOK: true},
		{name: "Product Runtime cannot claim OS repository", component: "product-runtime", repository: sourceRepository, wantOK: false},
		{name: "Product Runtime cannot claim apps repository", component: "product-runtime", repository: appsSourceRepository, wantOK: false},
		{name: "Internet cannot claim Runtime repository", component: "internet", repository: productRuntimeSourceRepository, wantOK: false},
		{name: "unlisted platform component cannot claim ordax-apps", component: "settings", repository: appsSourceRepository, wantOK: false},
		{name: "Notes cannot claim OS repository", component: "notes", repository: sourceRepository, wantOK: false},
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
