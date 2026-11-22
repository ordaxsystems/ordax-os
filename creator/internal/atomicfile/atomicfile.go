// Package atomicfile publishes signed Creator envelope pointers by staged
// replacement; signature and rollback checks belong to the calling channel.
package atomicfile

import (
	"fmt"
	"os"
	"path/filepath"
)

// Replace never unlinks the previous signed pointer before committing the new
// bytes. A failed rename leaves the last signed offline reference intact.
func Replace(path string, data []byte) error {
	return replaceWithRename(path, data, os.Rename)
}

func replaceWithRename(path string, data []byte, rename func(string, string) error) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	staged, err := os.CreateTemp(parent, ".ordax-envelope-*")
	if err != nil {
		return err
	}
	stagedPath := staged.Name()
	defer func() {
		_ = staged.Close()
		_ = os.Remove(stagedPath)
	}()
	if _, err := staged.Write(data); err != nil {
		return err
	}
	if err := staged.Sync(); err != nil {
		return err
	}
	if err := staged.Close(); err != nil {
		return err
	}
	if err := rename(stagedPath, path); err != nil {
		return fmt.Errorf("replace signed Creator envelope pointer: %w", err)
	}
	return nil
}
