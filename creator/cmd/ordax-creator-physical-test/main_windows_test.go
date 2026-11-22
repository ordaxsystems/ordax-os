//go:build windows && ordax_raw_backend

package main

import (
	"crypto/sha256"
	"strings"
	"testing"
)

func TestPortableBindingReadySeparatesWriterAndReleaseCommit(t *testing.T) {
	b := buildBinding{
		SourceCommit:                  strings.Repeat("a", 40),
		ReleaseSourceCommit:           strings.Repeat("b", 40),
		CanonicalTrustSHA256:          strings.Repeat("c", sha256.Size*2),
		PortableUSBContractSHA256:     strings.Repeat("d", sha256.Size*2),
		CreatorPortableContractSHA256: strings.Repeat("e", sha256.Size*2),
		PhysicalWriteAuthorized:       true,
	}
	if !portableBindingReady(b) {
		t.Fatal("distinct valid writer/release commits should satisfy pure binding readiness")
	}

	b.ReleaseSourceCommit = ""
	if portableBindingReady(b) {
		t.Fatal("Portable binding accepted a missing canonical release source commit")
	}

	b.ReleaseSourceCommit = b.SourceCommit
	if !portableBindingReady(b) {
		t.Fatal("same writer/release commit is valid when it is explicitly the canonical release")
	}
}
