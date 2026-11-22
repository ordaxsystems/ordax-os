package creatorcore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
)

// PortableMediaPlanFromApplication reconstructs the canonical, target-specific
// initial installation receipt from the already-authorized 39-operation plan.
// It never treats untrusted disk metadata as an authority. The strict exact
// SHA binding and full planner equality avoid a second manifest/parser.
func PortableMediaPlanFromApplication(plan PortableApplicationPlan) (PortableMediaPlan, error) {
	if plan.Schema != PortableApplicationPlanSchema ||
		plan.Status != "planned-not-authorized" ||
		plan.PhysicalWriteAuthorized || plan.PhysicalDeviceBound ||
		plan.PublicPromotionAllowed || plan.WholeDiskRawImageNeeded {
		return PortableMediaPlan{}, errors.New("invalid portable installation plan policy")
	}
	bindings := PortableMediaBindings{
		Schema: PortableMediaBindingsSchema,
		Artifacts: make([]PortableMediaArtifactBinding, 0, len(portableMediaTargets)),
	}
	for _, operation := range plan.Operations {
		if operation.Kind == "materialize-artifact" {
			bindings.Artifacts = append(bindings.Artifacts, PortableMediaArtifactBinding{
				ID: operation.ArtifactID,
				SHA256: operation.SHA256,
				SizeBytes: operation.SizeBytes,
			})
		}
	}
	media, err := PlanPortableMedia(plan.TargetBytes, plan.SourceCommit, bindings)
	if err != nil { return PortableMediaPlan{}, fmt.Errorf("reconstruct portable media: %w", err) }
	canonicalBytes, err := json.Marshal(media)
	if err != nil { return PortableMediaPlan{}, err }
	digest := sha256.Sum256(canonicalBytes)
	if hex.EncodeToString(digest[:]) != plan.MediaPlanSHA256 {
		return PortableMediaPlan{}, errors.New("portable media plan SHA differs from installation authorization")
	}
	reconstructed, err := PlanPortableApplication(media)
	if err != nil { return PortableMediaPlan{}, err }
	if !reflect.DeepEqual(plan, reconstructed) {
		return PortableMediaPlan{}, errors.New("portable installation plan differs from canonical Core operations")
	}
	return media, nil
}

func PortableMediaPlanReceiptBytes(media PortableMediaPlan) ([]byte, error) {
	if _, err := PlanPortableApplication(media); err != nil { return nil, err }
	bytes, err := json.MarshalIndent(media, "", "  ")
	if err != nil { return nil, err }
	return append(bytes, '\n'), nil
}
