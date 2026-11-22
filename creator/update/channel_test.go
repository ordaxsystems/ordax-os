package update

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"io"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validManifestForTest() Manifest {
	return Manifest{
		Schema:       ChannelSchemaV2,
		Channel:      DevelopmentChannel,
		Version:      "dev-0123456789ab",
		SourceCommit: "0123456789abcdef0123456789abcdef01234567",
		Payload: Payload{
			URL:    "https://github.com/ordaxsystems/ordax-os/releases/download/creator-dev/ordax-creator-dev-windows-amd64.zip",
			SHA256: strings.Repeat("a", 64),
			Size:   1234,
		},
		Entrypoints: Entrypoints{
			Inspect: "1-Inspect-OrdaXUSB.cmd",
			Status:  "ordax-creator-physical-test.exe",
		},
	}
}

func legacyManifestBytesForTest(trust string) []byte {
	m := validManifestForTest()
	legacy := legacyManifestV1{
		Schema: m.Schema, Channel: m.Channel, Version: m.Version,
		SourceCommit: m.SourceCommit, Payload: m.Payload,
		Entrypoints: legacyEntrypointsV1{Inspect: m.Entrypoints.Inspect, Trust: trust, Status: m.Entrypoints.Status},
	}
	legacy.Schema = ChannelSchemaV1
	data, _ := json.Marshal(legacy)
	return data
}

func TestValidateManifestAcceptsBoundDevelopmentChannel(t *testing.T) {
	if err := ValidateManifest(validManifestForTest()); err != nil {
		t.Fatal(err)
	}
}

func TestDecodeManifestAcceptsLegacyProtocolWithoutExposingTrustCapability(t *testing.T) {
	manifest, err := decodeManifest(legacyManifestBytesForTest("2-Legacy-Protocol-Compatibility.cmd"))
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Schema != ChannelSchemaV1 {
		t.Fatalf("schema = %q", manifest.Schema)
	}
	if manifest.Entrypoints.Inspect == "" || manifest.Entrypoints.Status == "" {
		t.Fatal("consumer entrypoints were lost")
	}
}

func TestDecodeManifestRejectsUnsafeLegacyCompatibilityEntrypoint(t *testing.T) {
	if _, err := decodeManifest(legacyManifestBytesForTest("../evil.cmd")); err == nil {
		t.Fatal("unsafe legacy compatibility entrypoint unexpectedly accepted")
	}
}

func TestValidateManifestRejectsExternalPayload(t *testing.T) {
	m := validManifestForTest()
	m.Payload.URL = "https://example.invalid/creator.zip"
	if err := ValidateManifest(m); err == nil {
		t.Fatal("external payload URL unexpectedly accepted")
	}
}

func TestValidateManifestRejectsTraversalEntrypoint(t *testing.T) {
	m := validManifestForTest()
	m.Entrypoints.Inspect = "../evil.cmd"
	if err := ValidateManifest(m); err == nil {
		t.Fatal("path traversal entrypoint unexpectedly accepted")
	}
}

func TestDecodeV2RejectsPublisherTrustField(t *testing.T) {
	m := validManifestForTest()
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	text := strings.TrimSuffix(string(data), "}") + `,"trust":"forbidden"}`
	if _, err := decodeManifest([]byte(text)); err == nil {
		t.Fatal("publisher trust field unexpectedly accepted in v2 consumer manifest")
	}
}

