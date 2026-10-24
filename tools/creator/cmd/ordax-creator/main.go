package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	creatorcore "github.com/ordaxsystems/ordax-os/tools/creator/core"
)

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ordax-creator <check|verify-payload|stage-tree|plan> --manifest <path> [--payload-root <dir>] [--output-root <dir>]")
	fmt.Fprintln(os.Stderr, "       ordax-creator prepare-image --seed <regular-file> --out <new-regular-file> --target-bytes <bytes>")
	fmt.Fprintln(os.Stderr, "       ordax-creator plan-portable --target-bytes <bytes>")
	fmt.Fprintln(os.Stderr, "       ordax-creator plan-portable-application --plan <portable-media-plan.json>")
	fmt.Fprintln(os.Stderr, "       ordax-creator plan-portable-media --target-bytes <bytes> --source-commit <40-hex> --bindings <json>")
	fmt.Fprintln(os.Stderr, "       ordax-creator verify-portable-sources --bindings <json> --sources-root <dir>")
	fmt.Fprintln(os.Stderr, "       ordax-creator plan-native --target-bytes <bytes>")
	fmt.Fprintln(os.Stderr, "       ordax-creator plan-native-materialization --target-bytes <bytes>")
	fmt.Fprintln(os.Stderr, "       ordax-creator plan-native-boot --pool-uuid <luks2-uuid>")
	fmt.Fprintln(os.Stderr, "       ordax-creator render-native-boot --pool-uuid <luks2-uuid> --normal-template <path> --recovery-template <path> --out-dir <new-dir>")
}

func loadManifest(path string) (creatorcore.Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return creatorcore.Manifest{}, err
	}
	return creatorcore.ParseManifest(data)
}

func runPrepareImage(args []string) int {
	fs := flag.NewFlagSet("prepare-image", flag.ContinueOnError)
	seed := fs.String("seed", "", "verified GPT seed regular-file path")
	out := fs.String("out", "", "new prepared regular-file path")
	targetBytes := fs.Uint64("target-bytes", 0, "exact target capacity in bytes; must be 512-byte aligned")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() != 0 || *seed == "" || *out == "" || *targetBytes == 0 {
		usage()
		return 2
	}

	prepared, err := creatorcore.PreparePhysicalImage(*seed, *out, *targetBytes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: prepare image failed: %v\n", err)
		return 1
	}
	fmt.Printf("PREPARED_PHYSICAL_IMAGE=YES\n")
	fmt.Printf("PREPARED_PATH=%s\n", prepared.Path)
	fmt.Printf("PREPARED_SIZE_BYTES=%d\n", prepared.SizeBytes)
	fmt.Printf("PREPARED_SHA256=%s\n", prepared.SHA256)
	fmt.Printf("PREPARED_LAST_USABLE_LBA=%d\n", prepared.LastUsableLBA)
	fmt.Printf("PREPARED_MAIN_LAST_LBA=%d\n", prepared.MainLastLBA)
	fmt.Printf("PHYSICAL_DEVICE_TOUCHED=NO\n")
	return 0
}

func runPlanPortable(args []string) int {
	fs := flag.NewFlagSet("plan-portable", flag.ContinueOnError)
	targetBytes := fs.Uint64("target-bytes", 0, "exact portable USB target capacity in bytes; must be 512-byte aligned")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() != 0 || *targetBytes == 0 {
		usage()
		return 2
	}

	plan, err := creatorcore.PlanPortableTargetStorage(*targetBytes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: portable USB plan failed: %v\n", err)
		return 1
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(plan); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: encode portable USB plan: %v\n", err)
		return 1
	}
	return 0
}

