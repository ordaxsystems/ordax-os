//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
)

const physicalProgressSchema = "prototype-ordax.creator-physical-progress/1"

type physicalProgressDocument struct {
	Schema         string `json:"$schema"`
	Phase          string `json:"phase"`
	CompletedBytes int64  `json:"completed_bytes"`
	TotalBytes     int64  `json:"total_bytes"`
}

func setProgressPercent(percent int) {
	if progressBar == 0 {
		return
	}
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	send(progressBar, pbmSetMarquee, 0, 0)
	send(progressBar, pbmSetPos, uintptr(percent), 0)
}

func readPhysicalProgress(path string) (physicalProgressDocument, error) {
	if path == "" {
		return physicalProgressDocument{}, fmt.Errorf("progress path is empty")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return physicalProgressDocument{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 4096 {
		return physicalProgressDocument{}, fmt.Errorf("progress snapshot is not a small regular file")
	}
	data, err := os.ReadFile(path)
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
	if document.CompletedBytes < 0 || document.TotalBytes < 0 || (document.TotalBytes > 0 && document.CompletedBytes > document.TotalBytes) {
		return physicalProgressDocument{}, fmt.Errorf("progress byte counters are invalid")
	}
	return document, nil
}

func guidedPhysicalProgressCopy(status, hint string) (string, string) {
	view := creatorExperience(creatorExperienceInput{WriteActive: true})
	return fmt.Sprintf("%s · %s", view.Eyebrow, status), fmt.Sprintf("%s %s", view.Title, hint)
}

func physicalProgressPresentation(document physicalProgressDocument) (status, hint string, percent int, ok bool) {
	ratioPercent := func(start, span int) int {
		if document.TotalBytes <= 0 {
			return start
		}
		value := start + int((document.CompletedBytes*int64(span))/document.TotalBytes)
		if value < start {
			value = start
		}
		if value > start+span {
			value = start + span
		}
		return value
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
		return creatorT(msgProgressStartingStatus), creatorT(msgProgressStartingHint), 2, true
	case "checking-elevation":
		return creatorT(msgProgressElevationStatus), creatorT(msgProgressElevationHint), 3, true
	case "revalidating-target":
		return creatorT(msgProgressTargetStatus), creatorT(msgProgressTargetHint), 5, true
	case "validating-image":
		return creatorT(msgProgressImageStatus), byteProgress(msgProgressValidationBytes), ratioPercent(5, 7), true
	case "planning-write":
		return creatorT(msgProgressPlanningStatus), creatorT(msgProgressPlanningHint), 13, true
	case "locking-target":
		return creatorT(msgProgressLockStatus), creatorT(msgProgressLockHint), 15, true
	case "writing":
		return creatorT(msgProgressWritingStatus), byteProgress(msgProgressWritingBytes), ratioPercent(15, 45), true
	case "flushing":
		return creatorT(msgProgressFlushStatus), creatorT(msgProgressFlushHint), 62, true
	case "verifying":
		return creatorT(msgProgressVerifyingStatus), byteProgress(msgProgressVerifyingBytes), ratioPercent(62, 28), true
	case "verified":
		return creatorT(msgProgressVerifiedStatus), creatorT(msgProgressVerifiedHint), 92, true
	case "formatting-data":
		return creatorT(msgProgressDataStatus), creatorT(msgProgressDataHint), 96, true
	case "complete":
		return creatorT(msgProgressCompleteStatus), creatorT(msgProgressCompleteHint), 100, true
	default:
		return "", "", 0, false
	}
}

func applyPhysicalProgressSnapshot(path string, lastKey *string) {
	document, err := readPhysicalProgress(path)
	if err != nil {
		return
	}
	key := fmt.Sprintf("%s:%d:%d", document.Phase, document.CompletedBytes, document.TotalBytes)
	if lastKey != nil && *lastKey == key {
		return
	}
	status, hint, percent, ok := physicalProgressPresentation(document)
	if !ok {
		return
	}
	status, hint = guidedPhysicalProgressCopy(status, hint)
	if lastKey != nil {
		*lastKey = key
	}
	updateWritePercentage(status, hint, percent)
}
