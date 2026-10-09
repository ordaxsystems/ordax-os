//go:build windows

package main

import (
	"encoding/base64"
	"strings"

	physicalchannel "github.com/ordaxsystems/ordax-os/tools/creator/physicalchannel"
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

// resolvePhysicalBackend has two deliberately separate paths:
//  1. owner-prototype builds compiled with ordax_owner_prototype may use only
//     the raw backend and seed shipped beside that exact executable;
//  2. normal builds accept only the dedicated purpose-bound Ed25519-signed
//     physical channel.
//
// The special owner path is compile-time isolated. The ordinary creator-dev
// build does not contain it and therefore remains non-destructive.
type physicalBackendResolution struct {
	Directory       string
	Mode            string
	PortablePayload *physicalchannel.PortablePayloadManifest
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
	}
}

func resolvePhysicalBackend() (physicalBackendResolution, bool) {
	if directory, ok := ownerPrototypePhysicalBackend(); ok {
		return physicalBackendResolution{Directory: directory, Mode: "legacy-owner"}, true
	}

	trust, trustSHA, ok := physicalTrustBinding()
	if !ok {
		return physicalBackendResolution{}, false
	}
	installed, _, err := physicalchannel.AcquireCached(nil, "", "", trust, trustSHA)
	if err == nil {
		return resolutionFromInstalled(installed), true
	}
	current, currentErr := physicalchannel.Current("", trust, trustSHA)
	if currentErr != nil {
		return physicalBackendResolution{}, false
	}
	return resolutionFromInstalled(current), true
}
