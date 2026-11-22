package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ordaxsystems/ordax-os/creator/internal/safefile"
)

const maxPhysicalDiagnosticBytes int64 = 64 << 10

// readPhysicalDiagnostic uses the same bounded, descriptor-identity checked
// reader as Creator's signed-channel caches. Backend diagnostics are data, not
// authorization, and must never trigger an unbounded read or follow a symlink.
func readPhysicalDiagnostic(path string) ([]byte, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("caminho do diagnóstico temporário está vazio")
	}
	data, err := safefile.ReadBoundedRegular(path, maxPhysicalDiagnosticBytes)
	if err != nil {
		return nil, fmt.Errorf("ler diagnóstico temporário: %w", err)
	}
	if strings.TrimSpace(string(data)) == "" {
		return nil, fmt.Errorf("diagnóstico temporário está vazio")
	}
	return data, nil
}

func persistPhysicalDiagnostic(sourcePath string) (string, error) {
	cacheRoot, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("resolver diretório local de diagnóstico: %w", err)
	}
	return persistPhysicalDiagnosticAt(sourcePath, cacheRoot)
}

func persistPhysicalDiagnosticAt(sourcePath, cacheRoot string) (string, error) {
	if strings.TrimSpace(cacheRoot) == "" {
		return "", fmt.Errorf("diretório local de diagnóstico está vazio")
	}
	data, err := readPhysicalDiagnostic(sourcePath)
	if err != nil {
		return "", err
	}

	// Check each newly created component before descending into the next.
	// MkdirAll would follow an existing symlinked ancestor and create files
	// outside the intended diagnostics tree before a final-path check.
	diagnosticRoot := cacheRoot
	for _, component := range []string{"OrdaX", "Creator", "diagnostics"} {
		diagnosticRoot = filepath.Join(diagnosticRoot, component)
		if err := os.Mkdir(diagnosticRoot, 0o700); err != nil && !os.IsExist(err) {
			return "", fmt.Errorf("criar diretório persistente de diagnóstico: %w", err)
		}
		info, err := os.Lstat(diagnosticRoot)
		if err != nil {
			return "", fmt.Errorf("validar diretório persistente de diagnóstico: %w", err)
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("diretório persistente de diagnóstico redirecionado ou inválido")
		}
	}

	file, err := os.CreateTemp(diagnosticRoot, "physical-write-*.txt")
	if err != nil {
		return "", fmt.Errorf("criar diagnóstico persistente: %w", err)
	}
	path := file.Name()
	committed := false
	defer func() {
		_ = file.Close()
		if !committed {
			_ = os.Remove(path)
		}
	}()

	if _, err := file.Write(data); err != nil {
		return "", fmt.Errorf("gravar diagnóstico persistente: %w", err)
	}
	if err := file.Sync(); err != nil {
		return "", fmt.Errorf("sincronizar diagnóstico persistente: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("fechar diagnóstico persistente: %w", err)
	}
	committed = true
	return path, nil
}
