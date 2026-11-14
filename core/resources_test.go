package core

import (
	"encoding/json"
	"testing"
)

func resourceConfig(scope string) Config {
	c := single(8, 0)
	c.Groups[0].Count = 2
	c.Groups[0].Resources = []ResourceConfig{{ID: "work", Name: "Arbitrary resource", Scope: scope, Workers: 1, Service: 100, QueueLimit: 500, Stages: []Stage{}}}
	c.Groups[0].Stages = []Stage{{Calls: []Call{{Resource: "work", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}
	return c
}
func copyConfig(c Config) Config {
	data, _ := json.Marshal(c)
	var next Config
	json.Unmarshal(data, &next)
	return next
}
func TestResourcePrivateVersusShared(t *testing.T) {
	for _, scope := range []string{"instance", "shared"} {
		t.Run(scope, func(t *testing.T) {
			e := engine(t, resourceConfig(scope))
			a := e.AddRequest(1)
			b := e.AddRequest(1)
			e.Advance(500)
			if !a.OK || !b.OK {
				t.Fatal("requests failed")
			}
			want := 100.0
			if scope == "shared" {
				want = 200
			}
			near(t, b.End, want, .02)
			if len(e.Snapshot().Resources) != map[string]int{"instance": 2, "shared": 1}[scope] {
				t.Fatal("wrong ownership")
			}
			for _, v := range e.Snapshot().Resources {
				near(t, v.L, v.Little+v.Unfinished, 1e-9)
			}
		})
	}
}
func TestResourceSequenceReleasesBeforeDownstream(t *testing.T) {
	c := resourceConfig("instance")
	c.Groups[0].Count = 1
	c.Groups[0].Stages = []Stage{{Calls: []Call{{Resource: "work", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}, {Calls: []Call{{Target: "leaf", Calls: 1, Route: "round_robin", Transport: "network"}}, Join: "all"}, {Calls: []Call{{Resource: "work", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}
	c.Groups = append(c.Groups, Group{ID: "leaf", Name: "Leaf", Count: 1, Workers: 8, Service: 300, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 100, Stages: []Stage{}})
	e := engine(t, c)
	tr := e.AddRequest(1)
	e.Advance(200)
	if len(e.resources["box-1/~work"].Active) != 0 || len(e.Groups["box"][0].Active) != 1 {
		t.Fatal("resource held while downstream waits")
	}
	e.Advance(500)
	if !tr.OK {
		t.Fatal(tr.Reason)
	}
	near(t, tr.End, 500, .02)
	if len(tr.Spans) != 4 || tr.Spans[1].Resource != "work" || tr.Spans[3].Resource != "work" || tr.Spans[3].Start < tr.Spans[2].Reply {
		t.Fatal("wrong stage order")
	}
}
func TestResourceUtilizationIsWorkerTime(t *testing.T) {
	c := resourceConfig("instance")
	c.Groups[0].Count = 1
	c.Groups[0].Resources[0].Workers = 2
	e := engine(t, c)
	e.AddRequest(1)
	e.Advance(200)
	v := e.Snapshot().Resources[0]
	near(t, v.Utilization, 25, .01)
	next := copyConfig(e.C)
	next.Groups[0].Resources[0].Workers = 4
	e.Update(next)
	e.Advance(200)
	v = e.Snapshot().Resources[0]
	near(t, v.Utilization, 100.0/1200*100, .01)
}
func TestResourceWindowDropsOldWork(t *testing.T) {
	e := engine(t, resourceConfig("shared"))
	e.AddRequest(1)
	e.Advance(1000)
	b, c := e.loadWindow(e.resources["box/~work"], 500)
	near(t, b, 0, .01)
	near(t, c, 500, .01)
}
func TestResourceScaleBundlesDrainAndKeepHistory(t *testing.T) {
	c := resourceConfig("instance")
	c.Groups[0].Stages = []Stage{{Calls: []Call{{Resource: "work", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}, {Calls: []Call{{Resource: "work", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}
	c.Groups[0].Resources = append(c.Groups[0].Resources, ResourceConfig{ID: "shared", Name: "Common", Scope: "shared", Workers: 1, Service: 1, QueueLimit: 500, Stages: []Stage{}})
	e := engine(t, c)
	e.AddRequest(1)
	tr := e.AddRequest(1)
	e.Advance(50)
	if err := e.Update(scaledConfig(t, e, "box", 1)); err != nil {
		t.Fatal(err)
	}
	owned := e.resources["box-2/~work"]
	if !owned.Draining || owned.Retired {
		t.Fatal("owned resource disappeared early")
	}
	e.Advance(500)
	if !tr.OK || !owned.Retired {
		t.Fatal("drain did not complete sequence")
	}
	if err := e.Update(scaledConfig(t, e, "box", 3)); err != nil {
		t.Fatal(err)
	}
	if owned.Retired || e.resources["box-3/~work"] == nil {
		t.Fatal("resources not cloned with instances")
	}
	shared := 0
	for _, n := range e.Nodes {
		if n.Owner == "box" && n.Resource == "shared" {
			shared++
		}
	}
	if shared != 1 {
		t.Fatal("shared resource was duplicated")
	}
	for _, v := range e.Snapshot().Resources {
		near(t, v.L, v.Little+v.Unfinished, 1e-9)
	}
}
func TestResourceDrainWaitsForFutureStage(t *testing.T) {
	c := resourceConfig("instance")
	c.Groups[0].Stages = []Stage{{Calls: []Call{{Target: "leaf", Calls: 1, Route: "round_robin", Transport: "network"}}, Join: "all"}, {Calls: []Call{{Resource: "work", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}
	c.Groups = append(c.Groups, Group{ID: "leaf", Name: "Leaf", Count: 1, Workers: 8, Service: 300, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 100, Stages: []Stage{}})
	e := engine(t, c)
	e.AddRequest(1)
	tr := e.AddRequest(1)
	e.Advance(50)
	e.Update(scaledConfig(t, e, "box", 1))
	if e.resources["box-2/~work"].Retired {
		t.Fatal("retired idle resource still needed by accepted request")
	}
	e.Advance(500)
	if !tr.OK || !e.resources["box-2/~work"].Retired {
		t.Fatal("future stage lost during drain")
	}
}
func TestResourceDeadlineCancellation(t *testing.T) {
	for _, cancel := range []bool{true, false} {
		c := resourceConfig("shared")
		c.Deadline = 50
		c.Cancel = cancel
		e := engine(t, c)
		tr := e.AddRequest(1)
		e.Advance(60)
		if tr.Reason != "client_deadline" {
			t.Fatal(tr.Reason)
		}
		n := e.resources["box/~work"]
		if (len(n.Active) == 0) != cancel {
			t.Fatal("wrong cancellation propagation")
		}
		e.Advance(500)
		if tr.active != 0 {
			t.Fatal("leaked spans")
		}
	}
}
func TestResourceAutoscalingUsesSelectedResource(t *testing.T) {
	c := resourceConfig("instance")
	c.Groups[0].Count = 1
	c.RPS = 15
	p := DefaultAutoScale()
	p.Enabled = true
	p.Resource = "work"
	p.Signal = "utilization"
	p.UpUtilization = 60
	p.Window = 1000
	p.UpDelay = 500
	p.Cooldown = 500
	p.Max = 4
	c.Groups[0].AutoScale = p
	e := engine(t, c)
	e.Advance(10000)
	if len(e.Groups["box"]) < 2 || len(e.ScaleEvents) == 0 {
		t.Fatal("resource did not drive scaling")
	}
	if len(e.sensorNodes(e.C.Groups[0])) != len(e.Groups["box"]) {
		t.Fatal("wrong sensor ownership")
	}
	next := copyConfig(e.C)
	next.RPS = 0
	next.Groups[0].AutoScale.DownDelay = 500
	e.Update(next)
	e.Advance(10000)
	e.Advance(10000)
	if len(e.Groups["box"]) != 1 {
		t.Fatal("did not scale down after resource load fell")
	}
}
func TestResourceConfigValidationAndLiveEdits(t *testing.T) {
	c := resourceConfig("instance")
	e := engine(t, c)
	tr := e.AddRequest(1)
	e.Advance(10)
	next := copyConfig(e.C)
	next.Groups[0].Resources[0].Name = "Compression"
	next.Groups[0].Resources[0].Workers = 2
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	if e.Now != 10 || e.resources["box-1/~work"].ResourceName != "Compression" {
		t.Fatal("live edit reset experiment")
	}
	next = copyConfig(e.C)
	next.Groups[0].Resources[0].Scope = "shared"
	if e.Update(next) == nil {
		t.Fatal("ownership change must be explicit reset")
	}
	bad := copyConfig(e.C)
	bad.Groups[0].Stages = []Stage{{Calls: []Call{{Resource: "missing", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}
	if Validate(bad) == nil {
		t.Fatal("invalid stage accepted")
	}
	e.Advance(500)
	if !tr.OK {
		t.Fatal("live edit lost work")
	}
}

func TestResourceAfterQuorumCancelsRemainingStage(t *testing.T) {
	c := resourceConfig("instance")
	c.Groups[0].Count = 1
	c.Groups[0].Stages = []Stage{{Calls: []Call{{Target: "leaf", Calls: 1, Route: "broadcast", Transport: "network"}}, Join: "any"}, {Calls: []Call{{Resource: "work", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}
	c.Groups = append(c.Groups, Group{ID: "leaf", Name: "Leaf", Count: 2, Workers: 4, Service: 10, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 100, Stages: []Stage{}})
	e := engine(t, c)
	slow := 500.0
	e.SetNode("leaf-2", "", &slow, nil)
	tr := e.AddRequest(1)
	e.Advance(1000)
	if !tr.OK || tr.active != 0 {
		t.Fatal("sequence after any did not finish")
	}
	near(t, tr.End, 110, .02)
	if tr.Spans[2].Status != "cancelled" {
		t.Fatal("previous stage did not cancel slow sibling")
	}
}
func TestResourceFaultAndOverrideRoundTrip(t *testing.T) {
	e := engine(t, resourceConfig("shared"))
	v := 200.0
	slots := 2
	if err := e.SetNode("box/~work", "down", &v, &slots); err != nil {
		t.Fatal(err)
	}
	next := engine(t, copyConfig(e.C))
	n := next.resources["box/~work"]
	if n.State != "down" || n.Service != 200 || n.Workers != 2 {
		t.Fatal("resource override lost")
	}
	tr := next.AddRequest(1)
	next.Advance(500)
	if tr.OK || tr.active != 0 || n.Outstanding != 0 {
		t.Fatal("resource failure leaked work")
	}
}

func TestResourceScalingIsDeterministic(t *testing.T) {
	run := func() string {
		c := resourceConfig("instance")
		c.Groups[0].Resources = append(c.Groups[0].Resources, ResourceConfig{ID: "second", Name: "Second", Scope: "instance", Workers: 2, Service: 10, QueueLimit: 100, Stages: []Stage{}})
		c.Groups[0].Stages = []Stage{{Calls: []Call{{Resource: "work", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}, {Calls: []Call{{Resource: "second", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}
		e := engine(t, c)
		e.AddRequest(1)
		e.AddRequest(1)
		e.Advance(20)
		e.Update(scaledConfig(t, e, "box", 1))
		e.Advance(1000)
		return e.JSON()
	}
	if run() != run() {
		t.Fatal("same composite experiment diverged")
	}
}
