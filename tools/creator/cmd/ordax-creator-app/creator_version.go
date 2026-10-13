package main
import "regexp"

// This is the user-visible release label, not its immutable Git provenance.
var creatorVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(-[a-z][a-z0-9]*(\.[0-9]+)?)?$`)
func validCreatorVersion(version string) bool { return creatorVersionPattern.MatchString(version) }
