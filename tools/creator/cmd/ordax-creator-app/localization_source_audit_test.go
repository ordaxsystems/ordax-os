package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

var creatorUIStringArgs = map[string][]int{
	"setText":               {1},
	"messageBox":            {0, 1},
	"createControl":         {1},
	"updateWriteProgress":   {0, 1},
	"updateWritePercentage": {0, 1},
}

func allowedCreatorUIScaffold(value string) bool {
	if strings.TrimSpace(value) == "" {
		return true
	}
	return value == "OrdaX Creator • " || value == "OrdaX Creator"
}

func TestCreatorUserFacingCallsDoNotEmbedCopyLiterals(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") || name == "localization.go" {
			continue
		}
		file, err := parser.ParseFile(fset, filepath.Clean(name), nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			ident, ok := call.Fun.(*ast.Ident)
			if !ok {
				return true
			}
			indexes, watched := creatorUIStringArgs[ident.Name]
			if !watched {
				return true
			}
			for _, index := range indexes {
				if index >= len(call.Args) {
					continue
				}
				ast.Inspect(call.Args[index], func(arg ast.Node) bool {
					literal, ok := arg.(*ast.BasicLit)
					if !ok || literal.Kind != token.STRING {
						return true
					}
					value, err := strconv.Unquote(literal.Value)
					if err != nil {
						t.Errorf("%s: invalid string literal at %s", name, fset.Position(literal.Pos()))
						return false
					}
					if !allowedCreatorUIScaffold(value) {
						t.Errorf("%s: user-facing call %s embeds copy literal %q at %s; use Creator localization owner", name, ident.Name, value, fset.Position(literal.Pos()))
					}
					return true
				})
			}
			return true
		})
	}
}
