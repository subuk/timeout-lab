package core

import (
	"encoding/json"
	"math"
	"testing"
)

func single(workers int, service float64) Config {
	c := DefaultConfig()
	c.RPS = 0
	c.Network = 0
	c.Jitter = 0
	c.Spread = 0
	c.Entry = "box"
	c.Deadline = 60000
	c.Groups = []Group{{ID: "box", Name: "Box", Count: 1, Workers: workers, Service: service, Timeout: 10000, ConnectTimeout: 100, QueueLimit: 2000, Join: "all", Quorum: 1}}
	return c
}
func engine(t *testing.T, c Config) *Engine {
	t.Helper()
	e, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	return e
}
func near(t *testing.T, a, b, tol float64) {
	t.Helper()
	if math.Abs(a-b) > tol {
		t.Fatalf("got %.8f want %.8f tolerance %.8f", a, b, tol)
	}
}
func TestWeightedServiceAndTrace(t *testing.T) {
	e := engine(t, single(1, 100))
	tr := e.AddRequest(2)
	e.Advance(500)
	if !tr.OK {
		t.Fatal(tr.Reason)
	}
	near(t, tr.End-tr.Start, 200, .01)
	near(t, tr.Spans[0].End-tr.Spans[0].WorkStart, 200, .001)
}
func TestFIFOAndCapacity(t *testing.T) {
	e := engine(t, single(1, 100))
	a := e.AddRequest(1)
	b := e.AddRequest(1)
	e.Advance(250)
	if !a.OK || !b.OK {
		t.Fatal("requests failed")
	}
	near(t, b.Spans[0].WorkStart-b.Spans[0].Arrive, 100, .01)
	near(t, b.End-a.End, 100, .01)
}
func TestLittleFiniteHorizon(t *testing.T) {
	e := engine(t, single(2, 100))
	for i := 0; i < 20; i++ {
		e.AddRequest(1)
	}
	e.Advance(250)
	n := e.Snapshot().Nodes[0]
	near(t, n.L, n.Little+n.Unfinished, 1e-9)
	if n.Unfinished <= 0 || n.Queue == 0 {
		t.Fatal("must include unfinished work")
	}
	e.Advance(1500)
	n = e.Snapshot().Nodes[0]
	near(t, n.L, n.Lambda*n.MeanW/1000, 1e-9)
	if n.Exited != 20 {
		t.Fatal(n.Exited)
	}
}
func TestOverloadQueueGrowth(t *testing.T) {
	e := engine(t, single(2, 100))
	for i := 0; i < 250; i++ {
		e.AddRequest(1)
		e.Advance(20)
	}
	n := e.Snapshot().Nodes[0]
	if n.Queue < 145 || n.Queue > 152 {
		t.Fatalf("queue=%d expected about 150", n.Queue)
	}
}
func TestDeadlineCancellation(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		c := single(1, 1000)
		c.Deadline = 100
		c.Cancel = cancel
		e := engine(t, c)
		tr := e.AddRequest(1)
		e.Advance(200)
		if tr.OK || tr.Reason != "client_deadline" {
			t.Fatalf("%+v", tr)
		}
		active := len(e.Nodes[0].Active)
		if cancel && active != 0 {
			t.Fatal("cancel did not release worker")
		}
		if !cancel && active != 1 {
			t.Fatal("work must survive timeout")
		}
		e.Advance(1500)
		if e.Failed != 1 || e.OK != 0 || e.Pending != 0 {
			t.Fatal("double counted result")
		}
		near(t, e.Snapshot().Nodes[0].L, e.Snapshot().Nodes[0].Little, 1e-8)
	}
}
func TestFanoutAndParentTiming(t *testing.T) {
	c := single(5, 10)
	c.Groups[0].Edges = []Edge{{Target: "leaf", Calls: 3, Route: "round_robin"}}
	c.Groups = append(c.Groups, Group{ID: "leaf", Name: "Leaf", Count: 3, Workers: 1, Service: 100, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 100, Join: "all", Quorum: 1})
	e := engine(t, c)
	tr := e.AddRequest(1)
	e.Advance(500)
	if !tr.OK || len(tr.Spans) != 4 {
		t.Fatalf("trace=%+v", tr)
	}
	near(t, tr.End-tr.Start, 110, .02)
	for _, n := range e.Nodes[1:] {
		if n.Exited != 1 {
			t.Fatal("bad distribution", n.ID, n.Exited)
		}
	}
}
func TestQuorumCancelsSlowSibling(t *testing.T) {
	c := single(5, 10)
	c.Groups[0].Join = "quorum"
	c.Groups[0].Quorum = 2
	c.Groups[0].Edges = []Edge{{Target: "leaf", Calls: 1, Route: "broadcast"}}
	c.Groups = append(c.Groups, Group{ID: "leaf", Name: "Leaf", Count: 3, Workers: 1, Service: 100, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 100, Join: "all", Quorum: 1})
	e := engine(t, c)
	v := 1000.
	e.SetNode("leaf-3", "", &v, nil)
	tr := e.AddRequest(1)
	e.Advance(500)
	if !tr.OK {
		t.Fatal(tr.Reason)
	}
	near(t, tr.End-tr.Start, 110, .02)
	if len(e.Nodes[3].Active) != 0 {
		t.Fatal("quorum should cancel remaining work")
	}
}
func TestConnectVersusRequestTimeout(t *testing.T) {
	for _, state := range []string{"blackhole", "hang"} {
		c := single(1, 100)
		c.Network = 5
		c.Deadline = 500
		c.Groups[0].ConnectTimeout = 100
		e := engine(t, c)
		e.SetNode("box-1", state, nil, nil)
		tr := e.AddRequest(1)
		e.Advance(600)
		want := "connect_timeout"
		if state == "hang" {
			want = "client_deadline"
		}
		if tr.Reason != want {
			t.Fatalf("%s got %s", state, tr.Reason)
		}
	}
}
func TestValidationCycles(t *testing.T) {
	c := single(1, 1)
	c.Groups[0].Edges = []Edge{{Target: "box", Calls: 1, Route: "round_robin"}}
	if Validate(c) == nil {
		t.Fatal("cycle accepted")
	}
}
func TestDeterministic(t *testing.T) {
	c := DefaultConfig()
	a := engine(t, c)
	b := engine(t, c)
	a.Advance(10000)
	b.Advance(10000)
	if a.JSON() != b.JSON() {
		t.Fatal("same seed diverged")
	}
}
func TestDefaultSteadyState(t *testing.T) {
	e := engine(t, DefaultConfig())
	for i := 0; i < 6; i++ {
		e.Advance(10000)
	}
	m := e.metrics()
	if m.ErrorRate != 0 || m.Goodput < 180 || m.Goodput > 220 {
		t.Fatalf("unexpected default metrics %+v", m)
	}
	for _, n := range e.Snapshot().Nodes {
		near(t, n.L, n.Little+n.Unfinished, 1e-7)
	}
}

