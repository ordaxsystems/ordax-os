//go:build windows

package main

import (
    "syscall"
    "unsafe"
)

const (
    wmSize = 0x0005
    wmEraseBkgnd = 0x0014
    wmGetMinMaxInfo = 0x0024
    wmDrawItem = 0x002B
    wmCtlColorEdit = 0x0133
    wmCtlColorListBox = 0x0134
    wmCtlColorStatic = 0x0138
    bsOwnerDraw = 0x0000000B
    odsSelected = 0x0001
    odsDisabled = 0x0004
    wmSetFont = 0x0030
    wmMeasureItem = 0x002C
    cbsOwnerDrawFixed = 0x0010
    cbsHasStrings = 0x0200
    odtComboBox = 3
    cbGetLBText = 0x0148
    cbGetLBTextLen = 0x0149
    odsComboBoxEdit = 0x1000
)

type creatorDrawItem struct {
    CtlType uint32
    CtlID uint32
    ItemID uint32
    ItemAction uint32
    ItemState uint32
    HwndItem uintptr
    HDC uintptr
    Bounds rect
    ItemData uintptr
}

type creatorMeasureItem struct {
    CtlType uint32
    CtlID uint32
    ItemID uint32
    ItemWidth uint32
    ItemHeight uint32
    ItemData uintptr
}

type creatorMinMaxInfo struct {
    Reserved point
    MaxSize point
    MaxPosition point
    MinTrackSize point
    MaxTrackSize point
}

var (
    procMoveWindow = user32.NewProc("MoveWindow")
    procGetWindowTextW = user32.NewProc("GetWindowTextW")
    procGetWindowTextLengthW = user32.NewProc("GetWindowTextLengthW")
    procDestroyWindow = user32.NewProc("DestroyWindow")
    procCreateFontW = gdi32.NewProc("CreateFontW")
    procSetWindowTheme = syscall.NewLazyDLL("uxtheme.dll").NewProc("SetWindowTheme")
    procSetBkColor = gdi32.NewProc("SetBkColor")
    creatorFontTitle uintptr
    creatorFontHeading uintptr
    creatorFontRegular uintptr
    creatorFontSmall uintptr
    creatorUIBrush uintptr
)

func creatorFont(size, weight int32) uintptr {
    name := utf16Ptr("Segoe UI")
    handle, _, _ := procCreateFontW.Call(
        uintptr(size), 0, 0, 0, uintptr(weight),
        0, 0, 0, 1, 0, 0, 5, 0,
        uintptr(unsafe.Pointer(name)),
    )
    return handle
}

func initializeCreatorControls() {
    creatorFontTitle = creatorFont(-35, 600)
    creatorFontHeading = creatorFont(-22, 600)
    creatorFontRegular = creatorFont(-17, 400)
    creatorFontSmall = creatorFont(-14, 400)
    creatorUIBrush, _, _ = procCreateSolidBrush.Call(creatorColorFor("panel", colorBtnFace))
    for _, control := range []uintptr{localeCombo, deviceCombo, updateButton, refreshButton, writeButton, bootHelpButton} {
        if control != 0 && creatorFontRegular != 0 {
            send(control, wmSetFont, creatorFontRegular, 1)
        }
    }
    if visualColors != nil {
        procSetWindowTheme.Call(localeCombo, uintptr(unsafe.Pointer(utf16Ptr("DarkMode_Explorer"))), 0)
        procSetWindowTheme.Call(deviceCombo, uintptr(unsafe.Pointer(utf16Ptr("DarkMode_Explorer"))), 0)
    }
    client := creatorClientRect()
    layoutCreatorControls(client.Right, client.Bottom)
}

func shutdownCreatorControls() {
    for _, font := range []uintptr{creatorFontTitle, creatorFontHeading, creatorFontRegular, creatorFontSmall} {
        if font != 0 { procDeleteObject.Call(font) }
    }
    if creatorUIBrush != 0 { procDeleteObject.Call(creatorUIBrush) }
}

func placeCreatorControl(hwnd uintptr, x, y, w, h int32) {
    if hwnd != 0 {
        procMoveWindow.Call(hwnd, uintptr(x), uintptr(y), uintptr(w), uintptr(h), 1)
    }
}

