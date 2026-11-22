//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"math/bits"

	"github.com/ordaxsystems/ordax-os/creator/internal/safefile"
)

const physicalProgressSchema = "prototype-ordax.creator-physical-progress/1"

type physicalProgressDocument struct {
	Schema         string `json:"$schema"`
	Phase          string `json:"phase"`
	CompletedBytes int64  `json:"completed_bytes"`
	TotalBytes     int64  `json:"total_bytes"`
}

func setProgressPercent(percent int) {
    if percent < 0 { percent = 0 }
    if percent > 100 { percent = 100 }
    creatorProgressValue = percent
    creatorProgressBusy = false
    invalidateGuidedVisual()
}

func readPhysicalProgress(path string) (physicalProgressDocument, error) {
	if path == "" {
		return physicalProgressDocument{}, fmt.Errorf("progress path is empty")
	}
	// The elevated helper may update this path while the UI polls it.
	// Read from the same opened, identity-checked descriptor with a hard cap.
	data, err := safefile.ReadBoundedRegular(path, 4096)
	if err != nil {
		return physicalProgressDocument{}, err
	}
	var document physicalProgressDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return physicalProgressDocument{}, err
	}
	if document.Schema != physicalProgressSchema {
		return physicalProgressDocument{}, fmt.Errorf("progress schema is incompatible")
	}
	if document.CompletedBytes < 0 || document.TotalBytes < 0 || document.CompletedBytes > document.TotalBytes {
		return physicalProgressDocument{}, fmt.Errorf("progress byte counters are invalid")
	}
	return document, nil
}

func guidedPhysicalProgressCopy(status, hint string) (string, string) {
	view := creatorExperience(creatorExperienceInput{WriteActive: true})
	return fmt.Sprintf("%s · %s", view.Eyebrow, status), fmt.Sprintf("%s %s", view.Title, hint)
}

// physicalProgressPercent scales valid, nonnegative 64-bit byte counters
// exactly without overflowing when a large physical image is reported.
// The phase spans are bounded, positive UI constants (at most 45 points).
// The high word of completed*span is always < total while completed < total,
// satisfying bits.Div64's quotient precondition.
func physicalProgressPercent(completed, total int64, start, span int) int {
	if total <= 0 || completed <= 0 || span <= 0 {
		return start
	}
	if completed >= total {
		return start + span
	}
	hi, lo := bits.Mul64(uint64(completed), uint64(span))
	scaled, _ := bits.Div64(hi, lo, uint64(total))
	return start + int(scaled)
}

// physicalProgressPresentation is the display adapter used by the existing
// localized regression tests. Stage order has one source in the detailed
// presentation below, shared with the live progress tracker.
func physicalProgressPresentation(document physicalProgressDocument) (status, hint string, percent int, ok bool) {
	status, hint, percent, _, ok = physicalProgressPresentationWithStage(document)
	return status, hint, percent, ok
}

