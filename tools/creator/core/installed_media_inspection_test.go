package creatorcore

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func installedMediaFixture(t *testing.T, names []string, ranges [][2]uint64) string {
	t.Helper()
	if len(names) != len(ranges) || len(names) > 4 {
		t.Fatal("bad installed media fixture")
	}
	path := filepath.Join(t.TempDir(), "existing-usb.raw")
	const sectors = 256
	writeTestGPTSeed(t, path, sectors)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	entries := make([]byte, 512)
	for i, name := range names {
		copy(entries[i*128:(i+1)*128], testGPTEntry(name, ranges[i][0], ranges[i][1], byte(i+1)))
	}
	crc := crc32.ChecksumIEEE(entries)
	copy(data[2*512:3*512], entries)
	copy(data[(sectors-2)*512:(sectors-1)*512], entries)
	copy(data[512:2*512], testGPTHeader(1, sectors-1, 34, sectors-3, 2, crc))
	copy(data[(sectors-1)*512:sectors*512], testGPTHeader(sectors-1, 1, 34, sectors-3, sectors-2, crc))
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func testInspectInstalledMedia(t *testing.T, path string, capacity uint64) (InstalledMediaInspection, error) {
	t.Helper()
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	return InspectInstalledMedia(file, capacity)
}

func TestInspectInstalledMediaRecognizesOnlyReadOnlyGPTCandidates(t *testing.T) {
	const capacity = 256 * 512
	tests := []struct {
		name       string
		partitions []string
		ranges     [][2]uint64
		profile    string
	}{
		{"seed", []string{"ORDAX-ESP", "ORDAX"}, [][2]uint64{{40, 50}, {51, 253}}, "owner-seed-candidate"},
		{"development", []string{"ORDAX-ESP", "ORDAX", "ORDAX-DATA"}, [][2]uint64{{40, 50}, {51, 180}, {181, 253}}, "owner-development-candidate"},
		{"stable", []string{"ORDAX-ESP", "ORDAX-DATA"}, [][2]uint64{{40, 50}, {51, 253}}, "portable-stable-candidate"},
		{"unknown", []string{"ORDAX-ESP", "OTHER"}, [][2]uint64{{40, 50}, {51, 253}}, "unrecognized"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := installedMediaFixture(t, tt.partitions, tt.ranges)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			got, err := testInspectInstalledMedia(t, path, capacity)
			if err != nil {
				t.Fatal(err)
			}
			if got.Profile != tt.profile || len(got.Partitions) != len(tt.partitions) {
				t.Fatalf("unexpected inspection: %+v", got)
			}
			if got.PhysicalWrite || got.Mode != "read-only-gpt-inspection" ||
				got.Verification != "gpt-primary-backup-crc-and-geometry-only" {
				t.Fatalf("inspection overstates authority: %+v", got)
			}
			encoded, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(encoded), "\"physical_write\":false") {
				t.Fatalf("inspection JSON lacks read-only authority: %s", encoded)
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) {
				t.Fatal("read-only inspection modified disk bytes")
			}
		})
	}
}

func TestInspectInstalledMediaRejectsDamagedOrUnsafeGPT(t *testing.T) {
	const capacity = 256 * 512
	baseNames := []string{"ORDAX-ESP", "ORDAX", "ORDAX-DATA"}
	baseRanges := [][2]uint64{{40, 50}, {51, 180}, {181, 253}}
	tests := []struct {
		name   string
		mutate func([]byte)
	}{
		{"bad-primary-crc", func(b []byte) { b[512+16] ^= 0xff }},
		{"bad-secondary-crc", func(b []byte) { b[(256-1)*512+16] ^= 0xff }},
		{"bad-entry-crc", func(b []byte) { b[2*512+32] ^= 0xff }},
		{"bad-backup-array", func(b []byte) { b[(256-2)*512+32] ^= 0xff }},
		{"bad-mbr", func(b []byte) { b[510] = 0 }},
		{"no-protective-partition", func(b []byte) { b[446+4] = 0 }},
		{"inconsistent-disk-capacity", func(b []byte) {
			backup := testGPTHeader(255, 1, 34, 253, 254, binary.LittleEndian.Uint32(b[512+88:512+92]))
			copy(b[(256-1)*512:], backup)
			// Capacity is injected separately below.
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := installedMediaFixture(t, baseNames, baseRanges)
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			tt.mutate(data)
			if err := os.WriteFile(path, data, 0o600); err != nil {
				t.Fatal(err)
			}
			size := uint64(capacity)
			if tt.name == "inconsistent-disk-capacity" {
				size += 512
			}
			if _, err := testInspectInstalledMedia(t, path, size); err == nil {
				t.Fatal("damaged/unsafe GPT was accepted")
			}
		})
	}
	for name, ranges := range map[string][][2]uint64{
		"overlapping": {{40, 50}, {50, 180}, {181, 253}},
		"out-of-range": {{40, 50}, {51, 180}, {181, 254}},
	} {
		t.Run(name, func(t *testing.T) {
			path := installedMediaFixture(t, baseNames, ranges)
			if _, err := testInspectInstalledMedia(t, path, capacity); err == nil {
				t.Fatal("unsafe partition geometry was accepted")
			}
		})
	}
	t.Run("duplicate-name", func(t *testing.T) {
		path := installedMediaFixture(t, []string{"ORDAX-ESP", "ORDAX", "ORDAX"}, baseRanges)
		if _, err := testInspectInstalledMedia(t, path, capacity); err == nil {
			t.Fatal("duplicate partition name was accepted")
		}
	})
	t.Run("invalid-capacity", func(t *testing.T) {
		path := installedMediaFixture(t, baseNames, baseRanges)
		for _, size := range []uint64{0, 257, capacity + 1} {
			if _, err := testInspectInstalledMedia(t, path, size); err == nil {
				t.Fatalf("invalid capacity %d was accepted", size)
			}
		}
	})
}
