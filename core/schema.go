package core

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Config accepts only the current schema. Unknown fields must fail rather than
// silently dropping calls from an old or misspelled model, at any nesting level.
func (c *Config) UnmarshalJSON(data []byte) error {
	type wireConfig Config
	var next wireConfig
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&next); err != nil {
		return fmt.Errorf("Invalid version 2 model: %w", err)
	}
	if next.Version != 2 {
		return fmt.Errorf("Model version 2 is required. Legacy model formats are not supported.")
	}
	*c = Config(next)
	return nil
}
