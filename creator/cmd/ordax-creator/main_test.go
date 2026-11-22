package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testPoolUUID = "01234567-89ab-cdef-0123-456789abcdef"

func TestRenderNativeBootWritesCanonicalEntriesTransactionally(t *testing.T) {
	root := t.TempDir()
	normal := filepath.Join(root, "normal.conf.in")
	recovery := filepath.Join(root, "recovery.conf.in")
	out := filepath.Join(root, "rendered")
	if err := os.WriteFile(normal, []byte("options ordax.mode=normal ordax.product_mode=native-disk ordax.pool_uuid=@ORDAX_POOL_UUID@\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(recovery, []byte("options ordax.mode=recovery ordax.product_mode=native-disk ordax.pool_uuid=@ORDAX_POOL_UUID@\n"), 0644); err != nil {
		t.Fatal(err)
	}

	rc := runRenderNativeBoot([]string{
		"--pool-uuid", testPoolUUID,
		"--normal-template", normal,
		"--recovery-template", recovery,
		"--out-dir", out,
	})
	if rc != 0 {
		t.Fatalf("render-native-boot returned %d", rc)
	}
	for _, relative := range []string{
		"loader/entries/ordax-native.conf",
		"loader/entries/ordax-native-recovery.conf",
	} {
		path := filepath.Join(out, filepath.FromSlash(relative))
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		text := string(data)
		if !strings.Contains(text, "ordax.pool_uuid="+testPoolUUID) {
			t.Fatalf("rendered entry did not bind exact UUID: %s", relative)
		}
		if strings.Contains(text, "@ORDAX_POOL_UUID@") {
			t.Fatalf("placeholder survived rendering: %s", relative)
		}
	}
}

func TestRenderNativeBootFailsWithoutPublishingPartialOutput(t *testing.T) {
	root := t.TempDir()
	normal := filepath.Join(root, "normal.conf.in")
	recovery := filepath.Join(root, "recovery.conf.in")
	out := filepath.Join(root, "rendered")
	if err := os.WriteFile(normal, []byte("options ordax.mode=normal ordax.pool_uuid=@ORDAX_POOL_UUID@\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(recovery, []byte("options no-placeholder\n"), 0644); err != nil {
		t.Fatal(err)
	}

	rc := runRenderNativeBoot([]string{
		"--pool-uuid", testPoolUUID,
		"--normal-template", normal,
		"--recovery-template", recovery,
		"--out-dir", out,
	})
	if rc == 0 {
		t.Fatal("invalid recovery template unexpectedly rendered")
	}
	if _, err := os.Lstat(out); !os.IsNotExist(err) {
		t.Fatal("failed render published a partial output directory")
	}
}

func TestRenderNativeBootRejectsSymlinkTemplateAndExistingOutput(t *testing.T) {
	root := t.TempDir()
	normal := filepath.Join(root, "normal.conf.in")
	recovery := filepath.Join(root, "recovery.conf.in")
	link := filepath.Join(root, "normal-link.conf.in")
	if err := os.WriteFile(normal, []byte("options ordax.pool_uuid=@ORDAX_POOL_UUID@\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(recovery, []byte("options ordax.pool_uuid=@ORDAX_POOL_UUID@\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(normal, link); err == nil {
		out := filepath.Join(root, "symlink-out")
		if rc := runRenderNativeBoot([]string{
			"--pool-uuid", testPoolUUID,
			"--normal-template", link,
			"--recovery-template", recovery,
			"--out-dir", out,
		}); rc == 0 {
			t.Fatal("symlink template unexpectedly accepted")
		}
	}

	out := filepath.Join(root, "existing")
	if err := os.Mkdir(out, 0755); err != nil {
		t.Fatal(err)
	}
	if rc := runRenderNativeBoot([]string{
		"--pool-uuid", testPoolUUID,
		"--normal-template", normal,
		"--recovery-template", recovery,
		"--out-dir", out,
	}); rc == 0 {
		t.Fatal("pre-existing output directory unexpectedly accepted")
	}
}
