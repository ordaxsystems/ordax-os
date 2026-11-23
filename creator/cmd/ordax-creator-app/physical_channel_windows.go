//go:build windows

package main

import (
	"encoding/base64"
	"strings"

	physicalchannel "github.com/ordaxsystems/ordax-os/creator/physicalchannel"
)

// These values are compile-time publisher bindings. Development builds keep
// them UNRESOLVED and therefore can never acquire or enable a destructive
// backend. End users never configure keys or trust material.
var (
	buildPhysicalTrustBase64 = "UNRESOLVED"
	buildPhysicalTrustSHA256 = "UNRESOLVED"
)

func physicalTrustBinding() ([]byte, string, bool) {
	encoded := strings.TrimSpace(buildPhysicalTrustBase64)
	digest := strings.TrimSpace(buildPhysicalTrustSHA256)
	if encoded == "" || encoded == "UNRESOLVED" || digest == "" || digest == "UNRESOLVED" {
		return nil, "", false
	}
	trust, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(trust) == 0 {
		return nil, "", false
	}
	return trust, digest, true
}

// Only the purpose-bound Ed25519-signed Portable channel may authorize
// physical media. Old embedded owner seeds are never a fallback writer.
type physicalBackendResolution struct {
	Directory       string
	Mode            string
	PortablePayload *physicalchannel.PortablePayloadManifest
	Installed       *physicalchannel.Installed
}

func resolutionFromInstalled(installed physicalchannel.Installed) physicalBackendResolution {
	var payload *physicalchannel.PortablePayloadManifest
	if installed.Manifest.Schema == physicalchannel.ManifestSchemaPortable &&
		installed.Manifest.PortablePayload != nil {
		copy := *installed.Manifest.PortablePayload
		copy.Artifacts = append([]physicalchannel.PortablePayloadArtifactBinding(nil), copy.Artifacts...)
		payload = &copy
	}
	return physicalBackendResolution{
		Directory: installed.Directory,
		Mode: "portable-public",
		PortablePayload: payload,
		Installed: &installed,
	}
}

func resolvePhysicalBackend() (physicalBackendResolution, bool) {
	trust, trustSHA, ok := physicalTrustBinding()
	if !ok {
		return physicalBackendResolution{}, false
	}
	installed, _, err := physicalchannel.AcquireCached(nil, "", "", trust, trustSHA)
	if err == nil {
		return resolutionFromInstalled(installed), true
	}
	// A stale signed cache is not proof of the newest available OS.
	// A failed online acquisition must block physical writes, not silently
	// downgrade to a previously installed physical payload.
	return physicalBackendResolution{}, false
}
