package core

import (
	"errors"
	"fmt"
	"math"
	"reflect"
	"regexp"
)

// Resources use the same Node/FIFO/worker/Span machinery as service boxes.
// Scope defines whether a resource is cloned per instance or shared by a group.
type ResourceConfig struct {
	I18n       Localizations     `json:"i18n,omitempty"`
	Labels     map[string]string `json:"labels,omitempty"`
	Cost       *CostRule         `json:"cost,omitempty"`
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Scope      string            `json:"scope"`
	Workers    int               `json:"workers"`
	Service    float64           `json:"service"`
	QueueLimit int               `json:"queueLimit"`
}
type Stage struct {
	Resource   string `json:"resource,omitempty"`
	Downstream bool   `json:"downstream,omitempty"`
}

func groupStages(g Group) []Stage {
	if g.Stages != nil {
		return g.Stages
	}
	stages := make([]Stage, 0, len(g.Resources)+1)
	for _, r := range g.Resources {
		stages = append(stages, Stage{Resource: r.ID})
	}
	if len(g.Edges) > 0 {
		stages = append(stages, Stage{Downstream: true})
	}
	return stages
}
func resourceVisits(g Group) int {
	n := 0
	for _, s := range groupStages(g) {
		if s.Resource != "" {
			n++
		}
	}
	return n
}
func resourceNodeID(owner, id string) string { return owner + "/~" + id }

