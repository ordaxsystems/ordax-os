package windowsadapter

import (
	"os"
	"strings"
	"testing"
)

func TestPortableDataWindowsWaitsForStableFormattedVolume(t *testing.T) {
	source, err := os.ReadFile("portable_data_windows.go")
	if err != nil {
		t.Fatalf("read portable_data_windows.go: %v", err)
	}
	text := string(source)
	required := []string{
		"$verificationDeadline = (Get-Date).AddSeconds(20)",
		"OrdinalIgnoreCase",
		"Get-Volume -DriveLetter",
		"Add-PartitionAccessPath -AssignDriveLetter",
		"ORDAX-DATA verification timed out: filesystem=",
		"$observedFileSystem = [string]$checkVolume.FileSystem",
		"$observedFileSystem = [string]$checkVolume.FileSystemType",
		"[System.IO.DriveInfo]::new",
		"$driveInfo.DriveFormat",
		"'Unknown'",
	}
	for _, fragment := range required {
		if !strings.Contains(text, fragment) {
			t.Fatalf("portable ORDAX-DATA verification lost required stabilization fragment %q", fragment)
		}
	}

	// Git may check this source out with CRLF on native Windows runners. Normalize
	// line endings before asserting the exact preference order.
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	fileSystemPos := strings.Index(normalized, "$observedFileSystem = [string]$checkVolume.FileSystem\n")
	fileSystemTypePos := strings.Index(normalized, "$observedFileSystem = [string]$checkVolume.FileSystemType\n")
	if fileSystemPos < 0 || fileSystemTypePos < 0 || fileSystemPos >= fileSystemTypePos {
		t.Fatalf("portable ORDAX-DATA verification must prefer FileSystem before FileSystemType; positions filesystem=%d filesystemType=%d", fileSystemPos, fileSystemTypePos)
	}

	forbidden := []string{
		"if (([string]$checkVolume.FileSystemType) -ne 'exFAT')",
		"throw \"ORDAX-DATA filesystem verification failed\"",
	}
	for _, fragment := range forbidden {
		if strings.Contains(text, fragment) {
			t.Fatalf("portable ORDAX-DATA verification regressed to one-shot check %q", fragment)
		}
	}
}

func TestPortableDataWaitsForSameDiskAfterPhysicalWrite(t *testing.T) {
	source, err := os.ReadFile("portable_data_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	text := strings.ReplaceAll(string(source), "\r\n", "\n")
	expected := []string{
		"function Wait-OrdaXTargetDisk {",
		"$deadline = (Get-Date).AddSeconds(60)",
		"$candidate = Get-Disk -Number $diskNumber -ErrorAction Stop",
		"Refresh-OrdaXStorage",
		"$disk = Wait-OrdaXTargetDisk",
		"Windows did not rediscover PhysicalDrive",
		"if ([UInt64]$disk.Size -ne $expectedDiskBytes)",
		"if (([string]$disk.BusType).ToUpperInvariant() -ne 'USB')",
		"if ([bool]$disk.IsSystem -or [bool]$disk.IsBoot)",
	}
	for _, fragment := range expected {
		if !strings.Contains(text, fragment) {
			t.Fatalf("exact-target USB rediscovery or identity check missing: %q", fragment)
		}
	}
	if strings.Contains(text, "$disk = Get-Disk -Number $diskNumber -ErrorAction Stop") {
		t.Fatal("one-shot Get-Disk after raw rewrite reintroduces transient Windows storage failure")
	}
	lookup := strings.Index(text, "$disk = Wait-OrdaXTargetDisk")
	check := strings.Index(text, "if ([UInt64]$disk.Size -ne $expectedDiskBytes)")
	if lookup < 0 || check <= lookup {
		t.Fatal("Windows USB identity verification must follow bounded disk rediscovery")
	}
}

func TestPortableDataNotifiesWindowsPartitionManagerAfterVerifiedRawWrite(t *testing.T) {
	source, err := os.ReadFile("portable_data_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	content := string(source)
	required := []string{
		"ioctlDiskUpdateProperties uintptr = 0x00070140",
		"openVerifiedPhysicalDriveReadOnly(expected)",
		"procDeviceIoControl.Call(",
		"ioctlDiskUpdateProperties,",
		"file.Close()",
		"if err := refreshPortableDiskPartitionView(expected); err != nil {",
		"$disk = Wait-OrdaXTargetDisk",
	}
	for _, fragment := range required {
		if !strings.Contains(content, fragment) {
			t.Fatalf("native same-USB GPT re-enumeration lost %q", fragment)
		}
	}
	refresh := strings.Index(content, "if err := refreshPortableDiskPartitionView(expected); err != nil {")
	powershell := strings.Index(content, "script := fmt.Sprintf(")
	if refresh < 0 || powershell <= refresh {
		t.Fatal("verified PhysicalDrive GPT refresh must precede Windows Get-Disk and ORDAX-DATA formatting")
	}
	checkSerial := strings.Index(content, "physical device serial changed")
	if checkSerial < 0 || refresh <= checkSerial {
		t.Fatal("native GPT refresh must follow the physical USB serial identity check")
	}
}
