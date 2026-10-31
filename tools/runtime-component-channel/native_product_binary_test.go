package main

import (
	"archive/zip"
	"crypto/sha256"
	"debug/elf"
	"debug/pe"
	"encoding/binary"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func nativeExecutableBytes() []byte {
	// A minimal structurally valid x86-64 ELF64 with executable PT_LOAD and
	// bound entrypoint. This is ONLY a packaging fixture and never executes:
	// actual kernel/Buildroot ABI proof remains a separate prerequisite.
	data := make([]byte, (2<<20)+4096)
	copy(data[:16], []byte{0x7f, 'E', 'L', 'F', 2, 1, 1})
	binary.LittleEndian.PutUint16(data[16:], uint16(elf.ET_EXEC))
	binary.LittleEndian.PutUint16(data[18:], uint16(elf.EM_X86_64))
	binary.LittleEndian.PutUint32(data[20:], uint32(elf.EV_CURRENT))
	binary.LittleEndian.PutUint64(data[24:], 0x400000)
	binary.LittleEndian.PutUint64(data[32:], 64)
	binary.LittleEndian.PutUint16(data[52:], 64)
	binary.LittleEndian.PutUint16(data[54:], 56)
	binary.LittleEndian.PutUint16(data[56:], 1)
	binary.LittleEndian.PutUint32(data[64:], uint32(elf.PT_LOAD))
	binary.LittleEndian.PutUint32(data[68:], uint32(elf.PF_R|elf.PF_X))
	binary.LittleEndian.PutUint64(data[80:], 0x400000)
	binary.LittleEndian.PutUint64(data[96:], uint64(len(data)))
	binary.LittleEndian.PutUint64(data[104:], uint64(len(data)))
	binary.LittleEndian.PutUint64(data[112:], 0x1000)
	return data
}

func nativePackageFixture(t *testing.T, executable bool, zipMode os.FileMode) testFixture {
	return nativePackageFixtureWithPayload(t, executable, zipMode, nativeExecutableBytes())
}

func nativePackageFixtureWithPayload(t *testing.T, executable bool, zipMode os.FileMode, body []byte) testFixture {
	return productRuntimeFixtureWithTarget(t, executable, zipMode, productRuntimeLinuxTarget, body)
}

func productRuntimeFixtureWithTarget(t *testing.T, executable bool, zipMode os.FileMode, target string, body []byte) testFixture {
	t.Helper()
	entrypoint, err := canonicalProductRuntimeEntrypoint(target)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	digest := sha256.Sum256(body)
	manifest := componentPackageManifest{
		Schema: packageSchema,
		Status: "candidate",
		Component: packageComponent{
			ID: "product-runtime", Title: "Product Runtime", Kind: "service",
			Version: "0.3.0", ReleaseMode: "component-slot",
			Criticality: "optional", FailureDomain: "service",
			RestartScope: "component", HealthMode: "runtime",
			Owner: productRuntimeSourceRepository,
			Dependencies: []string{},
		},
		SourceCommit: testSourceCommit,
		Entrypoint: entrypoint,
		TargetPlatform: target,
		SelfContainedSourceGraph: true,
		RemoteRuntimeDependencies: false,
		ActivationAllowed: false,
		SignatureRequiredBeforeActivation: true,
		NativeAdaptersPackaged: false,
		CompositionPackaged: false,
		Files: []packageFile{{Path: entrypoint,
			SHA256: hex.EncodeToString(digest[:]), Size: int64(len(body)),
			Executable: executable}},
	}
	manifestBytes, err := marshalJSON(manifest)
	if err != nil { t.Fatal(err) }
	packagePath := filepath.Join(dir, "product-runtime.zip")
	file, err := os.Create(packagePath)
	if err != nil { t.Fatal(err) }
	archive := zip.NewWriter(file)
	writeZipEntry(t, archive, packageManifestName, manifestBytes)
	header := &zip.FileHeader{Name: entrypoint, Method: zip.Store}
	header.SetMode(zipMode)
	entry, err := archive.CreateHeader(header)
	if err != nil { t.Fatal(err) }
	if _, err = entry.Write(body); err != nil { t.Fatal(err) }
	if err = archive.Close(); err != nil { t.Fatal(err) }
	if err = file.Close(); err != nil { t.Fatal(err) }
	hash, size, err := sha256File(packagePath, maxPackageBytes)
	if err != nil { t.Fatal(err) }
	manifestDigest := sha256.Sum256(manifestBytes)
	release := releaseDescriptor{
		Schema: releaseSchema,
		SourceRepository: productRuntimeSourceRepository,
		SourceCommit: testSourceCommit,
		CreatedFromRecipe: createdFromRecipe,
		Component: releaseComponent{ID: "product-runtime", Version: "0.3.0",
			ReleaseMode: "component-slot", PackageSchema: packageSchema},
		Package: packageBinding{Name: "product-runtime.zip", SHA256: hash,
			Size: size, ManifestSHA256: hex.EncodeToString(manifestDigest[:])},
		Activation: activationPolicy{DirectActivationAllowed: false, PendingHealthRequired: true},
	}
	releaseBytes, err := marshalJSON(release)
	if err != nil { t.Fatal(err) }
	releasePath := filepath.Join(dir, "runtime-component-release.json")
	if err = os.WriteFile(releasePath, releaseBytes, 0o644); err != nil { t.Fatal(err) }
	privatePath := filepath.Join(dir, "private.pem")
	trustPath := filepath.Join(dir, "trust.json")
	if _, err = generateKey(privatePath, trustPath, "native-runtime-test"); err != nil { t.Fatal(err) }
	envelopePath := filepath.Join(dir, "envelope.json")
	if _, err = signRelease(releasePath, privatePath, trustPath, envelopePath, "native-runtime-test"); err != nil { t.Fatal(err) }
	return testFixture{
		dir: dir, packagePath: packagePath, releasePath: releasePath,
		privatePath: privatePath, trustPath: trustPath, envelopePath: envelopePath,
		release: release,
	}
}

// A synthetic PE validates only the signed format contract, never an actual Runtime.
func productRuntimeWindowsPEFixture() []byte {
    payload := make([]byte, 0x400)
    copy(payload, "MZ")
    binary.LittleEndian.PutUint32(payload[0x3c:], 0x80)
    copy(payload[0x80:], "PE\x00\x00")
    binary.LittleEndian.PutUint16(payload[0x84:], pe.IMAGE_FILE_MACHINE_AMD64)
    binary.LittleEndian.PutUint16(payload[0x86:], 1)
    binary.LittleEndian.PutUint16(payload[0x94:], 0xf0)
    binary.LittleEndian.PutUint16(payload[0x96:], 0x0002)
    optional := 0x98
    binary.LittleEndian.PutUint16(payload[optional:], 0x20b)
    binary.LittleEndian.PutUint32(payload[optional+16:], 0x1000)
    binary.LittleEndian.PutUint32(payload[optional+20:], 0x1000)
    binary.LittleEndian.PutUint64(payload[optional+24:], 0x140000000)
    binary.LittleEndian.PutUint32(payload[optional+32:], 0x1000)
    binary.LittleEndian.PutUint32(payload[optional+36:], 0x200)
    binary.LittleEndian.PutUint32(payload[optional+56:], 0x2000)
    binary.LittleEndian.PutUint32(payload[optional+60:], 0x200)
    binary.LittleEndian.PutUint32(payload[optional+108:], 16)
    section := 0x188
    copy(payload[section:], ".text")
    binary.LittleEndian.PutUint32(payload[section+8:], 0x200)
    binary.LittleEndian.PutUint32(payload[section+12:], 0x1000)
    binary.LittleEndian.PutUint32(payload[section+16:], 0x200)
    binary.LittleEndian.PutUint32(payload[section+20:], 0x200)
    binary.LittleEndian.PutUint32(payload[section+36:], 0x60000020)
    return payload
}

func TestSignedProductRuntimeWindowsPEIsTargetBound(t *testing.T) {
    body := productRuntimeWindowsPEFixture()
    if err := validateProductRuntimePE(body); err != nil {
        t.Fatalf("synthetic PE structure refused: %v", err)
    }
    fixture := productRuntimeFixtureWithTarget(t, true, 0o555, productRuntimeWindowsTarget, body)
    pkg, err := inspectPackage(fixture.packagePath, fixture.release)
    if err != nil {
        t.Fatalf("target-bound synthetic PE refused: %v", err)
    }
    if pkg.Manifest.TargetPlatform != productRuntimeWindowsTarget ||
        pkg.Manifest.Entrypoint != productRuntimeWindowsExecutablePath {
        t.Fatal("signed package did not retain exact Windows target")
    }
    pkg.Manifest.TargetPlatform = productRuntimeLinuxTarget
    if err := validatePackageManifest(pkg.Manifest, fixture.release); err == nil {
        t.Fatal("Windows PE accepted Linux target label")
    }
    pkg.Manifest.TargetPlatform = ""
    if err := validatePackageManifest(pkg.Manifest, fixture.release); err == nil {
        t.Fatal("implicit/default target accepted")
    }
}

func TestSignedProductRuntimeRejectsCrossTargetPayloads(t *testing.T) {
    for _, tc := range []struct{
        name, target string
        body []byte
    }{
        {"ELF as Windows PE", productRuntimeWindowsTarget, nativeExecutableBytes()},
        {"Windows PE as Linux ELF", productRuntimeLinuxTarget, productRuntimeWindowsPEFixture()},
    } {
        t.Run(tc.name, func(t *testing.T) {
            fixture := productRuntimeFixtureWithTarget(t, true, 0o555, tc.target, tc.body)
            if _, err := inspectPackage(fixture.packagePath, fixture.release); err == nil {
                t.Fatal("signed foreign-target executable passed structural preflight")
            }
        })
    }
}

func TestWindowsProductRuntimePERejectsMalformedPayload(t *testing.T) {
    for _, tc := range []struct{
        name string
        mutate func([]byte)
    }{
        {"foreign architecture", func(p []byte){binary.LittleEndian.PutUint16(p[0x84:], pe.IMAGE_FILE_MACHINE_I386)}},
        {"not executable", func(p []byte){binary.LittleEndian.PutUint16(p[0x96:], 0)}},
        {"nonexecuting section", func(p []byte){binary.LittleEndian.PutUint32(p[0x188+36:], 0x40000040)}},
        {"unmapped entry", func(p []byte){binary.LittleEndian.PutUint32(p[0x98+16:], 0x8000)}},
        {"section outside image", func(p []byte){binary.LittleEndian.PutUint32(p[0x188+20:], 0x600)}},
    } {
        t.Run(tc.name, func(t *testing.T) {
            body := productRuntimeWindowsPEFixture()
            tc.mutate(body)
            fixture := productRuntimeFixtureWithTarget(t, true, 0o555, productRuntimeWindowsTarget, body)
            if _, err := inspectPackage(fixture.packagePath, fixture.release); err == nil {
                t.Fatal("malformed signed PE passed fail-closed validation")
            }
        })
    }
}

func TestNativeProductRuntimeELFStructuralPreflightRejectsMalformedPayload(t *testing.T) {
	mutations := map[string]func([]byte){
		"header-only fake": func(data []byte) {
			for n := 24; n < 120; n++ { data[n] = 0 }
		},
		"nonexecutable object": func(data []byte) {
			binary.LittleEndian.PutUint16(data[16:], uint16(elf.ET_REL))
		},
		"foreign architecture": func(data []byte) {
			binary.LittleEndian.PutUint16(data[18:], uint16(elf.EM_AARCH64))
		},
		"missing program table": func(data []byte) {
			binary.LittleEndian.PutUint16(data[56:], 0)
		},
		"invalid program header stride": func(data []byte) {
			binary.LittleEndian.PutUint16(data[54:], 2)
		},
		"segment outside payload": func(data []byte) {
			binary.LittleEndian.PutUint64(data[96:], uint64(len(data))+1)
		},
		"segment grows beyond memory": func(data []byte) {
			binary.LittleEndian.PutUint64(data[104:], 1)
		},
		"entrypoint not mapped": func(data []byte) {
			binary.LittleEndian.PutUint64(data[24:], 0x7ffffffff)
		},
		"entrypoint segment not executable": func(data []byte) {
			binary.LittleEndian.PutUint32(data[68:], uint32(elf.PF_R))
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			payload := nativeExecutableBytes()
			mutate(payload)
			if err := validateNativeProductRuntimeELF(payload); err == nil {
				t.Fatal("structurally invalid ELF passed native preflight")
			}
		})
	}
	if err := validateNativeProductRuntimeELF(nativeExecutableBytes()); err != nil {
		t.Fatalf("well-formed synthetic ELF rejected: %v", err)
	}
}

