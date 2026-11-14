package core

import (
	"errors"
	"fmt"
	"path"
	"strings"
)

// Containment controls ownership. Every definition executes the same program;
// calls, rather than containment, determine the request's path through boxes.
type boxDefinition struct {
	Group, Path       string
	Def               Group
	RootCount         int
	Shared, OwnShared bool
	Parent            *boxDefinition
}

func resourceGroup(parent Group, r ResourceConfig) Group {
	g := Group{ID: r.ID, Name: r.Name, I18n: r.I18n, Labels: r.Labels, Cost: r.Cost,
		Count: 1, Workers: r.Workers, Service: r.Service, QueueLimit: r.QueueLimit,
		Resources: r.Resources, Stages: r.Stages,
		Keepalive:        parent.Keepalive,
		KeepaliveTimeout: parent.KeepaliveTimeout, ConnectTimeout: parent.ConnectTimeout,
		Timeout: parent.Timeout, RetryConnect: parent.RetryConnect}
	if r.Keepalive != nil {
		g.Keepalive = r.Keepalive
	}
	if r.KeepaliveTimeout != nil {
		g.KeepaliveTimeout = r.KeepaliveTimeout
	}
	if r.ConnectTimeout != nil {
		g.ConnectTimeout = *r.ConnectTimeout
	}
	if r.Timeout != nil {
		g.Timeout = *r.Timeout
	}
	if r.RetryConnect != nil {
		g.RetryConnect = r.RetryConnect
	}
	return g
}
func boxDefinitions(c Config) []boxDefinition {
	var result []boxDefinition
	var walk func(boxDefinition)
	walk = func(b boxDefinition) {
		result = append(result, b)
		for _, r := range b.Def.Resources {
			p := r.ID
			if b.Path != "" {
				p = b.Path + "/" + r.ID
			}
			walk(boxDefinition{Group: b.Group, Path: p, Def: resourceGroup(b.Def, r), RootCount: b.RootCount,
				Shared: b.Shared || r.Scope == "shared", OwnShared: r.Scope == "shared", Parent: &b})
		}
	}
	for _, g := range c.Groups {
		walk(boxDefinition{Group: g.ID, Def: g, RootCount: g.Count})
	}
	return result
}
func (b boxDefinition) parentNodeID(index int) string { return definitionNodeID(*b.Parent, index) }
func definitionNodeID(b boxDefinition, index int) string {
	if b.Path == "" {
		return fmt.Sprintf("%s-%d", b.Group, index)
	}
	if b.OwnShared {
		return b.Group + "/~" + strings.ReplaceAll(b.Path, "/", "/~")
	}
	return resourceNodeID(b.parentNodeID(index), b.Def.ID)
}
func (e *Engine) boxGroup(n *Node) Group {
	g := e.G[n.Group]
	if n.Resource == "" {
		return g
	}
	for _, id := range strings.Split(n.Resource, "/") {
		for _, r := range g.Resources {
			if r.ID == id {
				g = resourceGroup(g, r)
				break
			}
		}
	}
	return g
}
func resourcePath(from, ref string) string {
	return path.Clean(path.Join(from, ref))
}
func (e *Engine) resolveResource(n *Node, ref string) *Node {
	target := resourcePath(n.Resource, ref)
	for _, r := range e.Nodes {
		if r.Group == n.Group && r.Resource == target && (r.Index == 0 || r.Index == n.Index) && !r.Retired {
			return r
		}
	}
	return nil
}
func matchesTags(when, labels map[string]string) bool {
	for k, v := range when {
		actual, exists := labels[k]
		if !exists || actual != v {
			return false
		}
	}
	return true
}
func validCondition(when map[string]string) bool {
	if len(when) > 16 {
		return false
	}
	for k, v := range when {
		if !labelKey.MatchString(k) || len(v) > 80 {
			return false
		}
	}
	return true
}

