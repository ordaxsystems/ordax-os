//go:build windows

package main

import (
    "fmt"
    "syscall"
    "unsafe"
)

const (
    wmPaint = 0x000F
    colorWindow = 5
    colorWindowText = 8
    colorHighlight = 13
    colorHighlightText = 14
    colorBtnFace = 15
    colorGrayText = 17
    transparent = 1
    dtCenter = 0x00000001
    dtVCenter = 0x00000004
    dtSingleLine = 0x00000020
    dtWordBreak = 0x00000010
    dtEndEllipsis = 0x00008000
    srccopy = 0x00CC0020
)

type rect struct { Left, Top, Right, Bottom int32 }
type paintStruct struct {
    Hdc uintptr
    Erase int32
    Paint rect
    Restore int32
    IncUpdate int32
    Reserved [32]byte
}

var (
    procBeginPaint = user32.NewProc("BeginPaint")
    procEndPaint = user32.NewProc("EndPaint")
    procInvalidateRect = user32.NewProc("InvalidateRect")
    procGetClientRect = user32.NewProc("GetClientRect")
    procFillRect = user32.NewProc("FillRect")
    procGetSysColor = user32.NewProc("GetSysColor")
    procDrawTextW = user32.NewProc("DrawTextW")
    procCreateSolidBrush = gdi32.NewProc("CreateSolidBrush")
    procCreatePen = gdi32.NewProc("CreatePen")
    procDeleteObject = gdi32.NewProc("DeleteObject")
    procSelectObject = gdi32.NewProc("SelectObject")
    procEllipse = gdi32.NewProc("Ellipse")
    procRoundRect = gdi32.NewProc("RoundRect")
    procMoveToEx = gdi32.NewProc("MoveToEx")
    procLineTo = gdi32.NewProc("LineTo")
    procSetBkMode = gdi32.NewProc("SetBkMode")
    procSetTextColor = gdi32.NewProc("SetTextColor")
    procCreateCompatibleDC = gdi32.NewProc("CreateCompatibleDC")
    procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
    procDeleteDC = gdi32.NewProc("DeleteDC")
    procBitBlt = gdi32.NewProc("BitBlt")
)

func sysColor(index uintptr) uintptr {
    c, _, _ := procGetSysColor.Call(index)
    return c
}

func creatorClientRect() rect {
    var r rect
    if mainWindow != 0 { procGetClientRect.Call(mainWindow, uintptr(unsafe.Pointer(&r))) }
    return r
}

func invalidateGuidedVisual() {
    if mainWindow != 0 { procInvalidateRect.Call(mainWindow, 0, 0) }
}

func currentGuidedExperience() creatorExperienceView {
    stateMu.Lock()
    state := refreshState
    stateMu.Unlock()
    input := creatorExperienceInput{
        TargetCount: len(state.Targets),
        TargetSelected: selectedTargetIndex() >= 0,
        PhysicalReady: state.PhysicalReady,
    }
    if state.Error != "" {
        input.ErrorMessageID = msgRefreshFailedDetail
        input.ErrorStepNumber = 1
    }
    writeMu.Lock()
    write := writeState
    writeMu.Unlock()
    input.WriteActive = write.Active
    input.WriteComplete = !write.Active && write.Success
    if write.Error != "" {
        input.ErrorMessageID = msgPhysicalWriteFailedDetail
        input.ErrorStepNumber = 4
    }
    return creatorExperience(input)
}

func drawTextWithFont(hdc uintptr, text string, bounds rect, flags uintptr, color, font uintptr) {
    chars, err := syscall.UTF16FromString(text)
    if err != nil || len(chars) == 0 { return }
    oldFont := uintptr(0)
    if font != 0 { oldFont, _, _ = procSelectObject.Call(hdc, font) }
    procSetBkMode.Call(hdc, transparent)
    procSetTextColor.Call(hdc, color)
    procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(&chars[0])),
        uintptr(len(chars)-1), uintptr(unsafe.Pointer(&bounds)), flags)
    if oldFont != 0 { procSelectObject.Call(hdc, oldFont) }
}
func drawTextInRect(hdc uintptr, text string, bounds rect, flags uintptr, color uintptr) {
    drawTextWithFont(hdc, text, bounds, flags, color, creatorFontRegular)
}