var resourceID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,40}$`)

func validateResources(c Config) error {
	total := 0
	used := map[string]bool{}
	for _, g := range c.Groups {
		for i := 1; i <= g.Count; i++ {
			used[fmt.Sprintf("%s-%d", g.ID, i)] = true
		}
	}
	for _, g := range c.Groups {
		if len(g.Resources) > 8 || len(g.Stages) > 16 {
			return errors.New("Resources: at most 8 resources and 16 stages per group")
		}
		ids := map[string]bool{}
		for _, r := range g.Resources {
			if !resourceID.MatchString(r.ID) || r.Name == "" || len(r.Name) > 100 || ids[r.ID] {
				return errors.New("Resources: unique short IDs and names are required")
			}
			ids[r.ID] = true
			owners := []string{g.ID}
			if r.Scope != "shared" {
				owners = nil
				for i := 1; i <= g.Count; i++ {
					owners = append(owners, fmt.Sprintf("%s-%d", g.ID, i))
				}
			}
			for _, owner := range owners {
				id := resourceNodeID(owner, r.ID)
				if used[id] {
					return errors.New("Resources: box IDs collide")
				}
				used[id] = true
			}
			if r.Scope != "instance" && r.Scope != "shared" {
				return errors.New("Resources: scope must be instance or shared")
			}
			if r.Workers < 1 || r.Workers > 512 || r.Service < 0 || r.Service > 10000 || r.QueueLimit < 0 || r.QueueLimit > 2000 {
				return errors.New("Resources: workers 1–512, processing 0–10000 ms, queue 0–2000")
			}
			if r.Scope == "shared" {
				total++
			} else {
				total += g.Count
			}
		}
		downstream := 0
		for _, stage := range groupStages(g) {
			if stage.Downstream {
				if stage.Resource != "" {
					return errors.New("Resources: a stage must select one action")
				}
				downstream++
			} else if !ids[stage.Resource] {
				return errors.New("Resources: stage references an unknown resource")
			}
		}
		if (len(g.Edges) > 0 && downstream != 1) || (len(g.Edges) == 0 && downstream != 0) {
			return errors.New("Resources: include exactly one downstream stage when the group has outgoing edges")
		}
		if g.AutoScale != nil && g.AutoScale.Resource != "" && !ids[g.AutoScale.Resource] {
			return errors.New("Resources: autoscaler references an unknown resource")
		}
	}
	if total > 512 {
		return errors.New("Resources: at most 512 internal boxes")
	}
	return nil
}
func (e *Engine) validateResourceUpdate(c Config) error {
	for i, g := range c.Groups {
		old := e.C.Groups[i]
		if len(g.Resources) != len(old.Resources) || !reflect.DeepEqual(groupStages(g), groupStages(old)) {
			return errors.New("Resources: changing structure requires a restart")
		}
		for j, r := range g.Resources {
			if r.ID != old.Resources[j].ID || r.Scope != old.Resources[j].Scope {
				return errors.New("Resources: changing structure requires a restart")
			}
		}
	}
	return nil
}
func (e *Engine) syncResources(c Config) {
	wanted := map[string]bool{}
	for _, g := range c.Groups {
		for _, r := range g.Resources {
			owners := e.Groups[g.ID]
			if r.Scope == "shared" {
				owners = []*Node{nil}
			}
			for _, owner := range owners {
				ownerID, index := g.ID, 0
				if owner != nil {
					ownerID, index = owner.ID, owner.Index
				}
				id := resourceNodeID(ownerID, r.ID)
				wanted[id] = true
				n := e.resources[id]
				if n == nil {
					n = &Node{ID: id, Group: g.ID, Index: index, Resource: r.ID, Owner: ownerID, OwnerNode: owner, State: "healthy", Active: map[int]*Span{}, Visits: map[int]*Span{}, CreatedAt: e.Now, LoadAt: e.Now, AreaAt: e.Now}
					e.resources[id] = n
					e.Nodes = append(e.Nodes, n)
				}
				e.integrateLoad(n)
				if n.Retired {
					n.State = "healthy"
				}
				n.Retired = false
				n.Draining = false
				n.FrozenLocality = nil
				n.ResourceName = r.Name
				n.ResourceI18n = r.I18n
				n.Workers = r.Workers
				n.Service = r.Service
				if o, ok := c.Overrides[id]; ok {
					if o.Workers != nil {
						n.Workers = *o.Workers
					}
					if o.Service != nil {
						n.Service = *o.Service
					}
				}
			}
		}
	}
	for _, n := range e.Nodes {
		if n.Resource != "" && !wanted[n.ID] && !n.Retired {
			n.Draining = true
			e.retireIfDrained(n)
		}
	}
}
func (e *Engine) bindResources(n *Node) map[string]*Node {
	result := map[string]*Node{}
	for _, r := range e.G[n.Group].Resources {
		owner := n.ID
		if r.Scope == "shared" {
			owner = n.Group
		}
		result[r.ID] = e.resources[resourceNodeID(owner, r.ID)]
	}
	return result
}
func (e *Engine) queueLimit(n *Node) int {
	if n.Resource != "" {
		for _, r := range e.G[n.Group].Resources {
			if r.ID == n.Resource {
				return r.QueueLimit
			}
		}
	}
	return e.G[n.Group].QueueLimit
}
func (e *Engine) nextStage(s *Span) {
	if s.done {
		return
	}
	if s.node.State != "healthy" {
		s.Phase = "hang"
		s.parked = func() { e.nextStage(s) }
		return
	}
	s.parked = nil
	if s.stage >= len(s.plan) {
		e.respond(s, true, "ok")
		return
	}
	stage := s.plan[s.stage]
	s.stage++
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
	if stage.Downstream {
		e.dispatchDownstream(s, done)
		return
	}
	s.Phase = "resource"
	n := s.stageBindings[stage.Resource]
	if n == nil {
		e.respond(s, false, "resource_unavailable")
		return
	}
	e.nextSpan++
	child := &Span{ID: e.nextSpan, Parent: s.ID, Node: n.ID, Resource: n.Resource, ResourceName: n.ResourceName, ResourceI18n: n.ResourceI18n, Start: e.Now, Arrive: -1, WorkStart: -1, LocalEnd: -1, End: -1, Reply: -1, Status: "pending", Phase: "queue", Weight: s.Weight, node: n, trace: s.trace, callback: done, connected: true}
	child.CallerLabels = copyLabels(s.Labels)
	n.Outstanding++
	s.trace.active++
	s.trace.Spans = append(s.trace.Spans, child)
	s.children = append(s.children, child)
	// Internal resources have no TCP handshake or simulated network hop.
	e.arrive(child)
}

type loadPoint struct{ At, Busy, Capacity float64 }

func (e *Engine) integrateLoad(n *Node) {
	dt := e.Now - n.LoadAt
	if dt > 0 {
		n.BusyArea += float64(len(n.Active)) * dt
		if !n.Retired {
			n.CapacityArea += float64(n.Workers) * dt
		}
		n.LoadAt = e.Now
	}
}
func (e *Engine) sampleLoads() {
	for _, n := range e.Nodes {
		e.integrateLoad(n)
		n.LoadHistory = append(n.LoadHistory, loadPoint{e.Now, n.BusyArea, n.CapacityArea})
		for len(n.LoadHistory) > 2 && n.LoadHistory[1].At < e.Now-60000 {
			n.LoadHistory = n.LoadHistory[1:]
		}
	}
}
func (e *Engine) loadWindow(n *Node, window float64) (float64, float64) {
	e.integrateLoad(n)
	start := math.Max(n.CreatedAt, e.Now-window)
	prior := loadPoint{n.CreatedAt, 0, 0}
	current := loadPoint{e.Now, n.BusyArea, n.CapacityArea}
	history := n.LoadHistory
	for _, point := range history {
		if point.At <= start {
			prior = point
			continue
		}
		current = point
		break
	}
	ratio := 0.0
	if current.At > prior.At {
		ratio = (start - prior.At) / (current.At - prior.At)
	}
	ratio = math.Max(0, math.Min(1, ratio))
	busy := prior.Busy + (current.Busy-prior.Busy)*ratio
	capacity := prior.Capacity + (current.Capacity-prior.Capacity)*ratio
	return math.Max(0, n.BusyArea-busy), math.Max(0, n.CapacityArea-capacity)
}
func (e *Engine) sensorNodes(g Group) []*Node {
	if g.AutoScale.Resource == "" {
		return e.Groups[g.ID]
	}
	var nodes []*Node
	for _, n := range e.Nodes {
		if n.Group == g.ID && n.Resource == g.AutoScale.Resource && !n.Draining && !n.Retired {
			nodes = append(nodes, n)
		}
	}
	return nodes
}
func resourceReason(util, threshold float64) string {
	return fmt.Sprintf("Utilization %.1f%% > %.1f%%", util, threshold)
}