func runPlanPortableMedia(args []string) int {
	fs := flag.NewFlagSet("plan-portable-media", flag.ContinueOnError)
	targetBytes := fs.Uint64("target-bytes", 0, "exact portable USB target capacity in bytes; must be 512-byte aligned")
	sourceCommit := fs.String("source-commit", "", "exact lowercase 40-hex source commit")
	bindingsPath := fs.String("bindings", "", "portable media bindings JSON")
	if err := fs.Parse(args); err != nil { return 2 }
	if fs.NArg() != 0 || *targetBytes == 0 || *sourceCommit == "" || *bindingsPath == "" { usage(); return 2 }
	data, err := os.ReadFile(*bindingsPath)
	if err != nil { fmt.Fprintf(os.Stderr, "ordax-creator: read portable media bindings: %v\n", err); return 1 }
	bindings, err := creatorcore.ParsePortableMediaBindings(data)
	if err != nil { fmt.Fprintf(os.Stderr, "ordax-creator: parse portable media bindings: %v\n", err); return 1 }
	plan, err := creatorcore.PlanPortableMedia(*targetBytes, *sourceCommit, bindings)
	if err != nil { fmt.Fprintf(os.Stderr, "ordax-creator: portable media plan failed: %v\n", err); return 1 }
	enc := json.NewEncoder(os.Stdout); enc.SetIndent("", "  ")
	if err := enc.Encode(plan); err != nil { fmt.Fprintf(os.Stderr, "ordax-creator: encode portable media plan: %v\n", err); return 1 }
	return 0
}
func runVerifyPortableSources(args []string) int {
	fs := flag.NewFlagSet("verify-portable-sources", flag.ContinueOnError)
	bindingsPath := fs.String("bindings", "", "canonical portable media bindings JSON")
	sourcesRoot := fs.String("sources-root", "", "flat directory containing exactly the 17 canonical sources")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() != 0 || *bindingsPath == "" || *sourcesRoot == "" {
		usage()
		return 2
	}
	data, err := os.ReadFile(*bindingsPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: read portable media bindings: %v\n", err)
		return 1
	}
	bindings, err := creatorcore.ParsePortableMediaBindings(data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: parse portable media bindings: %v\n", err)
		return 1
	}
	verified, err := creatorcore.VerifyPortableSources(bindings, *sourcesRoot)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: verify portable sources: %v\n", err)
		return 1
	}
	fmt.Printf("PORTABLE_SOURCES_VERIFIED=YES\n")
	fmt.Printf("PORTABLE_SOURCE_COUNT=%d\n", len(verified))
	fmt.Printf("PHYSICAL_DEVICE_TOUCHED=NO\n")
	fmt.Printf("PHYSICAL_WRITE_AUTHORIZED=NO\n")
	return 0
}

func runPlanPortableApplication(args []string) int {
	fs := flag.NewFlagSet("plan-portable-application", flag.ContinueOnError)
	planPath := fs.String("plan", "", "canonical portable media plan JSON")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() != 0 || *planPath == "" {
		usage()
		return 2
	}
	data, err := os.ReadFile(*planPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: read portable media plan: %v\n", err)
		return 1
	}
	media, err := creatorcore.ParsePortableMediaPlan(data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: parse portable media plan: %v\n", err)
		return 1
	}
	plan, err := creatorcore.PlanPortableApplication(media)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: plan portable application: %v\n", err)
		return 1
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(plan); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: encode portable application plan: %v\n", err)
		return 1
	}
	return 0
}

func runPlanNative(args []string) int {
	fs := flag.NewFlagSet("plan-native", flag.ContinueOnError)
	targetBytes := fs.Uint64("target-bytes", 0, "exact Native install target capacity in bytes; must be 512-byte aligned")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() != 0 || *targetBytes == 0 {
		usage()
		return 2
	}

	plan, err := creatorcore.PlanNativeInstallation(*targetBytes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: native install plan failed: %v\n", err)
		return 1
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(plan); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: encode native install plan: %v\n", err)
		return 1
	}
	return 0
}

func runPlanNativeMaterialization(args []string) int {
	fs := flag.NewFlagSet("plan-native-materialization", flag.ContinueOnError)
	targetBytes := fs.Uint64("target-bytes", 0, "exact disposable Native target capacity in bytes; must be 512-byte aligned")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() != 0 || *targetBytes == 0 {
		usage()
		return 2
	}

	plan, err := creatorcore.PlanNativeMaterialization(*targetBytes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: Native materialization plan failed: %v\n", err)
		return 1
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(plan); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: encode Native materialization plan: %v\n", err)
		return 1
	}
	return 0
}