// Only changes to the graph/program shape require a restart. Conditions,
// durations, call counts, join policy and link settings apply to future stages.
func programStructure(g Group) []string {
	out := []string{}
	for _, stage := range g.Stages {
		out = append(out, "stage")
		for _, call := range stage.Calls {
			out = append(out, "call:"+call.Target+":"+call.Resource)
		}
	}
	return out
}
func validatePrograms(c Config) error {
	boxes := boxDefinitions(c)
	byID := map[string]boxDefinition{}
	key := func(group, p string) string { return group + "\x00" + p }
	for _, b := range boxes {
		byID[key(b.Group, b.Path)] = b
	}
	targets := map[string][]struct {
		id    string
		count int
	}{}
	for _, b := range boxes {
		g, id := b.Def, key(b.Group, b.Path)
		if g.Stages == nil {
			return errors.New("Every box requires an explicit stages array; use [] for a leaf box.")
		}
		resolve := func(call Call) (boxDefinition, error) {
			if (call.Target == "") == (call.Resource == "") {
				return boxDefinition{}, errors.New("Calls: select exactly one target group or relative resource path")
			}
			targetID := key(call.Target, "")
			if call.Resource != "" {
				targetID = key(b.Group, resourcePath(b.Path, call.Resource))
			}
			target, ok := byID[targetID]
			if !ok || (call.Resource != "" && target.Path == "") {
				return boxDefinition{}, fmt.Errorf("Call target not found: %s%s", call.Target, call.Resource)
			}
			if call.Resource != "" && b.Shared && !target.Shared {
				return boxDefinition{}, errors.New("A shared box cannot call an instance-owned resource without an instance owner")
			}
			return target, nil
		}
		validateCalls := func(calls []Call, join string, quorum int) error {
			if len(calls) > 8 {
				return errors.New("At most 8 calls per stage")
			}
			count := 0
			for _, call := range calls {
				target, err := resolve(call)
				if err != nil {
					return err
				}
				if call.Calls < 1 || call.Calls > 16 {
					return errors.New("calls: between 1 and 16")
				}
				if call.Route != "round_robin" && call.Route != "random" && call.Route != "least_busy" && call.Route != "broadcast" {
					return errors.New("Unknown routing method")
				}
				if call.Network != nil && (!finite(*call.Network) || *call.Network < 0 || *call.Network > 5000) {
					return errors.New("Network latency: 0–5000 ms")
				}
				if call.Transport != "network" && call.Transport != "ideal" {
					return errors.New("Transport: network or ideal")
				}
				if call.Timeout != nil && (!finite(*call.Timeout) || *call.Timeout < 0 || *call.Timeout > 60000) {
					return errors.New("Call timeout override: 0–60000 ms; 0 means no additional budget")
				}
				if !validCondition(call.When) {
					return errors.New("Conditions: use up to 16 request tag key=value pairs")
				}
				n := call.Calls
				if call.Route == "broadcast" && call.Resource == "" {
					n *= target.Def.Count
				}
				count += n
				targets[id] = append(targets[id], struct {
					id    string
					count int
				}{key(target.Group, target.Path), n})
			}
			if join != "all" && join != "any" && join != "quorum" {
				return errors.New("join: all, any or quorum")
			}
			if join == "quorum" && len(calls) > 0 && (quorum < 1 || quorum > count) {
				return errors.New("Quorum must be between 1 and the number of child calls")
			}
			return nil
		}
		for _, stage := range g.Stages {
			if !validCondition(stage.When) {
				return errors.New("Conditions: use up to 16 request tag key=value pairs")
			}
			if len(stage.Calls) == 0 {
				return errors.New("Every stage requires 1–8 explicit calls")
			}
			if err := validateCalls(stage.Calls, stage.Join, stage.Quorum); err != nil {
				return err
			}
		}
		if g.AutoScale != nil && g.AutoScale.Resource != "" {
			if _, ok := byID[key(b.Group, g.AutoScale.Resource)]; !ok {
				return errors.New("Resources: autoscaler references an unknown resource")
			}
		}
	}
	visiting, memo := map[string]bool{}, map[string]int{}
	var visit func(string) (int, error)
	visit = func(id string) (int, error) {
		if visiting[id] {
			return 0, errors.New("Calls must form an acyclic graph; sequential revisits are allowed")
		}
		if n, ok := memo[id]; ok {
			return n, nil
		}
		visiting[id] = true
		count := 1
		for _, call := range targets[id] {
			n, err := visit(call.id)
			if err != nil {
				return 0, err
			}
			count += call.count * n
			if count > 512 {
				return 0, errors.New("Fan-out is too large: at most 512 calls per request")
			}
		}
		visiting[id], memo[id] = false, count
		return count, nil
	}
	for _, b := range boxes {
		if _, err := visit(key(b.Group, b.Path)); err != nil {
			return err
		}
	}
	return nil
}

