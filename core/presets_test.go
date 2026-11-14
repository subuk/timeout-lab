package core

import (
	"encoding/json"
	"math"
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

func TestReferencePresetBehaviorPreserved(t *testing.T) {
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
			c, err := referencePresetConfig(id)
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

func advanceUntil(e *Engine, end float64) {
	for e.Now < end {
		e.Advance(math.Min(10000, end-e.Now))
	}
}

func TestRetimedPresetBehavior(t *testing.T) {
	for _, id := range []string{"normal", "slow", "fanout", "hang", "autoscale", "az", "numa", "composition"} {
		t.Run(id, func(t *testing.T) {
			before, err := referencePresetConfig(id)
			if err != nil {
				t.Fatal(err)
			}
			after, err := PresetConfig(id)
			if err != nil {
				t.Fatal(err)
			}
			if after.RPS != 30 {
				t.Fatalf("preset has %g RPS, want 30", after.RPS)
			}
			a, b := engine(t, before), engine(t, after)
			// Compare equal expected arrival counts, not equal elapsed times.
			// Sampling remains at 500 ms and zero work retains its 0.001 ms
			// floor, so retiming need not produce identical RNG/event ordering.
			advanceUntil(a, 60000)
			advanceUntil(b, 60000*before.RPS/after.RPS)
			near(t, float64(b.Arrivals)/float64(a.Arrivals), 1, .06)
			near(t, float64(b.Failed)/float64(b.Arrivals), float64(a.Failed)/float64(a.Arrivals), .035)
			oldSnapshot, currentSnapshot := a.Snapshot(), b.Snapshot()
			for _, old := range append(oldSnapshot.Nodes, oldSnapshot.Resources...) {
				if old.Retired {
					continue
				}
				found := false
				for _, current := range append(currentSnapshot.Nodes, currentSnapshot.Resources...) {
					if current.ID == old.ID {
						found = true
						// Time-average occupancy preserves the scenario's bottlenecks.
						near(t, current.L, old.L, math.Max(1, old.L*.2))
					}
				}
				if !found {
					t.Fatalf("retimed scenario lost node %s", old.ID)
				}
			}
			m := b.Snapshot().Metrics
			switch id {
			case "normal", "az", "numa", "composition":
				if b.Failed != 0 || m.Goodput < 24 || m.Goodput > 36 {
					t.Fatalf("healthy scenario is not healthy: %+v", m)
				}
			case "slow", "fanout":
				if m.ErrorRate < 90 || m.Queue < 100 || len(b.Groups["db"][0].Active) != 24 {
					t.Fatalf("downstream overload disappeared: %+v", m)
				}
			case "hang":
				if m.Ghosts != 16 || len(b.Groups["api"][0].Queue) < 100 || b.C.Cancel {
					t.Fatalf("hung work no longer accumulates: %+v", m)
				}
			case "autoscale":
				if len(b.Groups["api"]) < 3 || len(b.Groups["api"]) > 4 || len(b.Groups["db"]) != 1 {
					t.Fatal("autoscaling did not relieve the compute bottleneck")
				}
				next := copyConfig(b.C)
				next.RPS = 1
				if err := b.Update(next); err != nil {
					t.Fatal(err)
				}
				advanceUntil(b, b.Now+600000)
				if len(b.Groups["api"]) != 1 {
					t.Fatal("autoscaler did not shrink after load fell")
				}
			}
		})
	}
}

func TestPresetImportAndLiveLoadKeepLiteralTimes(t *testing.T) {
	c := CompositionConfig()
	e := engine(t, copyConfig(c))
	advanceUntil(e, 1000)
	next := copyConfig(e.C)
	next.RPS = 60
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	if e.Now != 1000 || e.C.RPS != 60 || e.C.Deadline != c.Deadline || !reflect.DeepEqual(e.C.Groups, c.Groups) {
		t.Fatal("import or live RPS change retimed/reset the model")
	}
}
