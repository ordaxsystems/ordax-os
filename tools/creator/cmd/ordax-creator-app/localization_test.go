package main

import (
	"regexp"
	"sort"
	"strings"
	"testing"
	"unicode"
)

var creatorPlaceholderPattern = regexp.MustCompile(`\{([A-Za-z][A-Za-z0-9]*)\}`)
var creatorPortugueseMarker = regexp.MustCompile(`(?i)([ãõáéíóúâêôç]|\b(pendrive|discos|internos|gravação|verificação|atualizar|criar|fechar|recarregar|continuar|nenhuma|etapa|escolha|agora|segurança)\b)`)

func placeholderSet(value string) []string {
	matches := creatorPlaceholderPattern.FindAllStringSubmatch(value, -1)
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		out = append(out, match[1])
	}
	sort.Strings(out)
	return out
}

func TestCreatorLocalizationCatalogsHaveExactParity(t *testing.T) {
	ids := creatorMessageIDs()
	if len(ids) < 60 {
		t.Fatalf("localization owner unexpectedly small: %d messages", len(ids))
	}
	if len(creatorENUSMessages) != len(creatorPTBRMessages) {
		t.Fatalf("catalog size mismatch: pt-BR=%d en-US=%d", len(creatorPTBRMessages), len(creatorENUSMessages))
	}
	for _, id := range ids {
		pt, ok := creatorPTBRMessages[id]
		if !ok || strings.TrimSpace(pt) == "" {
			t.Fatalf("pt-BR missing %q", id)
		}
		en, ok := creatorENUSMessages[id]
		if !ok || strings.TrimSpace(en) == "" {
			t.Fatalf("en-US missing %q", id)
		}
		if strings.Join(placeholderSet(pt), ",") != strings.Join(placeholderSet(en), ",") {
			t.Fatalf("placeholder drift for %q: pt-BR=%v en-US=%v", id, placeholderSet(pt), placeholderSet(en))
		}
		if creatorPortugueseMarker.MatchString(en) {
			t.Fatalf("possible PT-BR leak in en-US %q: %q", id, en)
		}
		for _, value := range []string{pt, en} {
			for _, r := range value {
				if r == unicode.ReplacementChar || (unicode.IsControl(r) && r != '\n' && r != '\t') {
					t.Fatalf("invalid character U+%04X in %q", r, id)
				}
			}
		}
	}
}

func TestCreatorLocaleResolutionIsDeterministic(t *testing.T) {
	cases := map[string]creatorLocale{
		"pt-BR":    creatorLocalePTBR,
		"pt_BR":    creatorLocalePTBR,
		"pt-PT":    creatorLocalePTBR,
		"en-US":    creatorLocaleENUS,
		"en_GB":    creatorLocaleENUS,
		"en":       creatorLocaleENUS,
		"zh-Hans":  creatorSourceLocale,
		"mandarin": creatorSourceLocale,
		"":         creatorSourceLocale,
	}
	for input, want := range cases {
		if got := resolveCreatorLocale(input); got != want {
			t.Fatalf("resolveCreatorLocale(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestCreatorMessagesFallBackOnlyToSourceCatalog(t *testing.T) {
	unknown := creatorMessageID("creator.test.unknown")
	if got := creatorMessageFor(creatorLocaleENUS, unknown, nil); got != string(unknown) {
		t.Fatalf("unknown message must remain visible as its id, got %q", got)
	}
	if got := creatorMessageFor(creatorLocaleENUS, msgProgressWritingBytes, map[string]string{"completed": "1.0", "total": "2.0"}); got != "Write: 1.0 of 2.0 MiB." {
		t.Fatalf("interpolation result = %q", got)
	}
}

func TestCreatorSupportedLocalesAreExplicitAndBounded(t *testing.T) {
	got := creatorSupportedLocales()
	if len(got) != 2 || got[0] != creatorLocalePTBR || got[1] != creatorLocaleENUS {
		t.Fatalf("supported locales = %v", got)
	}
}
