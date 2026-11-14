package core

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

type presetNodeResult struct {
	Arrivals, Exited, Queue, Active int
	SumW                            float64
}
type presetResult struct {
	Metrics Metrics
	Nodes   map[string]presetNodeResult
}

func TestPresetBehaviorPreserved(t *testing.T) {
	// Captured before removing implicit programs. Compare outcomes and occupancy,
	// rather than implementation details of spans or event names.
	data, err := os.ReadFile("testdata/preset-behavior.json")
	if err != nil {
		t.Fatal(err)
	}
	var baseline map[string]presetResult
	if err := json.Unmarshal(data, &baseline); err != nil {
		t.Fatal(err)
	}
	for id, want := range baseline {
		t.Run(id, func(t *testing.T) {
			c, err := PresetConfig(id)
			if err != nil {
				t.Fatal(err)
			}
			e := engine(t, copyConfig(c))
			e.Advance(10000)
			got := presetResult{Metrics: e.Snapshot().Metrics, Nodes: map[string]presetNodeResult{}}
			for _, n := range e.Nodes {
				got.Nodes[n.ID] = presetNodeResult{n.Arrivals, n.Exited, len(n.Queue), len(n.Active), n.SumW}
			}
			if !reflect.DeepEqual(got.Metrics, want.Metrics) {
				t.Errorf("metrics changed:\n got %+v\nwant %+v", got.Metrics, want.Metrics)
			}
			if !reflect.DeepEqual(got.Nodes, want.Nodes) {
				t.Errorf("occupancy changed:\n got %+v\nwant %+v", got.Nodes, want.Nodes)
			}
		})
	}
}
