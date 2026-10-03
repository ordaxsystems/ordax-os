//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

const (
	wmPaint = 0x000F

	colorWindow        = 5
	colorWindowText    = 8
	colorHighlight     = 13
	colorHighlightText = 14
	colorBtnFace       = 15
	colorGrayText      = 17

	transparent  = 1
	dtCenter     = 0x00000001
	dtVCenter    = 0x00000004
	dtSingleLine = 0x00000020
	dtWordBreak  = 0x00000010
)

type rect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type paintStruct struct {
	Hdc       uintptr
	Erase     int32
	Paint     rect
	Restore   int32
	IncUpdate int32
	Reserved  [32]byte
}

var (
	procBeginPaint     = user32.NewProc("BeginPaint")
	procEndPaint       = user32.NewProc("EndPaint")
	procInvalidateRect = user32.NewProc("InvalidateRect")
	procFillRect       = user32.NewProc("FillRect")
	procGetSysColor    = user32.NewProc("GetSysColor")
	procDrawTextW      = user32.NewProc("DrawTextW")

	procCreateSolidBrush = gdi32.NewProc("CreateSolidBrush")
	procCreatePen        = gdi32.NewProc("CreatePen")
	procDeleteObject     = gdi32.NewProc("DeleteObject")
	procSelectObject     = gdi32.NewProc("SelectObject")
	procEllipse          = gdi32.NewProc("Ellipse")
	procRectangle        = gdi32.NewProc("Rectangle")
	procMoveToEx         = gdi32.NewProc("MoveToEx")
	procLineTo           = gdi32.NewProc("LineTo")
	procSetBkMode        = gdi32.NewProc("SetBkMode")
	procSetTextColor     = gdi32.NewProc("SetTextColor")
)

func sysColor(index uintptr) uintptr {
	value, _, _ := procGetSysColor.Call(index)
	return value
}

func invalidateGuidedVisual() {
	if mainWindow == 0 {
		return
	}
	area := rect{Left: 684, Top: 18, Right: 866, Bottom: 342}
	procInvalidateRect.Call(mainWindow, uintptr(unsafe.Pointer(&area)), 1)
}

func currentGuidedExperience() creatorExperienceView {
	stateMu.Lock()
	state := refreshState
	stateMu.Unlock()

	input := creatorExperienceInput{
		TargetCount:    len(state.Targets),
		TargetSelected: selectedTargetIndex() >= 0,
		PhysicalReady:  state.PhysicalReady,
	}
	if state.Error != "" {
		input.ErrorMessageID = msgRefreshFailedDetail
	}

	writeMu.Lock()
	write := writeState
	writeMu.Unlock()
	input.WriteActive = write.Active
	input.WriteComplete = !write.Active && write.Success
	if write.Error != "" {
		input.ErrorMessageID = msgPhysicalWriteFailedDetail
	}
	return creatorExperience(input)
}

func drawTextInRect(hdc uintptr, text string, bounds rect, flags uintptr, color uintptr) {
	wide, err := syscall.UTF16FromString(text)
	if err != nil || len(wide) == 0 {
		return
	}
	procSetBkMode.Call(hdc, transparent)
	procSetTextColor.Call(hdc, color)
	procDrawTextW.Call(
		hdc,
		uintptr(unsafe.Pointer(&wide[0])),
		uintptr(len(wide)-1),
		uintptr(unsafe.Pointer(&bounds)),
		flags,
	)
}

func drawStepCircle(hdc uintptr, x, y int32, number int, active, complete bool) {
	fillColor := sysColor(colorBtnFace)
	textColor := sysColor(colorWindowText)
	if active || complete {
		fillColor = sysColor(colorHighlight)
		textColor = sysColor(colorHighlightText)
	}
	brush, _, _ := procCreateSolidBrush.Call(fillColor)
	oldBrush, _, _ := procSelectObject.Call(hdc, brush)
	procEllipse.Call(hdc, uintptr(x), uintptr(y), uintptr(x+28), uintptr(y+28))
	procSelectObject.Call(hdc, oldBrush)
	procDeleteObject.Call(brush)

	label := fmt.Sprintf("%d", number)
	drawTextInRect(hdc, label, rect{Left: x, Top: y, Right: x + 28, Bottom: y + 28}, dtCenter|dtVCenter|dtSingleLine, textColor)
}