func TestNativeSignedPackageRejectsELFWithValidSignatureAndBrokenHeaders(t *testing.T) {
	body := nativeExecutableBytes()
	binary.LittleEndian.PutUint64(body[24:], 0x7ffffffff) // invalid entry, signed hash still matches
	fixture := nativePackageFixtureWithPayload(t, true, 0o555, body)
	_, err := inspectPackage(fixture.packagePath, fixture.release)
	if err == nil || !strings.Contains(err.Error(), "entrypoint is not mapped executable") {
		t.Fatalf("signed package with invalid ELF structure should fail closed: %v", err)
	}
}

func TestWindowsSignedProductRuntimeSlotRequiresReadOnlyAttribute(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("verify Windows file attributes on Windows runner")
	}
	fixture := productRuntimeFixtureWithTarget(t, true, 0o555,
		productRuntimeWindowsTarget, productRuntimeWindowsPEFixture())
	root := filepath.Join(fixture.dir, "windows-slots")
	// Remove only this temporary signed fixture; Windows read-only attributes
	// require the same canonical staging disposal policy.
	t.Cleanup(func() { removeStagingTree(root) })
	_, slot, changed, err := stageComponent(
		fixture.envelopePath, fixture.trustPath, fixture.packagePath, root,
	)
	if err != nil || !changed {
		t.Fatalf("Windows signed slot did not stage: changed=%v err=%v", changed, err)
	}
	executable := filepath.Join(slot, filepath.FromSlash(productRuntimeWindowsExecutablePath))
	info, err := os.Lstat(executable)
	if err != nil || info.Mode().Perm()&0o222 != 0 {
		t.Fatalf("Windows staged executable must be read-only, info=%v err=%v", info, err)
	}
	trust, err := os.ReadFile(fixture.trustPath)
	if err != nil { t.Fatal(err) }
	if _, err := verifySlotWithTrustBytes(slot, trust); err != nil {
		t.Fatalf("read-only signed Windows slot refused: %v", err)
	}
	if err := os.Chmod(executable, 0o666); err != nil { t.Fatal(err) }
	if _, err := verifySlotWithTrustBytes(slot, trust); err == nil ||
		!strings.Contains(err.Error(), "file is writable") {
		t.Fatalf("writable Windows executable passed signed slot proof: %v", err)
	}
}

