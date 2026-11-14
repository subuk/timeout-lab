package core

import (
	"errors"
	"fmt"
	"math"
)

// Policy times are milliseconds of simulation time. A decision changes count by one.
type AutoScalePolicy struct {
	Resource        string  `json:"resource,omitempty"`
	Signal          string  `json:"signal,omitempty"`
	UpUtilization   float64 `json:"upUtilization"`
	Window          float64 `json:"window"`
	Enabled         bool    `json:"enabled"`
	Min             int     `json:"min"`
	Max             int     `json:"max"`
	UpQueue         float64 `json:"upQueue"`
	DownUtilization float64 `json:"downUtilization"`
	UpDelay         float64 `json:"upDelay"`
	DownDelay       float64 `json:"downDelay"`
	Cooldown        float64 `json:"cooldown"`
}

func DefaultAutoScale() *AutoScalePolicy {
	return &AutoScalePolicy{Signal: "queue", UpUtilization: 75, Window: 5000, Min: 1, Max: 16, UpQueue: 2, DownUtilization: 30, UpDelay: 2000, DownDelay: 10000, Cooldown: 5000}
}
func (p AutoScalePolicy) validate() error {
	if (p.Signal != "" && p.Signal != "queue" && p.Signal != "utilization" && p.Signal != "both") || p.UpUtilization < 0 || p.UpUtilization > 100 || p.Window < 0 || p.Window > 60000 {
		return errors.New("Autoscaling: invalid signal, utilization (0–100%) or window (0–60000 ms)")
	}
	if p.Min < 1 || p.Max > 16 || p.Min > p.Max || p.UpQueue < 0 || p.UpQueue > 2000 || p.DownUtilization < 0 || p.DownUtilization > 100 || p.UpDelay < 0 || p.UpDelay > 300000 || p.DownDelay < 0 || p.DownDelay > 300000 || p.Cooldown < 0 || p.Cooldown > 300000 {
		return errors.New("Autoscaling: 1 ≤ min ≤ max ≤ 16, queue 0–2000, utilization 0–100%, delays 0–300 s")
	}
	return nil
}

type autoScaleState struct {
	Mode          string
	Since         float64
	Direction     int
	CooldownUntil float64
	Message       string
	Queue         float64
	Utilization   float64
}
type AutoScaleView struct {
	Group       string  `json:"group"`
	Enabled     bool    `json:"enabled"`
	Mode        string  `json:"mode"`
	Message     string  `json:"message"`
	Queue       float64 `json:"queue"`
	Utilization float64 `json:"utilization"`
	Remaining   float64 `json:"remaining"`
	Target      int     `json:"target"`
}
type ScaleEvent struct {
	T      float64 `json:"t"`
	Group  string  `json:"group"`
	From   int     `json:"from"`
	To     int     `json:"to"`
	Reason string  `json:"reason"`
}

