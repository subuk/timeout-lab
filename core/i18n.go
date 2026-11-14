package core

import (
	"errors"
	"regexp"
	"strings"
)

// Name is the default (English) label. Translations are optional data, never
// inferred from a built-in vocabulary; legacy names remain unchanged.
type LocalizedLabels struct {
	Description string `json:"description,omitempty"`
	Name        string `json:"name,omitempty"`
}
type Localizations map[string]LocalizedLabels

var localeTag = regexp.MustCompile(`^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$`)

func validateModelI18n(c Config) error {
	if len(c.Description) > 4000 {
		return errors.New("I18n: description must be at most 4000 bytes")
	}
	valid := func(m Localizations) bool {
		if len(m) > 32 {
			return false
		}
		seen := map[string]bool{}
		for tag, labels := range m {
			if len(labels.Description) > 4000 {
				return false
			}
			key := strings.ToLower(tag)
			if !localeTag.MatchString(tag) || len(tag) > 40 || len(labels.Name) > 200 || seen[key] {
				return false
			}
			seen[key] = true
		}
		return true
	}
	all := []Localizations{c.I18n}
	for _, g := range c.Groups {
		all = append(all, g.I18n)
		for _, r := range g.Resources {
			all = append(all, r.I18n)
		}
	}
	for _, m := range all {
		if !valid(m) {
			return errors.New("I18n: use unique language tags, at most 32 translations and names up to 200 bytes")
		}
	}
	return nil
}
