package core

import (
	"errors"
	"math"
	"regexp"
)

type MatchRule struct {
	Enabled bool   `json:"enabled"`
	Source  string `json:"source"` // request or caller
	Key     string `json:"key"`
}
type CostRule struct {
	MatchRule
	Match    float64 `json:"match"`
	Mismatch float64 `json:"mismatch"`
}
type TagGenerator struct {
	Key     string  `json:"key"`
	A       string  `json:"a"`
	B       string  `json:"b"`
	Percent float64 `json:"percent"`
}
type LocalityDecision struct {
	Source string  `json:"source"`
	Key    string  `json:"key"`
	From   string  `json:"from"`
	To     string  `json:"to"`
	Result string  `json:"result"` // match, mismatch or missing
	Factor float64 `json:"factor"`
}
type WorkCost struct {
	Base     float64           `json:"base"`
	Weight   float64           `json:"weight"`
	Factor   float64           `json:"factor"`
	Nominal  float64           `json:"nominal"`
	Duration float64           `json:"duration"`
	Locality *LocalityDecision `json:"locality,omitempty"`
}

type frozenLocality struct {
	Labels map[string]string
	Cost   *CostRule
}

func (e *Engine) freezeLocality(n *Node) *frozenLocality {
	f := &frozenLocality{Labels: e.nodeLabels(n)}
	if c := e.nodeCost(n); c != nil {
		value := *c
		f.Cost = &value
	}
	return f
}

