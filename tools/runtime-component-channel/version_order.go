package main

import (
	"errors"
	"math/big"
	"strings"
)

// Same semantic-version precedence as the canonical OS component manifest
// validator (system/contracts/component-manifest.mjs), implemented locally
// only because this signed-slot activation writer is a Go executable.
// No policy or independent component version registry is defined here.
func compareRuntimeComponentVersions(candidate, current string) (int, error) {
	first, err := parseRuntimeComponentVersion(candidate)
	if err != nil {
		return 0, err
	}
	second, err := parseRuntimeComponentVersion(current)
	if err != nil {
		return 0, err
	}
	for index := 0; index < 3; index++ {
		if result := first.numeric[index].Cmp(second.numeric[index]); result != 0 {
			return result, nil
		}
	}
	if len(first.prerelease) == 0 && len(second.prerelease) == 0 {
		return 0, nil
	}
	if len(first.prerelease) == 0 {
		return 1, nil
	}
	if len(second.prerelease) == 0 {
		return -1, nil
	}
	for index := 0; index < len(first.prerelease) && index < len(second.prerelease); index++ {
		left, right := first.prerelease[index], second.prerelease[index]
		leftNumeric := allNumericRunes(left)
		rightNumeric := allNumericRunes(right)
		switch {
		case leftNumeric && rightNumeric:
			l, _ := new(big.Int).SetString(left, 10)
			r, _ := new(big.Int).SetString(right, 10)
			if cmp := l.Cmp(r); cmp != 0 {
				return cmp, nil
			}
		case leftNumeric:
			return -1, nil
		case rightNumeric:
			return 1, nil
		case left < right:
			return -1, nil
		case left > right:
			return 1, nil
		}
	}
	if len(first.prerelease) < len(second.prerelease) {
		return -1, nil
	}
	if len(first.prerelease) > len(second.prerelease) {
		return 1, nil
	}
	return 0, nil
}

type runtimeComponentVersion struct {
	numeric    [3]*big.Int
	prerelease []string
}

func parseRuntimeComponentVersion(value string) (runtimeComponentVersion, error) {
	// Bound native parsing exactly like validateComponentVersion in the
	// canonical JS contract, even if the older Go release regex is looser.
	if len(value) < 5 || len(value) > 128 || !semverPattern.MatchString(value) {
		return runtimeComponentVersion{}, errors.New("runtime component version has invalid semantic version")
	}
	parts := strings.SplitN(value, "-", 2)
	numbers := strings.Split(parts[0], ".")
	if len(numbers) != 3 {
		return runtimeComponentVersion{}, errors.New("runtime component version has invalid numeric parts")
	}
	var version runtimeComponentVersion
	for index, digits := range numbers {
		value, ok := new(big.Int).SetString(digits, 10)
		if !ok {
			return runtimeComponentVersion{}, errors.New("runtime component version has invalid number")
		}
		version.numeric[index] = value
	}
	if len(parts) == 2 {
		identifiers := strings.Split(parts[1], ".")
		for _, id := range identifiers {
			if id == "" {
				return runtimeComponentVersion{}, errors.New("runtime component version has invalid prerelease identifier")
			}
			for _, c := range id {
				if (c < '0' || c > '9') &&
					(c < 'A' || c > 'Z') &&
					(c < 'a' || c > 'z') && c != '-' {
					return runtimeComponentVersion{}, errors.New("runtime component version has invalid prerelease character")
				}
			}
		}
		version.prerelease = identifiers
	}
	return version, nil
}

func allNumericRunes(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
