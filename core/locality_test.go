package core

import (
	"encoding/json"
	"testing"
)

func rule(source, key string) *MatchRule { return &MatchRule{true, source, key} }
func cost(source, key string, match, mismatch float64) *CostRule {
	return &CostRule{MatchRule{true, source, key}, match, mismatch}
}
func TestLocalityProcessingMatchMismatchMissing(t *testing.T) {
	for _, tc := range []struct {
		label  string
		want   float64
		result string
	}{{"a", 20, "match"}, {"b", 60, "mismatch"}, {"", 20, "missing"}} {
		c := single(1, 10)
		c.RequestLabels = map[string]string{"az": tc.label}
		c.Groups[0].Labels = map[string]string{"az": "a"}
		c.Groups[0].Cost = cost("request", "az", 1, 3)
		e := engine(t, c)
		tr := e.AddRequest(2)
		e.Advance(100)
		w := tr.Spans[0].WorkCost
		if !tr.OK || w.Locality.Result != tc.result {
			t.Fatalf("outcome %+v", w)
		}
		near(t, w.Duration, tc.want, 1e-9)
	}
}
func TestLocalityCallerAndResourceInheritance(t *testing.T) {
	c := single(2, 10)
	c.RequestLabels = map[string]string{"az": "b"}
	c.Groups[0].Labels = map[string]string{"az": "a"}
	c.Groups[0].Cost = cost("request", "az", 1, 3)
	c.Groups[0].Resources = []ResourceConfig{{ID: "disk", Name: "Disk", Scope: "instance", Workers: 1, Service: 10, QueueLimit: 10, Cost: cost("caller", "az", 1, 4)}}
	e := engine(t, c)
	tr := e.AddRequest(1)
	e.Advance(100)
	if len(tr.Spans) != 2 || !tr.OK {
		t.Fatal("no resource span")
	}
	near(t, tr.Spans[0].WorkCost.Duration, 30, 1e-9)
	near(t, tr.Spans[1].WorkCost.Duration, 10, 1e-9)
	if tr.Spans[1].CallerLabels["az"] != "a" || tr.Labels["az"] != "b" {
		t.Fatal("caller confused with request")
	}
	next := copyConfig(e.C)
	next.Groups[0].Resources[0].Labels = map[string]string{"az": "b"}
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	tr = e.AddRequest(1)
	e.Advance(100)
	near(t, tr.Spans[1].WorkCost.Duration, 40, 1e-9)
}
func TestLocalityLiveCostAndPlacementFreeze(t *testing.T) {
	c := single(1, 100)
	c.Groups[0].Labels = map[string]string{"az": "a"}
	c.RequestLabels = map[string]string{"az": "b"}
	c.Groups[0].Cost = cost("request", "az", 1, 3)
	e := engine(t, c)
	first := e.AddRequest(1)
	queued := e.AddRequest(1)
	e.Advance(50)
	next := copyConfig(e.C)
	next.Groups[0].Labels["az"] = "b"
	next.Groups[0].Cost.Mismatch = 5
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	e.Advance(500)
	near(t, first.Spans[0].WorkCost.Duration, 300, 1e-9)
	near(t, queued.Spans[0].WorkCost.Duration, 100, 1e-9)
	if first.Spans[0].Labels["az"] != "a" || queued.Spans[0].Labels["az"] != "b" {
		t.Fatal("execution placement not frozen")
	}
}
func TestLocalityRoutingAndRetryOrder(t *testing.T) {
	c := retryConfig()
	disabled := false
	c.Keepalive = &disabled
	c.Groups[0].Labels = map[string]string{"az": "a"}
	c.Groups[1].Count = 4
	c.Groups[1].Labels = map[string]string{"az": "b"}
	c.Groups[0].Timeout = 500
	c.Groups[0].Edges[0].Affinity = rule("caller", "az")
	c.Groups[0].Edges[0].NetworkCost = cost("caller", "az", 1, 3)
	c.Overrides = map[string]NodeConfig{"back-1": {Labels: map[string]string{"az": "a"}}, "back-3": {Labels: map[string]string{"az": "a"}}}
	e := engine(t, c)
	setFault(t, e, "back-1", "down")
	setFault(t, e, "back-3", "down")
	tr := e.AddRequest(1)
	e.Advance(600)
	sp := backSpans(tr)
	// Remote handshakes need 60 ms, exceeding the 30 ms connect timeout; the
	// network multiplier must be recomputed on each fallback, not reused locally.
	want := []string{"back-1", "back-3", "back-2", "back-4"}
	if len(sp) != len(want) {
		t.Fatalf("attempt count %d", len(sp))
	}
	for i, s := range sp {
		if s.Node != want[i] {
			t.Fatal("retry order", s.Node)
		}
		factor := 1.0
		if i >= 2 {
			factor = 3
		}
		near(t, s.NetworkDelay, 10*factor, 1e-9)
	}
	if tr.OK || tr.Reason != "connect_timeout" {
		t.Fatal("remote connect cost missing", tr.Reason)
	}
}
func TestLocalityFallbackAndStrictPreference(t *testing.T) {
	c := retryConfig()
	c.Groups[1].Count = 3
	c.Groups[1].Labels = map[string]string{"az": "b"}
	c.Groups[0].Labels = map[string]string{"az": "a"}
	c.Groups[0].Edges[0].Affinity = rule("caller", "az")
	c.Overrides = map[string]NodeConfig{"back-2": {Labels: map[string]string{"az": "a"}}}
	e := engine(t, c)
	for i := 0; i < 6; i++ {
		n := e.routeLocal("back", "round_robin", "test", c.Groups[0].Edges[0].Affinity, nil, map[string]string{"az": "a"})
		if n.ID != "back-2" {
			t.Fatal("non-local selected")
		}
	}
	n := e.routeLocal("back", "round_robin", "fallback", rule("caller", "az"), nil, map[string]string{"az": "c"})
	if n == nil {
		t.Fatal("fallback absent")
	}
	for _, mode := range []string{"round_robin", "random", "least_busy"} {
		n = e.routeLocal("back", mode, "test", rule("caller", "az"), nil, map[string]string{"az": "a"})
		if n.ID != "back-2" {
			t.Fatal(mode)
		}
	}
}
func TestLocalityGeneratorAndEntryAffinity(t *testing.T) {
	c := single(8, 1)
	c.Groups[0].Count = 2
	c.Groups[0].Labels = map[string]string{"az": "a"}
	c.Overrides = map[string]NodeConfig{"box-2": {Labels: map[string]string{"az": "b"}}}
	c.RequestTag = &TagGenerator{"az", "a", "b", 50}
	c.EntryAffinity = rule("request", "az")
	e := engine(t, c)
	counts := map[string]int{}
	for i := 0; i < 100; i++ {
		tr := e.AddRequest(1)
		e.Advance(5)
		counts[tr.Labels["az"]]++
		if tr.Spans[0].Labels["az"] != tr.Labels["az"] {
			t.Fatal("wrong entry node")
		}
	}
	if counts["a"] == 0 || counts["b"] == 0 {
		t.Fatal("distribution not sampled")
	}
}
func TestLocalityInstanceSharedInheritanceAndScale(t *testing.T) {
	c := resourceConfig("instance")
	c.Groups[0].Labels = map[string]string{"az": "a"}
	c.Overrides = map[string]NodeConfig{"box-2": {Labels: map[string]string{"az": "b"}}}
	e := engine(t, c)
	if e.nodeLabels(e.resources["box-2/~work"])["az"] != "b" {
		t.Fatal("resource did not inherit owner")
	}
	next := copyConfig(e.C)
	next.Groups[0].Count = 3
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	if e.nodeLabels(e.resources["box-3/~work"])["az"] != "a" {
		t.Fatal("new resource did not inherit")
	}
	c.Groups[0].Resources[0].Scope = "shared"
	e = engine(t, c)
	if e.nodeLabels(e.resources["box/~work"])["az"] != "a" {
		t.Fatal("shared label not from group")
	}
	next = copyConfig(e.C)
	next.Groups[0].Resources[0].Labels = map[string]string{"az": ""}
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	if _, ok := e.nodeLabels(e.resources["box/~work"])["az"]; ok {
		t.Fatal("empty label did not remove inheritance")
	}
}
func TestLocalityPresetsAndDeterminism(t *testing.T) {
	for _, c := range []Config{AZConfig(), NUMAConfig()} {
		data, _ := json.Marshal(c)
		var imported Config
		if err := json.Unmarshal(data, &imported); err != nil {
			t.Fatal(err)
		}
		a, b := engine(t, c), engine(t, imported)
		a.Advance(5000)
		b.Advance(5000)
		if a.JSON() != b.JSON() {
			t.Fatal("non-deterministic", c.Name)
		}
		if a.OK == 0 || a.Failed != 0 {
			t.Fatal("preset fails", c.Name, a.Failed)
		}
		for _, v := range a.Snapshot().Nodes {
			near(t, v.L, v.Little+v.Unfinished, 1e-8)
		}
	}
}
func TestLocalityValidation(t *testing.T) {
	for _, modify := range []func(*Config){func(c *Config) { c.RequestTag = &TagGenerator{"az", "a", "b", 101} }, func(c *Config) { c.Groups[0].Cost = cost("unknown", "az", 1, 3) }, func(c *Config) { c.Groups[0].Cost = cost("request", "az", 1, -3) }, func(c *Config) { c.Groups[0].Labels = map[string]string{"bad key": "a"} }, func(c *Config) {
		c.Groups[0].Edges[0].Route = "broadcast"
		c.Groups[0].Edges[0].Affinity = rule("caller", "az")
	}} {
		c := DefaultConfig()
		modify(&c)
		if Validate(c) == nil {
			t.Fatal("invalid locality accepted")
		}
	}
}