func drawCreatorPanel(hdc uintptr, bounds rect, fill, border string, radius int32) {
    brush, _, _ := procCreateSolidBrush.Call(creatorColorFor(fill, colorBtnFace))
    pen, _, _ := procCreatePen.Call(0, 1, creatorColorFor(border, colorGrayText))
    oldBrush, _, _ := procSelectObject.Call(hdc, brush)
    oldPen, _, _ := procSelectObject.Call(hdc, pen)
    procRoundRect.Call(hdc, uintptr(bounds.Left), uintptr(bounds.Top), uintptr(bounds.Right), uintptr(bounds.Bottom), uintptr(radius), uintptr(radius))
    procSelectObject.Call(hdc, oldPen)
    procSelectObject.Call(hdc, oldBrush)
    procDeleteObject.Call(pen)
    procDeleteObject.Call(brush)
}

func drawCreatorCircle(hdc uintptr, bounds rect, fill, text string, textColor uintptr) {
    brush, _, _ := procCreateSolidBrush.Call(creatorColorFor(fill, colorHighlight))
    oldBrush, _, _ := procSelectObject.Call(hdc, brush)
    pen, _, _ := procCreatePen.Call(0, 1, creatorColorFor("border", colorGrayText))
    oldPen, _, _ := procSelectObject.Call(hdc, pen)
    procEllipse.Call(hdc, uintptr(bounds.Left), uintptr(bounds.Top), uintptr(bounds.Right), uintptr(bounds.Bottom))
    procSelectObject.Call(hdc, oldBrush)
    procSelectObject.Call(hdc, oldPen)
    procDeleteObject.Call(brush)
    procDeleteObject.Call(pen)
    drawTextInRect(hdc, text, bounds, dtCenter|dtVCenter|dtSingleLine, textColor)
}

func drawCreatorRail(hdc uintptr, left int32, view creatorExperienceView) {
    titles := [4]string{
        creatorT(msgConnectTitle),
        creatorT(msgSelectTitle),
        creatorT(msgReviewTitle),
        creatorT(msgCompleteTitle),
    }
    active := view.StepNumber
    for i := 1; i <= 4; i++ {
        y := int32(217 + (i-1)*70)
        if i != 4 {
            pen, _, _ := procCreatePen.Call(0, 2, creatorColorFor("border", colorGrayText))
            old, _, _ := procSelectObject.Call(hdc, pen)
            procMoveToEx.Call(hdc, uintptr(left+36), uintptr(y+33), 0)
            procLineTo.Call(hdc, uintptr(left+36), uintptr(y+70))
            procSelectObject.Call(hdc, old)
            procDeleteObject.Call(pen)
        }
        done := (active > 0 && i < active) || view.Step == creatorStepComplete
        activeStep := active > 0 && i == active
        fill := "surface"
        if done || activeStep { fill = "brand_blue" }
        text := fmt.Sprintf("%d", i)
        if done { text = "✓" }
        if view.Step == creatorStepBlocked && activeStep {
            fill = "warning"
            text = "!"
        }
        labelColor := creatorColorFor("muted", colorWindowText)
        if done || activeStep { labelColor = creatorColorFor("text", colorWindowText) }
        drawCreatorCircle(hdc, rect{left+19, y, left+53, y+34}, fill, text, creatorColorFor("text", colorHighlightText))
        drawTextInRect(hdc, titles[i-1], rect{left+69, y+2, left+288, y+28}, dtSingleLine|dtEndEllipsis, labelColor)
    }
}

