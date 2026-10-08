//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	creatorcore "github.com/ordaxsystems/ordax-os/tools/creator/core"
	physicalchannel "github.com/ordaxsystems/ordax-os/tools/creator/physicalchannel"
)

type portablePhysicalPreparationDocument struct {
	Schema                    string         `json:"$schema"`
	Target                    physicalTarget `json:"target"`
	ApplicationPlanSHA256     string         `json:"application_plan_sha256"`
	DestructiveAuthorization  string         `json:"destructive_authorization"`
	WholeDiskRawImageRequired bool           `json:"whole_disk_raw_image_required"`
}

func executePhysicalWrite(state appRefreshState, target physicalTarget) error {
	switch state.PhysicalMode {
	case "legacy-owner":
		return executeLegacyPhysicalWrite(state.BackendDirectory, target)
	case "portable-public":
		if state.PortablePayload == nil {
			return errors.New("o payload Portable assinado não está disponível")
		}
		return executePortablePhysicalWrite(state.BackendDirectory, target, *state.PortablePayload)
	default:
		return errors.New("o canal físico atual não possui uma autoridade de gravação suportada")
	}
}

func portableSourceSpecs(
	directory string,
	payload physicalchannel.PortablePayloadManifest,
) ([]string, error) {
	specs := make([]string, 0, len(payload.Artifacts))
	for _, artifact := range payload.Artifacts {
		path, err := physicalchannel.PortablePayloadSourcePath(directory, artifact.ID)
		if err != nil {
			return nil, err
		}
		info, err := os.Lstat(path)
		if err != nil {
			return nil, fmt.Errorf("source Portable %s indisponível: %w", artifact.ID, err)
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("source Portable %s não é arquivo regular", artifact.ID)
		}
		if info.Size() != artifact.SizeBytes {
			return nil, fmt.Errorf("source Portable %s mudou de tamanho", artifact.ID)
		}
		specs = append(specs, artifact.ID+"="+path)
	}
	return specs, nil
}

func validatePortablePhysicalPreparation(
	preparation portablePhysicalPreparationDocument,
	target physicalTarget,
	expectedPlanSHA string,
) error {
	if preparation.Schema != "prototype-ordax.creator-portable-physical-preparation/1" {
		return errors.New("o backend retornou uma preparação Portable incompatível")
	}
	if preparation.Target.DiskNumber != target.DiskNumber ||
		preparation.Target.ConfirmationToken != target.ConfirmationToken ||
		preparation.Target.SystemDisk ||
		!preparation.Target.PrototypeSafe {
		return errors.New("o dispositivo mudou durante a preparação Portable; operação cancelada")
	}
	if preparation.ApplicationPlanSHA256 != expectedPlanSHA ||
		len(preparation.DestructiveAuthorization) != 64 ||
		preparation.WholeDiskRawImageRequired {
		return errors.New("a preparação Portable não preservou os vínculos de segurança esperados")
	}
	return nil
}

func executePortablePhysicalWrite(
	directory string,
	target physicalTarget,
	payload physicalchannel.PortablePayloadManifest,
) error {
	if payload.Schema != physicalchannel.PortablePayloadSchema {
		return errors.New("payload Portable assinado possui schema incompatível")
	}
	backend := filepath.Join(directory, "ordax-creator-physical-test.exe")
	info, err := os.Lstat(backend)
	if err != nil {
		return fmt.Errorf("pacote físico incompleto: backend não está disponível")
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("pacote físico inválido: backend não é arquivo regular")
	}

	bindings := creatorcore.PortableMediaBindings{
		Schema:    creatorcore.PortableMediaBindingsSchema,
		Artifacts: make([]creatorcore.PortableMediaArtifactBinding, 0, len(payload.Artifacts)),
	}
	for _, artifact := range payload.Artifacts {
		if artifact.SizeBytes <= 0 {
			return fmt.Errorf("payload Portable inválido: %s", artifact.ID)
		}
		bindings.Artifacts = append(bindings.Artifacts, creatorcore.PortableMediaArtifactBinding{
			ID:        artifact.ID,
			SHA256:    artifact.SHA256,
			SizeBytes: uint64(artifact.SizeBytes),
		})
	}
	mediaPlan, err := creatorcore.PlanPortableMedia(
		target.PhysicalDiskBytes,
		payload.ReleaseSourceCommit,
		bindings,
	)
	if err != nil {
		return fmt.Errorf("planejar mídia Portable: %w", err)
	}
	applicationPlan, err := creatorcore.PlanPortableApplication(mediaPlan)
	if err != nil {
		return fmt.Errorf("planejar aplicação Portable: %w", err)
	}
	planBytes, err := creatorcore.PortableApplicationPlanCanonicalBytes(applicationPlan)
	if err != nil {
		return err
	}
	planSHA, err := creatorcore.PortableApplicationPlanSHA256(applicationPlan)
	if err != nil {
		return err
	}
	sourceSpecs, err := portableSourceSpecs(directory, payload)
	if err != nil {
		return err
	}

	workRoot := filepath.Join(os.TempDir(), "OrdaX-Creator")
	if err := os.MkdirAll(workRoot, 0o700); err != nil {
		return fmt.Errorf("preparar área temporária: %w", err)
	}
	workDir, err := os.MkdirTemp(workRoot, "portable-write-*")
	if err != nil {
		return fmt.Errorf("criar área temporária: %w", err)
	}
	defer os.RemoveAll(workDir)

	planPath := filepath.Join(workDir, "portable-application-plan.json")
	diagnosticPath := filepath.Join(workDir, "ordax-physical-error.txt")
	progressPath := filepath.Join(workDir, "ordax-physical-progress.json")
	if err := os.WriteFile(planPath, planBytes, 0o600); err != nil {
		return fmt.Errorf("gravar plano Portable target-specific: %w", err)
	}

	updateWriteProgress(creatorT(msgPortablePlanStatus), creatorT(msgPortablePlanHint))
	output, err := runBackendHidden(
		directory,
		"prepare-portable",
		"--confirm", target.ConfirmationToken,
		"--plan", planPath,
	)
	if err != nil {
		return fmt.Errorf("preparar gravação Portable: %w", err)
	}
	var preparation portablePhysicalPreparationDocument
	if err := json.Unmarshal(output, &preparation); err != nil {
		return fmt.Errorf("ler resultado da preparação Portable: %w", err)
	}
	if err := validatePortablePhysicalPreparation(preparation, target, planSHA); err != nil {
		return err
	}

	updateWriteProgress(creatorT(msgProgressElevationStatus), creatorT(msgPortableElevationHint))
	args := []string{
		"apply-portable",
		"--confirm", target.ConfirmationToken,
		"--plan", planPath,
		"--authorize", preparation.DestructiveAuthorization,
		"--diagnostic-log", diagnosticPath,
		"--progress-log", progressPath,
	}
	for _, source := range sourceSpecs {
		args = append(args, "--source", source)
	}
	if err := runElevatedAndWait(backend, directory, args, diagnosticPath, progressPath); err != nil {
		return err
	}

	updateWritePercentage(creatorT(msgProgressCompleteStatus), creatorT(msgPortableVerifiedHint), 100)
	return nil
}
