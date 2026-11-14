package core

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

func sendManual(t *testing.T, e *Engine, o RequestOptions) *Trace {
	t.Helper()
	tr, err := e.SendRequest(o)
	if err != nil {
		t.Fatal(err)
	}
	return tr
}
func hasEvent(tr *Trace, kind, reason string) bool {
	for _, event := range tr.Events {
		if event.Kind == kind && (reason == "" || event.Reason == reason) {
			return true
		}
	}
	return false
}
func TestManualRequestParametersAndMode(t *testing.T) {
	c := single(1, 100)
	c.RPS = 200
	c.Spread = 100
	c.RequestLabels = map[string]string{"source": "generator"}
	e := engine(t, c)
	e.SetManualMode(true)
	e.Advance(1000)
	if e.Arrivals != 0 || e.Now != 1000 || e.C.RPS != 200 {
		t.Fatal("mode changed time/config or generated traffic")
	}
	labels := map[string]string{"source": "manual"}
	tr := sendManual(t, e, RequestOptions{Weight: 2, Deadline: 500, Labels: labels})
	labels["source"] = "changed"
	if !e.Snapshot().FocusRunning || e.Snapshot().Focus.ID != tr.ID {
		t.Fatal("missing live trace")
	}
	e.Advance(500)
	if e.Arrivals != 1 || !tr.OK || e.FocusRunning() || tr.Labels["source"] != "manual" {
		t.Fatal("incorrect manual result")
	}
	near(t, tr.Spans[0].LocalEnd-tr.Spans[0].WorkStart, 200, .001)
	if e.C.Weight != c.Weight || e.C.Deadline != c.Deadline || e.C.RequestLabels["source"] != "generator" {
		t.Fatal("request changed defaults")
	}
	for _, kind := range []string{"Request sent", "Call started", "Connection", "Connection ready", "Queued", "Worker acquired", "Processing started", "Processing finished", "Box finished", "Caller notified", "User response"} {
		if !hasEvent(tr, kind, "") {
			t.Errorf("missing %s", kind)
		}
	}
	for i := 1; i < len(tr.Events); i++ {
		if tr.Events[i].At < tr.Events[i-1].At {
			t.Fatal("events out of order")
		}
	}
	// Toggling at one instant cannot leave multiple arrival chains behind.
	for i := 0; i < 5; i++ {
		e.SetManualMode(false)
		e.SetManualMode(true)
	}
	e.Advance(500)
	if e.Arrivals != 1 {
		t.Fatal("stale arrival fired")
	}
	e.SetManualMode(false)
	e.Advance(100)
	if e.Arrivals <= 1 {
		t.Fatal("load did not resume")
	}
}
func TestManualDeadlineAndUncancelledWork(t *testing.T) {
	for _, cancel := range []bool{true, false} {
		c := single(1, 100)
		c.Cancel = cancel
		e := engine(t, c)
		e.SetManualMode(true)
		tr := sendManual(t, e, RequestOptions{Weight: 1, Deadline: 10})
		e.Advance(20)
		if tr.Reason != "client_deadline" || !hasEvent(tr, "User response", "client_deadline") {
			t.Fatal("deadline not recorded")
		}
		if e.FocusRunning() == cancel {
			t.Fatal("incorrect unfinished work state")
		}
		if !cancel {
			if _, err := e.SendRequest(RequestOptions{Weight: 1, Deadline: 100}); err == nil {
				t.Fatal("replaced unfinished trace")
			}
		} else if !hasEvent(tr, "Cancellation", "client_deadline") {
			t.Fatal("missing cancellation")
		}
		e.Advance(200)
		if e.FocusRunning() {
			t.Fatal("work did not finish")
		}
	}
}
func TestManualValidationIsAtomic(t *testing.T) {
	e := engine(t, single(1, 100))
	e.SetManualMode(true)
	for _, o := range []RequestOptions{{Weight: 0, Deadline: 100}, {Weight: math.NaN(), Deadline: 100}, {Weight: 1, Deadline: 0}, {Weight: 1, Deadline: 100, Labels: map[string]string{"bad key": "v"}}} {
		rng := e.rng
		if _, err := e.SendRequest(o); err == nil {
			t.Fatal("invalid options accepted")
		}
		if e.Arrivals != 0 || e.Focus != nil || e.rng != rng {
			t.Fatal("validation mutated engine")
		}
	}
}
func TestManualResourceRetryAndStepIndependence(t *testing.T) {
	run := func(step float64) *Trace {
		c := DefaultConfig()
		c.RPS = 0
		c.Jitter = 0
		c.Network = 2
		e := engine(t, c)
		e.SetManualMode(true)
		if err := e.SetNode("api-1", "down", nil, nil); err != nil {
			t.Fatal(err)
		}
		tr := sendManual(t, e, RequestOptions{Weight: 1.5, Deadline: 3000, Labels: map[string]string{"az": "az1"}})
		for at := 0.; at < 4000; at += step {
			e.Advance(step)
		}
		if !tr.OK || e.FocusRunning() {
			t.Fatal(tr.Reason)
		}
		for _, kind := range []string{"Connection retry", "Resource visit", "Waiting for resource", "Waiting for children"} {
			if !hasEvent(tr, kind, "") {
				t.Errorf("missing %s", kind)
			}
		}
		return tr
	}
	a, b := run(1), run(1000)
	aj, _ := json.Marshal(a)
	bj, _ := json.Marshal(b)
	if !reflect.DeepEqual(aj, bj) {
		t.Fatal("trace depends on Advance step size")
	}
}
func TestManualWarmConnectionAndPreservedQueue(t *testing.T) {
	c := single(1, 100)
	c.Network = 2
	e := engine(t, c)
	first := e.AddRequest(1)
	e.Advance(10)
	e.SetManualMode(true)
	tr := sendManual(t, e, RequestOptions{Weight: 1, Deadline: 1000})
	e.Advance(500)
	if !first.OK || !tr.OK || tr.Spans[0].WorkStart <= tr.Spans[0].Arrive {
		t.Fatal("existing queue was not preserved")
	}
	if tr.Spans[0].Connection != "reused" {
		t.Fatal("mode dropped connection")
	}
}