func TestNativeSignedSlotAllowsBoundELFWithoutActivation(t *testing.T) {
	fixture := nativePackageFixture(t, true, 0o555)
	root := filepath.Join(fixture.dir, "slots")
	t.Cleanup(func(){allowTestTreeCleanup(root)})
	release, slot, changed, err := stageComponent(
		fixture.envelopePath, fixture.trustPath, fixture.packagePath, root,
	)
	if err != nil || !changed {
		t.Fatalf("native stage changed=%v err=%v", changed, err)
	}
	if release.Component.ID != "product-runtime" || release.Activation.DirectActivationAllowed {
		t.Fatalf("native signed staging escalated activation: %+v", release)
	}
	executable := filepath.Join(slot, filepath.FromSlash(productRuntimeExecutablePath))
	info, err := os.Stat(executable)
	if err != nil { t.Fatal(err) }
	if info.Size() <= maxFileBytes { t.Fatal("test did not exceed generic app bound") }
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o555 {
		t.Fatalf("native mode=%04o; want 0555", info.Mode().Perm())
	}
	trust, err := os.ReadFile(fixture.trustPath)
	if err != nil { t.Fatal(err) }
	if _, err = verifySlotWithTrustBytes(slot, trust); err != nil { t.Fatal(err) }
	_, same, again, err := stageComponent(
		fixture.envelopePath, fixture.trustPath, fixture.packagePath, root,
	)
	if err != nil || again || same != slot {
		t.Fatalf("signed native restage changed=%v err=%v", again, err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(executable, 0o444); err != nil { t.Fatal(err) }
		if _, err := verifySlotWithTrustBytes(slot, trust); err == nil ||
			!strings.Contains(err.Error(), "file mode mismatch") {
			t.Fatalf("native mode substitution was not rejected: %v", err)
		}
	}
}

func TestNativeSignedReleaseV2ChecksExecutableSlotMode(t *testing.T) {
	fixture := nativePackageFixture(t, true, 0o555)
	dir := fixture.dir
	compatibilityPath := filepath.Join(dir, "product-runtime.compatibility.json")
	compatibility := canonicalCompatibilityFor(t, "product-runtime", "0.3.0")
	if err := os.WriteFile(compatibilityPath, compatibility, 0o644); err != nil { t.Fatal(err) }
	digest := sha256.Sum256(compatibility)
	v2 := releaseDescriptorV2{
		Schema: releaseSchemaV2, SourceRepository: productRuntimeSourceRepository,
		SourceCommit: fixture.release.SourceCommit, CreatedFromRecipe: createdFromRecipe,
		Component: fixture.release.Component, Package: fixture.release.Package,
		Activation: fixture.release.Activation,
		Compatibility: compatibilityBinding{
			Name: filepath.Base(compatibilityPath), Schema: compatibilitySchemaV1,
			SHA256: hex.EncodeToString(digest[:]), Size: int64(len(compatibility)),
		},
	}
	bytes, err := marshalJSON(v2)
	if err != nil { t.Fatal(err) }
	releasePath := filepath.Join(dir, "runtime-component-release-v2.json")
	if err := os.WriteFile(releasePath, bytes, 0o644); err != nil { t.Fatal(err) }
	envelopePath := filepath.Join(dir, "envelope-v2.json")
	if _, err := signReleaseV2(releasePath, compatibilityPath, fixture.privatePath,
		fixture.trustPath, envelopePath, "native-runtime-test"); err != nil { t.Fatal(err) }
	root := filepath.Join(dir, "slots-v2")
	t.Cleanup(func(){allowTestTreeCleanup(root)})
	_, slot, changed, err := stageComponentV2(envelopePath, fixture.trustPath,
		fixture.packagePath, compatibilityPath, root)
	if err != nil || !changed { t.Fatalf("signed native v2 stage changed=%v err=%v", changed, err) }
	trust, err := os.ReadFile(fixture.trustPath)
	if err != nil { t.Fatal(err) }
	if _, err := verifySlotV2WithTrustBytes(slot, trust); err != nil { t.Fatal(err) }
	if runtime.GOOS != "windows" {
		path := filepath.Join(slot, filepath.FromSlash(productRuntimeExecutablePath))
		if err := os.Chmod(path, 0o444); err != nil { t.Fatal(err) }
		_, err := verifySlotV2WithTrustBytes(slot, trust)
		if err == nil || !strings.Contains(err.Error(), "file mode mismatch") {
			t.Fatalf("release/2 executable mode tampering was accepted: %v", err)
		}
	}
}

func TestNativeSignedSlotRejectsUnboundExecutableMode(t *testing.T) {
	fixture := nativePackageFixture(t, true, 0o644)
	_, err := inspectPackage(fixture.packagePath, fixture.release)
	if err == nil || !strings.Contains(err.Error(), "file mode mismatch") {
		t.Fatalf("native ZIP mode mismatch err=%v", err)
	}
}

func TestNativeSignedSlotRejectsMissingManifestExecutionBinding(t *testing.T) {
	fixture := nativePackageFixture(t, false, 0o555)
	_, err := inspectPackage(fixture.packagePath, fixture.release)
	if err == nil || !strings.Contains(err.Error(), "must be executable") {
		t.Fatalf("missing native executable flag err=%v", err)
	}
}

func TestNativeExecutableFlagCannotBeUsedByApps(t *testing.T) {
	fixture := makeFixture(t)
	manifest := componentPackageManifest{
		Schema: packageSchema, Status: "candidate",
		Component: packageComponent{ID: "internet", Version: "0.3.0", Kind: "app",
			Title: "Internet", Owner: sourceRepository, ReleaseMode: "bundled"},
		SourceCommit: testSourceCommit,
		Entrypoint: "system/components/internet/runtime.mjs",
		SelfContainedSourceGraph: true,
		SignatureRequiredBeforeActivation: true,
		Files: []packageFile{{Path: "system/components/internet/runtime.mjs",
			SHA256: strings.Repeat("a", 64), Size: 40, Executable: true}},
	}
	if err := validatePackageManifest(manifest, fixture.release); err == nil ||
		!strings.Contains(err.Error(), "restricted to native Product Runtime") {
		t.Fatalf("app executable escalation err=%v", err)
	}
}

func TestNativeSignedFileBoundsAreComponentScoped(t *testing.T) {
	fixture := nativePackageFixture(t, true, 0o555)
	pkg, err := inspectPackage(fixture.packagePath, fixture.release)
	if err != nil { t.Fatal(err) }
	pkg.Manifest.Files[0].Size = maxProductRuntimeFileBytes + 1
	if err := validatePackageManifest(pkg.Manifest, fixture.release); err == nil ||
		!strings.Contains(err.Error(), "file binding is invalid") {
		t.Fatalf("oversized native ELF unexpectedly validated: %v", err)
	}
	pkg.Manifest.Files[0].Size = maxProductRuntimeFileBytes
	pkg.Manifest.Files[0].Path = "system/components/notes/run"
	if err := validatePackageManifest(pkg.Manifest, fixture.release); err == nil {
		t.Fatal("cross-owner native path unexpectedly validated")
	}
}
