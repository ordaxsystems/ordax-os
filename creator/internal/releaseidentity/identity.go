// Package releaseidentity owns the immutable, monotonic identity policy
// shared by the independently signed Creator distribution channels.
package releaseidentity

import (
	"fmt"
	"reflect"
)

// Check enforces a monotonic release sequence, prohibits reuse of a sequence
// by a different source, and binds each source commit to one signed manifest.
// Only callers that have already verified both signed manifests may invoke it.
// A legitimate re-sign of the same manifest remains valid.
func Check(channel, candidateCommit string, candidateSequence int64, candidateManifest any, baselineCommit string, baselineSequence int64, baselineManifest any) error {
	if candidateSequence < baselineSequence {
		return fmt.Errorf("%s rollback rejected: candidate sequence %d is older than current sequence %d", channel, candidateSequence, baselineSequence)
	}
	if candidateSequence == baselineSequence && candidateCommit != baselineCommit {
		return fmt.Errorf("%s release sequence %d was reused by a different source commit", channel, candidateSequence)
	}
	if candidateCommit == baselineCommit &&
		(candidateSequence != baselineSequence || !reflect.DeepEqual(candidateManifest, baselineManifest)) {
		return fmt.Errorf("%s source commit %s was reused with different signed release metadata or sequence", channel, candidateCommit)
	}
	return nil
}
