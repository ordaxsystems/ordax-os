package physicalchannel

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCurrentRequiresSignedCachedEnvelopeAndFreshBindings(t *testing.T) {
	root := t.TempDir()
	trustBytes, private, trustSHA := testTrust(t)
	commit := "0123456789abcdef0123456789abcdef01234567"
	candidate := sequencedCandidate(t, root, commit, 1)
	cacheSignedCandidate(t, root, candidate, private)

	installed, err := Current(root, trustBytes, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if installed.SourceCommit != commit || installed.Directory != candidate.Directory {
		t.Fatalf("unexpected cached candidate: %+v", installed)
	}
	sequence, err := ReleaseSequence(installed)
	if err != nil {
		t.Fatal(err)
	}
	if sequence != 1 {
		t.Fatalf("release sequence=%d want=1", sequence)
	}

	if err := os.WriteFile(filepath.Join(candidate.Directory, "provenance.json"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trustBytes, trustSHA); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("tampered cached candidate unexpectedly accepted: %v", err)
	}
}

func TestCurrentRejectsTamperedCachedEnvelope(t *testing.T) {
	trustBytes, private, trustSHA := testTrust(t)
	manifest := validManifest()
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	signature := ed25519.Sign(private, payload)
	signature[0] ^= 0xff
	envelopeBytes, err := json.Marshal(Envelope{
		Schema: EnvelopeSchema,
		Payload: payload,
		Signature: signature,
		KeyID: "ordax-prototype-release-v1",
	})
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), envelopeBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trustBytes, trustSHA); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("tampered cached envelope unexpectedly accepted: %v", err)
	}
}

func TestPhysicalChannelRejectsRedirectedVersionsRootForCachedAndOnlineCandidate(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	candidate := sequencedCandidate(t, root, "0123456789abcdef0123456789abcdef01234567", 1)
	cacheSignedCandidate(t, root, candidate, private)
	if _, err := Current(root, trust, trustSHA); err != nil {
		t.Fatalf("legitimate cached candidate rejected before symlink: %v", err)
	}
	versions := filepath.Join(root, "versions")
	backing := filepath.Join(t.TempDir(), "versions")
	if err := os.Rename(versions, backing); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(backing, versions); err != nil {
		t.Skipf("symlinks unavailable on this host: %v", err)
	}
	if _, err := Current(root, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "versions cache") {
		t.Fatalf("physical offline cache followed redirected versions root: %v", err)
	}
	envelope := signedEnvelope(t, validManifest(), private)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(envelope)
	}))
	defer server.Close()
	if _, _, err := Acquire(server.Client(), root, server.URL, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "versions cache") {
		t.Fatalf("physical online acquisition followed redirected versions root: %v", err)
	}
	if _, _, err := AcquireCached(server.Client(), root, server.URL, trust, trustSHA); err == nil {
		t.Fatal("physical signed cache promotion accepted redirected versions root")
	}
}


type physicalEnvelopeTransport func(*http.Request) (*http.Response, error)

func (fn physicalEnvelopeTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

// The actual physical candidate is installed once in a disposable test
// directory. These requests never reach GitHub or a real disk.
func TestPhysicalCachedAcquisitionRequiresStableSignedSecondRead(t *testing.T) {
	for _, mode := range []string{"stable", "network-failure", "http-failure", "bad-signature", "same-commit-different-bundle", "pointer-write-failure"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			trust, private, trustSHA := testTrust(t)
			candidate := sequencedCandidate(t, root, "0123456789abcdef0123456789abcdef01234567", 1)
			first := signedEnvelope(t, candidate.Manifest, private)
			second := first
			switch mode {
			case "same-commit-different-bundle":
				other := candidate.Manifest
				other.Bundle.SHA256 = strings.Repeat("b", 64)
				second = signedEnvelope(t, other, private)
			case "bad-signature":
				var envelope Envelope
				if err := json.Unmarshal(first, &envelope); err != nil {
					t.Fatal(err)
				}
				envelope.Signature[0] ^= 0xff
				var err error
				second, err = json.Marshal(envelope)
				if err != nil { t.Fatal(err) }
			}
			requests := 0
			client := &http.Client{Transport: physicalEnvelopeTransport(func(req *http.Request) (*http.Response, error) {
				requests++
				if req.URL.Host != "github.com" {
					return nil, fmt.Errorf("unexpected real host %q", req.URL.Host)
				}
				if requests > 2 {
					return nil, errors.New("unexpected third signed release fetch")
				}
				if requests == 2 {
					switch mode {
					case "network-failure":
						return nil, errors.New("synthetic network failure")
					case "http-failure":
						return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: io.NopCloser(bytes.NewReader(nil)), Header: make(http.Header), Request: req}, nil
					case "pointer-write-failure":
						if err := os.Mkdir(filepath.Join(root, currentEnvelopeName), 0o700); err != nil {
							return nil, err
						}
					}
				}
				body := first
				if requests == 2 { body = second }
				return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header), Request: req}, nil
			})}
			installed, changed, err := AcquireCached(client, root, DefaultEnvelopeURL, trust, trustSHA)
			if requests != 2 {
				t.Fatalf("expected exactly two signed fetches; got %d, err=%v", requests, err)
			}
			if mode == "stable" {
				if err != nil || changed || installed.SourceCommit != candidate.SourceCommit {
					t.Fatalf("stable signed candidate not accepted changed=%v commit=%s err=%v", changed, installed.SourceCommit, err)
				}
				if _, err := Current(root, trust, trustSHA); err != nil {
					t.Fatalf("verified offline pointer not committed: %v", err)
				}
				return
			}
			if err == nil || changed || installed.SourceCommit != "" {
				t.Fatalf("unconfirmed physical candidate was returned as success: changed=%v installed=%+v err=%v", changed, installed, err)
			}
			if _, err := Current(root, trust, trustSHA); err == nil {
				t.Fatal("unconfirmed candidate became current after failed recheck")
			}
		})
	}
}

func TestOfflinePhysicalRejectsOversizedSignedEnvelopeBeforeParsing(t *testing.T) {
	root := t.TempDir()
	trust, _, trustSHA := testTrust(t)
	path := filepath.Join(root, currentEnvelopeName)
	if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(path, maxEnvelopeBytes+1); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trust, trustSHA); err == nil ||
		!strings.Contains(err.Error(), "outside allowed size") {
		t.Fatalf("oversized physical envelope was accepted: %v", err)
	}
}