func runPlanNativeBoot(args []string) int {
	fs := flag.NewFlagSet("plan-native-boot", flag.ContinueOnError)
	poolUUID := fs.String("pool-uuid", "", "exact public LUKS2 ORDAX-POOL UUID")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() != 0 || *poolUUID == "" {
		usage()
		return 2
	}

	plan, err := creatorcore.PlanNativeBootEntries(*poolUUID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: Native boot plan failed: %v\n", err)
		return 1
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(plan); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: encode Native boot plan: %v\n", err)
		return 1
	}
	return 0
}

func readRegularText(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("template must be a regular non-symlink file: %s", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func writeNativeBootTarget(root, targetPath, content string) error {
	relative := filepath.Clean(filepath.FromSlash(targetPath))
	if relative == "." || filepath.IsAbs(relative) || relative == ".." ||
		strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("unsafe Native boot target path: %s", targetPath)
	}
	destination := filepath.Join(root, relative)
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	return os.WriteFile(destination, []byte(content), 0644)
}

func runRenderNativeBoot(args []string) int {
	fs := flag.NewFlagSet("render-native-boot", flag.ContinueOnError)
	poolUUID := fs.String("pool-uuid", "", "exact public LUKS2 ORDAX-POOL UUID")
	normalTemplatePath := fs.String("normal-template", "", "Native normal boot entry template")
	recoveryTemplatePath := fs.String("recovery-template", "", "Native recovery boot entry template")
	outDir := fs.String("out-dir", "", "new output directory for rendered Native boot entries")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() != 0 || *poolUUID == "" || *normalTemplatePath == "" ||
		*recoveryTemplatePath == "" || *outDir == "" {
		usage()
		return 2
	}

	normalTemplate, err := readRegularText(*normalTemplatePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: read normal Native boot template: %v\n", err)
		return 1
	}
	recoveryTemplate, err := readRegularText(*recoveryTemplatePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: read recovery Native boot template: %v\n", err)
		return 1
	}

	plan, err := creatorcore.PlanNativeBootEntries(*poolUUID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: Native boot plan failed: %v\n", err)
		return 1
	}
	normal, err := creatorcore.RenderNativeBootEntryTemplate(normalTemplate, plan.PoolUUID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: render normal Native boot entry: %v\n", err)
		return 1
	}
	recovery, err := creatorcore.RenderNativeBootEntryTemplate(recoveryTemplate, plan.PoolUUID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: render recovery Native boot entry: %v\n", err)
		return 1
	}

	output, err := filepath.Abs(*outDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: resolve Native boot output: %v\n", err)
		return 1
	}
	if _, err := os.Lstat(output); err == nil {
		fmt.Fprintln(os.Stderr, "ordax-creator: Native boot output directory must not already exist")
		return 1
	} else if !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "ordax-creator: inspect Native boot output: %v\n", err)
		return 1
	}

	parent := filepath.Dir(output)
	if err := os.MkdirAll(parent, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: create Native boot output parent: %v\n", err)
		return 1
	}
	parentInfo, err := os.Lstat(parent)
	if err != nil || !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink != 0 {
		fmt.Fprintln(os.Stderr, "ordax-creator: Native boot output parent must be a real directory")
		return 1
	}

	staging, err := os.MkdirTemp(parent, ".ordax-native-boot-render-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: create Native boot staging directory: %v\n", err)
		return 1
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(staging)
		}
	}()

	if err := writeNativeBootTarget(staging, plan.NormalTargetPath, normal); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: write normal Native boot entry: %v\n", err)
		return 1
	}
	if err := writeNativeBootTarget(staging, plan.RecoveryTargetPath, recovery); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: write recovery Native boot entry: %v\n", err)
		return 1
	}
	if err := os.Rename(staging, output); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: commit rendered Native boot entries: %v\n", err)
		return 1
	}
	cleanup = false

	result := map[string]any{
		"$schema":                  "prototype-ordax.native-boot-render/1",
		"status":                   "rendered",
		"pool_uuid":                plan.PoolUUID,
		"pool_uuid_is_secret":      false,
		"normal_target_path":       plan.NormalTargetPath,
		"recovery_target_path":     plan.RecoveryTargetPath,
		"physical_write_allowed":   false,
		"secret_material_included": false,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(result); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: encode rendered Native boot result: %v\n", err)
		return 1
	}
	return 0
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	command := os.Args[1]
	if command == "prepare-image" {
		os.Exit(runPrepareImage(os.Args[2:]))
	}
	if command == "plan-portable" {
		os.Exit(runPlanPortable(os.Args[2:]))
	}
	if command == "plan-portable-media" {
		os.Exit(runPlanPortableMedia(os.Args[2:]))
	}
	if command == "verify-portable-sources" {
		os.Exit(runVerifyPortableSources(os.Args[2:]))
	}
	if command == "plan-portable-application" {
		os.Exit(runPlanPortableApplication(os.Args[2:]))
	}
	if command == "plan-native" {
		os.Exit(runPlanNative(os.Args[2:]))
	}
	if command == "plan-native-materialization" {
		os.Exit(runPlanNativeMaterialization(os.Args[2:]))
	}
	if command == "plan-native-boot" {
		os.Exit(runPlanNativeBoot(os.Args[2:]))
	}
	if command == "render-native-boot" {
		os.Exit(runRenderNativeBoot(os.Args[2:]))
	}

	fs := flag.NewFlagSet(command, flag.ContinueOnError)
	manifestPath := fs.String("manifest", "docs/contracts/minimal-bootstrap.json", "path to minimal-bootstrap manifest")
	payloadRoot := fs.String("payload-root", "", "root directory of the assembled Creator payload")
	outputRoot := fs.String("output-root", "", "empty output directory for disposable filesystem-tree staging")
	if err := fs.Parse(os.Args[2:]); err != nil {
		os.Exit(2)
	}
	if fs.NArg() != 0 {
		usage()
		os.Exit(2)
	}

	manifest, err := loadManifest(*manifestPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: load manifest: %v\n", err)
		os.Exit(1)
	}
	if err := creatorcore.ValidateStructure(manifest); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: invalid manifest: %v\n", err)
		os.Exit(1)
	}

	switch command {
	case "check":
		fmt.Printf("MANIFEST_SCHEMA=%s\n", manifest.Schema)
		fmt.Printf("PHYSICAL_WRITE_STATUS=%s\n", creatorcore.PhysicalWriteStatus(manifest))
		fmt.Printf("PARTITIONS=ORDAX-ESP,ORDAX\n")
	case "verify-payload":
		result, err := creatorcore.VerifyPayload(manifest, *payloadRoot)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ordax-creator: payload verification failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("PAYLOAD_VERIFIED=YES\n")
		fmt.Printf("PAYLOAD_ARTIFACTS=%d\n", result.ArtifactCount)
		fmt.Printf("PHYSICAL_WRITE_STATUS=%s\n", creatorcore.PhysicalWriteStatus(manifest))
	case "stage-tree":
		result, err := creatorcore.StageDisposableTree(manifest, *payloadRoot, *outputRoot)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ordax-creator: disposable tree staging failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("DISPOSABLE_TREE_STAGED=YES\n")
		fmt.Printf("STAGED_ARTIFACTS=%d\n", result.ArtifactCount)
		fmt.Printf("STAGED_RUNTIME_ROOTS=%d\n", result.RuntimeRootCount)
		fmt.Printf("GPT_FILESYSTEM_PROOF=NO\n")
		fmt.Printf("PHYSICAL_WRITE_STATUS=%s\n", creatorcore.PhysicalWriteStatus(manifest))
	case "plan":
		plan, err := creatorcore.BuildWritePlan(manifest)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ordax-creator: %v\n", err)
			os.Exit(1)
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(plan); err != nil {
			fmt.Fprintf(os.Stderr, "ordax-creator: encode plan: %v\n", err)
			os.Exit(1)
		}
	default:
		usage()
		os.Exit(2)
	}
}