func (e *Engine) nextStage(s *Span) {
	if s.done {
		return
	}
	if s.node.State != "healthy" {
		s.Phase = "hang"
		e.traceEvent(s, "Work parked", "", 0)
		s.parked = func() { e.nextStage(s) }
		return
	}
	s.parked = nil
	for s.stage < len(s.plan) {
		// Topology is stable during live edits; capture numeric settings and
		// conditions only when their stage begins.
		stage := e.boxGroup(s.node).Stages[s.stage]
		s.stage++
		if !matchesTags(stage.When, s.trace.Labels) {
			e.traceEvent(s, "Stage skipped", "", float64(s.stage))
			continue
		}
		e.traceEvent(s, "Stage started", "", float64(s.stage))
		done := func(ok bool, why string) {
			if s.done {
				return
			}
			if !ok {
				e.respond(s, false, why)
			} else {
				e.nextStage(s)
			}
		}
		e.dispatchCalls(s, stage.Calls, stage.Join, stage.Quorum, done)
		return
	}
	e.respond(s, true, "ok")
}
func (e *Engine) dispatchCalls(s *Span, calls []Call, join string, quorum int, done func(bool, string)) {
	policy := e.downstreamSettings(s.node)
	s.Phase = "children"
	e.traceEvent(s, "Waiting for children", "", 0)
	type target struct {
		n     *Node
		net   float64
		retry bool
		call  Call
	}
	var targets []target
	for i, call := range calls {
		if !matchesTags(call.When, s.trace.Labels) {
			continue
		}
		network := e.C.Network
		if call.Network != nil {
			network = *call.Network
		}
		if call.Transport == "ideal" {
			network = 0
		}
		for j := 0; j < call.Calls; j++ {
			if call.Resource != "" {
				n := e.resolveResource(s.node, call.Resource)
				if n == nil {
					done(false, "resource_unavailable")
					return
				}
				targets = append(targets, target{n, network, false, call})
			} else if call.Route == "broadcast" {
				for _, n := range e.Groups[call.Target] {
					targets = append(targets, target{n, network, false, call})
				}
			} else {
				// Each stage has its own routing cursor.
				routeKey := fmt.Sprintf("%s/stage/%d/%d", s.Node, s.stage, i)
				n := e.routeLocal(call.Target, call.Route, routeKey, call.Affinity, s.trace.Labels, s.Labels)
				targets = append(targets, target{n, network, policy.RetryConnect, call})
			}
		}
	}
	if len(targets) == 0 {
		if join == "quorum" {
			done(false, "quorum_unreachable")
		} else {
			done(true, "ok")
		}
		return
	}
	s.successes, s.remaining = 0, len(targets)
	s.needed = s.remaining
	if join == "any" {
		s.needed = 1
	}
	if join == "quorum" {
		s.needed = quorum
	}
	if s.needed > s.remaining {
		done(false, "quorum_unreachable")
		return
	}
	stageDone, stageStart := false, len(s.children)
	for _, target := range targets {
		timeout := policy.Timeout
		if target.call.Timeout != nil {
			timeout = *target.call.Timeout
		}
		e.callDownstream(s, target.n, target.net, policy.ConnectTimeout, timeout, target.retry, func(ok bool, why string) {
			if s.done || stageDone {
				return
			}
			s.remaining--
			if ok {
				s.successes++
			}
			if s.successes >= s.needed || s.successes+s.remaining < s.needed {
				stageDone = true
				success := s.successes >= s.needed
				if e.C.Cancel {
					for _, child := range s.children[stageStart:] {
						if !child.done {
							e.cancel(child, "cancelled")
						}
					}
				}
				if success {
					done(true, "ok")
				} else {
					done(false, why)
				}
			}
		}, &target.call)
	}
}
