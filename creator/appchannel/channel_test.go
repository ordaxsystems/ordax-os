package appchannel

import (
	"bytes"
	"crypto/ed25519"
	"errors"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testTrust(t *testing.T) ([]byte, ed25519.PrivateKey, string) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	trust := TrustAnchor{Schema: TrustSchema, KeyID: "ordax-prototype-release-v1", PublicKeyB64: base64.StdEncoding.EncodeToString(public)}
	data, err := json.Marshal(trust)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	return data, private, hex.EncodeToString(digest[:])
}

func validManifest(body []byte, commit string, sequence int64) Manifest {
	digest := sha256.Sum256(body)
	return Manifest{
		Schema:            ManifestSchema,
		Purpose:           Purpose,
		SourceRepository:  SourceRepository,
		SourceCommit:      commit,
		Version:           "0.1.0",
		ReleaseSequence:   sequence,
		CreatedFromRecipe: Recipe,
		Artifact: Artifact{
			Name: ArtifactName,
			URL: ArtifactURL,
			SHA256: hex.EncodeToString(digest[:]),
			Size: int64(len(body)),
		},
	}
}

func signedEnvelope(t *testing.T, manifest Manifest, private ed25519.PrivateKey) []byte {
	t.Helper()
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	envelope := Envelope{Schema: EnvelopeSchema, Payload: payload, Signature: ed25519.Sign(private, payload), KeyID: "ordax-prototype-release-v1"}
	data, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

type staticTransport struct {
	envelope []byte
	artifact []byte
}

func (s staticTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	body := s.envelope
	contentType := "application/json"
	if req.URL.Path == "/ordaxsystems/ordax-os/releases/download/creator-app/OrdaX-Creator-App.exe" {
		body = s.artifact
		contentType = "application/octet-stream"
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Header: http.Header{"Content-Type": []string{contentType}},
		Body: io.NopCloser(strings.NewReader(string(body))),
		Request: req,
	}, nil
}

func TestVerifyEnvelopeAcceptsCanonicalAppPurpose(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest := validManifest([]byte("app"), "1111111111111111111111111111111111111111", 1)
	verified, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if verified.Purpose != Purpose || verified.ReleaseSequence != 1 {
		t.Fatalf("unexpected manifest: %+v", verified)
	}
}

func TestVerifyEnvelopeRejectsPurposeSignatureTrustAndSequence(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest := validManifest([]byte("app"), "1111111111111111111111111111111111111111", 1)
	manifest.Purpose = "creator-inspection-windows-amd64"
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil || !strings.Contains(err.Error(), "identity/purpose") {
		t.Fatalf("wrong purpose error=%v", err)
	}

	manifest = validManifest([]byte("app"), "1111111111111111111111111111111111111111", 1)
	data := signedEnvelope(t, manifest, private)
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	env.Signature[0] ^= 0xff
	tampered, _ := json.Marshal(env)
	if _, err := VerifyEnvelope(tampered, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("signature error=%v", err)
	}
	if _, err := VerifyEnvelope(data, trust, strings.Repeat("0", 64)); err == nil || !strings.Contains(err.Error(), "pinned") {
		t.Fatalf("trust pin error=%v", err)
	}

	manifest.ReleaseSequence = 0
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil || !strings.Contains(err.Error(), "source/version/sequence") {
		t.Fatalf("sequence error=%v", err)
	}
}

func TestAcquirePendingCannotActivateSignedAppWithoutPromotion(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	body := []byte("signed-authenticode-app-bytes-placeholder")
	manifest := validManifest(body, "2222222222222222222222222222222222222222", 2)
	envelope := signedEnvelope(t, manifest, private)
	client := &http.Client{Transport: staticTransport{envelope: envelope, artifact: body}}

	installed, changed, err := AcquirePending(client, root, "https://github.com/ordaxsystems/ordax-os/releases/download/creator-app/creator-app-envelope.json", trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || installed.ReleaseSequence != 2 || installed.SourceCommit != manifest.SourceCommit {
		t.Fatalf("unexpected installed app: %+v changed=%v", installed, changed)
	}
	if got, err := os.ReadFile(installed.Executable); err != nil || string(got) != string(body) {
		t.Fatalf("installed bytes mismatch: err=%v got=%q", err, got)
	}
	// The pending executable is signed and hashed but MUST NOT be current
	// before a separate launcher health-check and explicit promotion.
	if _, err := Current(root, trust, trustSHA); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("pending app bypassed launcher health gate: %v", err)
	}
	if _, err := PromotePending(root, installed.Manifest, trust, trustSHA); err != nil {
		t.Fatalf("explicit health-checked promotion rejected: %v", err)
	}
	current, err := Current(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if current.Executable != installed.Executable || current.ReleaseSequence != 2 {
		t.Fatalf("unexpected offline current: %+v", current)
	}
}

func TestCurrentRejectsTamperedInstalledApp(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	body := []byte("known-good-app")
	manifest := validManifest(body, "3333333333333333333333333333333333333333", 3)
	directory := filepath.Join(root, "versions", manifest.SourceCommit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ArtifactName), body, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), signedEnvelope(t, manifest, private), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trust, trustSHA); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ArtifactName), []byte("tampered"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("tampered app unexpectedly accepted: %v", err)
	}
}

