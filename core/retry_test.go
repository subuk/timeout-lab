package core

import (
	"encoding/json"
	"testing"
)

func retryConfig() Config {
	c := single(4, 1)
	network := 10.0
	c.Entry = "front"
	c.Groups = []Group{
		{ID: "front", Name: "Front", Count: 1, Workers: 4, Service: 1, Timeout: 200, ConnectTimeout: 30, QueueLimit: 100, Join: "all", Quorum: 1, Edges: []Edge{{Target: "back", Calls: 1, Route: "round_robin", Network: &network}}},
		{ID: "back", Name: "Back", Count: 2, Workers: 4, Service: 10, Timeout: 200, ConnectTimeout: 30, QueueLimit: 100, Join: "all", Quorum: 1},
	}
	return c
}
func setFault(t *testing.T, e *Engine, id, state string) {
	t.Helper()
	if err := e.SetNode(id, state, nil, nil); err != nil {
		t.Fatal(err)
	}
}
func backSpans(tr *Trace) []*Span {
	var result []*Span
	for _, s := range tr.Spans {
		if s.node.Group == "back" {
			result = append(result, s)
		}
	}
	return result
}
func TestRetryConnectDefaultAndJSON(t *testing.T) {
	e := engine(t, retryConfig())
	if !*e.C.Groups[0].RetryConnect {
		t.Fatal("default must be enabled")
	}
	c := e.C
	disabled := false
	c.Groups[0].RetryConnect = &disabled
	data, _ := json.Marshal(c)
	var decoded Config
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if *engine(t, decoded).C.Groups[0].RetryConnect {
		t.Fatal("explicit false must survive JSON")
	}
}
func TestRetryConnectRefusedAndTimeout(t *testing.T) {
	for _, fault := range []string{"down", "blackhole"} {
		t.Run(fault, func(t *testing.T) {
			e := engine(t, retryConfig())
			setFault(t, e, "back-1", fault)
			tr := e.AddRequest(1)
			e.Advance(300)
			spans := backSpans(tr)
			if !tr.OK || len(spans) != 2 {
				t.Fatalf("outcome=%s spans=%d", tr.Reason, len(spans))
			}
			if spans[0].connected || spans[0].Arrive >= 0 || spans[1].Node != "back-2" || spans[1].Attempt != 2 || spans[1].RetryOf != spans[0].ID {
				t.Fatal("wrong attempt tracking")
			}
			if spans[1].Start != spans[0].Reply {
				t.Fatal("retry should start after failure")
			}
			if e.Pending != 0 || tr.active != 0 || e.Failed != 0 || e.OK != 1 {
				t.Fatal("attempts must settle one user result")
			}
			for _, n := range e.Nodes {
				if n.Outstanding != 0 || len(n.Active) != 0 {
					t.Fatal("leaked work")
				}
			}
		})
	}
}
func TestRetryConnectDisabled(t *testing.T) {
	c := retryConfig()
	disabled := false
	c.Groups[0].RetryConnect = &disabled
	e := engine(t, c)
	setFault(t, e, "back-1", "down")
	tr := e.AddRequest(1)
	e.Advance(300)
	if tr.OK || tr.Reason != "connection_refused" || len(backSpans(tr)) != 1 {
		t.Fatal("disabled retry still ran")
	}
}
func TestRetryConnectDoesNotRetryResponseFailure(t *testing.T) {
	for _, fault := range []string{"hang", "slow", "reset", "queue_full"} {
		t.Run(fault, func(t *testing.T) {
			c := retryConfig()
			c.Groups[0].Timeout = 70
			if fault == "queue_full" {
				c.Groups[1].QueueLimit = 0
				c.Groups[1].Workers = 1
				c.Groups[1].Service = 200
			}
			e := engine(t, c)
			switch fault {
			case "hang":
				setFault(t, e, "back-1", "hang")
			case "slow":
				v := 200.0
				e.SetNode("back-1", "", &v, nil)
			case "reset":
				e.at(40, func() { setFault(t, e, "back-1", "down") })
			case "queue_full":
				e.AddRequest(1)
				e.Advance(10)
				e.rr["front-1/0"] = 0 // Route the next call to the same busy node.
			}
			tr := e.AddRequest(1)
			e.Advance(300)
			if tr.OK || len(backSpans(tr)) != 1 || !backSpans(tr)[0].connected {
				t.Fatalf("post-connect failure retried: %s", tr.Reason)
			}
		})
	}
}

