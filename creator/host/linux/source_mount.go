package linuxadapter

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strconv"
	"strings"
)

const maxMountInfoBytes = 1024 * 1024

func decodeMountInfoField(value string) (string, error) {
	var output strings.Builder
	for index := 0; index < len(value); {
		if value[index] != '\\' {
			if value[index] < 0x20 || value[index] == 0x7f {
				return "", errors.New("mountinfo field contains control character")
			}
			output.WriteByte(value[index])
			index++
			continue
		}
		if index+3 >= len(value) {
			return "", errors.New("mountinfo field has truncated escape")
		}
		code := value[index+1 : index+4]
		switch code {
		case "040", "011", "012", "134":
			number, _ := strconv.ParseUint(code, 8, 8)
			output.WriteByte(byte(number))
		default:
			return "", fmt.Errorf("mountinfo field contains unsupported escape \\%s", code)
		}
		index += 4
	}
	return output.String(), nil
}

func canonicalDevPath(value string) (string, error) {
	if !path.IsAbs(value) || !strings.HasPrefix(value, "/dev/") {
		return "", errors.New("mounted source is not an absolute /dev path")
	}
	clean := path.Clean(value)
	if clean != value || clean == "/dev" || strings.Contains(clean, "\x00") {
		return "", errors.New("mounted source device path is not canonical")
	}
	return clean, nil
}

// DiscoverMountedBlockDevice resolves the exact block-device source of one
// existing mount from Linux mountinfo. It performs no device I/O and fails
// closed on duplicate mounts, non-/dev sources or malformed records.
func DiscoverMountedBlockDevice(mountinfoPath, mountPoint string) (string, error) {
	if !path.IsAbs(mountPoint) || path.Clean(mountPoint) != mountPoint {
		return "", errors.New("source mount point must be canonical and absolute")
	}
	file, err := os.Open(mountinfoPath)
	if err != nil {
		return "", fmt.Errorf("open mountinfo: %w", err)
	}
	defer file.Close()
	payload, err := io.ReadAll(io.LimitReader(file, maxMountInfoBytes+1))
	if err != nil {
		return "", fmt.Errorf("read mountinfo: %w", err)
	}
	if len(payload) == 0 || len(payload) > maxMountInfoBytes {
		return "", errors.New("mountinfo is empty or exceeds safety bound")
	}

	var match string
	for _, line := range strings.Split(strings.TrimSuffix(string(payload), "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}
		separator := -1
		for index, field := range fields {
			if field == "-" {
				separator = index
				break
			}
		}
		if separator < 6 || separator+3 > len(fields) {
			continue
		}
		decodedMount, err := decodeMountInfoField(fields[4])
		if err != nil || decodedMount != mountPoint {
			continue
		}
		source, err := decodeMountInfoField(fields[separator+2])
		if err != nil {
			return "", fmt.Errorf("decode source mount device: %w", err)
		}
		source, err = canonicalDevPath(source)
		if err != nil {
			return "", err
		}
		if match != "" {
			return "", errors.New("source mount point appears more than once in mountinfo")
		}
		match = source
	}
	if match == "" {
		return "", fmt.Errorf("source mount point %s is not backed by a discoverable /dev block device", mountPoint)
	}
	return match, nil
}
