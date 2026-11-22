package creatorcore

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func TestPortableApplicationPlanCanonicalBytesMatchCLIEncoderAndDigest(t *testing.T) {
	media, err := PlanPortableMedia(
		8<<30,
		"0123456789abcdef0123456789abcdef01234567",
		portableBindingsFixture(),
	)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanPortableApplication(media)
	if err != nil {
		t.Fatal(err)
	}

	canonical, err := PortableApplicationPlanCanonicalBytes(plan)
	if err != nil {
		t.Fatal(err)
	}

	var emitted bytes.Buffer
	encoder := json.NewEncoder(&emitted)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(plan); err != nil {
		t.Fatal(err)
	}

	if !bytes.Equal(canonical, emitted.Bytes()) {
		t.Fatal("canonical plan bytes differ from ordax-creator emitted JSON bytes")
	}
	if len(canonical) == 0 || canonical[len(canonical)-1] != '\n' {
		t.Fatal("canonical plan bytes must end in exactly one LF")
	}

	digest, err := PortableApplicationPlanSHA256(plan)
	if err != nil {
		t.Fatal(err)
	}
	expected := sha256.Sum256(emitted.Bytes())
	if digest != hex.EncodeToString(expected[:]) {
		t.Fatalf("application plan digest=%s want emitted-file digest=%s", digest, hex.EncodeToString(expected[:]))
	}
}
