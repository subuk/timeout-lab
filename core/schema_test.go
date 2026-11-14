package core

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestModelFormatRejectsLegacyFieldsAndUnknownVersions(t *testing.T) {
	for name, edit := range map[string]func(map[string]any){
		"no version":         func(c map[string]any) { delete(c, "version") },
		"old version":        func(c map[string]any) { c["version"] = 1 },
		"future version":     func(c map[string]any) { c["version"] = 3 },
		"global keepalive":   func(c map[string]any) { c["keepalive"] = false },
		"edges":              func(c map[string]any) { firstGroup(c)["edges"] = []any{} },
		"group join":         func(c map[string]any) { firstGroup(c)["join"] = "all" },
		"group quorum":       func(c map[string]any) { firstGroup(c)["quorum"] = 1 },
		"downstream stage":   func(c map[string]any) { firstGroup(c)["stages"] = []any{map[string]any{"downstream": true}} },
		"resource shorthand": func(c map[string]any) { firstGroup(c)["stages"] = []any{map[string]any{"resource": "compute"}} },
		"nested edges": func(c map[string]any) {
			c["groups"].([]any)[1].(map[string]any)["resources"].([]any)[0].(map[string]any)["edges"] = []any{}
		},
		"misspelled field": func(c map[string]any) { firstGroup(c)["stage"] = []any{} },
	} {
		t.Run(name, func(t *testing.T) {
			data, _ := json.Marshal(DefaultConfig())
			var raw map[string]any
			if err := json.Unmarshal(data, &raw); err != nil {
				t.Fatal(err)
			}
			edit(raw)
			data, _ = json.Marshal(raw)
			original := CompositionConfig()
			destination := copyConfig(original)
			if err := json.Unmarshal(data, &destination); err == nil {
				t.Fatal("invalid model accepted")
			}
			if !reflect.DeepEqual(destination, original) {
				t.Fatal("failed import partially changed the destination")
			}
		})
	}
}
func firstGroup(c map[string]any) map[string]any { return c["groups"].([]any)[0].(map[string]any) }

func TestProgramsMustBeExplicit(t *testing.T) {
	for name, edit := range map[string]func(*Config){
		"missing stages":        func(c *Config) { c.Groups[0].Stages = nil },
		"nested missing stages": func(c *Config) { c.Groups[1].Resources[0].Stages = nil },
		"empty stage":           func(c *Config) { c.Groups[0].Stages = []Stage{{Join: "all", Calls: []Call{}}} },
		"missing join":          func(c *Config) { c.Groups[0].Stages[0].Join = "" },
		"missing transport":     func(c *Config) { c.Groups[0].Stages[0].Calls[0].Transport = "" },
	} {
		t.Run(name, func(t *testing.T) {
			c := DefaultConfig()
			edit(&c)
			if _, err := New(c); err == nil {
				t.Fatal("implicit program accepted")
			}
		})
	}
	c := DefaultConfig()
	c.Groups[1].Stages = []Stage{}
	e := engine(t, copyConfig(c))
	e.C.RPS = 0
	tr := e.AddRequest(1)
	e.Advance(2000)
	if !tr.OK || len(tr.Spans) != 2 {
		t.Fatal("containment triggered an implicit call")
	}
}

func TestEveryPresetExportsOnlyExplicitPrograms(t *testing.T) {
	for _, id := range []string{"normal", "slow", "fanout", "hang", "autoscale", "az", "numa", "composition"} {
		c, err := PresetConfig(id)
		if err != nil {
			t.Fatal(err)
		}
		e := engine(t, c)
		data, _ := json.Marshal(e.C)
		if strings.Contains(string(data), `"edges"`) || strings.Contains(string(data), `"downstream"`) {
			t.Fatal("legacy fields exported", id)
		}
		for _, b := range boxDefinitions(e.C) {
			if b.Def.Stages == nil {
				t.Fatal("missing program", id, b.Path)
			}
			for _, s := range b.Def.Stages {
				if len(s.Calls) == 0 || s.Join == "" {
					t.Fatal("implicit stage", id, b.Path)
				}
			}
		}
		engine(t, copyConfig(e.C))
	}
	if _, err := PresetConfig("missing"); err == nil {
		t.Fatal("unknown preset silently selected another model")
	}
}
