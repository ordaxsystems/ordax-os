package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
)

type signedReleaseSchemaHeader struct {
	Schema string `json:"$schema"`
}

func signedReleaseSchemaForActivation(envelopeBytes, trustBytes []byte) (string, error) {
	payload, err := verifyEnvelopeSignaturePayload(envelopeBytes, trustBytes)
	if err != nil {
		return "", err
	}
	var header signedReleaseSchemaHeader
	if err := json.Unmarshal(payload, &header); err != nil {
		return "", fmt.Errorf("runtime component signed release schema: %w", err)
	}
	if header.Schema == "" {
		return "", errors.New("runtime component signed release schema is missing")
	}
	return header.Schema, nil
}

func verifyActivationSlotWithTrustBytes(slot string, trustBytes []byte) (releaseDescriptor, error) {
	absolute, err := filepath.Abs(slot)
	if err != nil {
		return releaseDescriptor{}, err
	}
	envelopeBytes, err := readRegular(
		filepath.Join(absolute, slotEnvelopeName),
		maxEnvelopeBytes,
		false,
	)
	if err != nil {
		return releaseDescriptor{}, err
	}
	schema, err := signedReleaseSchemaForActivation(envelopeBytes, trustBytes)
	if err != nil {
		return releaseDescriptor{}, err
	}
	switch schema {
	case releaseSchema:
		return verifySlotWithTrustBytes(absolute, trustBytes)
	case releaseSchemaV2:
		release, err := verifySlotV2WithTrustBytes(absolute, trustBytes)
		if err != nil {
			return releaseDescriptor{}, err
		}
		return sharedReleaseFromV2(release), nil
	default:
		return releaseDescriptor{}, errors.New("unsupported runtime component signed release schema for activation")
	}
}