func writeZip(t *testing.T, entries map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "payload.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	for name, body := range entries {
		entry, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestExtractPayloadRequiresAllEntrypoints(t *testing.T) {
	m := validManifestForTest()
	zipPath := writeZip(t, map[string]string{
		m.Entrypoints.Inspect: "@echo inspect\r\n",
	})
	dest := filepath.Join(t.TempDir(), "out")
	if err := os.Mkdir(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := extractPayload(zipPath, dest, m); err == nil || !strings.Contains(err.Error(), "status entrypoint") {
		t.Fatalf("missing status entrypoint error = %v", err)
	}
}

func TestExtractPayloadRejectsTraversal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "payload.zip")
	var data bytes.Buffer
	archive := zip.NewWriter(&data)
	entry, err := archive.Create("../evil.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte("evil"))
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(t.TempDir(), "out")
	if err := os.Mkdir(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := extractPayload(path, dest, validManifestForTest()); err == nil || !strings.Contains(err.Error(), "unsafe archive path") {
		t.Fatalf("traversal error = %v", err)
	}
}

func TestCurrentRejectsDirectoryOutsideVersionSlot(t *testing.T) {
	root := t.TempDir()
	current := Installed{
		Schema:       "prototype-ordax.creator-installed/1",
		Channel:      DevelopmentChannel,
		Version:      "dev-0123456789ab",
		SourceCommit: "0123456789abcdef0123456789abcdef01234567",
		Directory:    filepath.Join(root, "elsewhere"),
	}
	data, _ := json.Marshal(current)
	if err := os.WriteFile(filepath.Join(root, "current.json"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root); err == nil {
		t.Fatal("external current directory unexpectedly accepted")
	}
}


func TestSafeRelativeRejectsAmbiguousWindowsPathsOnAllHosts(t *testing.T) {
	for _, name := range []string{
		"C:payload.exe", `C:\payload.exe`, `dir\payload.exe`,
		"payload.exe:stream", "nested/NUL", "nested/CON.txt",
		"nested/com1.exe", "nested/LPT9", "nested/COM¹",
		"trailing.", "nested/trailing ", "a//b", "./payload.exe",
		"nested/a<b", "nested/a>b", "nested/a?b", "nested/a*b",
		"nested/a|b", "nested/a\"b", "nested/control\x1f",
		"../payload.exe", "/absolute/payload.exe",
	} {
		if safeRelative(name) {
			t.Errorf("unsafe path %q accepted", name)
		}
	}
	for _, name := range []string{"payload.zip", "bin/payload.exe", "1-Inspect-OrdaXUSB.cmd"} {
		if !safeRelative(name) {
			t.Errorf("canonical relative path %q rejected", name)
		}
	}
}

func TestValidateManifestRejectsNonCanonicalCreatorDevAssetURLs(t *testing.T) {
	base := "https://github.com/ordaxsystems/ordax-os/releases/download/creator-dev/"
	for _, raw := range []string{
		base,
		base + "payload.exe",
		base + "subfolder/payload.zip",
		base + "payload.zip?redirect=true",
		base + "payload.zip?",
		base + "payload%2Ezip",
		base + "NUL.zip",
		"https://github.com.evil.example/ordaxsystems/ordax-os/releases/download/creator-dev/payload.zip",
	} {
		m := validManifestForTest()
		m.Payload.URL = raw
		if err := ValidateManifest(m); err == nil {
			t.Errorf("noncanonical release asset URL %q accepted", raw)
		}
	}
}

func TestExtractPayloadRejectsCaseFoldedDuplicatePaths(t *testing.T) {
	zipPath := writeZip(t, map[string]string{
		"payload/Component.exe": "first",
		"payload/component.exe": "second",
	})
	destination := filepath.Join(t.TempDir(), "out")
	if err := os.Mkdir(destination, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := extractPayload(zipPath, destination, validManifestForTest()); err == nil ||
		!strings.Contains(err.Error(), "duplicate archive path") {
		t.Fatalf("case-folded duplicate error = %v", err)
	}
}


func TestExtractPayloadAcceptsExplicitCanonicalDirectories(t *testing.T) {
	m := validManifestForTest()
	zipPath := writeZip(t, map[string]string{
		"bin/":               "",
		"bin/helper.exe":     "safe helper",
		m.Entrypoints.Inspect: "read-only inspect",
		m.Entrypoints.Status:  "read-only status",
	})
	destination := filepath.Join(t.TempDir(), "out")
	if err := os.Mkdir(destination, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := extractPayload(zipPath, destination, m); err != nil {
		t.Fatalf("explicit directory ZIP entry was rejected: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(destination, "bin", "helper.exe"))
	if err != nil || string(data) != "safe helper" {
		t.Fatalf("extracted helper bytes=%q error=%v", data, err)
	}
}

func writeInstalledPointerForTest(t *testing.T, root, version string) Installed {
	t.Helper()
	m := validManifestForTest()
	if version == "" {
		version = m.Version
	}
	directory := filepath.Join(root, "versions", m.SourceCommit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	current := Installed{
		Schema: "prototype-ordax.creator-installed/1",
		Channel: m.Channel,
		Version: version,
		SourceCommit: m.SourceCommit,
		Directory: directory,
	}
	data, err := json.Marshal(current)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "current.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	return current
}

func TestCurrentRejectsSymlinkPointerAndVersionRoot(t *testing.T) {
	t.Run("pointer", func(t *testing.T) {
		root := t.TempDir()
		writeInstalledPointerForTest(t, root, "")
		source := filepath.Join(root, "current.json")
		bytes, err := os.ReadFile(source)
		if err != nil {
			t.Fatal(err)
		}
		backing := filepath.Join(t.TempDir(), "pointer.json")
		if err := os.WriteFile(backing, bytes, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(source); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(backing, source); err != nil {
			t.Skipf("symlinks unavailable on this host: %v", err)
		}
		if _, err := Current(root); err == nil {
			t.Fatal("symlinked installed pointer accepted")
		}
	})
	t.Run("versions", func(t *testing.T) {
		root := t.TempDir()
		writeInstalledPointerForTest(t, root, "")
		versions := filepath.Join(root, "versions")
		backing := filepath.Join(t.TempDir(), "versions")
		if err := os.Rename(versions, backing); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(backing, versions); err != nil {
			t.Skipf("symlinks unavailable on this host: %v", err)
		}
		if _, err := Current(root); err == nil {
			t.Fatal("symlinked installed versions root accepted")
		}
	})
}

func TestCurrentRejectsOversizedInstalledPointer(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "current.json"),
		[]byte(strings.Repeat("x", maxInstalledPointerBytes+1)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root); err == nil {
		t.Fatal("oversized installed pointer accepted")
	}
}

func TestEnsureRejectsVersionMismatchAtIdenticalSourceCommit(t *testing.T) {
	root := t.TempDir()
	writeAttestedPointerForTest(t, root, "different-product-version")
	m := validManifestForTest()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			t.Errorf("unexpected method %q", req.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(m); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	defer server.Close()
	if _, _, err := Ensure(server.Client(), root, server.URL); err == nil ||
		!strings.Contains(err.Error(), "conflicts with published source/payload") {
		t.Fatalf("same-source conflicting product version result = %v", err)
	}
}


func writeAttestedPointerForTest(t *testing.T, root, version string) Installed {
	t.Helper()
	m := validManifestForTest()
	if version == "" { version = m.Version }
	dir := filepath.Join(root, "versions", m.SourceCommit)
	if err := os.MkdirAll(dir, 0o755); err != nil { t.Fatal(err) }
	for name, content := range map[string]string{
		m.Entrypoints.Inspect: "@echo inspect\r\n",
		m.Entrypoints.Status: "readonly-executable",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil { t.Fatal(err) }
	}
	files, err := installedFileInventory(dir)
	if err != nil { t.Fatal(err) }
	installed := Installed{
		Schema: "prototype-ordax.creator-installed/1", Channel:m.Channel,
		Version:version, SourceCommit:m.SourceCommit, Directory:dir,
		PayloadSHA256:m.Payload.SHA256, Files:files,
	}
	data, err := json.Marshal(installed)
	if err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(root, "current.json"), data, 0o600); err != nil { t.Fatal(err) }
	return installed
}

func TestCurrentVerifiesAllCachedDevelopmentFiles(t *testing.T) {
	tests := []struct{
		name string
		mutate func(t *testing.T, installed Installed)
	}{
		{"changed-content", func(t *testing.T, installed Installed) {
			if err := os.WriteFile(filepath.Join(installed.Directory,"ordax-creator-physical-test.exe"), []byte("tampered"), 0o600); err != nil { t.Fatal(err) }
		}},
		{"unexpected-extra-file", func(t *testing.T, installed Installed) {
			if err := os.WriteFile(filepath.Join(installed.Directory, "unexpected.exe"), []byte("extra"), 0o600); err != nil { t.Fatal(err) }
		}},
		{"deleted-file", func(t *testing.T, installed Installed) {
			if err := os.Remove(filepath.Join(installed.Directory,"ordax-creator-physical-test.exe")); err != nil { t.Fatal(err) }
		}},
		{"symlink", func(t *testing.T, installed Installed) {
			target := filepath.Join(installed.Directory,"ordax-creator-physical-test.exe")
			if err := os.Remove(target); err != nil { t.Fatal(err) }
			if err := os.Symlink(filepath.Join(installed.Directory,"1-Inspect-OrdaXUSB.cmd"),target); err != nil {
				t.Skipf("symlinks unavailable on host: %v",err)
			}
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name,func(t *testing.T) {
			root := t.TempDir()
			inst := writeAttestedPointerForTest(t, root, "")
			if _, err := Current(root); err != nil { t.Fatalf("clean cache rejected: %v",err) }
			tc.mutate(t,inst)
			if _, err := Current(root); err == nil { t.Fatal("changed cache unexpectedly accepted") }
		})
	}
}

func TestCurrentRejectsLegacyUnattestedCache(t *testing.T) {
	root := t.TempDir()
	writeInstalledPointerForTest(t, root, "")
	if _, err := Current(root); err == nil || !strings.Contains(err.Error(),"lacks verified payload receipt") {
		t.Fatalf("legacy cache without integrity receipt: %v",err)
	}
}

func TestEnsureReusesAttestedCacheWithoutDownloadingZIP(t *testing.T) {
	root := t.TempDir()
	writeAttestedPointerForTest(t,root,"")
	m := validManifestForTest()
	data, err := json.Marshal(m)
	if err != nil { t.Fatal(err) }
	var manifestRequests, payloadRequests int
	client := &http.Client{Transport:developmentRoundTrip(func(req *http.Request)(*http.Response,error){
		if strings.Contains(req.URL.Path,"creator-dev-manifest.json") {
			manifestRequests++
			return &http.Response{StatusCode:http.StatusOK,Body:io.NopCloser(bytes.NewReader(data)),Header:make(http.Header),Request:req},nil
		}
		payloadRequests++
		return nil, io.EOF
	})}
	installed, changed, err := Ensure(client,root,"https://github.com/ordaxsystems/ordax-os/releases/download/creator-dev/creator-dev-manifest.json")
	if err != nil || changed || installed.SourceCommit != m.SourceCommit {
		t.Fatalf("reuse result changed=%t commit=%q err=%v",changed,installed.SourceCommit,err)
	}
	if manifestRequests != 1 || payloadRequests != 0 {
		t.Fatalf("unexpected network requests manifest=%d payload=%d",manifestRequests,payloadRequests)
	}
}

type developmentRoundTrip func(*http.Request) (*http.Response,error)
func (f developmentRoundTrip) RoundTrip(req *http.Request) (*http.Response,error) { return f(req) }

func TestEnsureMigratesLegacyCacheOnlyAfterVerifiedZIPComparison(t *testing.T) {
	root := t.TempDir()
	writeInstalledPointerForTest(t,root,"")
	m := validManifestForTest()
	zipPath := writeZip(t,map[string]string{
		m.Entrypoints.Inspect:"@echo inspect\r\n",
		m.Entrypoints.Status:"readonly-executable",
	})
	zipBytes,err := os.ReadFile(zipPath)
	if err != nil { t.Fatal(err) }
	sum := sha256.Sum256(zipBytes)
	m.Payload.SHA256 = hex.EncodeToString(sum[:])
	m.Payload.Size = int64(len(zipBytes))
	manifestBytes,err := json.Marshal(m)
	if err != nil { t.Fatal(err) }
	requests := 0
	client := &http.Client{Transport:developmentRoundTrip(func(req *http.Request)(*http.Response,error){
		requests++
		var data []byte
		if strings.Contains(req.URL.Path,"creator-dev-manifest.json") {
			data = manifestBytes
		} else if req.URL.String() == m.Payload.URL {
			data = zipBytes
		} else {
			t.Errorf("unexpected external URL %s",req.URL)
			return nil, io.EOF
		}
		return &http.Response{StatusCode:http.StatusOK,Body:io.NopCloser(bytes.NewReader(data)),Header:make(http.Header),Request:req},nil
	})}
	// Both channels use the same test transport; nothing is fetched externally.
	existingDir := filepath.Join(root,"versions",m.SourceCommit)
	for name,content := range map[string]string{
		m.Entrypoints.Inspect:"@echo inspect\r\n",
		m.Entrypoints.Status:"readonly-executable",
	} {
		if err := os.WriteFile(filepath.Join(existingDir,name),[]byte(content),0o600);err != nil { t.Fatal(err) }
	}
	installed,changed,err := Ensure(client,root,"https://github.com/ordaxsystems/ordax-os/releases/download/creator-dev/creator-dev-manifest.json")
	if err != nil || changed || installed.PayloadSHA256 != m.Payload.SHA256 {
		t.Fatalf("legacy migration failed changed=%t err=%v",changed,err)
	}
	if requests != 2 { t.Fatalf("expected one manifest and one ZIP request, got %d",requests) }
	if _,err := Current(root);err != nil { t.Fatalf("migrated offline receipt invalid: %v",err) }
	_,changed,err = Ensure(client,root,"https://github.com/ordaxsystems/ordax-os/releases/download/creator-dev/creator-dev-manifest.json")
	if err != nil || changed || requests != 3 { t.Fatalf("second reuse changed=%t requests=%d err=%v",changed,requests,err) }
	// A corrupted version slot must not be promoted or silently replaced.
	if err := os.WriteFile(filepath.Join(existingDir,m.Entrypoints.Status),[]byte("corrupt"),0o600);err != nil { t.Fatal(err) }
	if _,_,err := Ensure(client,root,"https://github.com/ordaxsystems/ordax-os/releases/download/creator-dev/creator-dev-manifest.json");err == nil {
		t.Fatal("tampered existing version slot silently accepted")
	}
}

func TestCurrentRejectsEmptyDirectoryAndSparseDevelopmentPointers(t *testing.T) {
	for _, mode := range []string{"empty", "directory", "sparse"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "current.json")
			switch mode {
			case "empty":
				if err := os.WriteFile(path, nil, 0o600); err != nil {
					t.Fatal(err)
				}
			case "directory":
				if err := os.Mkdir(path, 0o700); err != nil {
					t.Fatal(err)
				}
			case "sparse":
				if err := os.WriteFile(path, []byte("{}"), 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Truncate(path, maxInstalledPointerBytes+1); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := Current(root); err == nil {
				t.Fatalf("unsafe development pointer type %s accepted", mode)
			}
		})
	}
}

func TestDevelopmentInventoryPreservesEmptyFilesAndRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	for name, body := range map[string][]byte{
		"nonempty.dat": []byte("development-cache"),
		"empty.dat": nil,
	} {
		if err := os.WriteFile(filepath.Join(root, name), body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	files, err := installedFileInventory(root)
	if err != nil || len(files) != 2 {
		t.Fatalf("development cache inventory rejected empty file: files=%+v err=%v", files, err)
	}
	found := false
	for _, file := range files {
		if file.Path == "empty.dat" {
			sum := sha256.Sum256(nil)
			if file.Size != 0 || file.SHA256 != hex.EncodeToString(sum[:]) {
				t.Fatalf("empty cache receipt changed: %+v", file)
			}
			found = true
		}
	}
	if !found {
		t.Fatal("empty file was silently omitted from cache receipt")
	}
	link := filepath.Join(root, "linked.dat")
	if err := os.Symlink(filepath.Join(root, "nonempty.dat"), link); err != nil {
		t.Skipf("symlinks unavailable on host: %v", err)
	}
	if _, err := installedFileInventory(root); err == nil {
		t.Fatal("symlinked development cache file accepted in receipt")
	}
}


func TestDevelopmentZIPRejectsForgedOverBudgetHeaderBeforeWritingFiles(t *testing.T) {
	manifest := validManifestForTest()
	zipPath := writeZip(t, map[string]string{manifest.Entrypoints.Inspect: "tiny"})
	body, err := os.ReadFile(zipPath)
	if err != nil { t.Fatal(err) }
	central := bytes.Index(body, []byte("PK\x01\x02"))
	if central < 0 || central+28 > len(body) { t.Fatal("ZIP central directory header missing") }
	binary.LittleEndian.PutUint32(body[central+24:central+28], uint32(maxExtractedBytes+1))
	if err := os.WriteFile(zipPath, body, 0o600); err != nil { t.Fatal(err) }
	archive, err := zip.OpenReader(zipPath)
	if err != nil { t.Fatalf("forged ZIP header was not parsed: %v",err) }
	headerSize := archive.File[0].UncompressedSize64
	_ = archive.Close()
	if headerSize != uint64(maxExtractedBytes+1) { t.Fatalf("forged header not applied: %d", headerSize) }
	dest := t.TempDir()
	if err := extractPayload(zipPath,dest,manifest); err == nil || !strings.Contains(err.Error(), "ZIP expanded size") {
		t.Fatalf("over-budget declared ZIP expansion was accepted: %v",err)
	}
	files, err := os.ReadDir(dest)
	if err != nil || len(files) != 0 {t.Fatalf("ZIP should not create files before size gate: files=%v err=%v",files,err)}
}