func drawStepRail(hdc uintptr, view creatorExperienceView) {
	activeStep := view.StepNumber
	if view.Step == creatorStepBlocked && activeStep == 0 {
		activeStep = 1
	}
	for i := 1; i <= 4; i++ {
		y := int32(72 + (i-1)*48)
		if i < 4 {
			penColor := sysColor(colorGrayText)
			if i < activeStep {
				penColor = sysColor(colorHighlight)
			}
			pen, _, _ := procCreatePen.Call(0, 2, penColor)
			oldPen, _, _ := procSelectObject.Call(hdc, pen)
			procMoveToEx.Call(hdc, 724, uintptr(y+28), 0)
			procLineTo.Call(hdc, 724, uintptr(y+48))
			procSelectObject.Call(hdc, oldPen)
			procDeleteObject.Call(pen)
		}
		drawStepCircle(hdc, 710, y, i, i == activeStep, i < activeStep || view.Step == creatorStepComplete)
	}
}

func drawUSBIllustration(hdc uintptr, view creatorExperienceView) {
	lineColor := sysColor(colorWindowText)
	if view.Step == creatorStepBlocked {
		lineColor = sysColor(colorGrayText)
	}
	pen, _, _ := procCreatePen.Call(0, 2, lineColor)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	brush, _, _ := procCreateSolidBrush.Call(sysColor(colorWindow))
	oldBrush, _, _ := procSelectObject.Call(hdc, brush)

	// A deliberately simple, local illustration: USB body + connector.
	procRectangle.Call(hdc, 774, 88, 838, 132)
	procRectangle.Call(hdc, 838, 98, 852, 122)
	procMoveToEx.Call(hdc, 842, 103, 0)
	procLineTo.Call(hdc, 848, 103)
	procMoveToEx.Call(hdc, 842, 117, 0)
	procLineTo.Call(hdc, 848, 117)

	// State badge beside the USB: check, progress, or attention mark.
	badgeBrush, _, _ := procCreateSolidBrush.Call(sysColor(colorHighlight))
	procSelectObject.Call(hdc, badgeBrush)
	procEllipse.Call(hdc, 806, 142, 836, 172)
	procSelectObject.Call(hdc, oldBrush)
	procDeleteObject.Call(badgeBrush)

	badge := "i"
	switch view.Step {
	case creatorStepReview:
		badge = "!"
	case creatorStepCreating:
		badge = "…"
	case creatorStepComplete:
		badge = "✓"
	case creatorStepBlocked:
		badge = "!"
	}
	drawTextInRect(hdc, badge, rect{Left: 806, Top: 142, Right: 836, Bottom: 172}, dtCenter|dtVCenter|dtSingleLine, sysColor(colorHighlightText))

	procSelectObject.Call(hdc, oldBrush)
	procDeleteObject.Call(brush)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(pen)
}

func paintGuidedVisual(hwnd uintptr) uintptr {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	if hdc == 0 {
		return 0
	}
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))

	backgroundBrush, _, _ := procCreateSolidBrush.Call(sysColor(colorWindow))
	procFillRect.Call(hdc, uintptr(unsafe.Pointer(&ps.Paint)), backgroundBrush)
	procDeleteObject.Call(backgroundBrush)

	panel := rect{Left: 684, Top: 18, Right: 866, Bottom: 342}
	panelBrush, _, _ := procCreateSolidBrush.Call(sysColor(colorBtnFace))
	procFillRect.Call(hdc, uintptr(unsafe.Pointer(&panel)), panelBrush)
	procDeleteObject.Call(panelBrush)

	separator, _, _ := procCreatePen.Call(0, 1, sysColor(colorGrayText))
	oldSeparator, _, _ := procSelectObject.Call(hdc, separator)
	procMoveToEx.Call(hdc, 676, 18, 0)
	procLineTo.Call(hdc, 676, 342)
	procSelectObject.Call(hdc, oldSeparator)
	procDeleteObject.Call(separator)

	view := currentGuidedExperience()
	drawTextInRect(hdc, "Seu OrdaX USB", rect{Left: 698, Top: 28, Right: 854, Bottom: 54}, dtCenter|dtVCenter|dtSingleLine, sysColor(colorWindowText))
	drawStepRail(hdc, view)
	drawUSBIllustration(hdc, view)
	drawTextInRect(hdc, view.Title, rect{Left: 748, Top: 190, Right: 858, Bottom: 238}, dtCenter|dtWordBreak, sysColor(colorWindowText))
	drawTextInRect(hdc, view.Eyebrow, rect{Left: 748, Top: 244, Right: 858, Bottom: 282}, dtCenter|dtWordBreak, sysColor(colorGrayText))
	return 0
}