func TestIndividualOverridesSurviveReset(t *testing.T) {
	e := engine(t, DefaultConfig())
	v := 600.
	w := 3
	e.SetNode("db-1", "hang", &v, &w)
	b := engine(t, e.C)
	n := b.Groups["db"][0]
	if n.Service != 600 || n.Workers != 3 || n.State != "hang" {
		t.Fatalf("override lost %+v", n)
	}
}
func TestGroupCanClearIndividualOverride(t *testing.T) {
	e := engine(t, DefaultConfig())
	v := 600.
	e.SetNode("db-1", "", &v, nil)
	c := e.C
	o := c.Overrides["db-1"]
	o.Service = nil
	c.Overrides["db-1"] = o
	if err := e.Update(c); err != nil {
		t.Fatal(err)
	}
	if e.Groups["db"][0].Service != DefaultConfig().Groups[2].Service {
		t.Fatal("group value did not apply")
	}
}
func TestLatencyCapture(t *testing.T) {
	c := single(1, 100)
	c.Network = 10
	e := engine(t, c)
	tr := e.AddRequest(1)
	e.Advance(40)
	next := e.C
	next.Network = 200
	e.Update(next)
	e.Advance(400)
	near(t, tr.End-tr.Start, 140, .01)
}
func TestRecovery(t *testing.T) {
	e := engine(t, single(1, 100))
	e.SetNode("box-1", "hang", nil, nil)
	tr := e.AddRequest(1)
	e.Advance(200)
	if tr.done {
		t.Fatal("must be waiting")
	}
	e.SetNode("box-1", "healthy", nil, nil)
	e.Advance(200)
	if !tr.OK {
		t.Fatal("did not recover")
	}
}

