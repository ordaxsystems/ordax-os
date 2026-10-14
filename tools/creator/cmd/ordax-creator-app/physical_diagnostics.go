package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func persistPhysicalDiagnostic(sourcePath string) (string, error) {
	cacheRoot, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("resolver diretório local de diagnóstico: %w", err)
	}
	return persistPhysicalDiagnosticAt(sourcePath, cacheRoot)
}

func persistPhysicalDiagnosticAt(sourcePath, cacheRoot string) (string, error) {
	if strings.TrimSpace(sourcePath) == "" {
		return "", fmt.Errorf("caminho do diagnóstico temporário está vazio")
	}
	if strings.TrimSpace(cacheRoot) == "" {
		return "", fmt.Errorf("diretório local de diagnóstico está vazio")
	}
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return "", fmt.Errorf("ler diagnóstico temporário: %w", err)
	}
	if strings.TrimSpace(string(data)) == "" {
		return "", fmt.Errorf("diagnóstico temporário está vazio")
	}

	diagnosticRoot := filepath.Join(cacheRoot, "OrdaX", "Creator", "diagnostics")
	if err := os.MkdirAll(diagnosticRoot, 0o700); err != nil {
		return "", fmt.Errorf("criar diretório persistente de diagnóstico: %w", err)
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
