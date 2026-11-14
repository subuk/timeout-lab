package core

import (
	"encoding/json"
	"testing"
)

func idleValue(v float64) *float64 { return &v }
func keepValue(v bool) *bool       { return &v }
func TestConnectionsLegacyMigration(t *testing.T) {
	c := DefaultConfig()
	raw, _ := json.Marshal(c)
	var old map[string]any
	json.Unmarshal(raw, &old)
	old["keepalive"] = false
	raw, _ = json.Marshal(old)
	json.Unmarshal(raw, &c)
	e := engine(t, c)
	if e.C.Keepalive != nil || e.C.Client.Keepalive {
		t.Fatal("legacy generator setting not migrated")
	}
	for _, g := range e.C.Groups {
		if *g.Keepalive || *g.KeepaliveTimeout != 30000 {
			t.Fatal("legacy downstream setting not migrated")
		}
	}
	raw, _ = json.Marshal(e.C)
	var exported map[string]any
	json.Unmarshal(raw, &exported)
	if _, ok := exported["keepalive"]; ok {
		t.Fatal("global flag still exported")
	}
	fresh := engine(t, DefaultConfig())
	if !fresh.C.Client.Keepalive || !*fresh.C.Groups[0].Keepalive {
		t.Fatal("default must enable reuse")
	}
}
func TestIdleTimeoutExpiresAfterReply(t *testing.T) {
	c := single(4, 5)
	c.Client = &ClientConnections{true, 20, 100}
	e := engine(t, c)
	e.AddRequest(1)
	e.Advance(10)
	reuse := e.AddRequest(1)
	e.Advance(10)
	if reuse.Spans[0].Connection != "reused" {
		t.Fatal("idle connection expired too early")
	}
	e.Advance(20)
	fresh := e.AddRequest(1)
	e.Advance(10)
	if fresh.Spans[0].Connection != "new" {
		t.Fatal("idle connection did not expire")
	}
}
func TestIdleTimeoutDoesNotCloseConcurrentActiveCalls(t *testing.T) {
	c := single(4, 100)
	c.Client = &ClientConnections{true, 10, 100}
	e := engine(t, c)
	first := e.AddRequest(1)
	e.Advance(50)
	second := e.AddRequest(1)
	e.Advance(60)
	if second.Spans[0].Connection != "reused" || e.connections["client>box-1"] == nil {
		t.Fatal("active connection expired")
	}
	e.Advance(45)
	if !first.OK || !second.OK || e.connections["client>box-1"] == nil {
		t.Fatal("idle did not wait for last response")
	}
	e.Advance(10)
	if e.connections["client>box-1"] != nil {
		t.Fatal("idle connection retained")
	}
}
func TestIdleIncludesReturnNetwork(t *testing.T) {
	c := single(4, 10)
	c.Network = 5
	c.Client = &ClientConnections{true, 10, 100}
	e := engine(t, c)
	tr := e.AddRequest(1)
	e.Advance(37)
	if !tr.OK || e.connections["client>box-1"] == nil {
		t.Fatal("idle measured before full response")
	}
	e.Advance(5)
	if e.connections["client>box-1"] != nil {
		t.Fatal("idle failed to expire after full reply")
	}
}
func TestIdlePolicyLiveEdits(t *testing.T) {
	c := single(4, 1)
	c.Client = &ClientConnections{true, 100, 100}
	e := engine(t, c)
	e.AddRequest(1)
	e.Advance(30)
	next := copyConfig(e.C)
	next.Client.KeepaliveTimeout = 10
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	if e.Now != 30 || e.Arrivals != 1 || len(e.connections) != 0 {
		t.Fatal("shortening timeout reset time or restarted idle age")
	}
	tr := e.AddRequest(1)
	e.Advance(5)
	next = copyConfig(e.C)
	next.Client.KeepaliveTimeout = 100
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	e.Advance(20)
	if !tr.OK || len(e.connections) == 0 {
		t.Fatal("old expiry timer removed extended connection")
	}
	next = copyConfig(e.C)
	next.Client.KeepaliveTimeout = 0
	e.Update(next)
	for i := 0; i < 10; i++ {
		e.Advance(10000)
	}
	if len(e.connections) == 0 {
		t.Fatal("zero timeout must be unlimited")
	}
}
func TestDownstreamKeepaliveBelongsToCallerInstance(t *testing.T) {
	c := retryConfig()
	c.Groups[0].Count = 2
	c.Groups[1].Count = 1
	c.Groups[1].Keepalive = keepValue(false)
	c.Overrides = map[string]NodeConfig{"front-1": {Keepalive: keepValue(false)}}
	e := engine(t, c)
	for i := 0; i < 6; i++ {
		tr := e.AddRequest(1)
		e.Advance(300)
		s := backSpans(tr)[0]
		want := "new"
		if i >= 3 && i%2 == 1 {
			want = "reused"
		}
		if !tr.OK || s.Connection != want {
			t.Fatalf("call %d: expected %s, got %s", i, want, s.Connection)
		}
	}
	if e.connections["client>front-1"] == nil || e.connections["front-2>back-1"] == nil || e.connections["front-1>back-1"] != nil {
		t.Fatal("box policy affected other caller connections")
	}
}
func TestDownstreamTimeoutsAllowInstanceOverrides(t *testing.T) {
	for _, kind := range []string{"connect", "call"} {
		c := retryConfig()
		c.Groups[0].Count = 2
		c.Groups[1].Service = 100
		o := NodeConfig{ConnectTimeout: idleValue(5)}
		if kind == "call" {
			o = NodeConfig{Timeout: idleValue(50)}
		}
		c.Overrides = map[string]NodeConfig{"front-1": o}
		e := engine(t, c)
		first := e.AddRequest(1)
		e.Advance(300)
		second := e.AddRequest(1)
		e.Advance(300)
		if first.OK || !second.OK {
			t.Fatalf("%s override not isolated", kind)
		}
	}
}
func TestConnectionDisableEnableDuringHandshake(t *testing.T) {
	c := single(4, 1)
	c.Network = 10
	e := engine(t, c)
	tr := e.AddRequest(1)
	e.Advance(5)
	next := copyConfig(e.C)
	next.Client.Keepalive = false
	e.Update(next)
	next = copyConfig(e.C)
	next.Client.Keepalive = true
	e.Update(next)
	e.Advance(100)
	if !tr.OK || len(e.connections) != 0 {
		t.Fatal("pre-toggle handshake entered new cache")
	}
}
func TestDrainingBoxRetainsDownstreamSettings(t *testing.T) {
	c := retryConfig()
	c.Groups[0].Count = 2
	c.Groups[0].Service = 100
	c.Groups[0].Timeout = 300
	c.Groups[1].Service = 100
	c.Overrides = map[string]NodeConfig{"front-2": {Timeout: idleValue(50), Keepalive: keepValue(false)}}
	e := engine(t, c)
	e.rr["entry"] = 1
	tr := e.AddRequest(1)
	e.Advance(10)
	next := copyConfig(e.C)
	next.Groups[0].Count = 1
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	e.Advance(400)
	if tr.OK || tr.Reason != "request_timeout" {
		t.Fatal("draining caller lost its timeout")
	}
}
func TestConnectionPolicyValidation(t *testing.T) {
	for _, value := range []float64{-1, 3600001} {
		c := DefaultConfig()
		c.Groups[0].KeepaliveTimeout = idleValue(value)
		if _, err := New(c); err == nil {
			t.Fatal("invalid idle accepted")
		}
	}
	c := DefaultConfig()
	c.Overrides = map[string]NodeConfig{"api-1": {ConnectTimeout: idleValue(0)}}
	if _, err := New(c); err == nil {
		t.Fatal("invalid instance connect timeout accepted")
	}
}

