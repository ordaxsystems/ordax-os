package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func portableVerifyReceiptFixture(t *testing.T, version int) (PortableVerifyReceipt, string) {
	t.Helper()
	trust, pub, priv := testKeys(t)
	systemData := validPortableEROFS()
	runtimeData := append([]byte(nil), systemData...)
	runtimeData[len(runtimeData)-1] = 0x31
	aiData := append([]byte(nil), systemData...)
	aiData[len(aiData)-1] = 0x32

	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	t.Cleanup(server.Close)

	var manifest Manifest
	switch version {
	case 2:
		manifest = manifestForPortable(server.URL+"/system.erofs", systemData)
	case 3:
		manifest = manifestForPortableV3(
			server.URL+"/system.erofs",
			server.URL+"/native-surface-runtime.erofs",
			systemData,
			runtimeData,
		)
	case 4:
		manifest = manifestForPortableV4(
			server.URL+"/system.erofs",
			server.URL+"/native-surface-runtime.erofs",
			server.URL+"/local-ai-runtime.erofs",
			systemData,
			runtimeData,
			aiData,
		)
	default:
		t.Fatalf("unsupported portable fixture version: %d", version)
	}
	envelope := signedEnvelope(t, manifest, trust.KeyID, priv)
	mux.HandleFunc("/release.json", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(envelope) })
	mux.HandleFunc("/system.erofs", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(systemData) })
	mux.HandleFunc("/native-surface-runtime.erofs", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(runtimeData) })
	mux.HandleFunc("/local-ai-runtime.erofs", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(aiData) })

	root := filepath.Join(t.TempDir(), ".ordax")
	var receipt PortableVerifyReceipt
	var err error
	switch version {
	case 2:
		if _, err = materializePortable(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo, testCommit); err == nil {
			receipt, err = verifyPortableExact(root, trust, pub, defaultRepo, testCommit)
		}
	case 3:
		if _, err = materializePortableV3(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo, testCommit); err == nil {
			receipt, err = verifyPortableV3Exact(root, trust, pub, defaultRepo, testCommit)
		}
	case 4:
		if _, err = materializePortableV4(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo, testCommit); err == nil {
			receipt, err = verifyPortableV4Exact(root, trust, pub, defaultRepo, testCommit)
		}
	}
	if err != nil {
		t.Fatal(err)
	}
	return receipt, manifest.Artifacts[0].SHA256
}

func TestPortableVerifyReceiptJSONCarriesAuthenticatedSystemDigest(t *testing.T) {
	cases := []struct {
		name        string
		version     int
		expectedKey map[string]bool
	}{
		{
			name:    "v2",
			version: 2,
			expectedKey: map[string]bool{
				"status": true, "source_commit": true, "release_path": true,
				"artifact_path": true, "artifact_sha256": true, "activation_allowed": true,
			},
		},
		{
			name:    "v3",
			version: 3,
			expectedKey: map[string]bool{
				"status": true, "source_commit": true, "release_path": true,
				"artifact_path": true, "artifact_sha256": true, "runtime_path": true,
				"activation_allowed": true,
			},
		},
		{
			name:    "v4",
			version: 4,
			expectedKey: map[string]bool{
				"status": true, "source_commit": true, "release_path": true,
				"artifact_path": true, "artifact_sha256": true, "runtime_path": true,
				"ai_runtime_path": true, "activation_allowed": true,
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			receipt, wantDigest := portableVerifyReceiptFixture(t, tc.version)
			encoded, err := json.Marshal(receipt)
			if err != nil {
				t.Fatal(err)
			}
			var wire map[string]any
			if err := json.Unmarshal(encoded, &wire); err != nil {
				t.Fatal(err)
			}
			if len(wire) != len(tc.expectedKey) {
				t.Fatalf("unexpected handoff field count: got=%d want=%d payload=%s", len(wire), len(tc.expectedKey), encoded)
			}
			for key := range wire {
				if !tc.expectedKey[key] {
					t.Fatalf("unexpected handoff field %q in %s", key, encoded)
				}
			}
			if wire["artifact_sha256"] != wantDigest {
				t.Fatalf("handoff lost authenticated system digest: got=%v want=%s", wire["artifact_sha256"], wantDigest)
			}
			if wire["activation_allowed"] != false {
				t.Fatalf("handoff unexpectedly allows activation: %s", encoded)
			}
		})
	}
}

func TestPortableVerifyReceiptJSONFailsClosedAfterSystemMutation(t *testing.T) {
	receipt, _ := portableVerifyReceiptFixture(t, 2)
	data, err := os.ReadFile(receipt.ArtifactPath)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 0x01
	if err := os.WriteFile(receipt.ArtifactPath, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := json.Marshal(receipt); err == nil || !strings.Contains(err.Error(), "digest mismatch") {
		t.Fatalf("post-verification system mutation reached handoff JSON: %v", err)
	}
}

func TestPortableVerifyReceiptJSONRejectsManifestEnvelopeDivergence(t *testing.T) {
	receipt, _ := portableVerifyReceiptFixture(t, 4)
	manifestPath := filepath.Join(receipt.ReleasePath, "release-manifest.json")
	manifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	manifest = append(manifest, '\n')
	if err := os.WriteFile(manifestPath, manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := json.Marshal(receipt); err == nil || !strings.Contains(err.Error(), "differs from signed envelope payload") {
		t.Fatalf("divergent manifest reached handoff JSON: %v", err)
	}
}