func drawCreatorUSBStatus(hdc uintptr, left int32, view creatorExperienceView) {
    box := rect{left+16, 503, left+286, 584}
    drawCreatorPanel(hdc, box, "panel", "border", 12)
    stateMu.Lock()
    targets := refreshState.Targets
    stateMu.Unlock()
    selection := selectedTargetIndex()
    selected := selection >= 0 && selection < len(targets)
    if !selected {
        drawTextInRect(hdc, creatorT(msgConnectTitle), rect{left+35, 524, left+270, 548}, dtSingleLine, creatorColorFor("muted", colorGrayText))
        return
    }
    target := targets[selection]
    drawTextInRect(hdc, creatorT(msgUSBDetected), rect{left+34, 513, left+260, 536}, dtSingleLine, creatorColorFor("text", colorWindowText))
    primary := targetPrimaryIdentity(target)
    if len([]rune(primary)) > 28 { primary = string([]rune(primary)[:26]) + "…" }
    secondary := targetSecondaryIdentity(target)
    if len([]rune(secondary)) > 28 { secondary = string([]rune(secondary)[:26]) + "…" }
    drawTextInRect(hdc, primary, rect{left+34, 540, left+268, 560}, dtSingleLine, creatorColorFor("muted", colorGrayText))
    drawTextInRect(hdc, secondary, rect{left+34, 560, left+268, 580}, dtSingleLine, creatorColorFor("accent", colorHighlight))
}

