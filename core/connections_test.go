package core

import (
	"encoding/json"
	"testing"
)

func TestKeepaliveTraceKindsAndDisabledCache(t *testing.T) {
	c := single(4, 5)
	e := engine(t, c)
	first := e.AddRequest(1)
	e.Advance(20)
	second := e.AddRequest(1)
	e.Advance(20)
	if first.Spans[0].Connection != "new" || !first.Spans[0].ConnectionEstablished || second.Spans[0].Connection != "reused" {
		t.Fatal("missing connection metadata")
	}
	data, _ := json.Marshal(second.Spans[0])
	var view map[string]any
	json.Unmarshal(data, &view)
	if view["connection"] != "reused" || view["connectionEstablished"] != true {
		t.Fatal("metadata not exported")
	}
	next := copyConfig(e.C)
	next.Client.Keepalive = false
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	if len(e.connections) != 0 {
		t.Fatal("toggle retained connections")
	}
	for i := 0; i < 2; i++ {
		tr := e.AddRequest(1)
		e.Advance(20)
		if tr.Spans[0].Connection != "new" || len(e.connections) != 0 {
			t.Fatal("disabled keepalive cached a connection")
		}
	}
}
func TestKeepaliveBlackholeEvictedBeforeNextCall(t *testing.T) {
	for _, cancel := range []bool{true, false} {
		c := retryConfig()
		c.Cancel = cancel
		e := engine(t, c)
		warm := e.AddRequest(1)
		e.Advance(300)
		if !warm.OK {
			t.Fatal(warm.Reason)
		}
		setFault(t, e, "back-1", "blackhole")
		e.rr["front-1/stage/1/0"] = 0
		failed := e.AddRequest(1)
		e.Advance(300)
		sp := backSpans(failed)
		if failed.OK || len(sp) != 1 || sp[0].Connection != "reused" || !sp[0].ConnectionClosed {
			t.Fatal("expected closed reused connection", cancel)
		}
		if e.connections["client>front-1"] == nil {
			t.Fatal("downstream failure evicted healthy upstream connection")
		}
		if e.connections["front-1>back-1"] != nil {
			t.Fatal("stale connection retained")
		}
		e.rr["front-1/stage/1/0"] = 0
		next := e.AddRequest(1)
		e.Advance(300)
		attempts := backSpans(next)
		if !next.OK || len(attempts) != 2 || attempts[0].Status != "connect_timeout" || attempts[0].Connection != "new" || attempts[0].ConnectionEstablished {
			t.Fatal("next request did not reconnect and fail over", cancel)
		}
	}
}
func TestLateTimeoutCannotEvictReplacement(t *testing.T) {
	c := single(4, 1)
	c.Cancel = false
	e := engine(t, c)
	e.AddRequest(1)
	e.Advance(10)
	n := e.Groups["box"][0]
	n.State = "hang"
	// Two requests share one old connection, with different caller budgets.
	tr := &Trace{Weight: 1, Labels: map[string]string{}}
	old := e.call(tr, nil, n, 0, 100, 20, func(bool, string) {})
	later := e.call(tr, nil, n, 0, 100, 80, func(bool, string) {})
	e.Advance(25)
	if !old.ConnectionClosed {
		t.Fatal("first timeout did not close old connection")
	}
	slow, fast := 100.0, 1.0
	if err := e.SetNode("box-1", "healthy", &slow, nil); err != nil {
		t.Fatal(err)
	}
	if err := e.SetNode("box-1", "", &fast, nil); err != nil {
		t.Fatal(err)
	}
	replacement := e.AddRequest(1)
	e.Advance(5)
	key := "client>box-1"
	newID := e.connections[key]
	if !replacement.OK || replacement.Spans[0].Connection != "new" || newID.ID == later.connectionID {
		t.Fatal("replacement not established")
	}
	// The second old call actually times out after the replacement succeeds.
	e.Advance(60)
	if !later.ConnectionClosed {
		t.Fatalf("old call did not time out: status=%s reply=%f work=%+v settled=%v connected=%v start=%f now=%f", later.Status, later.Reply, later.WorkCost, later.settled, later.ConnectionEstablished, later.Start, e.Now)
	}
	if e.connections[key] != newID {
		t.Fatal("late old failure evicted replacement")
	}
	reused := e.AddRequest(1)
	e.Advance(5)
	if reused.Spans[0].Connection != "reused" {
		t.Fatal("replacement not reusable")
	}
}
func TestTimedOutHandshakeDoesNotPopulatePool(t *testing.T) {
	c := single(4, 1)
	c.Cancel = false
	c.Network = 10
	c.Deadline = 5
	c.Groups[0].ConnectTimeout = 100
	e := engine(t, c)
	tr := e.AddRequest(1)
	e.Advance(100)
	if tr.OK || len(e.connections) != 0 || !tr.Spans[0].ConnectionClosed {
		t.Fatal("late handshake resurrected expired connection")
	}
}
func TestKeepalivePostConnectResetAndResources(t *testing.T) {
	c := resourceConfig("instance")
	e := engine(t, c)
	tr := e.AddRequest(1)
	e.Advance(20)
	setFault(t, e, "box-1", "down")
	e.Advance(300)
	if tr.OK || !tr.Spans[0].ConnectionClosed || len(e.connections) != 0 {
		t.Fatal("reset kept connection")
	}
	for _, s := range tr.Spans {
		if s.Resource != "" && (s.Connection != "" || s.ConnectionClosed) {
			t.Fatal("resource has a network connection")
		}
	}
}
func TestKeepaliveBlackholeDefaultScenarioRecovers(t *testing.T) {
	c := DefaultConfig()
	c.Groups[0].ConnectTimeout = 15
	e := engine(t, c)
	e.Advance(5000)
	setFault(t, e, "api-1", "blackhole")
	e.Advance(5000)
	if e.Failed == 0 {
		t.Fatal("already connected requests should fail")
	}
	failed := e.Failed
	ok := e.OK
	e.Advance(10000)
	if e.Failed != failed || e.OK <= ok {
		t.Fatal("blackhole continues failing user requests after eviction")
	}
}