func physicalProgressPresentationWithStage(document physicalProgressDocument) (status, hint string, percent, stage int, ok bool) {
	ratioPercent := func(start, span int) int {
		return physicalProgressPercent(document.CompletedBytes, document.TotalBytes, start, span)
	}
	byteProgress := func(messageID creatorMessageID) string {
		if document.TotalBytes <= 0 {
			return ""
		}
		const mib = float64(1024 * 1024)
		return creatorTValues(messageID, map[string]string{
			"completed": fmt.Sprintf("%.1f", float64(document.CompletedBytes)/mib),
			"total":     fmt.Sprintf("%.1f", float64(document.TotalBytes)/mib),
		})
	}
	switch document.Phase {
	case "starting":
		return creatorT(msgProgressStartingStatus), creatorT(msgProgressStartingHint), 2, 1, true
	case "checking-elevation":
		return creatorT(msgProgressElevationStatus), creatorT(msgProgressElevationHint), 3, 2, true
	case "revalidating-target":
		return creatorT(msgProgressTargetStatus), creatorT(msgProgressTargetHint), 5, 3, true
	case "validating-image":
		return creatorT(msgProgressImageStatus), byteProgress(msgProgressValidationBytes), ratioPercent(5, 7), 4, true
	case "planning-write":
		return creatorT(msgProgressPlanningStatus), creatorT(msgProgressPlanningHint), 13, 5, true
	case "locking-target":
		return creatorT(msgProgressLockStatus), creatorT(msgProgressLockHint), 15, 6, true
	case "writing":
		return creatorT(msgProgressWritingStatus), byteProgress(msgProgressWritingBytes), ratioPercent(15, 45), 7, true
	case "flushing":
		return creatorT(msgProgressFlushStatus), creatorT(msgProgressFlushHint), 62, 8, true
	case "verifying":
		return creatorT(msgProgressVerifyingStatus), byteProgress(msgProgressVerifyingBytes), ratioPercent(62, 28), 9, true
	case "verified":
		return creatorT(msgProgressVerifiedStatus), creatorT(msgProgressVerifiedHint), 92, 10, true
	case "formatting-data":
		return creatorT(msgProgressDataStatus), creatorT(msgProgressDataHint), 96, 11, true
	case "complete":
		return creatorT(msgProgressCompleteStatus), creatorT(msgProgressCompleteHint), 100, 12, true
	// Portable stages use the same bounded sidecar and phase tracker, but
	// their counters come from actual materialized/read-back artifact bytes.
	// No 100% is trusted from the elevated helper's completion sidecar.
	case "starting-portable":
		return creatorT(msgProgressStartingStatus), creatorT(msgProgressStartingHint), 2, 1, true
	case "partitioning-portable":
		return creatorT(msgPortablePartitionStatus), creatorT(msgPortablePartitionHint), ratioPercent(7, 13), 2, true
	case "formatting-portable":
		return creatorT(msgPortableFormatStatus), creatorT(msgPortableFormatHint), 22, 3, true
	case "materializing-portable":
		return creatorT(msgPortableCopyStatus), byteProgress(msgPortableCopyBytes), ratioPercent(27, 38), 4, true
	case "flushing-portable":
		return creatorT(msgProgressFlushStatus), creatorT(msgProgressFlushHint), 68, 5, true
	case "verifying-portable":
		return creatorT(msgProgressVerifyingStatus), byteProgress(msgProgressVerifyingBytes), ratioPercent(70, 23), 6, true
	case "checking-layout-portable":
		return creatorT(msgPortableLayoutStatus), creatorT(msgPortableLayoutHint), 95, 7, true
	case "complete-portable":
		return creatorT(msgProgressCompleteStatus), creatorT(msgProgressCompleteHint), 100, 8, true
	default:
		return "", "", 0, 0, false
	}
}

// The helper overwrites the JSON progress sidecar while the UI polls it.
// A delayed, replayed or regressive snapshot must not rewind a later phase.
// Only the actual elevated process exit code can establish terminal success.
type physicalProgressTracker struct {
	lastKey        string
	lastStage      int
	lastCompleted  int64
	lastTotal      int64
	lastPercent    int
}

func (tracker *physicalProgressTracker) accept(document physicalProgressDocument) (status, hint string, percent int, ok bool) {
	if tracker == nil {
		return "", "", 0, false
	}
	status, hint, percent, stage, recognized := physicalProgressPresentationWithStage(document)
	if !recognized || document.Phase == "complete" || document.Phase == "complete-portable" {
		// The child can still fail after writing its final sidecar entry.
		// Do not show 100% or "complete" before its verified zero exit.
		return "", "", 0, false
	}
	if document.CompletedBytes < 0 || document.TotalBytes < 0 || document.CompletedBytes > document.TotalBytes {
		return "", "", 0, false
	}
	key := fmt.Sprintf("%s:%d:%d", document.Phase, document.CompletedBytes, document.TotalBytes)
	if key == tracker.lastKey || stage < tracker.lastStage || percent < tracker.lastPercent {
		return "", "", 0, false
	}
	if stage == tracker.lastStage &&
		(document.CompletedBytes < tracker.lastCompleted || document.TotalBytes != tracker.lastTotal) {
		return "", "", 0, false
	}
	tracker.lastKey = key
	tracker.lastStage = stage
	tracker.lastCompleted = document.CompletedBytes
	tracker.lastTotal = document.TotalBytes
	tracker.lastPercent = percent
	return status, hint, percent, true
}

func applyPhysicalProgressSnapshot(path string, tracker *physicalProgressTracker) {
	document, err := readPhysicalProgress(path)
	if err != nil {
		return
	}
	status, hint, percent, ok := tracker.accept(document)
	if !ok {
		return
	}
	status, hint = guidedPhysicalProgressCopy(status, hint)
	updateWritePercentage(status, hint, percent)
}