func paintGuidedVisual(hwnd uintptr) uintptr {
    var ps paintStruct
    screen, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
    if screen == 0 { return 0 }
    defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
    client := creatorClientRect()
    // Paint static content exactly once, offscreen. Blitting is clipped by
    // WS_CLIPCHILDREN so native interactive controls retain their own pixels.
    hdc := screen
    memory, _, _ := procCreateCompatibleDC.Call(screen)
    bitmap := uintptr(0)
    oldBitmap := uintptr(0)
    if memory != 0 && client.Right > 0 && client.Bottom > 0 {
        bitmap, _, _ = procCreateCompatibleBitmap.Call(screen, uintptr(client.Right), uintptr(client.Bottom))
        if bitmap != 0 {
            oldBitmap, _, _ = procSelectObject.Call(memory, bitmap)
            hdc = memory
        }
    }
    defer func() {
        if memory != 0 {
            if bitmap != 0 && oldBitmap != 0 {
                procBitBlt.Call(screen, 0, 0, uintptr(client.Right), uintptr(client.Bottom),
                    memory, 0, 0, srccopy)
                procSelectObject.Call(memory, oldBitmap)
            }
            if bitmap != 0 { procDeleteObject.Call(bitmap) }
            procDeleteDC.Call(memory)
        }
    }()
    right := client.Right
    if right < 1090 { right = 1090 }
    sidebar := right - 306
    mainRight := sidebar - 18

    bg, _, _ := procCreateSolidBrush.Call(creatorColorFor("background", colorWindow))
    procFillRect.Call(hdc, uintptr(unsafe.Pointer(&client)), bg)
    procDeleteObject.Call(bg)

    drawCreatorPanel(hdc, rect{22, 19, right-21, 159}, "surface", "border", 18)
    drawTextWithFont(hdc, creatorT(msgHeaderTitle),
        rect{139, 53, mainRight-18, 101}, dtSingleLine|dtEndEllipsis,
        creatorColorFor("text", colorWindowText), creatorFontTitle)
    drawTextWithFont(hdc, creatorT(msgHeaderSubtitle),
        rect{139, 109, mainRight-18, 149}, dtWordBreak,
        creatorColorFor("muted", colorGrayText), creatorFontRegular)
    drawCreatorPanel(hdc, rect{22, 174, 329, 285}, "panel", "border", 13)
    drawCreatorPanel(hdc, rect{344, 174, mainRight, 285}, "panel", "border", 13)
    drawTextWithFont(hdc, creatorT(msgFieldLanguage), rect{45, 192, 310, 217},
        dtSingleLine|dtEndEllipsis, creatorColorFor("muted", colorGrayText), creatorFontRegular)
    drawTextWithFont(hdc, creatorT(msgFieldUSB), rect{364, 192, mainRight-24, 217},
        dtSingleLine|dtEndEllipsis, creatorColorFor("muted", colorGrayText), creatorFontRegular)
    view := currentGuidedExperience()
    cardBorder := "border"
    if view.Step == creatorStepBlocked { cardBorder = "warning" }
    if view.Step == creatorStepReview || view.Step == creatorStepComplete { cardBorder = "success" }
    drawCreatorPanel(hdc, rect{22, 301, mainRight, 500}, "panel", cardBorder, 15)
    iconFill := "accent"
    if view.Step == creatorStepBlocked { iconFill = "warning" }
    if view.Step == creatorStepReview || view.Step == creatorStepComplete { iconFill = "success" }
    symbol := "i"
    if view.Step == creatorStepBlocked { symbol = "!" }
    if view.Step == creatorStepReview || view.Step == creatorStepComplete { symbol = "✓" }
    drawCreatorCircle(hdc, rect{49, 343, 92, 386}, iconFill, symbol, creatorColorFor("background", colorWindow))
    titleColor := creatorColorFor("text", colorWindowText)
    if view.Step == creatorStepBlocked { titleColor = creatorColorFor("warning", colorWindowText) }
    if view.Step == creatorStepComplete { titleColor = creatorColorFor("success", colorWindowText) }
    drawTextWithFont(hdc, creatorStatusText, rect{112, 330, mainRight-30, 373},
        dtSingleLine|dtEndEllipsis, titleColor, creatorFontHeading)
    drawTextWithFont(hdc, creatorHintText, rect{112, 383, mainRight-32, 484},
        dtWordBreak, creatorColorFor("muted", colorGrayText), creatorFontRegular)
    statusBottom := client.Bottom-77
    if statusBottom > 719 { statusBottom = 719 }
    drawCreatorPanel(hdc, rect{22, 514, mainRight, statusBottom}, "panel", "border", 12)
    drawTextWithFont(hdc, creatorT(msgStatusCaption), rect{43, 526, 190, 552},
        dtSingleLine, creatorColorFor("text", colorWindowText), creatorFontRegular)
    drawCreatorPanel(hdc, rect{43, 564, mainRight-24, 580}, "surface", "border", 7)
    progressStart, progressEnd := int32(46), mainRight-27
    if creatorProgressBusy {
        // Unknown exact percentage: deliberately static, not a flickering timer.
        progressEnd = progressStart + (progressEnd-progressStart)/4
    } else {
        progressEnd = progressStart + (progressEnd-progressStart)*int32(creatorProgressValue)/100
    }
    if progressEnd > progressStart {
        drawCreatorPanel(hdc, rect{progressStart, 567, progressEnd, 577}, "brand_blue", "brand_blue", 6)
    }
    if creatorProgressValue > 0 && !creatorProgressBusy {
        drawTextWithFont(hdc, fmt.Sprintf("%d%%", creatorProgressValue),
            rect{44, 590, mainRight-24, 612}, dtSingleLine,
            creatorColorFor("accent", colorHighlight), creatorFontSmall)
    }

    drawCreatorPanel(hdc, rect{sidebar, 174, right-21, client.Bottom-20}, "panel", "border", 16)
    creatorDrawOfficialLogo(hdc, 44, 55, 75, 75)
    drawTextInRect(hdc, creatorT(msgSidebarUSBTitle), rect{sidebar+32, 187, right-38, 213}, dtSingleLine, creatorColorFor("text", colorWindowText))
    drawCreatorRail(hdc, sidebar, view)
    drawCreatorUSBStatus(hdc, sidebar, view)
    drawTextWithFont(hdc, creatorVersionText,
        rect{45, client.Bottom-46, mainRight-460, client.Bottom-16},
        dtSingleLine|dtEndEllipsis, creatorColorFor("muted", colorGrayText), creatorFontSmall)
    return 0
}
