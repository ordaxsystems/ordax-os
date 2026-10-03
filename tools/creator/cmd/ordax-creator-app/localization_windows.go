//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

const (
	localeNameMaxLength                   = 85
	creatorLocalePreferenceSchema         = "prototype-ordax.creator-locale-preference/1"
	moveFileReplaceExisting       uintptr = 0x1
	moveFileWriteThrough          uintptr = 0x8
)

var (
	procGetUserDefaultLocaleName = kernel32.NewProc("GetUserDefaultLocaleName")
	procMoveFileExW              = kernel32.NewProc("MoveFileExW")
)

type creatorLocalePreference struct {
	Schema string `json:"$schema"`
	Locale string `json:"locale"`
}

func init() {
	setCreatorLocale(string(loadCreatorLocalePreference()))
}

func creatorSystemLocale() string {
	buffer := make([]uint16, localeNameMaxLength)
	result, _, _ := procGetUserDefaultLocaleName.Call(
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(len(buffer)),
	)
	if result == 0 {
		return string(creatorSourceLocale)
	}
	return syscall.UTF16ToString(buffer)
}

func creatorLocalePreferencePath() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil || root == "" {
		return "", fmt.Errorf("creator locale configuration directory unavailable")
	}
	return filepath.Join(root, "OrdaX", "Creator", "preferences.json"), nil
}

func exactCreatorLocale(value string) (creatorLocale, bool) {
	for _, locale := range creatorSupportedLocales() {
		if value == string(locale) {
			return locale, true
		}
	}
	return creatorSourceLocale, false
}

func loadCreatorLocalePreference() creatorLocale {
	fallback := resolveCreatorLocale(creatorSystemLocale())
	path, err := creatorLocalePreferencePath()
	if err != nil {
		return fallback
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() <= 0 || info.Size() > 4096 {
		return fallback
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fallback
	}
	var preference creatorLocalePreference
	if err := json.Unmarshal(data, &preference); err != nil || preference.Schema != creatorLocalePreferenceSchema {
		return fallback
	}
	locale, ok := exactCreatorLocale(preference.Locale)
	if !ok {
		return fallback
	}
	return locale
}

func saveCreatorLocalePreference(locale creatorLocale) error {
	if _, ok := exactCreatorLocale(string(locale)); !ok {
		return fmt.Errorf("unsupported Creator locale: %s", locale)
	}
	path, err := creatorLocalePreferencePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create Creator configuration directory: %w", err)
	}
	data, err := json.Marshal(creatorLocalePreference{Schema: creatorLocalePreferenceSchema, Locale: string(locale)})
	if err != nil {
		return err
	}
	data = append(data, '\n')
	staged := path + ".new"
	if err := os.WriteFile(staged, data, 0o600); err != nil {
		return fmt.Errorf("stage Creator locale preference: %w", err)
	}
	defer os.Remove(staged)
	from, err := syscall.UTF16PtrFromString(staged)
	if err != nil {
		return err
	}
	to, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	result, _, callErr := procMoveFileExW.Call(
		uintptr(unsafe.Pointer(from)),
		uintptr(unsafe.Pointer(to)),
		moveFileReplaceExisting|moveFileWriteThrough,
	)
	if result == 0 {
		return fmt.Errorf("commit Creator locale preference: %v", callErr)
	}
	return nil
}
