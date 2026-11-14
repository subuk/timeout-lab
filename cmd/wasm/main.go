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
			Manual  bool                `json:"manual"`
			Request core.RequestOptions `json:"request"`
			Preset  string              `json:"preset"`
			Type    string              `json:"type"`
			MS      float64             `json:"ms"`
			Config  core.Config         `json:"config"`
			ID      string              `json:"id"`
			State   string              `json:"state"`
			Service *float64            `json:"service"`
			Workers *int                `json:"workers"`
		}
		if len(args) == 0 {
			return `{"error":"Missing command"}`
		}
		if err := json.Unmarshal([]byte(args[0].String()), &cmd); err != nil {
			return errorJSON(err)
		}
		var err error
		switch cmd.Type {
		case "mode":
			sim.SetManualMode(cmd.Manual)
		case "request":
			_, err = sim.SendRequest(cmd.Request)
		case "advance":
			sim.Advance(cmd.MS)
		case "preset":
			var c core.Config
			c, err = core.PresetConfig(cmd.Preset)
			if err == nil {
				var next *core.Engine
				next, err = core.New(c)
				if err == nil {
					next.SetManualMode(sim.ManualMode)
					sim = next
				}
			}
		case "reset":
			var next *core.Engine
			next, err = core.New(cmd.Config)
			if err == nil {
				next.SetManualMode(sim.ManualMode)
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
