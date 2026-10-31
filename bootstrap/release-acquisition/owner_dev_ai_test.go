package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type ownerDevAIFixture struct {
	client *http.Client
	url string
	trust TrustAnchor
	pub ed25519.PublicKey
	lockPath string
	root string
	manifest Manifest
	aiDownloads *int
	systemDownloads *int
	surfaceDownloads *int
}

func newOwnerDevAIFixture(t *testing.T) ownerDevAIFixture {
	t.Helper()
	trust, pub, priv := testKeys(t)
	lock := []byte("{\"schema\":\"test-owner-dev-source-lock\"}\n")
	sum := sha256.Sum256(lock)
	lockPath := filepath.Join(t.TempDir(), "source-lock.json")
	if err := os.WriteFile(lockPath, lock, 0o600); err != nil { t.Fatal(err) }
	system := validPortableEROFS()
	surface := append([]byte(nil), system...)
	surface[len(surface)-1] = 0x73
	ai := append([]byte(nil), system...)
	ai[len(ai)-1] = 0x81
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	t.Cleanup(server.Close)
	manifest := manifestForPortableV4(
		server.URL+"/system.erofs", server.URL+"/native-surface-runtime.erofs",
		server.URL+"/local-ai-runtime.erofs", system, surface, ai,
	)
	manifest.LocalAI.SourceLockSHA256 = hex.EncodeToString(sum[:])
	envelope := signedEnvelope(t, manifest, trust.KeyID, priv)
	countAI, countSystem, countSurface := 0, 0, 0
	mux.HandleFunc("/release.json", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(envelope) })
	mux.HandleFunc("/system.erofs", func(w http.ResponseWriter, r *http.Request) {
		countSystem++
		_, _ = w.Write(system)
	})
	mux.HandleFunc("/native-surface-runtime.erofs", func(w http.ResponseWriter, r *http.Request) {
		countSurface++
		_, _ = w.Write(surface)
	})
	mux.HandleFunc("/local-ai-runtime.erofs", func(w http.ResponseWriter, r *http.Request) {
		countAI++
		_, _ = w.Write(ai)
	})
	return ownerDevAIFixture{
		client:server.Client(),url:server.URL+"/release.json",
		trust:trust,pub:pub,lockPath:lockPath,root:t.TempDir(),
		manifest:manifest,aiDownloads:&countAI,systemDownloads:&countSystem,surfaceDownloads:&countSurface,
	}
}

func (f ownerDevAIFixture) run() (OwnerDevAIReceipt,error) {
	ai:=f.manifest.Artifacts[2]
	return materializeOwnerDevAI(f.client,f.url,f.root,f.lockPath,f.trust,f.pub,
		defaultRepo,testCommit,ai.SHA256,ai.Size)
}

func TestOwnerDevAIAcquiresOnlySignedComponentAndReusesExactDigest(t *testing.T) {
	f:=newOwnerDevAIFixture(t)
	first,err:=f.run()
	if err!=nil { t.Fatal(err) }
	if first["status"]!="materialized-owner-dev-local-ai" || first["activation_allowed"]!=false || first["reused"]!=false {
		t.Fatalf("invalid selective AI receipt: %#v",first)
	}
	expected:=filepath.Join(f.root,"local-ai","sha256",f.manifest.Artifacts[2].SHA256,"local-ai-runtime.erofs")
	if first["artifact_path"]!=expected { t.Fatalf("unexpected store: %#v",first) }
	info,err:=os.Stat(expected)
	if err!=nil { t.Fatal(err) }
	if info.Mode().Perm()!=0o600 { t.Fatalf("AI file not private: %s",info.Mode()) }
	dir,err:=os.Stat(filepath.Dir(expected))
	if err!=nil { t.Fatal(err) }
	if dir.Mode().Perm()!=0o700 { t.Fatalf("AI digest not private: %s",dir.Mode()) }
	if *f.aiDownloads!=1 || *f.systemDownloads!=0 || *f.surfaceDownloads!=0 {
		t.Fatalf("unexpected artifacts downloaded AI/system/Surface: %d/%d/%d",*f.aiDownloads,*f.systemDownloads,*f.surfaceDownloads)
	}
	for _, name:=range []string{"current","known-good","releases","ai-runtimes"} {
		if _,err:=os.Lstat(filepath.Join(f.root,name)); !os.IsNotExist(err) {
			t.Fatalf("unexpected Stable release/activation state %s: %v",name,err)
		}
	}
	second,err:=f.run()
	if err!=nil || second["reused"]!=true || *f.aiDownloads!=1 {
		t.Fatalf("no verified offline reuse: %#v, %v, requests=%d",second,err,*f.aiDownloads)
	}
}