// Fixed readable minima, fluid content width and bottom actions on resize.
func layoutCreatorControls(width, height int32) {
    if mainWindow == 0 || width < 950 || height < 590 { return }
    sidebar := width - 306
    mainRight := sidebar - 18
    // Only interactive controls are native windows. Titles, body copy,
    // progress and rail have one owner, the double-buffered parent painter.
    placeCreatorControl(localeCombo, 45, 224, 268, 216)
    placeCreatorControl(deviceCombo, 364, 224, mainRight-384, 216)
    bottom := height - 53
    placeCreatorControl(updateButton, mainRight-434, bottom, 128, 43)
    placeCreatorControl(refreshButton, mainRight-298, bottom, 138, 43)
    placeCreatorControl(writeButton, mainRight-151, bottom, 150, 43)
    placeCreatorControl(bootHelpButton, sidebar+25, height-80, 255, 43)
    invalidateGuidedVisual()
}

func creatorControlColor(message uint32, hdc, handle uintptr) uintptr {
    if creatorUIBrush == 0 { return 0 }
    procSetBkMode.Call(hdc, 2) // OPAQUE: Win32 combo lists own their background.
    procSetTextColor.Call(hdc, creatorColorFor("text", colorWindowText))
    procSetBkColor.Call(hdc, creatorColorFor("panel", colorBtnFace))
    return creatorUIBrush
}

func measureCreatorItem(lParam uintptr) uintptr {
    if lParam == 0 { return 0 }
    // WM_MEASUREITEM LPARAM is a synchronous Windows-owned MEASUREITEMSTRUCT*.
    // Borrow only during this native callback; never retain the pointer.
    item := (*creatorMeasureItem)(unsafe.Pointer(lParam))
    if item.CtlType != odtComboBox { return 0 }
    item.ItemHeight = 29
    return 1
}

func drawCreatorComboItem(data *creatorDrawItem) uintptr {
    fill := "panel"
    if data.ItemState&odsSelected != 0 { fill = "surface" }
    drawCreatorPanel(data.HDC, data.Bounds, fill, fill, 0)
    if data.ItemID == ^uint32(0) { return 1 }
    length := send(data.HwndItem, cbGetLBTextLen, uintptr(data.ItemID), 0)
    if length > 0 && length < 8192 {
        buf := make([]uint16, length+1)
        send(data.HwndItem, cbGetLBText, uintptr(data.ItemID), uintptr(unsafe.Pointer(&buf[0])))
        label := syscall.UTF16ToString(buf)
        textBox := data.Bounds
        textBox.Left += 9
        textBox.Right -= 7
        drawTextWithFont(data.HDC, label, textBox,
            dtSingleLine|dtVCenter|dtEndEllipsis, creatorColorFor("text", colorWindowText), creatorFontRegular)
    }
    return 1
}

func drawCreatorNativeItem(lParam uintptr) uintptr {
    if lParam == 0 { return 0 }
    // WM_DRAWITEM LPARAM is a synchronous Windows-owned DRAWITEMSTRUCT*.
    // Borrow only during this native callback; never retain the pointer.
    data := (*creatorDrawItem)(unsafe.Pointer(lParam))
    if data.CtlType == odtComboBox {
        return drawCreatorComboItem(data)
    }
    return drawCreatorButton(lParam)
}

func creatorControlCaption(hwnd uintptr) string {
    length, _, _ := procGetWindowTextLengthW.Call(hwnd)
    if length > 256 { return "" }
    chars := make([]uint16, length+1)
    procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&chars[0])), uintptr(len(chars)))
    return syscall.UTF16ToString(chars)
}

func drawCreatorButton(lParam uintptr) uintptr {
    if lParam == 0 { return 0 }
    // WM_DRAWITEM LPARAM is a synchronous Windows-owned DRAWITEMSTRUCT*.
    // Borrow only during this native callback; never retain the pointer.
    data := (*creatorDrawItem)(unsafe.Pointer(lParam))
    if data.CtlType != 4 { return 0 } // ODT_BUTTON
    disabled := data.ItemState&odsDisabled != 0
    primary := int(data.CtlID) == idWrite
    fill := "surface"
    border := "border"
    fg := creatorColorFor("text", colorWindowText)
    if primary && !disabled {
        fill = "brand_blue"
        border = "brand_violet"
        fg = creatorColorFor("background", colorHighlightText)
    } else if disabled {
        fill = "panel"
        fg = creatorColorFor("muted", colorGrayText)
    } else if data.ItemState&odsSelected != 0 {
        fill = "panel"
        border = "accent"
    }
    drawCreatorPanel(data.HDC, data.Bounds, fill, border, 13)
    drawTextWithFont(data.HDC, creatorControlCaption(data.HwndItem), data.Bounds, dtSingleLine|dtCenter|dtVCenter|dtEndEllipsis, fg, creatorFontRegular)
    return 1
}
