package core

import "errors"

// RequestOptions are captured for one root call. They do not change the generator.
type RequestOptions struct {
	Weight   float64           `json:"weight"`
	Deadline float64           `json:"deadline"`
	Labels   map[string]string `json:"labels"`
}

// TraceEvent records actual engine transitions in their execution order.
// Value is a duration for call/processing/network events, queue depth for Queued,
// and attempt number for Connection retry. Reason is a result or resource ID.
type TraceEvent struct {
	At     float64 `json:"at"`
	Span   int     `json:"span,omitempty"`
	Kind   string  `json:"kind"`
	Reason string  `json:"reason,omitempty"`
	Value  float64 `json:"value,omitempty"`
}

func (e *Engine) traceEvent(s *Span, kind, reason string, value float64) {
	if s.trace.Manual {
		s.trace.Events = append(s.trace.Events, TraceEvent{At: e.Now, Span: s.ID, Kind: kind, Reason: reason, Value: value})
	}
}

// SetManualMode suppresses arrivals without altering accepted work or RPS.
func (e *Engine) SetManualMode(manual bool) {
	if manual == e.ManualMode {
		return
	}
	e.ManualMode = manual
	e.arrivalEpoch++ // A pending arrival must never start a second arrival chain.
	if !manual {
		e.scheduleArrival()
	}
}

func (e *Engine) FocusRunning() bool {
	if e.Focus == nil {
		return false
	}
	if !e.Focus.done {
		return true
	}
	for _, s := range e.Focus.Spans {
		if !s.done || !s.settled {
			return true
		}
	}
	return false
}

func (e *Engine) SendRequest(o RequestOptions) (*Trace, error) {
	if !e.ManualMode {
		return nil, errors.New("Select Single request mode first.")
	}
	if e.FocusRunning() {
		return nil, errors.New("The previous request still has unfinished work.")
	}
	if !finite(o.Weight) || o.Weight <= 0 || o.Weight > 10 || !finite(o.Deadline) || o.Deadline < 1 || o.Deadline > 60000 {
		return nil, errors.New("Use weight > 0 and ≤ 10, and deadline 1–60000 ms.")
	}
	if len(o.Labels) > 16 {
		return nil, errors.New("Use at most 16 request labels.")
	}
	for k, v := range o.Labels {
		if !labelKey.MatchString(k) || len(v) > 80 {
			return nil, errors.New("Check label names and duplicate keys.")
		}
	}
	return e.addRequest(o.Weight, o.Deadline, o.Labels, true), nil
}
