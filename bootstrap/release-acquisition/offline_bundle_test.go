package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func offlineFixture(t *testing.T, trust TrustAnchor, key ed25519.PrivateKey, manifest Manifest, payloads map[string][]byte) string {
	t.Helper()
	directory := t.TempDir()
	envelope := signedEnvelope(t, manifest, trust.KeyID, key)
	if err := os.WriteFile(filepath.Join(directory, "release-envelope.json"), envelope, 0o600); err != nil {
		t.Fatal(err)
	}
	for name, contents := range payloads {
		if err := os.WriteFile(filepath.Join(directory, name), contents, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return directory
}

func TestOfflineBundleMaterializesLegacyAndPortableReleasesWithoutNetwork(t *testing.T) {
	for _, schema := range []string{manifestSchema, manifestSchemaV2, manifestSchemaV3, manifestSchemaV4} {
		t.Run(schema, func(t *testing.T) {
			trust, public, private := testKeys(t)
			system := validPortableEROFS()
			runtime := validPortableEROFS()
			runtime[len(runtime)-1] = 0x36
			ai := validPortableEROFS()
			ai[len(ai)-1] = 0x54
			var manifest Manifest
			files := map[string][]byte{}
			switch schema {
			case manifestSchema:
				system = validSystemTar(t)
				manifest = manifestFor("https://example.invalid/system.tar", system)
				files["system.tar"] = system
			case manifestSchemaV2:
				manifest = manifestForPortable("https://example.invalid/system.erofs", system)
				files["system.erofs"] = system
			case manifestSchemaV3:
				manifest = manifestForPortableV3("https://example.invalid/system.erofs", "https://example.invalid/native-surface-runtime.erofs", system, runtime)
				files["system.erofs"], files["native-surface-runtime.erofs"] = system, runtime
			case manifestSchemaV4:
				manifest = manifestForPortableV4("https://example.invalid/system.erofs", "https://example.invalid/native-surface-runtime.erofs", "https://example.invalid/local-ai-runtime.erofs", system, runtime, ai)
				files["system.erofs"], files["native-surface-runtime.erofs"], files["local-ai-runtime.erofs"] = system, runtime, ai
			}
			directory := offlineFixture(t, trust, private, manifest, files)
			root := filepath.Join(t.TempDir(), "release-root")
			bundle, err := prepareLocalBundle(directory, "", root, trust, public, defaultRepo, testCommit, schema)
			if err != nil {
				t.Fatalf("offline preflight: %v", err)
			}
			// nil HTTP client and invalid DNS host make any fallback detectable.
			switch schema {
			case manifestSchema:
				receipt, err := materialize(nil, "", root, trust, public, defaultRepo, testCommit, bundle)
				if err != nil || receipt.Idempotent || receipt.SourceCommit != testCommit {
					t.Fatalf("legacy materialization failed: %#v %v", receipt, err)
				}
				second, err := materialize(nil, "", root, trust, public, defaultRepo, testCommit, bundle)
				if err != nil || !second.Idempotent {
					t.Fatalf("legacy retry not idempotent: %#v %v", second, err)
				}
			case manifestSchemaV2:
				receipt, err := materializePortable(nil, "", root, trust, public, defaultRepo, testCommit, bundle)
				if err != nil || receipt.ActivationAllowed || receipt.Idempotent {
					t.Fatalf("v2 offline materialization failed: %#v %v", receipt, err)
				}
				if _, err := verifyPortableExact(root, trust, public, defaultRepo, testCommit); err != nil {
					t.Fatal(err)
				}
			case manifestSchemaV3:
				receipt, err := materializePortableV3(nil, "", root, trust, public, defaultRepo, testCommit, bundle)
				if err != nil || receipt.ActivationAllowed || receipt.Idempotent {
					t.Fatalf("v3 offline materialization failed: %#v %v", receipt, err)
				}
				if _, err := verifyPortableV3Exact(root, trust, public, defaultRepo, testCommit); err != nil {
					t.Fatal(err)
				}
			case manifestSchemaV4:
				receipt, err := materializePortableV4(nil, "", root, trust, public, defaultRepo, testCommit, bundle)
				if err != nil || receipt.ActivationAllowed || receipt.Idempotent {
					t.Fatalf("v4 offline materialization failed: %#v %v", receipt, err)
				}
				if _, err := verifyPortableV4Exact(root, trust, public, defaultRepo, testCommit); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := os.Lstat(filepath.Join(root, "current")); !os.IsNotExist(err) {
				t.Fatal("offline materialization must not activate current")
			}
			if _, err := os.Lstat(filepath.Join(root, "known-good")); !os.IsNotExist(err) {
				t.Fatal("offline materialization must not write known-good")
			}
			if err := os.WriteFile(filepath.Join(directory, "release-envelope.json"), []byte("tampered"), 0o600); err != nil {
				t.Fatal(err)
			}
			// The manifest bytes are fixed by preflight, and no activation occurs;
			// a fresh preflight refuses the tampered input.
			if _, err := prepareLocalBundle(directory, "", root, trust, public, defaultRepo, testCommit, schema); err == nil {
				t.Fatal("tampered envelope accepted by second preflight")
			}
		})
	}
}

func TestOfflineBundleRejectsTamperAndUnsafeInputBeforeMutatingDestination(t *testing.T) {
	trust, pub, key := testKeys(t)
	data := validPortableEROFS()
	manifest := manifestForPortable("https://example.invalid/system.erofs", data)
	cases := []struct {
		name string
		change func(*testing.T, string)
	}{
		{"truncated", func(t *testing.T, dir string) {
			t.Helper()
			if err := os.WriteFile(filepath.Join(dir, "system.erofs"), data[:128], 0o600); err != nil { t.Fatal(err) }
		}},
		{"same-size digest mismatch", func(t *testing.T, dir string) {
			t.Helper()
			other := bytes.Clone(data)
			other[len(other)-1] ^= 1
			if err := os.WriteFile(filepath.Join(dir, "system.erofs"), other, 0o600); err != nil { t.Fatal(err) }
		}},
		{"missing", func(t *testing.T, dir string) {
			t.Helper()
			if err := os.Remove(filepath.Join(dir, "system.erofs")); err != nil { t.Fatal(err) }
		}},
		{"symlink artifact", func(t *testing.T, dir string) {
			t.Helper()
			path := filepath.Join(dir, "system.erofs")
			if err := os.Remove(path); err != nil { t.Fatal(err) }
			if err := os.Symlink(filepath.Join(t.TempDir(), "outside"), path); err != nil { t.Fatal(err) }
		}},
		{"symlink envelope", func(t *testing.T, dir string) {
			t.Helper()
			path := filepath.Join(dir, "release-envelope.json")
			target := filepath.Join(t.TempDir(), "envelope.json")
			if err := os.Rename(path, target); err != nil { t.Fatal(err) }
			if err := os.Symlink(target, path); err != nil { t.Fatal(err) }
		}},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			directory := offlineFixture(t, trust, key, manifest, map[string][]byte{"system.erofs": data})
			root := filepath.Join(t.TempDir(), "root")
			item.change(t, directory)
			if _, err := prepareLocalBundle(directory, "", root, trust, pub, defaultRepo, testCommit, manifestSchemaV2); err == nil {
				t.Fatal("unsafe offline package accepted")
			}
			if _, err := os.Lstat(root); !os.IsNotExist(err) {
				t.Fatal("rejected package modified output root")
			}
		})
	}
}

func TestOfflineBundleRejectsWrongIdentityOverlapAndNetworkFallback(t *testing.T) {
	trust, pub, key := testKeys(t)
	system := validPortableEROFS()
	manifest := manifestForPortable("https://example.invalid/system.erofs", system)
	dir := offlineFixture(t, trust, key, manifest, map[string][]byte{"system.erofs": system})
	root := filepath.Join(t.TempDir(), "root")
	for _, input := range []struct {
		dir, url, commit, schema, root string
	}{
		{dir, "https://example.invalid/envelope", testCommit, manifestSchemaV2, root},
		{"", "", testCommit, manifestSchemaV2, root},
		{dir, "", strings.Repeat("b", 40), manifestSchemaV2, root},
		{dir, "", testCommit, manifestSchemaV3, root},
		{dir, "", testCommit, manifestSchemaV2, filepath.Join(dir, "dest")},
		{dir, "", testCommit, manifestSchemaV2, filepath.Dir(dir)},
	} {
		if _, err := prepareLocalBundle(input.dir, input.url, input.root, trust, pub, defaultRepo, input.commit, input.schema); err == nil {
			t.Fatalf("unsafe source/identity accepted: %#v", input)
		}
	}
	bundle, err := prepareLocalBundle(dir, "", root, trust, pub, defaultRepo, testCommit, manifestSchemaV2)
	if err != nil { t.Fatal(err) }
	// Once the source is preflighted, a swapped payload must still fail in
	// the exact copy writer and must never become a release.
	if err := os.WriteFile(filepath.Join(dir, "system.erofs"), []byte("changed after preflight"), 0o600); err != nil { t.Fatal(err) }
	if _, err := materializePortable(nil, "", root, trust, pub, defaultRepo, testCommit, bundle); err == nil {
		t.Fatal("modified source after preflight accepted")
	}
	if _, err := os.Lstat(filepath.Join(root, "releases", testCommit)); !os.IsNotExist(err) {
		t.Fatal("rejected artifact left a published release")
	}
}

func TestOfflineBundleCommandRejectsInvalidTrustOrMixedSource(t *testing.T) {
	trust, pub, key := testKeys(t)
	_ = pub
	data := validPortableEROFS()
	manifest := manifestForPortable("https://example.invalid/system.erofs", data)
	directory := offlineFixture(t, trust, key, manifest, map[string][]byte{"system.erofs": data})
	trustData, err := json.Marshal(trust)
	if err != nil { t.Fatal(err) }
	trustPath := filepath.Join(t.TempDir(), "trust.json")
	if err := os.WriteFile(trustPath, trustData, 0o600); err != nil { t.Fatal(err) }
	root := filepath.Join(t.TempDir(), "root")
	args := []string{"--local-bundle", directory, "--root", root, "--trust", trustPath, "--expected-commit", testCommit}
	if err := materializePortableCommand(args); err != nil {
		t.Fatalf("offline CLI rejected canonical signed package: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "releases", testCommit, "system.erofs")); err != nil { t.Fatal(err) }
	args = append(args, "--envelope-url", "https://example.invalid/unsigned")
	if err := materializePortableCommand(args); err == nil {
		t.Fatal("mixed local/HTTPS sources accepted")
	}
}
