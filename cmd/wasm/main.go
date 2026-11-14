//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"timeoutlab/core"
)

var sim *core.Engine

func main() {
	sim, _ = core.New(core.DefaultConfig())
	js.Global().Set("labCommand", js.FuncOf(func(this js.Value, args []js.Value) any {
		var cmd struct {
			Preset  string      `json:"preset"`
			Type    string      `json:"type"`
			MS      float64     `json:"ms"`
			Config  core.Config `json:"config"`
			ID      string      `json:"id"`
			State   string      `json:"state"`
			Service *float64    `json:"service"`
			Workers *int        `json:"workers"`
		}
		if len(args) == 0 {
			return `{"error":"Missing command"}`
		}
		if err := json.Unmarshal([]byte(args[0].String()), &cmd); err != nil {
			return errorJSON(err)
		}
		var err error
		switch cmd.Type {
		case "advance":
			sim.Advance(cmd.MS)
		case "preset":
			c := core.AZConfig()
			if cmd.Preset == "numa" {
				c = core.NUMAConfig()
			}
			var next *core.Engine
			next, err = core.New(c)
			if err == nil {
				sim = next
			}
		case "reset":
			var next *core.Engine
			next, err = core.New(cmd.Config)
			if err == nil {
				sim = next
			}
		case "config":
			err = sim.Update(cmd.Config)
		case "node":
			err = sim.SetNode(cmd.ID, cmd.State, cmd.Service, cmd.Workers)
		}
		if err != nil {
			return errorJSON(err)
		}
		return sim.JSON()
	}))
	select {}
}
func errorJSON(err error) string {
	b, _ := json.Marshal(map[string]string{"error": err.Error()})
	return string(b)
}
