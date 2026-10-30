package main

import (
	"archive/zip"
	"crypto/sha256"
	"debug/elf"
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
	t.Helper()
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
		Entrypoint: productRuntimeExecutablePath,
		SelfContainedSourceGraph: true,
		RemoteRuntimeDependencies: false,
		ActivationAllowed: false,
		SignatureRequiredBeforeActivation: true,
		NativeAdaptersPackaged: false,
		CompositionPackaged: false,
		Files: []packageFile{{Path: productRuntimeExecutablePath,
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
	header := &zip.FileHeader{Name: productRuntimeExecutablePath, Method: zip.Store}
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