func scaledConfig(t *testing.T, e *Engine, group string, count int) Config {
	t.Helper()
	var c Config
	if err := json.Unmarshal([]byte(mustJSON(e.C)), &c); err != nil {
		t.Fatal(err)
	}
	for i := range c.Groups {
		if c.Groups[i].ID == group {
			c.Groups[i].Count = count
		}
	}
	return c
}
func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
func TestScaleUpPreservesExperimentAndQueues(t *testing.T) {
	e := engine(t, single(1, 100))
	first := e.AddRequest(1)
	e.Advance(200)
	for i := 0; i < 10; i++ {
		e.AddRequest(1)
	}
	e.Advance(10)
	now, arrivals, next, rng, seq := e.Now, e.Arrivals, e.nextTrace, e.rng, e.seq
	old := e.Nodes[0]
	queue := len(old.Queue)
	area := old.Area
	if err := e.Update(scaledConfig(t, e, "box", 3)); err != nil {
		t.Fatal(err)
	}
	if e.Now != now || e.Arrivals != arrivals || e.nextTrace != next || e.rng != rng || e.seq != seq || len(old.Queue) != queue || old.Area != area || e.Recent[0] != first {
		t.Fatal("scale-up reset existing state")
	}
	if len(e.Groups["box"]) != 3 || len(e.Groups["box"][1].Visits) != 0 {
		t.Fatal("new capacity missing or backlog migrated")
	}
	seen := map[string]bool{}
	for i := 0; i < 3; i++ {
		tr := e.AddRequest(1)
		seen[tr.Spans[0].Node] = true
	}
	if len(seen) != 3 {
		t.Fatal("new nodes did not receive traffic", seen)
	}
	e.Advance(2000)
	for _, n := range e.Snapshot().Nodes {
		near(t, n.L, n.Little+n.Unfinished, 1e-8)
	}
}
func TestScaleDownDrainsNetworkAndQueuedWork(t *testing.T) {
	c := single(1, 100)
	c.Groups[0].Count = 2
	c.Network = 10
	e := engine(t, c)
	var old []*Trace
	for i := 0; i < 6; i++ {
		old = append(old, e.AddRequest(1))
	}
	e.Advance(5)
	removed := e.Groups["box"][1]
	if len(removed.Visits) != 0 || removed.Outstanding != 3 {
		t.Fatal("test requires in-flight inbound calls")
	}
	if err := e.Update(scaledConfig(t, e, "box", 1)); err != nil {
		t.Fatal(err)
	}
	if !removed.Draining || removed.Retired || len(e.Groups["box"]) != 1 {
		t.Fatal("in-flight work was dropped")
	}
	for i := 0; i < 3; i++ {
		tr := e.AddRequest(1)
		if tr.Spans[0].Node != "box-1" {
			t.Fatal("routed to draining node")
		}
	}
	e.Advance(1000)
	for _, tr := range old {
		if !tr.OK {
			t.Fatal("accepted request failed during drain", tr.Reason)
		}
	}
	if !removed.Retired || removed.Outstanding != 0 || removed.Exited != 3 || e.Failed != 0 {
		t.Fatal("drain did not complete cleanly")
	}
	for _, n := range e.Snapshot().Nodes {
		near(t, n.L, n.Little+n.Unfinished, 1e-8)
	}
}
func TestScaleDownKeepsHungDrainAndCanReactivate(t *testing.T) {
	c := single(1, 100)
	c.Groups[0].Count = 2
	c.Cancel = false
	e := engine(t, c)
	e.SetNode("box-2", "hang", nil, nil)
	e.AddRequest(1)
	tr := e.AddRequest(1)
	e.Advance(20)
	n := e.Groups["box"][1]
	if err := e.Update(scaledConfig(t, e, "box", 1)); err != nil {
		t.Fatal(err)
	}
	e.Advance(200)
	if !n.Draining || n.Retired || tr.done {
		t.Fatal("hung work disappeared")
	}
	if err := e.Update(scaledConfig(t, e, "box", 2)); err != nil {
		t.Fatal(err)
	}
	if e.Groups["box"][1] != n || n.Draining || len(n.Active) != 1 {
		t.Fatal("reactivation lost pending work")
	}
	e.SetNode("box-2", "healthy", nil, nil)
	e.Advance(200)
	if !tr.OK {
		t.Fatal("reactivated work did not finish")
	}
}
func TestScaleDownRejectsImpossibleQuorumAtomically(t *testing.T) {
	c := single(2, 1)
	c.Groups[0].Join = "quorum"
	c.Groups[0].Quorum = 2
	c.Groups[0].Edges = []Edge{{Target: "leaf", Calls: 1, Route: "broadcast"}}
	leaf := c.Groups[0]
	leaf.ID = "leaf"
	leaf.Count = 3
	leaf.Join = "all"
	leaf.Edges = nil
	c.Groups = append(c.Groups, leaf)
	e := engine(t, c)
	e.AddRequest(1)
	e.Advance(.5)
	before := e.JSON()
	if e.Update(scaledConfig(t, e, "leaf", 1)) == nil {
		t.Fatal("impossible quorum accepted")
	}
	if e.JSON() != before {
		t.Fatal("rejected scale changed experiment")
	}
}
func TestScaleUpRelievesOverload(t *testing.T) {
	c := single(2, 100)
	c.RPS = 50
	e := engine(t, c)
	e.Advance(5000)
	before := e.metrics()
	if before.Queue < 100 {
		t.Fatal("expected overloaded queue")
	}
	if err := e.Update(scaledConfig(t, e, "box", 4)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		e.Advance(10000)
	}
	after := e.metrics()
	if e.Now != 35000 || after.Goodput < 40 || after.Queue > 20 || after.Arrivals < before.Arrivals {
		t.Fatalf("scale failed: before=%+v after=%+v", before, after)
	}
}
func TestRetiredNodesKeepHistoryWithoutRoutingCapacity(t *testing.T) {
	c := single(1, 10)
	c.Groups[0].Count = 2
	e := engine(t, c)
	e.AddRequest(1)
	e.AddRequest(1)
	e.Advance(100)
	retired := e.Groups["box"][1]
	exited := retired.Exited
	if err := e.Update(scaledConfig(t, e, "box", 1)); err != nil {
		t.Fatal(err)
	}
	if !retired.Retired || e.metrics().Capacity != 1 {
		t.Fatal("retired node still contributes capacity")
	}
	if err := e.Update(scaledConfig(t, e, "box", 2)); err != nil {
		t.Fatal(err)
	}
	if len(e.Nodes) != 2 || retired.Exited != exited || retired.State != "healthy" {
		t.Fatal("reactivation erased history or duplicated node")
	}
}