func TestOwnerDevAIRejectsMissingOrWrongSignedPinsBeforeAnyBlobDownload(t *testing.T) {
	f:=newOwnerDevAIFixture(t)
	ai:=f.manifest.Artifacts[2]
	run:=func(release,hash string,size int64,pub ed25519.PublicKey) error {
		_,err:=materializeOwnerDevAI(f.client,f.url,f.root,f.lockPath,f.trust,pub,defaultRepo,release,hash,size)
		return err
	}
	if err:=run(strings.Repeat("c",40),ai.SHA256,ai.Size,f.pub);err==nil { t.Fatal("wrong release accepted") }
	if err:=run(testCommit,strings.Repeat("f",64),ai.Size,f.pub);err==nil { t.Fatal("wrong digest accepted") }
	if err:=run(testCommit,ai.SHA256,ai.Size+1,f.pub);err==nil { t.Fatal("wrong size accepted") }
	if err:=run(testCommit,ai.SHA256,ai.Size,make(ed25519.PublicKey,32));err==nil { t.Fatal("wrong signature key accepted") }
	if err:=os.WriteFile(f.lockPath,[]byte("a different active source lock"),0o600);err!=nil { t.Fatal(err) }
	if err:=run(testCommit,ai.SHA256,ai.Size,f.pub);err==nil { t.Fatal("wrong source lock accepted") }
	if *f.aiDownloads!=0 || *f.systemDownloads!=0 || *f.surfaceDownloads!=0 {
		t.Fatal("download occurred before signed identity/lock/pin gates")
	}
	if _,err:=os.Lstat(filepath.Join(f.root,"local-ai"));!os.IsNotExist(err) {
		t.Fatal("untrusted artifact created state")
	}
}

func TestOwnerDevAIRejectsCorruptedExistingPayloadWithoutRedownload(t *testing.T) {
	f:=newOwnerDevAIFixture(t)
	first,err:=f.run()
	if err!=nil { t.Fatal(err) }
	path:=first["artifact_path"].(string)
	file,err:=os.OpenFile(path,os.O_WRONLY,0)
	if err!=nil { t.Fatal(err) }
	if _,err:=file.WriteAt([]byte{0x3f},2048);err!=nil { t.Fatal(err) }
	if err:=file.Close();err!=nil { t.Fatal(err) }
	if _,err:=f.run();err==nil || !strings.Contains(err.Error(),"digest") {
		t.Fatalf("corrupt content-addressed candidate accepted: %v",err)
	}
	if *f.aiDownloads!=1 { t.Fatal("tampered candidate silently re-downloaded or overwritten") }
}

func TestOwnerDevAIRejectsSymlinkedPrivateStore(t *testing.T) {
	f:=newOwnerDevAIFixture(t)
	outside:=t.TempDir()
	if err:=os.Symlink(outside,filepath.Join(f.root,"local-ai"));err!=nil { t.Fatal(err) }
	if _,err:=f.run();err==nil || !strings.Contains(err.Error(),"private directory") {
		t.Fatalf("symlinked private path accepted: %v",err)
	}
	if *f.aiDownloads!=0 { t.Fatal("download crossed untrusted path") }
}

func TestOwnerDevAIRejectsWorldWritableStateRoot(t *testing.T) {
	f:=newOwnerDevAIFixture(t)
	if err:=os.Chmod(f.root,0o777);err!=nil { t.Fatal(err) }
	if _,err:=f.run();err==nil || !strings.Contains(err.Error(),"writable") {
		t.Fatalf("unsafe state root accepted: %v",err)
	}
	if *f.aiDownloads!=0 { t.Fatal("download crossed unsafe state root") }
}
