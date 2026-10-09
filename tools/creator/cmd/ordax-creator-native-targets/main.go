package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path"
	"strings"

	creatorcore "github.com/ordaxsystems/ordax-os/tools/creator/core"
	linuxadapter "github.com/ordaxsystems/ordax-os/tools/creator/host/linux"
)

func readSourceBootDevice(sourceFile string) (string, error) {
	data, err := os.ReadFile(sourceFile)
	if err != nil {
		return "", fmt.Errorf("read source boot device handoff: %w", err)
	}
	if len(data) == 0 || len(data) > 4096 {
		return "", fmt.Errorf("source boot device handoff has invalid size")
	}
	value := strings.TrimSpace(string(data))
	if !path.IsAbs(value) || !strings.HasPrefix(value, "/dev/") {
		return "", fmt.Errorf("source boot device handoff is not an absolute /dev path")
	}
	return value, nil
}

func main() {
	sourceFile := flag.String("source-device-file", "", "optional explicit /dev source override for bounded tests/recovery only")
	mountinfo := flag.String("mountinfo", "/proc/self/mountinfo", "Linux mountinfo used to identify current OrdaX source block device")
	sourceMountpoint := flag.String("source-mountpoint", "/ordax", "current mounted OrdaX release/bootstrap filesystem")
	sysClassBlock := flag.String("sys-class-block", "/sys/class/block", "Linux sysfs block class root")
	devRoot := flag.String("dev-root", "/dev", "Linux block device root")
	confirm := flag.String("confirm", "", "re-enumerate and bind a previously selected Native target token")
	flag.Parse()
	if flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "ordax-creator-native-targets: unexpected positional arguments")
		os.Exit(2)
	}

	var sourceDevice string
	var err error
	if strings.TrimSpace(*sourceFile) != "" {
		sourceDevice, err = readSourceBootDevice(*sourceFile)
	} else {
		sourceDevice, err = linuxadapter.DiscoverMountedBlockDevice(*mountinfo, *sourceMountpoint)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-native-targets:", err)
		os.Exit(1)
	}
	targets, err := linuxadapter.EnumerateNativeInstallTargets(*sysClassBlock, *devRoot, sourceDevice)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-native-targets:", err)
		os.Exit(1)
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if strings.TrimSpace(*confirm) == "" {
		output := struct {
			Schema        string                                    `json:"$schema"`
			Mode          string                                    `json:"mode"`
			PhysicalWrite bool                                      `json:"physical_write"`
			SourceDevice  string                                    `json:"source_boot_device"`
			Targets       []creatorcore.NativeInstallTargetIdentity `json:"targets"`
		}{
			Schema:        "prototype-ordax.creator-native-targets/1",
			Mode:          "read-only-native-install-target-discovery",
			PhysicalWrite: false,
			SourceDevice:  sourceDevice,
			Targets:       targets,
		}
		if err := encoder.Encode(output); err != nil {
			fmt.Fprintln(os.Stderr, "ordax-creator-native-targets:", err)
			os.Exit(1)
		}
		return
	}

	confirmed, err := creatorcore.MatchConfirmedNativeInstallTarget(targets, *confirm)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-native-targets:", err)
		os.Exit(1)
	}
	plan, err := creatorcore.PlanNativeInstallationForTarget(confirmed, *confirm)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-native-targets:", err)
		os.Exit(1)
	}
	if err := encoder.Encode(plan); err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-native-targets:", err)
		os.Exit(1)
	}
}