var labelKey = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,40}$`)

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func validateLocality(c Config) error {
	labels := func(m map[string]string) bool {
		if len(m) > 16 {
			return false
		}
		for k, v := range m {
			if !labelKey.MatchString(k) || len(v) > 80 {
				return false
			}
		}
		return true
	}
	rule := func(r *MatchRule) bool {
		return r == nil || !r.Enabled || ((r.Source == "caller" || r.Source == "request") && labelKey.MatchString(r.Key))
	}
	cost := func(r *CostRule) bool {
		return r == nil || (rule(&r.MatchRule) && finite(r.Match) && finite(r.Mismatch) && r.Match >= 0 && r.Match <= 100 && r.Mismatch >= 0 && r.Mismatch <= 100)
	}
	if !labels(c.RequestLabels) || !rule(c.EntryAffinity) {
		return errors.New("Locality: invalid labels or comparison")
	}
	if r := c.RequestTag; r != nil {
		if !labelKey.MatchString(r.Key) || r.A == "" || r.B == "" || len(r.A) > 80 || len(r.B) > 80 || !finite(r.Percent) || r.Percent < 0 || r.Percent > 100 {
			return errors.New("Locality: invalid request tag distribution")
		}
	}
	for _, b := range boxDefinitions(c) {
		g := b.Def
		if !labels(g.Labels) || !cost(g.Cost) {
			return errors.New("Locality: invalid labels or cost (0-100)")
		}
		for _, r := range g.Resources {
			if !labels(r.Labels) || !cost(r.Cost) {
				return errors.New("Locality: invalid labels or cost (0-100)")
			}
		}
		calls := []Call{}
		for _, stage := range g.Stages {
			calls = append(calls, stage.Calls...)
		}
		for _, call := range calls {
			if !rule(call.Affinity) || !cost(call.NetworkCost) {
				return errors.New("Locality: invalid call rule")
			}
			if call.Route == "broadcast" && call.Affinity != nil && call.Affinity.Enabled {
				return errors.New("Locality: broadcast cannot prefer a subset")
			}
		}
	}
	for _, o := range c.Overrides {
		if !labels(o.Labels) || !cost(o.Cost) {
			return errors.New("Locality: invalid node labels or cost")
		}
	}
	return nil
}
func copyLabels(m map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range m {
		out[k] = v
	}
	return out
}
func mergeLabels(a, b map[string]string) map[string]string {
	out := copyLabels(a)
	for k, v := range b {
		if v == "" {
			delete(out, k)
		} else {
			out[k] = v
		}
	}
	return out
}
func (e *Engine) requestLabels() map[string]string {
	out := copyLabels(e.C.RequestLabels)
	if r := e.C.RequestTag; r != nil {
		v := r.B
		if e.random()*100 < r.Percent {
			v = r.A
		}
		out[r.Key] = v
	}
	return out
}
func (e *Engine) nodeLabels(n *Node) map[string]string {
	if n.FrozenLocality != nil {
		return copyLabels(n.FrozenLocality.Labels)
	}
	g := e.G[n.Group]
	m := copyLabels(g.Labels)
	if n.Resource != "" {
		if n.OwnerNode != nil {
			m = e.nodeLabels(n.OwnerNode)
		}
		m = mergeLabels(m, e.boxGroup(n).Labels)
	}
	return mergeLabels(m, e.C.Overrides[n.ID].Labels)
}
func (e *Engine) nodeCost(n *Node) *CostRule {
	if n.FrozenLocality != nil {
		return n.FrozenLocality.Cost
	}
	if o := e.C.Overrides[n.ID]; o.Cost != nil {
		return o.Cost
	}
	return e.boxGroup(n).Cost
}
func decide(r *MatchRule, request, caller, target map[string]string) *LocalityDecision {
	if r == nil || !r.Enabled {
		return nil
	}
	from := request[r.Key]
	if r.Source == "caller" {
		from = caller[r.Key]
	}
	d := &LocalityDecision{Source: r.Source, Key: r.Key, From: from, To: target[r.Key], Result: "missing", Factor: 1}
	if d.From != "" && d.To != "" {
		d.Result = "mismatch"
		if d.From == d.To {
			d.Result = "match"
		}
	}
	return d
}
func decideCost(r *CostRule, request, caller, target map[string]string) *LocalityDecision {
	if r == nil {
		return nil
	}
	d := decide(&r.MatchRule, request, caller, target)
	if d == nil {
		return nil
	}
	if d.Result == "match" {
		d.Factor = r.Match
	} else if d.Result == "mismatch" {
		d.Factor = r.Mismatch
	}
	return d
}
func (e *Engine) routeLocal(group, mode, key string, r *MatchRule, request, caller map[string]string) *Node {
	if r == nil || !r.Enabled {
		return e.route(group, mode, key)
	}
	nodes := e.Groups[group]
	local := []*Node{}
	for _, n := range nodes {
		if d := decide(r, request, caller, e.nodeLabels(n)); d != nil && d.Result == "match" {
			local = append(local, n)
		}
	}
	if len(local) == 0 {
		return e.route(group, mode, key)
	}
	if mode == "random" {
		return local[int(e.random()*float64(len(local)))]
	}
	if mode == "least_busy" {
		best := local[0]
		for _, n := range local {
			if len(n.Visits) < len(best.Visits) {
				best = n
			}
		}
		return best
	}
	// Independent round-robin cursors prevent interleaved locality classes
	// from repeatedly choosing the same member of their respective subsets.
	from := request[r.Key]
	if r.Source == "caller" {
		from = caller[r.Key]
	}
	key += "\x00locality\x00" + from
	i := e.rr[key]
	e.rr[key] = i + 1
	return local[i%len(local)]
}
func (e *Engine) orderRetry(nodes []*Node, r *MatchRule, request, caller map[string]string) []*Node {
	if len(nodes) < 2 {
		return nodes
	}
	out := []*Node{nodes[0]}
	remote := []*Node{}
	for _, n := range nodes[1:] {
		d := decide(r, request, caller, e.nodeLabels(n))
		if d != nil && d.Result == "match" {
			out = append(out, n)
		} else {
			remote = append(remote, n)
		}
	}
	return append(out, remote...)
}
func (e *Engine) prepareHop(s, parent *Span, calls []*Call) {
	s.NetworkBase = s.network
	s.NetworkDelay = s.network
	if parent != nil {
		s.CallerLabels = copyLabels(parent.Labels)
	}
	if len(calls) > 0 && calls[0] != nil {
		call := calls[0]
		target := e.nodeLabels(s.node)
		s.NetworkLocality = decideCost(call.NetworkCost, s.trace.Labels, s.CallerLabels, target)
		s.RoutingLocality = decide(call.Affinity, s.trace.Labels, s.CallerLabels, target)
		if s.NetworkLocality != nil {
			s.network *= s.NetworkLocality.Factor
			s.NetworkDelay = s.network
		}
		d := s.RoutingLocality
		if d == nil || d.Result == "missing" {
			d = s.NetworkLocality
		}
		if d != nil && d.Result != "missing" {
			s.node.HopKnown++
			if d.Result == "mismatch" {
				s.node.HopRemote++
			}
		}
	}
}
func (e *Engine) processingCost(s *Span) float64 {
	if s.WorkCost != nil {
		return s.WorkCost.Duration
	}
	d := decideCost(e.nodeCost(s.node), s.trace.Labels, s.CallerLabels, s.Labels)
	factor := 1.0
	if d != nil {
		factor = d.Factor
		if d.Result != "missing" {
			s.node.CostKnown++
			if d.Result == "mismatch" {
				s.node.CostRemote++
			}
		}
	}
	nominal := s.node.Service * s.Weight * factor
	s.WorkCost = &WorkCost{Base: s.node.Service, Weight: s.Weight, Factor: factor, Nominal: nominal, Duration: e.duration(nominal), Locality: d}
	return s.WorkCost.Duration
}
func AZConfig() Config {
	return retimePreset(referenceAZConfig())
}

func referenceAZConfig() Config {
	c := referenceDefaultConfig()
	c.Name = "Two zones · locality"
	c.Description = "Two zones: each LB prefers backends in its AZ. Select an LB → Locality, disable matching preference and compare cross-zone calls and latency. Scaling inherits group labels; placement of new nodes across zones is manual."
	c.I18n = Localizations{"ru": {Name: "Две зоны · локальность", Description: "Две зоны: LB предпочитает бекенды в своей AZ. Выберите LB → Локальность, отключите предпочтение совпадения и сравните межзонные вызовы и задержку. Масштабирование наследует метки группы; распределение новых узлов между зонами задаётся вручную."}}
	c.EntryAffinity = &MatchRule{true, "request", "az"}
	c.RequestTag = &TagGenerator{"az", "az1", "az2", 50}
	c.Groups[0].Count = 2
	c.Groups[2].Count = 2
	c.Overrides = map[string]NodeConfig{}
	for i := range c.Groups {
		g := &c.Groups[i]
		g.Labels = map[string]string{"az": "az1"}
		for si := range g.Stages {
			for ci := range g.Stages[si].Calls {
				call := &g.Stages[si].Calls[ci]
				if call.Target != "" {
					call.Affinity = &MatchRule{true, "caller", "az"}
					call.NetworkCost = &CostRule{MatchRule{true, "caller", "az"}, 1, 3}
				}
			}
		}
	}
	c.Overrides["lb-2"] = NodeConfig{Labels: map[string]string{"az": "az2"}}
	c.Overrides["api-2"] = NodeConfig{Labels: map[string]string{"az": "az2"}}
	c.Overrides["api-4"] = NodeConfig{Labels: map[string]string{"az": "az2"}}
	c.Overrides["db-2"] = NodeConfig{Labels: map[string]string{"az": "az2"}}
	return c
}
func NUMAConfig() Config {
	return retimePreset(referenceNUMAConfig())
}

func referenceNUMAConfig() Config {
	c := referenceDefaultConfig()
	c.Name = "NUMA · illustrative memory cost"
	c.Description = "NUMA: by default, data is distributed 50/50 across nodes. The request label selects the memory holding the data. Access from another CPU node costs ×3. Under Request labels, enable entry preference by request.numa and compare. Times are illustrative; bandwidth and cache coherence are not modeled."
	c.I18n = Localizations{"ru": {Name: "NUMA · условная стоимость памяти", Description: "NUMA: по умолчанию данные распределены 50/50 между нодами. Метка запроса выбирает память с данными. Доступ из другой CPU-ноды стоит ×3. В «Метках запросов» включите предпочтение входного ящика по request.numa и сравните. Время условное: пропускная способность и когерентность кешей не моделируются."}}
	c.Entry = "cpu"
	c.Network = 0
	c.RPS = 200
	c.Jitter = 0
	c.RequestTag = &TagGenerator{"numa", "0", "1", 50}
	c.EntryAffinity = &MatchRule{false, "request", "numa"}
	c.Groups = []Group{
		{ID: "cpu", Name: "CPU nodes", I18n: Localizations{"ru": {Name: "CPU-ноды"}}, Labels: map[string]string{"numa": "0"}, Count: 2, Workers: 4, Service: 4, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 500, Stages: []Stage{{Calls: []Call{{Target: "memory", Calls: 1, Route: "round_robin", Affinity: &MatchRule{true, "request", "numa"}, Transport: "network"}}, Join: "all", Quorum: 1}}},
		{ID: "memory", Name: "Node memory", I18n: Localizations{"ru": {Name: "Память нод"}}, Labels: map[string]string{"numa": "0"}, Cost: &CostRule{MatchRule{true, "caller", "numa"}, 1, 3}, Count: 2, Workers: 4, Service: 6, Timeout: 1000, ConnectTimeout: 100, QueueLimit: 500, Stages: []Stage{}},
	}
	c.Overrides = map[string]NodeConfig{"cpu-2": {Labels: map[string]string{"numa": "1"}}, "memory-2": {Labels: map[string]string{"numa": "1"}}}
	return c
}
