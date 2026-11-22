//go:build windows

package main

import "testing"

func TestCreatorRailStagesFollowCanonicalExperience(t *testing.T) {
	for _, tc := range []struct {
		name string
		input creatorExperienceInput
		fills [4]string
		glyphs [4]string
		emphasis [4]bool
	}{
		{
			name: "no USB connected",
			input: creatorExperienceInput{},
			fills: [4]string{"brand_blue", "surface", "surface", "surface"},
			glyphs: [4]string{"1", "2", "3", "4"},
			emphasis: [4]bool{true, false, false, false},
		},
		{
			name: "USB found but not chosen",
			input: creatorExperienceInput{TargetCount: 1},
			fills: [4]string{"brand_blue", "brand_blue", "surface", "surface"},
			glyphs: [4]string{"✓", "2", "3", "4"},
			emphasis: [4]bool{true, true, false, false},
		},
		{
			name: "selected ready target for review",
			input: creatorExperienceInput{TargetCount: 1, TargetSelected: true, PhysicalReady: true},
			fills: [4]string{"brand_blue", "brand_blue", "brand_blue", "surface"},
			glyphs: [4]string{"✓", "✓", "3", "4"},
			emphasis: [4]bool{true, true, true, false},
		},
		{
			name: "USB actively writing",
			input: creatorExperienceInput{WriteActive: true},
			fills: [4]string{"brand_blue", "brand_blue", "brand_blue", "brand_blue"},
			glyphs: [4]string{"✓", "✓", "✓", "4"},
			emphasis: [4]bool{true, true, true, true},
		},
		{
			name: "USB completed after verified writer exit",
			input: creatorExperienceInput{WriteComplete: true},
			fills: [4]string{"brand_blue", "brand_blue", "brand_blue", "brand_blue"},
			glyphs: [4]string{"✓", "✓", "✓", "✓"},
			emphasis: [4]bool{true, true, true, true},
		},
		{
			name: "physical writer unavailable",
			input: creatorExperienceInput{TargetCount: 1, TargetSelected: true, PhysicalReady: false},
			fills: [4]string{"brand_blue", "brand_blue", "warning", "surface"},
			glyphs: [4]string{"✓", "✓", "!", "4"},
			emphasis: [4]bool{true, true, true, false},
		},
		{
			name: "initial discovery failed",
			input: creatorExperienceInput{ErrorMessageID: msgRefreshFailedDetail, ErrorStepNumber: 1},
			fills: [4]string{"warning", "surface", "surface", "surface"},
			glyphs: [4]string{"!", "2", "3", "4"},
			emphasis: [4]bool{true, false, false, false},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			view := creatorExperience(tc.input)
			for step:=1;step<=4;step++ {
				got:=creatorRailStyle(view,step)
				index:=step-1
				if got.Fill != tc.fills[index] || got.Glyph != tc.glyphs[index] || got.Emphasized != tc.emphasis[index] {
					t.Fatalf("step %d style=%+v, want fill=%q glyph=%q emphasized=%t",
						step, got, tc.fills[index],tc.glyphs[index],tc.emphasis[index])
				}
			}
		})
	}
}

func TestCreatorCircleFallbackKeepsInactiveStepsNeutralWithoutShadowPalette(t *testing.T) {
	previous:=visualColors
	t.Cleanup(func(){visualColors=previous})
	visualColors=nil
	for _, fill:=range []string{"surface","panel"} {
		if got:=creatorCircleSystemFallback(fill); got!=colorBtnFace {
			t.Fatalf("neutral %q circle should use native button-face, got COLORREF key %d",fill,got)
		}
		if got:=creatorColorFor(fill,creatorCircleSystemFallback(fill));got!=sysColor(colorBtnFace) {
			t.Fatalf("neutral %q fallback does not resolve to system button-face",fill)
		}
	}
	for _, fill:=range []string{"brand_blue","accent","warning"} {
		if got:=creatorCircleSystemFallback(fill);got!=colorHighlight {
			t.Fatalf("active %q circle should use native highlight fallback, got %d",fill,got)
		}
	}
	// The Surface design SSOT still overrides every system fallback when
	// the verified bundle contains explicit theme tokens.
	visualColors=map[string]uintptr{"surface":0x123456,"brand_blue":0xabcdef}
	if got:=creatorColorFor("surface",creatorCircleSystemFallback("surface"));got!=0x123456{
		t.Fatalf("Surface-owned surface token was ignored: %x",got)
	}
	if got:=creatorColorFor("brand_blue",creatorCircleSystemFallback("brand_blue"));got!=0xabcdef{
		t.Fatalf("Surface-owned accent token was ignored: %x",got)
	}
}
