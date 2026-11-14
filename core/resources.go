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
	I18n             Localizations     `json:"i18n,omitempty"`
	Labels           map[string]string `json:"labels,omitempty"`
	Cost             *CostRule         `json:"cost,omitempty"`
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Scope            string            `json:"scope"`
	Workers          int               `json:"workers"`
	Service          float64           `json:"service"`
	QueueLimit       int               `json:"queueLimit"`
	Resources        []ResourceConfig  `json:"resources,omitempty"`
	Stages           []Stage           `json:"stages"`
	Keepalive        *bool             `json:"keepalive,omitempty"`
	KeepaliveTimeout *float64          `json:"keepaliveTimeout,omitempty"`
	ConnectTimeout   *float64          `json:"connectTimeout,omitempty"`
	Timeout          *float64          `json:"timeout,omitempty"`
	RetryConnect     *bool             `json:"retryConnect,omitempty"`
}
type Stage struct {
	Calls  []Call            `json:"calls"`
	When   map[string]string `json:"when,omitempty"`
	Join   string            `json:"join"`
	Quorum int               `json:"quorum,omitempty"`
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
	for _, b := range boxDefinitions(c) {
		g := b.Def
		if len(g.Resources) > 8 || len(g.Stages) > 16 {
			return errors.New("Resources: at most 8 resources and 16 stages per box")
		}
		ids := map[string]bool{}
		for _, r := range g.Resources {
			if !resourceID.MatchString(r.ID) || r.Name == "" || len(r.Name) > 100 || ids[r.ID] {
				return errors.New("Resources: unique short IDs and names are required")
			}
			ids[r.ID] = true
			if r.Scope != "instance" && r.Scope != "shared" {
				return errors.New("Resources: scope must be instance or shared")
			}
			if r.Workers < 1 || r.Workers > 512 || !finite(r.Service) || r.Service < 0 || r.Service > 10000 || r.QueueLimit < 0 || r.QueueLimit > 2000 {
				return errors.New("Resources: workers 1–512, processing 0–10000 ms, queue 0–2000")
			}
		}
		if b.Path == "" {
			continue
		}
		copies := b.RootCount
		if b.Shared {
			copies = 1
		}
		total += copies
		if total > 512 {
			return errors.New("Resources: at most 512 internal boxes")
		}
		for i := 1; i <= copies; i++ {
			id := definitionNodeID(b, i)
			if used[id] {
				return errors.New("Resources: box IDs collide")
			}
			used[id] = true
		}
	}
	return nil
}
func (e *Engine) validateResourceUpdate(c Config) error {
	before, after := boxDefinitions(e.C), boxDefinitions(c)
	if len(before) != len(after) {
		return errors.New("Resources: changing structure requires a restart")
	}
	for i, b := range before {
		a := after[i]
		if b.Group != a.Group || b.Path != a.Path || b.Shared != a.Shared || b.OwnShared != a.OwnShared || !reflect.DeepEqual(programStructure(b.Def), programStructure(a.Def)) {
			return errors.New("Resources: changing structure requires a restart")
		}
	}
	return nil
}
func (e *Engine) syncResources(c Config) {
	wanted := map[string]bool{}
	for _, b := range boxDefinitions(c) {
		if b.Path == "" {
			continue
		}
		copies := b.RootCount
		if b.Shared {
			copies = 1
		}
		for i := 1; i <= copies; i++ {
			id := definitionNodeID(b, i)
			ownerID := b.Group
			var owner *Node
			index := i
			if b.Shared {
				index = 0
			}
			if !b.OwnShared {
				ownerID = b.parentNodeID(i)
				for _, candidate := range e.Nodes {
					if candidate.ID == ownerID {
						owner = candidate
						break
					}
				}
			}
			wanted[id] = true
			n := e.resources[id]
			if n == nil {
				n = &Node{ID: id, Group: b.Group, Index: index, Resource: b.Path, Owner: ownerID, OwnerNode: owner, State: "healthy", Active: map[int]*Span{}, Visits: map[int]*Span{}, CreatedAt: e.Now, LoadAt: e.Now, AreaAt: e.Now}
				e.resources[id] = n
				e.Nodes = append(e.Nodes, n)
			}
			e.integrateLoad(n)
			if n.Retired {
				n.State = "healthy"
			}
			n.Retired, n.Draining = false, false
			n.FrozenLocality, n.FrozenDownstream = nil, nil
			n.ResourceName, n.ResourceI18n = b.Def.Name, b.Def.I18n
			n.Workers, n.Service = b.Def.Workers, b.Def.Service
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
	for _, n := range e.Nodes {
		if n.Resource != "" && !wanted[n.ID] && !n.Retired {
			n.Draining = true
			e.retireIfDrained(n)
		}
	}
}
func (e *Engine) queueLimit(n *Node) int { return e.boxGroup(n).QueueLimit }

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