func (e *Engine) syncAutoScale(c Config) {
	for i, g := range c.Groups {
		old := e.C.Groups[i]
		changed := *old.AutoScale != *g.AutoScale
		manual := !e.inAutoScale && old.Count != g.Count
		if changed || manual {
			st := &autoScaleState{Mode: "idle", Message: "Waiting to check conditions"}
			if manual && g.AutoScale.Enabled {
				st.CooldownUntil = e.Now + g.AutoScale.Cooldown
				st.Mode = "cooldown"
				st.Message = "Cooldown after manual scaling"
			}
			e.auto[g.ID] = st
		}
	}
}
func (e *Engine) autoScaleTick() {
	// Stable group order; no RNG or wall clock. Same experiment at every UI speed.
	for i := range e.C.Groups {
		g := e.C.Groups[i]
		p := g.AutoScale
		st := e.auto[g.ID]
		if st == nil {
			st = &autoScaleState{}
			e.auto[g.ID] = st
		}
		nodes := e.sensorNodes(g)
		queued := 0
		busy, capacity := 0.0, 0.0
		requestQueued := 0
		for _, n := range e.Groups[g.ID] {
			requestQueued += len(n.Queue)
		}
		healthy := true
		for _, n := range e.Groups[g.ID] {
			if n.State != "healthy" {
				healthy = false
			}
		}
		for _, n := range e.Nodes {
			if n.Group == g.ID && n.Resource != "" && !n.Retired {
				requestQueued += len(n.Queue)
			}
		}
		draining := false
		for _, n := range nodes {
			queued += len(n.Queue)
			b, c := e.loadWindow(n, p.Window)
			busy += b
			capacity += c
			if n.State != "healthy" {
				healthy = false
			}
		}
		for _, n := range e.Nodes {
			if n.Group == g.ID && n.Draining {
				draining = true
			}
		}
		st.Queue = float64(queued) / float64(len(nodes))
		st.Utilization = 0
		if capacity > 0 {
			st.Utilization = busy / capacity * 100
		}
		queueHigh := (p.Signal == "queue" || p.Signal == "both") && st.Queue > p.UpQueue
		utilizationHigh := (p.Signal == "utilization" || p.Signal == "both") && st.Utilization > p.UpUtilization
		if !p.Enabled {
			st.Mode = "disabled"
			st.Message = "Disabled"
			st.Direction = 0
			continue
		}
		if e.Now < st.CooldownUntil {
			st.Mode = "cooldown"
			st.Message = "Cooldown between changes"
			st.Direction = 0
			continue
		}
		direction := 0
		reason := ""
		delay := p.UpDelay
		switch {
		case g.Count < p.Min:
			direction = 1
			reason = "Node count is below the minimum"
		case g.Count > p.Max:
			direction = -1
			reason = "Node count is above the maximum"
			delay = p.DownDelay
		case queueHigh || utilizationHigh:
			if g.Count >= p.Max {
				st.Mode = "at_max"
				st.Message = "Maximum node count reached"
				st.Direction = 0
				continue
			}
			direction = 1
			reason = fmt.Sprintf("Queue %.1f > %.1f per node", st.Queue, p.UpQueue)
			if utilizationHigh {
				reason = resourceReason(st.Utilization, p.UpUtilization)
			}
		case queued == 0 && requestQueued == 0 && st.Utilization <= p.DownUtilization:
			if g.Count <= p.Min {
				st.Mode = "at_min"
				st.Message = "Minimum node count reached"
				st.Direction = 0
				continue
			}
			if !healthy {
				st.Mode = "unhealthy"
				st.Message = "Scale-down paused: a node is unhealthy"
				st.Direction = 0
				continue
			}
			direction = -1
			reason = fmt.Sprintf("Utilization %.1f%% ≤ %.1f%%, queues are empty", st.Utilization, p.DownUtilization)
			delay = p.DownDelay
		}
		if direction == 0 {
			st.Mode = "idle"
			st.Message = "Load is between thresholds"
			st.Direction = 0
			continue
		}
		if direction < 0 && draining {
			st.Mode = "draining"
			st.Message = "Waiting for the previous drain to finish"
			st.Direction = 0
			continue
		}
		if st.Direction != direction {
			st.Since = e.Now
			st.Direction = direction
		}
		st.Mode = "holding_up"
		if direction < 0 {
			st.Mode = "holding_down"
		}
		st.Message = reason
		if e.Now-st.Since < delay {
			continue
		}
		next := e.C
		next.Groups = append([]Group(nil), e.C.Groups...)
		next.Groups[i].Count = g.Count + direction
		e.inAutoScale = true
		err := e.Update(next)
		e.inAutoScale = false
		if err != nil {
			st.Mode = "blocked"
			st.Message = err.Error()
			continue
		}
		ev := ScaleEvent{T: e.Now, Group: g.ID, From: g.Count, To: g.Count + direction, Reason: reason}
		e.ScaleEvents = append([]ScaleEvent{ev}, e.ScaleEvents...)
		if len(e.ScaleEvents) > 40 {
			e.ScaleEvents = e.ScaleEvents[:40]
		}
		e.note(fmt.Sprintf("Auto · %s: %d → %d. %s", g.Name, ev.From, ev.To, reason))
		st.Direction = 0
		st.CooldownUntil = e.Now + p.Cooldown
		st.Mode = "cooldown"
		st.Message = "Cooldown after automatic scaling"
	}
}
func (e *Engine) autoScaleViews() []AutoScaleView {
	result := make([]AutoScaleView, 0, len(e.C.Groups))
	for _, g := range e.C.Groups {
		p := g.AutoScale
		v := AutoScaleView{Group: g.ID, Enabled: p.Enabled, Mode: "disabled", Message: "Disabled", Target: g.Count}
		if st := e.auto[g.ID]; st != nil {
			v.Mode = st.Mode
			v.Message = st.Message
			v.Queue = st.Queue
			v.Utilization = st.Utilization
			if !p.Enabled {
				v.Mode = "disabled"
				v.Message = "Disabled"
			} else if st.Mode == "cooldown" {
				v.Remaining = math.Max(0, st.CooldownUntil-e.Now)
			} else if st.Mode == "holding_up" || st.Mode == "holding_down" {
				delay := p.UpDelay
				if st.Direction < 0 {
					delay = p.DownDelay
				}
				v.Remaining = math.Max(0, st.Since+delay-e.Now)
				v.Target = g.Count + st.Direction
			}
		}
		result = append(result, v)
	}
	return result
}
