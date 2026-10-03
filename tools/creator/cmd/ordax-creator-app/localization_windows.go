//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

const localeNameMaxLength = 85

var procGetUserDefaultLocaleName = kernel32.NewProc("GetUserDefaultLocaleName")

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