func TestRetryConnectFanoutCountsLogicalCalls(t *testing.T) {
	c := retryConfig()
	c.Groups[0].Edges[0].Calls = 2
	e := engine(t, c)
	setFault(t, e, "back-1", "down")
	tr := e.AddRequest(1)
	e.Advance(300)
	if !tr.OK || len(backSpans(tr)) != 3 || tr.Spans[0].successes != 2 || tr.Spans[0].remaining != 0 {
		t.Fatal("retry attempts changed fanout completion counts")
	}
}
func TestRetryConnectSharedCallBudget(t *testing.T) {
	c := retryConfig()
	c.Groups[0].Timeout = 60
	e := engine(t, c)
	setFault(t, e, "back-1", "blackhole")
	tr := e.AddRequest(1)
	e.Advance(300)
	if tr.OK || tr.Reason != "request_timeout" || len(backSpans(tr)) != 2 {
		t.Fatalf("unexpected result: %s", tr.Reason)
	}
	near(t, tr.End-tr.Spans[0].LocalEnd, 60.001, .001)
}
func TestRetryConnectExhaustsEachCandidateOnce(t *testing.T) {
	for _, route := range []string{"round_robin", "least_busy", "random"} {
		t.Run(route, func(t *testing.T) {
			c := retryConfig()
			c.Groups[1].Count = 4
			c.Groups[0].Edges[0].Route = route
			e := engine(t, c)
			for _, n := range e.Groups["back"] {
				setFault(t, e, n.ID, "down")
			}
			tr := e.AddRequest(1)
			e.Advance(300)
			seen := map[string]bool{}
			for _, s := range backSpans(tr) {
				if seen[s.Node] {
					t.Fatal("node retried twice")
				}
				seen[s.Node] = true
			}
			if tr.OK || len(seen) != 4 || e.Failed != 1 {
				t.Fatal("wrong exhaustion behavior")
			}
		})
	}
}
func TestRetryConnectDoesNotRetryPropagatedChildFailure(t *testing.T) {
	c := retryConfig()
	net := 10.0
	c.Groups[1].Edges = []Edge{{Target: "leaf", Calls: 1, Route: "round_robin", Network: &net}}
	c.Groups = append(c.Groups, Group{ID: "leaf", Name: "Leaf", Count: 1, Workers: 1, Service: 1, Timeout: 100, ConnectTimeout: 30, QueueLimit: 100, Join: "all", Quorum: 1})
	e := engine(t, c)
	setFault(t, e, "leaf-1", "down")
	tr := e.AddRequest(1)
	e.Advance(300)
	if tr.OK || tr.Reason != "connection_refused" || len(backSpans(tr)) != 1 {
		t.Fatal("upstream retried after a downstream failure")
	}
}
func TestRetryConnectKeepaliveFailureDoesNotRetry(t *testing.T) {
	c := retryConfig()
	c.Groups[0].Edges[0].Route = "least_busy"
	e := engine(t, c)
	warm := e.AddRequest(1)
	e.Advance(300)
	if !warm.OK {
		t.Fatal(warm.Reason)
	}
	setFault(t, e, "back-1", "blackhole")
	tr := e.AddRequest(1)
	e.Advance(300)
	if tr.OK || tr.Reason != "request_timeout" || len(backSpans(tr)) != 1 {
		t.Fatal("reused connection failure retried")
	}
}
func TestRetryConnectBroadcastKeepsDistinctVotes(t *testing.T) {
	c := retryConfig()
	c.Groups[0].Edges[0].Route = "broadcast"
	c.Groups[0].Join = "quorum"
	c.Groups[0].Quorum = 2
	e := engine(t, c)
	setFault(t, e, "back-1", "down")
	tr := e.AddRequest(1)
	e.Advance(300)
	if tr.OK || len(backSpans(tr)) != 2 {
		t.Fatal("broadcast retry must not count a healthy node twice")
	}
}
func TestRetryConnectStopsAfterUserDeadline(t *testing.T) {
	for _, cancel := range []bool{true, false} {
		c := retryConfig()
		c.Deadline = 25
		c.Cancel = cancel
		e := engine(t, c)
		setFault(t, e, "back-1", "blackhole")
		tr := e.AddRequest(1)
		e.Advance(300)
		if tr.Reason != "client_deadline" || len(backSpans(tr)) != 1 || tr.active != 0 {
			t.Fatalf("retry after user deadline; cancel=%v", cancel)
		}
	}
}
func TestRetryConnectSkipsRemovedCandidates(t *testing.T) {
	e := engine(t, retryConfig())
	setFault(t, e, "back-1", "blackhole")
	tr := e.AddRequest(1)
	e.Advance(10)
	c := scaledConfig(t, e, "back", 1)
	if err := e.Update(c); err != nil {
		t.Fatal(err)
	}
	e.Advance(300)
	if tr.OK || len(backSpans(tr)) != 1 {
		t.Fatal("retry routed to removed node")
	}
}
func TestRetryConnectDetectsFailureDuringHandshake(t *testing.T) {
	e := engine(t, retryConfig())
	tr := e.AddRequest(1)
	e.at(10, func() { setFault(t, e, "back-1", "down") })
	e.Advance(300)
	if !tr.OK || len(backSpans(tr)) != 2 || backSpans(tr)[0].connected {
		t.Fatal("handshake failure was not retried")
	}
}
