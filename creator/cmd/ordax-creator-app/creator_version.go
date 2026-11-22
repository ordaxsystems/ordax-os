package main

import "regexp"

// The single product SemVer source is version.json. The Windows candidate
// workflow binds it and the exact Creator Git commit into the EXE via -X.
// These are transparent development build labels, never publisher signatures
// or evidence of authorization to operate on a physical device.
var (
	buildCreatorVersion      string
	buildCreatorSourceCommit string
)

var (
	creatorVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(-[a-z][a-z0-9]*(\.[0-9]+)?)?$`)
	creatorCommitPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

func validCreatorVersion(version string) bool {
	return creatorVersionPattern.MatchString(version)
}

func creatorBinaryBuildIdentity() (version, sourceCommit string, ok bool) {
	if !validCreatorVersion(buildCreatorVersion) ||
		!creatorCommitPattern.MatchString(buildCreatorSourceCommit) {
		return "", "", false
	}
	return buildCreatorVersion, buildCreatorSourceCommit, true
}
