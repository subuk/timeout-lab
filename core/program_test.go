package core

import (
	"encoding/json"
	"reflect"
	"testing"
)

func nestedConfig() Config {
	c := single(8, 0)
	c.Groups[0].Resources = []ResourceConfig{
		{ID: "app", Name: "Application", Scope: "instance", Workers: 4, QueueLimit: 100,
			Stages: []Stage{{Calls: []Call{{Resource: "../cpu", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}, {Calls: []Call{{Resource: "../disk", Calls: 1, Route: "round_robin", When: map[string]string{"op": "write"}, Transport: "ideal"}}, Join: "all"}, {Calls: []Call{{Resource: "../cpu", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}},
		{ID: "cpu", Name: "CPU", Scope: "instance", Workers: 1, Service: 10, QueueLimit: 100,
			Resources: []ResourceConfig{{ID: "memory", Name: "Memory", Scope: "instance", Workers: 1, Service: 5, QueueLimit: 100, Stages: []Stage{}}}, Stages: []Stage{{Calls: []Call{{Resource: "memory", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}},
		},
		{ID: "disk", Name: "Disk", Scope: "shared", Workers: 1, Service: 50, QueueLimit: 100, Stages: []Stage{}},
	}
	c.Groups[0].Stages = []Stage{{Calls: []Call{{Resource: "app", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}
	return c
}
func TestNestedProgramsChoosePathByRequestTags(t *testing.T) {
	e := engine(t, nestedConfig())
	for _, op := range []string{"read", "write", "other"} {
		tr := e.addRequest(1, 1000, map[string]string{"op": op}, true)
		e.Advance(200)
		if !tr.OK {
			t.Fatal(op, tr.Reason)
		}
		disk := 0
		for _, s := range tr.Spans {
			if s.Resource == "disk" {
				disk++
			}
			if s.Resource != "" && s.Connection != "" {
				t.Fatal("ideal resource made a connection")
			}
		}
		want := 30.002
		if op == "write" {
			want += 50
			if disk != 1 {
				t.Fatal("write skipped disk")
			}
		} else if disk != 0 {
			t.Fatal("unmatched call executed")
		}
		near(t, tr.End-tr.Start, want, .000001)
	}
	for _, v := range e.Snapshot().Resources {
		near(t, v.L, v.Little+v.Unfinished, 1e-9)
	}
}
func TestNestedProgramsSharedQueueAndPrivateCopies(t *testing.T) {
	c := nestedConfig()
	c.Groups[0].Count = 2
	e := engine(t, c)
	a := e.addRequest(1, 1000, map[string]string{"op": "write"}, false)
	b := e.addRequest(1, 1000, map[string]string{"op": "write"}, false)
	e.Advance(250)
	if !a.OK || !b.OK {
		t.Fatal(a.Reason, b.Reason)
	}
	near(t, b.End-a.End, 50, 1e-9)
	if len(e.resources) != 7 {
		t.Fatal("expected 6 private boxes and one shared disk", len(e.resources))
	}
	if e.resources["box-2/~cpu/~memory"].Arrivals != 2 || e.resources["box/~disk"].Arrivals != 2 {
		t.Fatal("wrong ownership")
	}
}
func TestNestedProgramsDrainFutureSiblingAndDescendantCalls(t *testing.T) {
	for _, cancel := range []bool{true, false} {
		c := nestedConfig()
		c.Groups[0].Count = 2
		c.Cancel = cancel
		e := engine(t, c)
		e.addRequest(1, 1000, map[string]string{"op": "write"}, false)
		tr := e.addRequest(1, 1000, map[string]string{"op": "write"}, false)
		e.Advance(1)
		next := copyConfig(e.C)
		next.Groups[0].Count = 1
		if err := e.Update(next); err != nil {
			t.Fatal(err)
		}
		if e.resources["box-2/~cpu/~memory"].Retired {
			t.Fatal("future descendant retired")
		}
		e.Advance(300)
		if !tr.OK {
			t.Fatal("lost accepted work", tr.Reason)
		}
		for _, n := range e.Nodes {
			if n.Index == 2 && !n.Retired {
				t.Fatal("bundle did not retire", n.ID)
			}
		}
		if e.resources["box/~disk"].Retired {
			t.Fatal("shared resource retired")
		}
	}
}
func TestNestedProgramsDetachedWorkKeepsBundle(t *testing.T) {
	c := nestedConfig()
	c.Groups[0].Count = 2
	c.Cancel = false
	e := engine(t, c)
	e.addRequest(1, 5, map[string]string{"op": "write"}, false)
	tr := e.addRequest(1, 5, map[string]string{"op": "write"}, false)
	e.Advance(6)
	next := copyConfig(e.C)
	next.Groups[0].Count = 1
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	if tr.Reason != "client_deadline" {
		t.Fatal(tr.Reason)
	}
	e.Advance(300)
	if tr.active != 0 || e.resources["box-2/~cpu/~memory"].Arrivals != 2 {
		t.Fatal("orphaned downstream work")
	}
	for _, n := range e.Nodes {
		if n.Index == 2 && !n.Retired {
			t.Fatal(n.ID)
		}
	}
}
func TestNestedBoxNetworkConnectionsAndIndependentBudget(t *testing.T) {
	c := nestedConfig()
	timeout := 20.0
	delay := 3.0
	c.Groups = append(c.Groups, Group{ID: "remote", Name: "Remote", Count: 1, Workers: 4, Service: 1, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 10, Stages: []Stage{}})
	app := &c.Groups[0].Resources[0]
	app.Timeout = &timeout
	app.Stages = []Stage{{Calls: []Call{{Target: "remote", Calls: 1, Route: "round_robin", Network: &delay, Transport: "network"}}, Join: "all"}}
	e := engine(t, c)
	a := e.AddRequest(1)
	e.Advance(50)
	b := e.AddRequest(1)
	e.Advance(50)
	if !a.OK || !b.OK || a.Spans[2].Connection != "new" || b.Spans[2].Connection != "reused" {
		t.Fatal("nested caller connection reuse")
	}
	near(t, (a.End-a.Start)-(b.End-b.Start), 6, 1e-9)
	next := copyConfig(e.C)
	next.Groups[1].Service = 50
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	failed := e.AddRequest(1)
	e.Advance(60)
	if failed.Reason != "request_timeout" {
		t.Fatal(failed.Reason)
	}
}
func TestNetworkZeroAndIdealLinks(t *testing.T) {
	for _, transport := range []string{"network", "ideal"} {
		c := single(4, 1)
		c.Groups = append(c.Groups, Group{ID: "leaf", Name: "Leaf", Count: 1, Workers: 4, Service: 2, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 10, Stages: []Stage{}})
		zero := 0.0
		c.Groups[0].Stages = []Stage{{Calls: []Call{{Target: "leaf", Calls: 1, Route: "round_robin", Transport: transport, Network: &zero}}, Join: "all"}}
		e := engine(t, c)
		for i := 0; i < 2; i++ {
			tr := e.AddRequest(1)
			e.Advance(10)
			if !tr.OK {
				t.Fatal(tr.Reason)
			}
			near(t, tr.End-tr.Start, 3, 1e-12)
			child := tr.Spans[1]
			near(t, child.Arrive, child.Start, 1e-12)
			if (child.Connection == "") != (transport == "ideal") {
				t.Fatal("wrong transport", transport, child.Connection)
			}
		}
	}
}
func TestConditionalStagesParallelJoinAndSequentialRevisit(t *testing.T) {
	c := nestedConfig()
	app := &c.Groups[0].Resources[0]
	app.Stages = []Stage{
		{When: map[string]string{"op": "read"}, Calls: []Call{{Resource: "../cpu", Calls: 1, Route: "round_robin", Transport: "ideal"}, {Resource: "../disk", Calls: 1, Route: "round_robin", Transport: "ideal"}}, Join: "any"},
		{Calls: []Call{{Resource: "../cpu", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"},
	}
	e := engine(t, c)
	tr := e.addRequest(1, 1000, map[string]string{"op": "read"}, true)
	e.Advance(100)
	if !tr.OK {
		t.Fatal(tr.Reason)
	}
	near(t, tr.End-tr.Start, 30.002, 1e-9)
	if e.resources["box/~disk"].Errors != 1 {
		t.Fatal("any did not cancel slow branch")
	}
	for _, s := range tr.Spans {
		if s.Parent == 2 && s.Resource == "cpu" && s.Start > 1 && s.Status != "ok" {
			t.Fatal("next stage cancelled")
		}
	}
	tr = e.addRequest(1, 1000, nil, true)
	e.Advance(100)
	near(t, tr.End-tr.Start, 15.002, 1e-9)
	found := false
	for _, event := range tr.Events {
		if event.Kind == "Stage skipped" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing skip event")
	}
}
func TestConditionalQuorumCannotHang(t *testing.T) {
	c := nestedConfig()
	app := &c.Groups[0].Resources[0]
	app.Stages = []Stage{{Join: "quorum", Quorum: 2, Calls: []Call{
		{Resource: "../cpu", Calls: 1, Route: "round_robin", Transport: "ideal"},
		{Resource: "../disk", Calls: 1, Route: "round_robin", When: map[string]string{"op": "write"}, Transport: "ideal"},
	}}}
	e := engine(t, c)
	tr := e.addRequest(1, 1000, map[string]string{"op": "read"}, false)
	e.Advance(10)
	if tr.Reason != "quorum_unreachable" || tr.active != 0 {
		t.Fatal(tr.Reason, tr.active)
	}
}
func TestProgramsValidationAndAtomicLiveUpdate(t *testing.T) {
	visit := func(path string) Stage {
		return Stage{Calls: []Call{{Resource: path, Calls: 1, Route: "round_robin", Transport: "ideal"}}, Join: "all"}
	}
	for name, edit := range map[string]func(*Config){
		"cycle":             func(c *Config) { c.Groups[0].Resources[1].Stages = []Stage{visit("../app")} },
		"missing":           func(c *Config) { c.Groups[0].Resources[0].Stages = []Stage{visit("../../none")} },
		"ambiguous":         func(c *Config) { c.Groups[0].Stages[0].Calls[0].Target = "box" },
		"shared to private": func(c *Config) { c.Groups[0].Resources[2].Stages = []Stage{visit("../cpu")} },
		"nested timeout":    func(c *Config) { v := -1.0; c.Groups[0].Resources[1].Resources[0].Timeout = &v },
		"nested tags": func(c *Config) {
			stage := visit("../../disk")
			stage.When = map[string]string{"bad key": "x"}
			c.Groups[0].Resources[1].Resources[0].Stages = []Stage{stage}
		},
		"nested fanout": func(c *Config) {
			stage := visit("../cpu")
			stage.Calls[0].Calls = 16
			for i := 0; i < 3; i++ {
				stage.Calls = append(stage.Calls, stage.Calls[0])
			}
			c.Groups[0].Resources[0].Stages = []Stage{stage}
			c.Groups[0].Stages = []Stage{visit("app"), visit("app"), visit("app"), visit("app"), visit("app")}
		},
	} {
		t.Run(name, func(t *testing.T) {
			c := nestedConfig()
			edit(&c)
			if _, err := New(c); err == nil {
				t.Fatal("invalid program accepted")
			}
		})
	}
	e := engine(t, nestedConfig())
	e.AddRequest(1)
	e.Advance(5)
	before := e.JSON()
	bad := copyConfig(e.C)
	bad.Groups[0].Resources[0].Stages[0].Calls[0].Resource = "../missing"
	if e.Update(bad) == nil || e.JSON() != before {
		t.Fatal("invalid update changed state")
	}
	next := copyConfig(e.C)
	next.Groups[0].Resources[1].Resources[0].Workers = 2
	next.Groups[0].Resources[0].Stages[1].Calls[0].When = map[string]string{"op": "read"}
	if err := e.Update(next); err != nil || e.Now != 5 {
		t.Fatal("live edit", err)
	}
	var round Config
	data, _ := json.Marshal(e.C)
	if err := json.Unmarshal(data, &round); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(round, e.C) {
		t.Fatal("program JSON round trip")
	}
}
func TestProgramsDeepCompositionAndAdvanceIndependence(t *testing.T) {
	c := single(8, 1)
	r := ResourceConfig{ID: "box", Name: "Box", Scope: "instance", Workers: 2, Service: 1, QueueLimit: 100, Stages: []Stage{}}
	for i := 0; i < 24; i++ {
		r = ResourceConfig{ID: "box", Name: "Box", Scope: "instance", Workers: 2, Service: 1, QueueLimit: 100, Resources: []ResourceConfig{r}, Stages: []Stage{{Calls: []Call{{Resource: r.ID, Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}}
	}
	c.Groups[0].Resources = []ResourceConfig{r}
	c.Groups[0].Stages = []Stage{{Calls: []Call{{Resource: r.ID, Calls: 1, Route: "round_robin", Transport: "ideal"}}, Join: "all"}}
	a, b := engine(t, c), engine(t, copyConfig(c))
	tr := a.AddRequest(1)
	b.AddRequest(1)
	a.Advance(100)
	for i := 0; i < 1000; i++ {
		b.Advance(.1)
	}
	if !tr.OK || len(tr.Spans) != 26 {
		t.Fatal("deep composition failed", tr.Reason, len(tr.Spans))
	}
	near(t, tr.End, 26, 1e-9)
	left, _ := json.Marshal(a.Recent)
	right, _ := json.Marshal(b.Recent)
	if string(left) != string(right) {
		t.Fatal("playback changed execution")
	}
}

func TestProgramsEmptyPlanSurvivesExport(t *testing.T) {
	c := nestedConfig()
	c.Groups[0].Resources[0].Stages = []Stage{}
	c.Groups[0].Resources[0].Resources = []ResourceConfig{{ID: "unused", Name: "Unused", Scope: "instance", Workers: 1, Service: 100, QueueLimit: 10, Stages: []Stage{}}}
	e := engine(t, copyConfig(c))
	tr := e.AddRequest(1)
	e.Advance(10)
	if !tr.OK || len(tr.Spans) != 2 {
		t.Fatal("empty plan turned into implicit visits", tr.Reason, len(tr.Spans))
	}
}
func TestProgramsCaptureSettingsWhenStageStarts(t *testing.T) {
	e := engine(t, nestedConfig())
	tr := e.addRequest(1, 1000, map[string]string{"op": "read"}, false)
	e.Advance(5)
	next := copyConfig(e.C)
	next.Groups[0].Resources[0].Stages[1].Calls[0].When = map[string]string{"op": "read"}
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	e.Advance(100)
	if !tr.OK || e.resources["box/~disk"].Arrivals != 1 {
		t.Fatal("not-yet-started stage did not see live settings")
	}
}
func TestProgramsNestedCallerRetriesAndKeepaliveUpdates(t *testing.T) {
	c := nestedConfig()
	net := 5.0
	c.Groups = append(c.Groups, Group{ID: "remote", Name: "Remote", Count: 2, Workers: 4, Service: 1, Timeout: 500, ConnectTimeout: 100, QueueLimit: 10, Stages: []Stage{}})
	c.Groups[0].Resources[0].Stages = []Stage{{Calls: []Call{{Target: "remote", Calls: 1, Route: "round_robin", Network: &net, Transport: "network"}}, Join: "all"}}
	e := engine(t, c)
	setFault(t, e, "remote-1", "down")
	tr := e.AddRequest(1)
	e.Advance(100)
	if !tr.OK || len(tr.Spans) != 4 || tr.Spans[2].Status != "connection_refused" || tr.Spans[3].Attempt != 2 {
		t.Fatal("nested caller did not retry")
	}
	next := copyConfig(e.C)
	no := false
	next.Groups[0].Resources[0].Keepalive = &no
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	if e.connections["box-1/~app>remote-2"] != nil || e.connections["client>box-1"] == nil {
		t.Fatal("nested keepalive edit affected wrong caller")
	}
}
func TestProgramsNestedSharedOwnershipLabelsAndAutoscaleSensor(t *testing.T) {
	c := nestedConfig()
	c.Groups[0].Count = 2
	cpu := &c.Groups[0].Resources[1]
	cpu.Labels = map[string]string{"rack": "private"}
	cpu.Resources[0].Scope = "shared"
	c.Groups[0].Labels = map[string]string{"rack": "group"}
	c.Groups[0].AutoScale = DefaultAutoScale()
	c.Groups[0].AutoScale.Resource = "cpu/memory"
	e := engine(t, c)
	nodes := e.sensorNodes(e.C.Groups[0])
	if len(nodes) != 1 || nodes[0].ID != "box/~cpu/~memory" || e.nodeLabels(nodes[0])["rack"] != "group" {
		t.Fatal("nested shared ownership or labels wrong")
	}
	for i := 0; i < 2; i++ {
		e.AddRequest(1)
	}
	e.Advance(100)
	if nodes[0].Arrivals != 4 {
		t.Fatal("both private CPUs must use one shared memory")
	}
}
func TestCompositionPresetRoundTripAndTagPaths(t *testing.T) {
	e := engine(t, copyConfig(CompositionConfig()))
	e.SetManualMode(true)
	for _, op := range []string{"read", "write"} {
		tr, err := e.SendRequest(RequestOptions{Weight: 1, Deadline: 1000, Labels: map[string]string{"op": op}})
		if err != nil {
			t.Fatal(err)
		}
		e.Advance(1000)
		if !tr.OK {
			t.Fatal(tr.Reason)
		}
		groups := map[string]bool{}
		for _, sp := range tr.Spans {
			groups[sp.node.Group] = true
		}
		if groups["cache"] != (op == "read") || groups["db"] != (op == "write") || !groups["audit"] {
			t.Fatal("wrong tagged path", op, groups)
		}
	}
}

func TestProgramStagesRouteIndependently(t *testing.T) {
	c := single(8, 1)
	for _, id := range []string{"a", "b"} {
		c.Groups = append(c.Groups, Group{ID: id, Name: id, Count: 2, Workers: 4, Service: 1, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 10, Stages: []Stage{}})
		c.Groups[0].Stages = append(c.Groups[0].Stages, Stage{Calls: []Call{{Target: id, Calls: 1, Route: "round_robin", Transport: "network"}}, Join: "all"})
	}
	e := engine(t, c)
	for i := 0; i < 4; i++ {
		e.AddRequest(1)
		e.Advance(20)
	}
	for _, id := range []string{"a", "b"} {
		for _, n := range e.Groups[id] {
			if n.Arrivals != 2 {
				t.Fatal("stage routing biased toward one node", n.ID, n.Arrivals)
			}
		}
	}
}

func TestCallTimeoutOverridesApplyToEveryTargetAndTransport(t *testing.T) {
	for _, internal := range []bool{false, true} {
		for _, transport := range []string{"network", "ideal"} {
			for _, timeout := range []*float64{nil, new(float64), func() *float64 { v := 5.0; return &v }()} {
				c := single(4, 1)
				c.Groups[0].Timeout = 10
				call := Call{Calls: 1, Route: "round_robin", Transport: transport, Timeout: timeout}
				if internal {
					c.Groups[0].Resources = []ResourceConfig{{ID: "leaf", Name: "Leaf", Scope: "instance", Workers: 4, Service: 100, QueueLimit: 10, Stages: []Stage{}}}
					call.Resource = "leaf"
				} else {
					c.Groups = append(c.Groups, Group{ID: "leaf", Name: "Leaf", Count: 1, Workers: 4, Service: 100, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 10, Stages: []Stage{}})
					call.Target = "leaf"
				}
				c.Groups[0].Stages = []Stage{{Calls: []Call{call}, Join: "all"}}
				e := engine(t, copyConfig(c))
				tr := e.AddRequest(1)
				e.Advance(200)
				want, ok := 11.0, false
				if timeout != nil {
					want = 1 + *timeout
					if *timeout == 0 {
						want, ok = 101, true
					}
				}
				if tr.OK != ok || (!ok && tr.Reason != "request_timeout") {
					t.Fatal(internal, transport, tr.Reason)
				}
				near(t, tr.End, want, 1e-9)
				if timeout != nil && *timeout == 0 {
					tr = e.addRequest(1, 20, nil, false)
					e.Advance(200)
					if tr.Reason != "client_deadline" || tr.active != 0 {
						t.Fatal("zero override bypassed deadline/cancellation")
					}
				}
			}
		}
	}
}
func TestCallWithoutAdditionalBudgetRetriesEachCandidateAtMostOnce(t *testing.T) {
	for _, allDown := range []bool{false, true} {
		c := retryConfig()
		c.Groups[0].Timeout = 1
		c.Groups[0].Stages[0].Calls[0].Timeout = new(float64)
		e := engine(t, c)
		setFault(t, e, "back-1", "blackhole")
		if allDown {
			setFault(t, e, "back-2", "blackhole")
		}
		tr := e.AddRequest(1)
		e.Advance(300)
		if len(backSpans(tr)) != 2 || tr.active != 0 || tr.OK == allDown {
			t.Fatal("unbounded or skipped retries", tr.Reason)
		}
	}
}
