package core

import "testing"

func autoConfig(count int) Config {
	c := single(1, 10000)
	c.Groups[0].Count = count
	p := DefaultAutoScale()
	p.Enabled = true
	p.Min = 1
	p.Max = 4
	p.UpQueue = 1
	p.UpDelay = 1000
	p.DownDelay = 1000
	p.Cooldown = 1000
	c.Groups[0].AutoScale = p
	return c
}
func addBacklog(e *Engine, n int) {
	for i := 0; i < n; i++ {
		e.AddRequest(1)
	}
}
func TestAutoScaleUpDelayCooldownAndMaximum(t *testing.T) {
	e := engine(t, autoConfig(1))
	addBacklog(e, 30)
	e.Advance(1499)
	if len(e.Groups["box"]) != 1 {
		t.Fatal("scaled before condition held")
	}
	e.Advance(1)
	if len(e.Groups["box"]) != 2 || len(e.ScaleEvents) != 1 {
		t.Fatal("did not scale after hold")
	}
	e.Advance(1999)
	if len(e.Groups["box"]) != 2 {
		t.Fatal("cooldown or new hold ignored")
	}
	e.Advance(1)
	if len(e.Groups["box"]) != 3 {
		t.Fatal("second scale missing")
	}
	e.Advance(2000)
	if len(e.Groups["box"]) != 4 {
		t.Fatal("third scale missing")
	}
	e.Advance(2000)
	if len(e.Groups["box"]) != 4 || len(e.ScaleEvents) != 3 {
		t.Fatal("maximum ignored")
	}
	if e.Now != 7500 || e.Arrivals != 30 || e.C.RPS != 0 {
		t.Fatal("autoscaling reset time, traffic or counters")
	}
	for _, n := range e.Snapshot().Nodes {
		near(t, n.L, n.Little+n.Unfinished, 1e-8)
	}
}
func TestAutoScaleDownDelayAndMinimum(t *testing.T) {
	e := engine(t, autoConfig(3))
	e.Advance(1499)
	if len(e.Groups["box"]) != 3 {
		t.Fatal("scaled down early")
	}
	e.Advance(1)
	if len(e.Groups["box"]) != 2 {
		t.Fatal("did not scale down idle group")
	}
	e.Advance(2000)
	if len(e.Groups["box"]) != 1 {
		t.Fatal("did not reach minimum")
	}
	e.Advance(5000)
	if len(e.Groups["box"]) != 1 || len(e.ScaleEvents) != 2 {
		t.Fatal("minimum ignored")
	}
}
func TestAutoScaleShortSpikeResetsHold(t *testing.T) {
	c := autoConfig(1)
	c.Deadline = 700
	e := engine(t, c)
	addBacklog(e, 10)
	e.Advance(1000)
	if len(e.ScaleEvents) != 0 || len(e.Nodes[0].Queue) != 0 {
		t.Fatal("short spike triggered scale")
	}
	c2 := scaledConfig(t, e, "box", 1)
	c2.Deadline = 60000
	e.Update(c2)
	addBacklog(e, 10)
	e.Advance(1499)
	if len(e.ScaleEvents) != 0 {
		t.Fatal("hold inherited previous spike")
	}
	e.Advance(1)
	if len(e.ScaleEvents) != 1 {
		t.Fatal("new hold did not trigger")
	}
}
func TestAutoScaleDisableCancelsPendingDecision(t *testing.T) {
	e := engine(t, autoConfig(1))
	addBacklog(e, 30)
	e.Advance(1000)
	c := scaledConfig(t, e, "box", 1)
	c.Groups[0].AutoScale.Enabled = false
	e.Update(c)
	e.Advance(3000)
	if len(e.ScaleEvents) != 0 || len(e.Groups["box"]) != 1 {
		t.Fatal("disabled controller scaled")
	}
}
func TestAutoScaleManualCountStartsCooldown(t *testing.T) {
	e := engine(t, autoConfig(1))
	addBacklog(e, 30)
	e.Advance(1000)
	e.Update(scaledConfig(t, e, "box", 2))
	e.Advance(1999)
	if len(e.Groups["box"]) != 2 {
		t.Fatal("manual change did not restart cooldown/hold")
	}
	e.Advance(1)
	if len(e.Groups["box"]) != 3 {
		t.Fatal("controller did not resume after manual change")
	}
}
func TestAutoScaleDownWaitsForDrain(t *testing.T) {
	c := autoConfig(3)
	c.Cancel = false
	e := engine(t, c)
	e.SetNode("box-3", "hang", nil, nil)
	for i := 0; i < 3; i++ {
		e.AddRequest(1)
	}
	e.Advance(100)
	e.Update(scaledConfig(t, e, "box", 2))
	e.Advance(10000)
	// First two operations complete after 10s; let the utilization window clear.
	// The third remains parked in drain.
	e.Advance(6000)
	if len(e.Groups["box"]) != 2 || len(e.ScaleEvents) != 0 || e.auto["box"].Mode != "draining" {
		t.Fatal("scaled down before previous drain completed", e.auto["box"].Mode)
	}
}
func TestAutoScaleBlockedQuorumLeavesGroupIntact(t *testing.T) {
	c := single(1, 1)
	c.Groups[0].Stages = []Stage{{Calls: []Call{{Target: "leaf", Calls: 1, Route: "broadcast", Transport: "network"}}, Join: "quorum", Quorum: 2}}
	leaf := autoConfig(2).Groups[0]
	leaf.ID = "leaf"
	c.Groups = append(c.Groups, leaf)
	e := engine(t, c)
	e.Advance(4000)
	if len(e.Groups["leaf"]) != 2 || len(e.ScaleEvents) != 0 || e.auto["leaf"].Mode != "blocked" {
		t.Fatal("quorum was broken by automatic downscale")
	}
}
func TestAutoScaleVirtualTimeIndependentOfAdvanceChunks(t *testing.T) {
	c := autoConfig(1)
	a := engine(t, c)
	b := engine(t, c)
	addBacklog(a, 30)
	addBacklog(b, 30)
	a.Advance(5000)
	for i := 0; i < 400; i++ {
		b.Advance(12.5)
	}
	if a.JSON() != b.JSON() {
		t.Fatal("autoscaler depends on UI speed/tick size")
	}
}
func TestAutoScaleConfigValidation(t *testing.T) {
	c := autoConfig(1)
	c.Groups[0].AutoScale.Min = 5
	c.Groups[0].AutoScale.Max = 2
	if Validate(c) == nil {
		t.Fatal("inverted bounds accepted")
	}
	c = autoConfig(1)
	c.Groups[0].AutoScale.UpDelay = -1
	if Validate(c) == nil {
		t.Fatal("negative delay accepted")
	}
}
func TestAutoScaleFollowsLoadRiseAndFall(t *testing.T) {
	c := autoConfig(1)
	c.RPS = 25
	c.Groups[0].Service = 100
	c.Groups[0].AutoScale.Max = 4
	c.Groups[0].AutoScale.UpQueue = 2
	e := engine(t, c)
	for i := 0; i < 3; i++ {
		e.Advance(10000)
	}
	if len(e.Groups["box"]) < 3 || len(e.ScaleEvents) == 0 {
		t.Fatal("did not grow under sustained overload")
	}
	c2 := scaledConfig(t, e, "box", len(e.Groups["box"]))
	c2.RPS = 0
	e.Update(c2)
	for i := 0; i < 4; i++ {
		e.Advance(10000)
	}
	if len(e.Groups["box"]) != 1 || e.Now != 70000 {
		t.Fatal("did not shrink after load fell")
	}
}
