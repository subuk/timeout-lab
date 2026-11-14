package core

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestModelI18nRoundTripAndLiveUpdate(t *testing.T) {
	c := resourceConfig("instance")
	c.Description = "Default description"
	c.I18n = Localizations{"ru": {Name: "Модель", Description: "Описание модели"}, "de": {Name: "Modell"}}
	c.Groups[0].I18n = Localizations{"ru": {Name: "Группа"}}
	c.Groups[0].Resources[0].I18n = Localizations{"ru": {Name: "Ресурс"}, "fr-CA": {Name: "Ressource"}}
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var restored Config
	if err = json.Unmarshal(b, &restored); err != nil {
		t.Fatal(err)
	}
	e := engine(t, restored)
	tr := e.AddRequest(1)
	e.Advance(500)
	next := copyConfig(e.C)
	next.Groups[0].Resources[0].I18n["ru"] = LocalizedLabels{Name: "Новое имя"}
	if err = e.Update(next); err != nil {
		t.Fatal(err)
	}
	if e.C.Description != "Default description" || e.C.I18n["ru"].Description != "Описание модели" {
		t.Fatal("description lost")
	}
	if e.Now != 500 || e.Arrivals != 1 {
		t.Fatal("localization reset the experiment")
	}
	if e.C.I18n["de"].Name != "Modell" || e.C.Groups[0].I18n["ru"].Name != "Группа" {
		t.Fatal("metadata lost")
	}
	found := false
	for _, s := range tr.Spans {
		if s.Resource != "" {
			found = true
			if s.ResourceI18n["ru"].Name != "Ресурс" {
				t.Fatal("historical trace localization changed")
			}
		}
	}
	if !found {
		t.Fatal("missing resource span")
	}
	tr = e.AddRequest(1)
	e.Advance(500)
	for _, s := range tr.Spans {
		if s.Resource != "" && s.ResourceI18n["ru"].Name != "Новое имя" {
			t.Fatal("new translation not used")
		}
	}
}
func TestModelI18nValidation(t *testing.T) {
	for _, m := range []Localizations{{"../ru": {Name: "x"}}, {"ru": {Name: "x"}, "RU": {Name: "y"}}, {"en": {Name: strings.Repeat("x", 201)}}} {
		c := DefaultConfig()
		c.Groups[0].I18n = m
		if Validate(c) == nil {
			t.Fatalf("accepted invalid localization: %v", m)
		}
	}
	c := DefaultConfig()
	c.Groups[0].Name = "Бекенды"
	c.Groups[0].I18n = nil
	e := engine(t, c)
	if e.C.Groups[0].Name != "Бекенды" {
		t.Fatal("legacy name was rewritten")
	}
	for _, preset := range []Config{DefaultConfig(), AZConfig(), NUMAConfig()} {
		if preset.I18n["ru"].Name == "" || preset.Name == preset.I18n["ru"].Name {
			t.Fatal("preset must have English base and explicit Russian translation")
		}
	}
}