func TestRollbackAndSequenceReuseAreRejected(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	body := []byte("current")
	currentManifest := validManifest(body, "4444444444444444444444444444444444444444", 4)
	directory := filepath.Join(root, "versions", currentManifest.SourceCommit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ArtifactName), body, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), signedEnvelope(t, currentManifest, private), 0o600); err != nil {
		t.Fatal(err)
	}

	older := validManifest([]byte("old"), "1111111111111111111111111111111111111111", 3)
	if err := checkPendingRollback(root, older, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "rollback rejected") {
		t.Fatalf("rollback error=%v", err)
	}
	reused := validManifest([]byte("other"), "5555555555555555555555555555555555555555", 4)
	if err := checkPendingRollback(root, reused, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "reused") {
		t.Fatalf("sequence reuse error=%v", err)
	}
	newer := validManifest([]byte("new"), "6666666666666666666666666666666666666666", 5)
	if err := checkPendingRollback(root, newer, trust, trustSHA); err != nil {
		t.Fatalf("newer app rejected: %v", err)
	}
}

func TestSignedAppRejectsSymlinkedVersionsRootAcrossReadAndPending(t *testing.T) {
	root := t.TempDir()
	external := t.TempDir()
	if err := os.Symlink(external, filepath.Join(root, "versions")); err != nil {
		t.Skipf("symlinks unavailable on this host: %v", err)
	}
	trust, private, trustSHA := testTrust(t)
	body := []byte("signed-app-byte-fixture")
	manifest := validManifest(body, "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 15)
	dir := filepath.Join(external, manifest.SourceCommit)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ArtifactName), body, 0o700); err != nil {
		t.Fatal(err)
	}
	envelope := signedEnvelope(t, manifest, private)
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), envelope, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "versions cache") {
		t.Fatalf("offline signed app followed redirected versions root: %v", err)
	}
	client := &http.Client{Transport: staticTransport{envelope: envelope, artifact: body}}
	if _, _, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA); err == nil {
		t.Fatal("pending signed app followed redirected versions root")
	}
}


type signedAppTestTransport func(*http.Request) (*http.Response, error)

func (fn signedAppTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

// Only signed local fixtures and an in-memory HTTP transport are used here.
// Pending staging must confirm the same signed envelope twice, and must
// never publish Current until launcher health-check and explicit promotion.
func TestSignedAppPendingRequiresSecondStableEnvelope(t *testing.T) {
	for _, mode := range []string{
		"stable", "network-failure", "http-failure",
		"changed-signed-artifact", "invalid-second-signature", "pointer-write-failure",
	} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			trust, private, trustSHA := testTrust(t)
			body := []byte("valid-signed-app-fixture")
			manifest := validManifest(body, "7777777777777777777777777777777777777777", 7)
			dir := filepath.Join(root, "versions", manifest.SourceCommit)
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, ArtifactName), body, 0o700); err != nil {
				t.Fatal(err)
			}
			first := signedEnvelope(t, manifest, private)
			second := first
			switch mode {
			case "changed-signed-artifact":
				rebound := manifest
				rebound.Artifact.SHA256 = strings.Repeat("a", 64)
				second = signedEnvelope(t, rebound, private)
			case "invalid-second-signature":
				var altered Envelope
				if err := json.Unmarshal(first, &altered); err != nil {
					t.Fatal(err)
				}
				altered.Signature[0] ^= 0xff
				var err error
				second, err = json.Marshal(altered)
				if err != nil {
					t.Fatal(err)
				}
			}
			requests := 0
			client := &http.Client{Transport: signedAppTestTransport(func(req *http.Request) (*http.Response, error) {
				requests++
				if req.URL.Host != "github.com" || req.URL.Path != "/ordaxsystems/ordax-os/releases/download/creator-app/creator-app-envelope.json" || requests > 2 {
					return nil, errors.New("unexpected signed app test URL or third request")
				}
				if requests == 2 {
					switch mode {
					case "network-failure":
						return nil, errors.New("synthetic signed app network failure")
					case "http-failure":
						return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: io.NopCloser(bytes.NewReader(nil)), Header: make(http.Header), Request: req}, nil
					case "pointer-write-failure":
						if err := os.Mkdir(filepath.Join(root, pendingEnvelopeName), 0o700); err != nil {
							return nil, err
						}
					}
				}
				data := first
				if requests == 2 {
					data = second
				}
				return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader(data)), Header: make(http.Header), Request: req}, nil
			})}
			got, changed, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA)
			if requests != 2 {
				t.Fatalf("expected two independent envelope fetches, got %d, err=%v", requests, err)
			}
			if mode == "stable" {
				if err != nil || !changed || got.SourceCommit != manifest.SourceCommit {
					t.Fatalf("stable signed app not staged: pending=%t installed=%+v err=%v", changed, got, err)
				}
				if _, err := Current(root, trust, trustSHA); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("signed app became current without health-check: %v", err)
				}
				if _, err := PromotePending(root, got.Manifest, trust, trustSHA); err != nil {
					t.Fatalf("explicit health-checked promotion failed: %v", err)
				}
				if current, err := Current(root, trust, trustSHA); err != nil || current.Manifest != manifest {
					t.Fatalf("verified App did not activate after promotion: %+v err=%v", current, err)
				}
			} else {
				if err == nil || changed || got.SourceCommit != "" {
					t.Fatalf("unconfirmed signed app was returned as success: changed=%t installed=%+v err=%v", changed, got, err)
				}
				if _, err := Current(root, trust, trustSHA); err == nil {
					t.Fatal("unconfirmed signed app became offline current")
				}
				if mode != "pointer-write-failure" {
					if _, err := os.Lstat(filepath.Join(root, pendingEnvelopeName)); !errors.Is(err, os.ErrNotExist) {
						t.Fatalf("unconfirmed signed App retained pending marker: %v", err)
					}
				}
			}
		})
	}
}

