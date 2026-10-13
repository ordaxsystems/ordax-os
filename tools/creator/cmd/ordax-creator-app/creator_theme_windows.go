//go:build windows

package main

import (
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "os"
    "path/filepath"
    "strings"
    "syscall"
    "unsafe"
)

// This adapter consumes generated assets exported from the Surface SSOT.
// It does not own or duplicate palette values, a new logo, or a theme service.
type creatorVisualTheme struct {
    Schema string            `json:"$schema"`
    Source string            `json:"source"`
    SymbolSHA256 string      `json:"symbol_sha256"`
    Colors map[string]string `json:"colors"`
}

var (
    visualColors map[string]uintptr
    visualLogo uintptr
    visualGDIPlusToken uintptr
    visualLogoPath string
    gdiplus = syscall.NewLazyDLL("gdiplus.dll")
    procGdiplusStartup = gdiplus.NewProc("GdiplusStartup")
    procGdiplusShutdown = gdiplus.NewProc("GdiplusShutdown")
    procGdipCreateBitmapFromFile = gdiplus.NewProc("GdipCreateBitmapFromFile")
    procGdipDisposeImage = gdiplus.NewProc("GdipDisposeImage")
    procGdipCreateFromHDC = gdiplus.NewProc("GdipCreateFromHDC")
    procGdipDrawImageRectI = gdiplus.NewProc("GdipDrawImageRectI")
    procGdipDeleteGraphics = gdiplus.NewProc("GdipDeleteGraphics")
    dwmapi = syscall.NewLazyDLL("dwmapi.dll")
    procDwmSetWindowAttribute = dwmapi.NewProc("DwmSetWindowAttribute")
)

type creatorGDIPlusStartup struct {
    Version uint32
    Callback uintptr
    SuppressBackgroundThread uint32
    SuppressExternalCodecs uint32
}

func creatorColorFor(name string, fallback uint32) uintptr {
    if visualColors != nil {
        if color, ok := visualColors[name]; ok {
            return color
        }
    }
    return sysColor(uintptr(fallback))
}

// COLORREF is BGR in integer representation. The CSS colors are RGB.
func creatorParseColor(value string) (uintptr, bool) {
    if !strings.HasPrefix(value, "#") || len(value) != 7 {
        return 0, false
    }
    b, err := hex.DecodeString(value[1:])
    if err != nil || len(b) != 3 {
        return 0, false
    }
    return uintptr(uint32(b[0]) | uint32(b[1]) << 8 | uint32(b[2]) << 16), true
}

func loadCreatorVisualTheme() {
    executable, err := os.Executable()
    if err != nil {
        return
    }
    directory := filepath.Dir(executable)
    themeBytes, err := os.ReadFile(filepath.Join(directory, "ordax-design-theme.json"))
    if err != nil || len(themeBytes) > 64<<10 {
        return
    }
    symbolPath := filepath.Join(directory, "ordax-symbol.png")
    symbolBytes, err := os.ReadFile(symbolPath)
    if err != nil || len(symbolBytes) > 2<<20 || len(symbolBytes) < 24 ||
        string(symbolBytes[:8]) != "\x89PNG\r\n\x1a\n" {
        return
    }
    var document creatorVisualTheme
    if err := json.Unmarshal(themeBytes, &document); err != nil ||
        document.Schema != "prototype-ordax.creator-ui-theme/1" ||
        document.Source == "" ||
        len(document.Colors) != 15 {
        return
    }
    digest := sha256.Sum256(symbolBytes)
    if hex.EncodeToString(digest[:]) != document.SymbolSHA256 {
        return
    }
    // Bundle provenance is tied to the exact exported theme and symbol in CI.
    provenanceBytes, err := os.ReadFile(filepath.Join(directory, "provenance.json"))
    if err != nil || len(provenanceBytes) > 64<<10 {
        return
    }
    var provenance struct {
        ThemeSHA256 string `json:"theme_sha256"`
        SymbolSHA256 string `json:"symbol_sha256"`
    }
    if json.Unmarshal(provenanceBytes, &provenance) != nil {
        return
    }
    themeDigest := sha256.Sum256(themeBytes)
    if provenance.ThemeSHA256 != hex.EncodeToString(themeDigest[:]) ||
        provenance.SymbolSHA256 != document.SymbolSHA256 {
        return
    }
    colors := make(map[string]uintptr, len(document.Colors))
    for key, value := range document.Colors {
        color, ok := creatorParseColor(value)
        if !ok { return }
        colors[key] = color
    }
    visualColors = colors
    visualLogoPath = symbolPath
    startup := creatorGDIPlusStartup{Version: 1}
    if status, _, _ := procGdiplusStartup.Call(uintptr(unsafe.Pointer(&visualGDIPlusToken)), uintptr(unsafe.Pointer(&startup)), 0); status != 0 {
        visualGDIPlusToken = 0
        return
    }
    if status, _, _ := procGdipCreateBitmapFromFile.Call(uintptr(unsafe.Pointer(utf16Ptr(visualLogoPath))), uintptr(unsafe.Pointer(&visualLogo))); status != 0 {
        visualLogo = 0
    }
}

func creatorDrawOfficialLogo(hdc uintptr, x, y, width, height int32) {
    if visualLogo == 0 { return }
    var graphics uintptr
    if result, _, _ := procGdipCreateFromHDC.Call(hdc, uintptr(unsafe.Pointer(&graphics))); result != 0 { return }
    defer procGdipDeleteGraphics.Call(graphics)
    procGdipDrawImageRectI.Call(graphics, visualLogo, uintptr(x), uintptr(y), uintptr(width), uintptr(height))
}

func creatorEnableNativeDarkTitlebar(hwnd uintptr) {
    if visualColors == nil { return }
    enabled := uint32(1)
    // DWMWA_USE_IMMERSIVE_DARK_MODE, supported on contemporary Windows.
    procDwmSetWindowAttribute.Call(hwnd, 20, uintptr(unsafe.Pointer(&enabled)), unsafe.Sizeof(enabled))
}

func releaseCreatorVisualTheme() {
    if visualLogo != 0 {
        procGdipDisposeImage.Call(visualLogo)
        visualLogo = 0
    }
    if visualGDIPlusToken != 0 {
        procGdiplusShutdown.Call(visualGDIPlusToken)
        visualGDIPlusToken = 0
    }
}