func TestDownstreamIdleAndGeneratorAreIndependent(t *testing.T) {
	c := retryConfig()
	c.Groups[1].Count = 1
	c.Groups[1].Service = 100
	c.Groups[0].KeepaliveTimeout = idleValue(20)
	e := engine(t, c)
	first := e.AddRequest(1)
	e.Advance(150)
	if !first.OK || e.connections["front-1>back-1"] == nil {
		t.Fatal("downstream expired during processing or reply")
	}
	e.Advance(25)
	if e.connections["front-1>back-1"] != nil || e.connections["client>front-1"] == nil {
		t.Fatal("idle setting affected wrong connection")
	}
	next := e.AddRequest(1)
	e.Advance(200)
	if !next.OK || next.Spans[0].Connection != "reused" || backSpans(next)[0].Connection != "new" {
		t.Fatal("caller-specific idle not reflected in trace")
	}
}
func TestBoxDisableDoesNotAffectOtherCallers(t *testing.T) {
	c := retryConfig()
	c.Groups[0].Count = 2
	c.Groups[1].Count = 1
	e := engine(t, c)
	e.AddRequest(1)
	e.Advance(100)
	e.AddRequest(1)
	e.Advance(100)
	next := copyConfig(e.C)
	next.Overrides = map[string]NodeConfig{"front-1": {Keepalive: keepValue(false)}}
	if err := e.Update(next); err != nil {
		t.Fatal(err)
	}
	if e.connections["front-1>back-1"] != nil || e.connections["front-2>back-1"] == nil || e.connections["client>front-1"] == nil {
		t.Fatal("disabled wrong pools")
	}
}