func TestSignedAppRejectsNoncanonicalReleaseAssetURL(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	m := validManifest([]byte("app"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1)
	for _, badURL := range []string{
		"https://github.com/ordaxsystems/ordax-os/releases/download/creator-app/OrdaX-Creator-App.exe?",
		"https://github.com/ordaxsystems/ordax-os/releases/download/creator-app/OrdaX-Creator-App.exe?download=1",
		"https://github.com/ordaxsystems/ordax-os/releases/download/creator-app/OrdaX-Creator-App%2Eexe",
		"https://github.com/ordaxsystems/ordax-os/releases/download/creator-app/OrdaX-Creator-App.exe#fragment",
		"https://github.com/ordaxsystems/ordax-os/releases/download/creator-app/nested/OrdaX-Creator-App.exe",
		"https://github.com.evil.example/ordaxsystems/ordax-os/releases/download/creator-app/OrdaX-Creator-App.exe",
	} {
		m.Artifact.URL = badURL
		if _, err := VerifyEnvelope(signedEnvelope(t, m, private), trust, trustSHA); err == nil {
			t.Errorf("noncanonical signed asset URL %q accepted", badURL)
		}
	}
	m.Artifact.URL = ArtifactURL
	if _, err := VerifyEnvelope(signedEnvelope(t, m, private), trust, trustSHA); err != nil {
		t.Fatalf("canonical signed asset URL rejected: %v", err)
	}
}

func TestSignedAppPendingRejectsSameCommitReboundRelease(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	body := []byte("unchanged-signed-app")
	baseline := validManifest(body, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 4)
	directory := filepath.Join(root, "versions", baseline.SourceCommit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ArtifactName), body, 0o700); err != nil {
		t.Fatal(err)
	}
	pointer := signedEnvelope(t, baseline, private)
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), pointer, 0o600); err != nil {
		t.Fatal(err)
	}
	rebound := baseline
	rebound.Artifact.SHA256 = strings.Repeat("b", 64)
	client := &http.Client{Transport: staticTransport{envelope: signedEnvelope(t, rebound, private), artifact: body}}
	if installed, changed, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA); err == nil || changed || installed.SourceCommit != "" {
		t.Fatalf("rebound same-commit app was accepted: changed=%t installed=%+v err=%v", changed, installed, err)
	}
	current, err := Current(root, trust, trustSHA)
	if err != nil || current.Manifest != baseline {
		t.Fatalf("last verified App was replaced by rebind: current=%+v err=%v", current, err)
	}
}

func TestOfflineSignedAppRejectsOversizedExecutableBeforeHashing(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	body := []byte("signed-app-executable")
	manifest := validManifest(body, "9999999999999999999999999999999999999999", 9)
	directory := filepath.Join(root, "versions", manifest.SourceCommit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(directory, ArtifactName)
	if err := os.WriteFile(executable, body, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), signedEnvelope(t, manifest, private), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trust, trustSHA); err != nil {
		t.Fatalf("valid signed app rejected: %v", err)
	}
	if err := os.Truncate(executable, 8<<20); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "changed size") {
		t.Fatalf("oversized signed app executable was accepted: %v", err)
	}
}