func TestLocalityRoundRobinIndependentSubsets(t *testing.T) {
	c := single(4, 1)
	c.Groups[0].Count = 4
	c.Groups[0].Labels = map[string]string{"az": "a"}
	c.Overrides = map[string]NodeConfig{"box-2": {Labels: map[string]string{"az": "b"}}, "box-4": {Labels: map[string]string{"az": "b"}}}
	e := engine(t, c)
	got := map[string]int{}
	for i := 0; i < 8; i++ {
		zone := "a"
		if i%2 == 1 {
			zone = "b"
		}
		n := e.routeLocal("box", "round_robin", "entry", rule("request", "az"), map[string]string{"az": zone}, nil)
		got[n.ID]++
	}
	for _, id := range []string{"box-1", "box-2", "box-3", "box-4"} {
		if got[id] != 2 {
			t.Fatalf("unbalanced subset: %v", got)
		}
	}
}

func TestLocalityDrainingKeepsPlacementAndCost(t *testing.T) {
	c := single(1, 100)
	c.Groups[0].Count = 2
	c.Groups[0].Labels = map[string]string{"az": "a"}
	c.RequestLabels = map[string]string{"az": "b"}
	c.EntryAffinity = rule("request", "az")
	c.Overrides = map[string]NodeConfig{"box-2": {Labels: map[string]string{"az": "b"}, Cost: cost("request", "az", 2, 3)}}
	e := engine(t, c)
	first := e.AddRequest(1)
	queued := e.AddRequest(1)
	e.Advance(10)
	next := copyConfig(e.C)
	next.Groups[0].Count = 1
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	e.Advance(500)
	if !first.OK || !queued.OK {
		t.Fatal("drain failed")
	}
	s := queued.Spans[0]
	if s.Labels["az"] != "b" || s.WorkCost.Factor != 2 {
		t.Fatalf("drain changed locality: %+v %+v", s.Labels, s.WorkCost)
	}
	next = copyConfig(e.C)
	next.Groups[0].Count = 2
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	n := e.Groups["box"][1]
	if e.nodeLabels(n)["az"] != "a" || e.nodeCost(n) != nil {
		t.Fatal("new slot did not inherit group")
	}
}

func TestNUMAPresetUsesBothNodes(t *testing.T) {
	for _, pinned := range []bool{false, true} {
		c := NUMAConfig()
		c.EntryAffinity.Enabled = pinned
		e := engine(t, c)
		e.Advance(10000)
		for _, n := range e.Nodes {
			if n.Arrivals < 500 {
				t.Fatalf("pinned=%v: %s received only %d requests", pinned, n.ID, n.Arrivals)
			}
		}
		remote, known := 0, 0
		for _, n := range e.Groups["memory"] {
			remote += n.CostRemote
			known += n.CostKnown
		}
		if known == 0 {
			t.Fatal("memory not used")
		}
		if pinned && remote != 0 {
			t.Fatalf("pinned requests used remote memory: %d", remote)
		}
		if !pinned && (remote < known/3 || remote > known*2/3) {
			t.Fatalf("expected local and remote accesses: %d/%d", remote, known)
		}
	}
}
