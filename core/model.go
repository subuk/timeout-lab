package core

import (
	"container/heap"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

type Call struct {
	Timeout     *float64          `json:"timeout,omitempty"`
	Resource    string            `json:"resource,omitempty"`
	When        map[string]string `json:"when,omitempty"`
	Transport   string            `json:"transport"`
	Affinity    *MatchRule        `json:"affinity,omitempty"`
	NetworkCost *CostRule         `json:"networkCost,omitempty"`
	Target      string            `json:"target,omitempty"`
	Calls       int               `json:"calls"`
	Route       string            `json:"route"`
	Network     *float64          `json:"network,omitempty"`
}
type Group struct {
	Keepalive        *bool             `json:"keepalive,omitempty"`
	KeepaliveTimeout *float64          `json:"keepaliveTimeout,omitempty"`
	I18n             Localizations     `json:"i18n,omitempty"`
	Labels           map[string]string `json:"labels,omitempty"`
	Cost             *CostRule         `json:"cost,omitempty"`
	Resources        []ResourceConfig  `json:"resources,omitempty"`
	Stages           []Stage           `json:"stages"`
	AutoScale        *AutoScalePolicy  `json:"autoscale,omitempty"`
	RetryConnect     *bool             `json:"retryConnect,omitempty"`
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Count            int               `json:"count"`
	Workers          int               `json:"workers"`
	Service          float64           `json:"service"`
	Timeout          float64           `json:"timeout"`
	ConnectTimeout   float64           `json:"connectTimeout"`
	QueueLimit       int               `json:"queueLimit"`
}
type NodeConfig struct {
	Keepalive        *bool             `json:"keepalive,omitempty"`
	KeepaliveTimeout *float64          `json:"keepaliveTimeout,omitempty"`
	Timeout          *float64          `json:"timeout,omitempty"`
	ConnectTimeout   *float64          `json:"connectTimeout,omitempty"`
	RetryConnect     *bool             `json:"retryConnect,omitempty"`
	Labels           map[string]string `json:"labels,omitempty"`
	Cost             *CostRule         `json:"cost,omitempty"`
	Service          *float64          `json:"service,omitempty"`
	Workers          *int              `json:"workers,omitempty"`
	State            string            `json:"state,omitempty"`
}
type Config struct {
	Version       int                   `json:"version"`
	Description   string                `json:"description,omitempty"`
	I18n          Localizations         `json:"i18n,omitempty"`
	RequestLabels map[string]string     `json:"requestLabels,omitempty"`
	RequestTag    *TagGenerator         `json:"requestTag,omitempty"`
	EntryAffinity *MatchRule            `json:"entryAffinity,omitempty"`
	Name          string                `json:"name"`
	Entry         string                `json:"entry"`
	RPS           float64               `json:"rps"`
	Weight        float64               `json:"weight"`
	Spread        float64               `json:"spread"`
	Network       float64               `json:"network"`
	Jitter        float64               `json:"jitter"`
	Deadline      float64               `json:"deadline"`
	Cancel        bool                  `json:"cancel"`
	Client        *ClientConnections    `json:"client,omitempty"`
	Seed          uint64                `json:"seed"`
	Groups        []Group               `json:"groups"`
	Overrides     map[string]NodeConfig `json:"overrides,omitempty"`
}

func DefaultConfig() Config {
	return retimePreset(referenceDefaultConfig())
}

// Reference workloads use their original rates; built-in presets are retimed
// once, after the complete graph has been assembled.
func referenceDefaultConfig() Config {
	return Config{Version: 2, Name: "Load balancer → backends → database", Description: "Requests pass through a load balancer and API backends to a database. Adjust the load and processing times to see queues grow and service workers wait for child calls.", I18n: Localizations{"ru": {Name: "Балансер → бекенды → база", Description: "Запросы проходят через балансер и бекенды API к базе данных. Меняйте нагрузку и время обработки, наблюдайте за ростом очередей и ожиданием дочерних вызовов, которое занимает воркеры сервисов."}}, Entry: "lb", RPS: 200, Weight: 1, Spread: 20, Network: 5, Jitter: 10, Deadline: 3000, Cancel: true, Seed: 42, Groups: []Group{
		{ID: "lb", Name: "Load balancer", I18n: Localizations{"ru": {Name: "Балансер"}}, Count: 1, Workers: 256, Service: 2, Timeout: 1500, ConnectTimeout: 200, QueueLimit: 500, Stages: []Stage{{Calls: []Call{{Target: "api", Calls: 1, Route: "round_robin", Transport: "network"}}, Join: "all", Quorum: 1}}},
		{ID: "api", Name: "Backends", I18n: Localizations{"ru": {Name: "Бекенды"}}, Count: 4, Workers: 16, Service: 0, Resources: []ResourceConfig{{ID: "compute", Name: "CPU", Scope: "instance", Workers: 2, Service: 8, QueueLimit: 500, Stages: []Stage{}}}, Stages: []Stage{{Calls: []Call{{Resource: "compute", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}, {Calls: []Call{{Target: "db", Calls: 1, Route: "round_robin", Transport: "network"}}, Join: "all", Quorum: 1}, {Calls: []Call{{Resource: "compute", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}, Timeout: 700, ConnectTimeout: 200, QueueLimit: 500},
		{ID: "db", Name: "Database", I18n: Localizations{"ru": {Name: "База данных"}}, Count: 1, Workers: 24, Service: 0, Resources: []ResourceConfig{{ID: "compute", Name: "CPU", Scope: "instance", Workers: 2, Service: 1, QueueLimit: 500, Stages: []Stage{}}, {ID: "storage", Name: "Disk", I18n: Localizations{"ru": {Name: "Диск"}}, Scope: "instance", Workers: 4, Service: 4, QueueLimit: 500, Stages: []Stage{}}}, Stages: []Stage{{Calls: []Call{{Resource: "compute", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}, {Calls: []Call{{Resource: "storage", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}, {Calls: []Call{{Resource: "compute", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}, Timeout: 500, ConnectTimeout: 200, QueueLimit: 500},
	}}
}
func Validate(c Config) error {
	if c.Version != 2 {
		return errors.New("Model version 2 is required. Legacy model formats are not supported.")
	}
	if err := validateConnections(c); err != nil {
		return err
	}
	if err := validateModelI18n(c); err != nil {
		return err
	}
	if err := validateLocality(c); err != nil {
		return err
	}
	if len(c.Groups) < 1 || len(c.Groups) > 12 {
		return errors.New("Between 1 and 12 groups are required")
	}
	if c.RPS < 0 || c.RPS > 2000 || c.Weight <= 0 || c.Weight > 10 || c.Network < 0 || c.Network > 5000 || c.Deadline < 1 || c.Deadline > 60000 || c.Jitter < 0 || c.Jitter > 100 || c.Spread < 0 || c.Spread > 100 {
		return errors.New("Check RPS (0–2000), weight (0–10), network (0–5000 ms), deadline (1–60000 ms) and variation (0–100%)")
	}
	if err := validateResources(c); err != nil {
		return err
	}
	groups := map[string]Group{}
	total := 0
	for _, g := range c.Groups {
		if g.ID == "" || len(g.ID) > 40 || len(g.Name) > 100 {
			return errors.New("Each group needs a short ID and a name")
		}
		if _, ok := groups[g.ID]; ok {
			return errors.New("Group IDs must be unique")
		}
		if g.Count < 1 || g.Count > 16 || g.Workers < 1 || g.Workers > 512 || g.Service < 0 || g.Service > 10000 || g.Timeout < 1 || g.Timeout > 60000 || g.ConnectTimeout < 1 || g.ConnectTimeout > 60000 || g.QueueLimit < 0 || g.QueueLimit > 2000 {
			return fmt.Errorf("Invalid parameters for group %s", g.ID)
		}
		if g.AutoScale != nil {
			if err := g.AutoScale.validate(); err != nil {
				return fmt.Errorf("%s: %w", g.ID, err)
			}
		}
		groups[g.ID] = g
		total += g.Count
	}
	if total > 64 {
		return errors.New("At most 64 nodes")
	}
	if _, ok := groups[c.Entry]; !ok {
		return errors.New("Entry group not found")
	}
	if err := validatePrograms(c); err != nil {
		return err
	}
	validNodes := map[string]bool{}
	for _, g := range c.Groups {
		for i := 1; i <= g.Count; i++ {
			validNodes[fmt.Sprintf("%s-%d", g.ID, i)] = true
		}
	}
	for _, b := range boxDefinitions(c) {
		if b.Path == "" {
			continue
		}
		for i := 1; i <= b.RootCount; i++ {
			validNodes[definitionNodeID(b, i)] = true
		}
	}
	for id, o := range c.Overrides {
		if !validNodes[id] {
			return fmt.Errorf("Override node not found: %s", id)
		}
		if o.Service != nil && (*o.Service < 0 || *o.Service > 10000) {
			return errors.New("Processing override: 0–10000 ms")
		}
		if o.Workers != nil && (*o.Workers < 1 || *o.Workers > 512) {
			return errors.New("Worker override: 1–512")
		}
		if o.State != "" && o.State != "healthy" && o.State != "down" && o.State != "hang" && o.State != "blackhole" {
			return errors.New("Unknown state override")
		}
	}
	return nil
}

type event struct {
	at  float64
	seq uint64
	fn  func()
}
type events []event

func (h events) Len() int { return len(h) }
func (h events) Less(i, j int) bool {
	if h[i].at == h[j].at {
		return h[i].seq < h[j].seq
	}
	return h[i].at < h[j].at
}
func (h events) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *events) Push(x any)   { *h = append(*h, x.(event)) }
func (h *events) Pop() any     { a := *h; x := a[len(a)-1]; *h = a[:len(a)-1]; return x }

type Span struct {
	connectionRef         *pooledConnection
	connectionReleased    bool
	connectionEpoch       uint64
	Connection            string `json:"connection,omitempty"`
	ConnectionEstablished bool   `json:"connectionEstablished,omitempty"`
	ConnectionClosed      bool   `json:"connectionClosed,omitempty"`
	connectionKey         string
	connectionID          uint64
	cacheConnection       bool
	ResourceI18n          Localizations     `json:"resourceI18n,omitempty"`
	Labels                map[string]string `json:"labels,omitempty"`
	CallerLabels          map[string]string `json:"callerLabels,omitempty"`
	WorkCost              *WorkCost         `json:"workCost,omitempty"`
	NetworkLocality       *LocalityDecision `json:"networkLocality,omitempty"`
	RoutingLocality       *LocalityDecision `json:"routingLocality,omitempty"`
	NetworkBase           float64           `json:"networkBase"`
	NetworkDelay          float64           `json:"networkDelay"`
	Resource              string            `json:"resource,omitempty"`
	ResourceName          string            `json:"resourceName,omitempty"`
	stage                 int
	plan                  []Stage
	downstream            func(bool, string)

	Attempt    int     `json:"attempt,omitempty"`
	RetryOf    int     `json:"retryOf,omitempty"`
	ID         int     `json:"id"`
	Parent     int     `json:"parent"`
	Node       string  `json:"node"`
	Start      float64 `json:"start"`
	Arrive     float64 `json:"arrive"`
	WorkStart  float64 `json:"workStart"`
	LocalEnd   float64 `json:"localEnd"`
	End        float64 `json:"end"`
	Reply      float64 `json:"reply"`
	Status     string  `json:"status"`
	Phase      string  `json:"phase"`
	Weight     float64 `json:"weight"`
	node       *Node
	trace      *Trace
	done       bool
	settled    bool
	occupied   bool
	started    bool
	parked     func()
	callback   func(bool, string)
	children   []*Span
	remaining  int
	successes  int
	needed     int
	generation int
	network    float64
	connected  bool
}
type Trace struct {
	Manual   bool              `json:"manual,omitempty"`
	Deadline float64           `json:"deadline,omitempty"`
	Events   []TraceEvent      `json:"events,omitempty"`
	Labels   map[string]string `json:"labels,omitempty"`
	ID       int               `json:"id"`
	Start    float64           `json:"start"`
	End      float64           `json:"end"`
	Weight   float64           `json:"weight"`
	OK       bool              `json:"ok"`
	Reason   string            `json:"reason"`
	Spans    []*Span           `json:"spans"`
	done     bool
	active   int
}
type completion struct {
	at, w, queue, local, wait float64
	ok                        bool
}
type Node struct {
	FrozenDownstream *DownstreamSettings
	ResourceI18n     Localizations
	FrozenLocality   *frozenLocality
	CostKnown        int
	CostRemote       int
	HopKnown         int
	HopRemote        int
	Resource         string
	ResourceName     string
	Owner            string
	OwnerNode        *Node
	CreatedAt        float64
	BusyArea         float64
	CapacityArea     float64
	LoadAt           float64
	LoadHistory      []loadPoint

	Draining    bool
	Retired     bool
	Outstanding int // Includes calls already routed but still connecting/in transit.
	ID          string
	Group       string
	Index       int
	Workers     int
	Service     float64
	State       string
	Active      map[int]*Span
	Queue       []*Span
	Visits      map[int]*Span
	Area        float64
	AreaAt      float64
	Arrivals    int
	Exited      int
	Errors      int
	SumW        float64
	SumQ        float64
	SumLocal    float64
	SumWait     float64
	Completed   []completion
}
type Point struct {
	T         float64 `json:"t"`
	Goodput   float64 `json:"goodput"`
	P95       float64 `json:"p95"`
	ErrorRate float64 `json:"errorRate"`
	Queue     int     `json:"queue"`
	Busy      int     `json:"busy"`
	Pending   int     `json:"pending"`
}
type Log struct {
	T    float64 `json:"t"`
	Text string  `json:"text"`
}
type Engine struct {
	auto             map[string]*autoScaleState
	inAutoScale      bool
	ScaleEvents      []ScaleEvent
	C                Config
	Now              float64
	Nodes            []*Node
	Groups           map[string][]*Node
	G                map[string]Group
	Events           events
	seq              uint64
	rng              uint64
	rr               map[string]int
	connections      map[string]*pooledConnection
	connectionEpochs map[string]uint64
	nextConnection   uint64
	resources        map[string]*Node
	nextSpan         int
	ManualMode       bool
	Focus            *Trace
	arrivalEpoch     uint64
	nextTrace        int
	Traces           map[int]*Trace
	Recent           []*Trace
	Results          []completion
	Arrivals         int
	OK               int
	Failed           int
	Pending          int
	History          []Point
	Log              []Log
}

func normalize(c *Config) {
	normalizeConnections(c)
	for i := range c.Groups {
		if c.Groups[i].RetryConnect == nil {
			enabled := true
			c.Groups[i].RetryConnect = &enabled
		}
		if c.Groups[i].AutoScale == nil {
			c.Groups[i].AutoScale = DefaultAutoScale()
		}
		p := c.Groups[i].AutoScale
		if p.Signal == "" {
			p.Signal = "queue"
			p.UpUtilization = 75
		}
		if p.Window == 0 {
			p.Window = 5000
		}
	}
}
func New(c Config) (*Engine, error) {
	normalize(&c)
	if err := Validate(c); err != nil {
		return nil, err
	}
	e := &Engine{auto: map[string]*autoScaleState{}, C: c, Groups: map[string][]*Node{}, G: map[string]Group{}, rr: map[string]int{}, connections: map[string]*pooledConnection{}, connectionEpochs: map[string]uint64{}, resources: map[string]*Node{}, rng: c.Seed, Traces: map[int]*Trace{}}
	for _, g := range c.Groups {
		e.G[g.ID] = g
		for i := 0; i < g.Count; i++ {
			n := &Node{ID: fmt.Sprintf("%s-%d", g.ID, i+1), Group: g.ID, Index: i + 1, Workers: g.Workers, Service: g.Service, State: "healthy", Active: map[int]*Span{}, Visits: map[int]*Span{}}
			e.Nodes = append(e.Nodes, n)
			e.Groups[g.ID] = append(e.Groups[g.ID], n)
		}
	}
	e.syncResources(c)
	overrideIDs := make([]string, 0, len(c.Overrides))
	for id := range c.Overrides {
		overrideIDs = append(overrideIDs, id)
	}
	sort.Strings(overrideIDs)
	for _, id := range overrideIDs {
		o := c.Overrides[id]
		e.SetNode(id, o.State, o.Service, o.Workers)
	}
	e.note("New experiment · seed " + fmt.Sprint(c.Seed))
	e.scheduleArrival()
	e.at(500, e.sample)
	return e, nil
}
func (e *Engine) random() float64 {
	e.rng = e.rng*6364136223846793005 + 1442695040888963407
	return float64(e.rng>>11) / 9007199254740992
}
func (e *Engine) duration(v float64) float64 {
	return math.Max(.001, v*(1+(2*e.random()-1)*e.C.Jitter/100))
}
func (e *Engine) at(dt float64, fn func()) {
	e.seq++
	heap.Push(&e.Events, event{e.Now + math.Max(0, dt), e.seq, fn})
}
func (e *Engine) Advance(ms float64) {
	end := e.Now + math.Max(0, math.Min(ms, 10000))
	for e.Events.Len() > 0 && e.Events[0].at <= end {
		v := heap.Pop(&e.Events).(event)
		e.Now = v.at
		v.fn()
	}
	e.Now = end
}
func (e *Engine) note(s string) {
	e.Log = append([]Log{{e.Now, s}}, e.Log...)
	if len(e.Log) > 30 {
		e.Log = e.Log[:30]
	}
}
func (e *Engine) scheduleArrival() {
	if e.C.RPS == 0 || e.ManualMode {
		return
	}
	epoch := e.arrivalEpoch
	e.at(-math.Log(math.Max(1e-12, e.random()))/e.C.RPS*1000, func() {
		if epoch != e.arrivalEpoch || e.ManualMode {
			return
		}
		if e.C.RPS > 0 {
			w := e.C.Weight * (1 + (2*e.random()-1)*e.C.Spread/100)
			e.AddRequest(math.Max(.01, w))
			e.scheduleArrival()
		}
	})
}
func (e *Engine) route(group, mode, key string) *Node {
	nodes := e.Groups[group]
	if mode == "random" {
		return nodes[int(e.random()*float64(len(nodes)))]
	}
	if mode == "least_busy" {
		best := nodes[0]
		for _, n := range nodes {
			if len(n.Visits) < len(best.Visits) {
				best = n
			}
		}
		return best
	}
	i := e.rr[key]
	e.rr[key] = i + 1
	return nodes[i%len(nodes)]
}
func (e *Engine) AddRequest(weight float64) *Trace {
	return e.addRequest(weight, e.C.Deadline, e.requestLabels(), false)
}
func (e *Engine) addRequest(weight, deadline float64, labels map[string]string, manual bool) *Trace {
	e.nextTrace++
	t := &Trace{ID: e.nextTrace, Start: e.Now, End: -1, Weight: weight, Deadline: deadline, Labels: copyLabels(labels), Manual: manual}
	if manual {
		e.Focus = t
		t.Events = append(t.Events, TraceEvent{At: e.Now, Kind: "Request sent"})
	}
	e.Traces[t.ID] = t
	e.Arrivals++
	e.Pending++
	n := e.routeLocal(e.C.Entry, "round_robin", "entry", e.C.EntryAffinity, t.Labels, nil)
	e.call(t, nil, n, e.C.Network, e.C.Client.ConnectTimeout, deadline, func(ok bool, reason string) { e.finishTrace(t, ok, reason) }, &Call{Affinity: e.C.EntryAffinity, Transport: "network"})
	return t
}
func (e *Engine) finishTrace(t *Trace, ok bool, reason string) {
	if t.done {
		return
	}
	t.done = true
	t.End = e.Now
	t.OK = ok
	t.Reason = reason
	if t.Manual {
		t.Events = append(t.Events, TraceEvent{At: e.Now, Kind: "User response", Reason: reason})
	}
	e.Pending--
	if ok {
		e.OK++
	} else {
		e.Failed++
	}
	e.Results = append(e.Results, completion{at: e.Now, w: e.Now - t.Start, ok: ok})
	e.Recent = append([]*Trace{t}, e.Recent...)
	if len(e.Recent) > 24 {
		e.Recent = e.Recent[:24]
	}
	if t.active == 0 {
		delete(e.Traces, t.ID)
	}
}
func (e *Engine) call(t *Trace, parent *Span, n *Node, network, connectTimeout, timeout float64, cb func(bool, string), calls ...*Call) *Span {
	e.nextSpan++
	p := 0
	key := "client>" + n.ID
	if parent != nil {
		p = parent.ID
		key = parent.Node + ">" + n.ID
	}
	s := &Span{ID: e.nextSpan, Parent: p, Node: n.ID, Resource: n.Resource, ResourceName: n.ResourceName, ResourceI18n: n.ResourceI18n, Start: e.Now, Arrive: -1, WorkStart: -1, LocalEnd: -1, End: -1, Reply: -1, Status: "pending", Phase: "connect", Weight: t.Weight, node: n, trace: t, callback: cb, network: network}
	e.prepareHop(s, parent, calls)
	network = s.network
	n.Outstanding++
	t.Spans = append(t.Spans, s)
	t.active++
	e.traceEvent(s, "Call started", "", timeout)
	if n.Resource != "" {
		e.traceEvent(s, "Resource visit", "", 0)
	}
	if timeout > 0 {
		e.at(timeout, func() {
			if s.settled {
				return
			}
			reason := "request_timeout"
			if parent == nil {
				reason = "client_deadline"
			}
			e.dropConnection(s)
			e.settle(s, false, reason)
			if e.C.Cancel {
				e.cancel(s, reason)
			}
		})
	}
	ideal := len(calls) > 0 && calls[0] != nil && calls[0].Transport == "ideal"
	if ideal {
		s.network, s.NetworkBase, s.NetworkDelay = 0, 0, 0
		s.connected = true
		s.Phase = "network"
		e.traceEvent(s, "Ideal link", "", 0)
		e.at(0, func() {
			if !s.done {
				e.arrive(s)
			}
		})
		return s
	}
	e.acquireConnection(s, parent, key)
	e.traceEvent(s, "Connection", s.Connection, 0)
	connected := s.connected
	ct := 0.0
	if !connected && network > 0 {
		ct = e.duration(2 * network)
	}
	if n.State == "down" {
		e.at(network, func() { e.reject(s, "connection_refused") })
		return s
	}
	if !connected && (n.State == "blackhole" || ct > connectTimeout) {
		e.at(connectTimeout, func() { e.reject(s, "connect_timeout") })
		return s
	}
	e.at(ct, func() {
		if s.done {
			return
		}
		if !s.connected && n.State == "down" {
			e.reject(s, "connection_refused")
			return
		}
		if !s.connected && n.State == "blackhole" {
			e.at(math.Max(0, s.Start+connectTimeout-e.Now), func() { e.reject(s, "connect_timeout") })
			return
		}
		s.connected = true
		s.ConnectionEstablished = true
		e.traceEvent(s, "Connection ready", "", network)
		if s.settled {
			s.ConnectionClosed = true
		}
		// A call may keep running after its caller timed out (cancel=false).
		// Completing its handshake must not resurrect an abandoned connection.
		e.cacheEstablishedConnection(s)
		s.Phase = "network"
		e.at(network, func() { e.arrive(s) })
	})
	return s
}
func (e *Engine) settle(s *Span, ok bool, why string) {
	if s.settled {
		return
	}
	s.settled = true
	s.Reply = e.Now
	e.traceEvent(s, "Caller notified", why, 0)
	e.releaseConnection(s)
	s.callback(ok, why)
}
func (e *Engine) reject(s *Span, why string) {
	if s.done {
		return
	}
	if why == "connection_refused" || why == "connect_timeout" || why == "connection_reset" {
		e.dropConnection(s)
	}
	e.end(s, false, why)
	e.settle(s, false, why)
}
func (e *Engine) integrate(n *Node) {
	n.Area += float64(len(n.Visits)) * (e.Now - n.AreaAt)
	n.AreaAt = e.Now
}
func (e *Engine) arrive(s *Span) {
	if s.done {
		return
	}
	n := s.node
	e.integrate(n)
	s.Arrive = e.Now
	e.traceEvent(s, "Box entered", "", 0)
	n.Arrivals++
	n.Visits[s.ID] = s
	if n.State == "down" {
		e.reject(s, "connection_reset")
		return
	}
	if len(n.Active) >= n.Workers && len(n.Queue) >= e.queueLimit(n) {
		e.reject(s, "queue_full")
		return
	}
	s.Phase = "queue"
	n.Queue = append(n.Queue, s)
	e.traceEvent(s, "Queued", "", float64(len(n.Queue)))
	e.pump(n)
}
func (e *Engine) pump(n *Node) {
	for len(n.Active) < n.Workers && len(n.Queue) > 0 {
		s := n.Queue[0]
		n.Queue = n.Queue[1:]
		if s.done {
			continue
		}
		e.integrateLoad(n)
		n.Active[s.ID] = s
		s.occupied = true
		s.started = true
		s.WorkStart = e.Now
		e.traceEvent(s, "Worker acquired", "", 0)
		s.Labels = e.nodeLabels(n)
		e.local(s)
	}
}
func (e *Engine) local(s *Span) {
	if s.done {
		return
	}
	n := s.node
	if n.State == "down" {
		e.reject(s, "connection_reset")
		return
	}
	if n.State != "healthy" {
		s.Phase = "hang"
		e.traceEvent(s, "Work parked", "", 0)
		s.parked = func() { e.local(s) }
		return
	}
	s.Phase = "local"
	s.parked = nil
	d := e.processingCost(s)
	e.traceEvent(s, "Processing started", "", d)
	e.at(d, func() {
		if s.done {
			return
		}
		if n.State != "healthy" {
			s.Phase = "hang"
			e.traceEvent(s, "Work parked", "", 0)
			s.parked = func() { e.afterLocal(s) }
			return
		}
		e.afterLocal(s)
	})
}
func (e *Engine) afterLocal(s *Span) {
	if s.done {
		return
	}
	s.LocalEnd = e.Now
	e.traceEvent(s, "Processing finished", "", 0)
	s.parked = nil
	s.plan = append([]Stage(nil), e.boxGroup(s.node).Stages...)
	e.nextStage(s)
}
func (e *Engine) respond(s *Span, ok bool, why string) {
	if s.done {
		return
	}
	e.end(s, ok, why)
	if e.C.Cancel {
		for _, c := range s.children {
			if !c.done {
				e.cancel(c, "cancelled")
			}
		}
	}
	network := s.network
	e.at(network, func() { e.settle(s, ok, why) })
}
func (e *Engine) end(s *Span, ok bool, why string) {
	if s.done {
		return
	}
	s.done = true
	s.End = e.Now
	e.traceEvent(s, "Box finished", why, 0)
	s.Status = why
	s.Phase = "done"
	s.parked = nil
	n := s.node
	if s.Arrive >= 0 {
		e.integrate(n)
		delete(n.Visits, s.ID)
		n.Exited++
		if !ok {
			n.Errors++
		}
		w := e.Now - s.Arrive
		q := w
		local := 0.0
		wait := 0.0
		if s.started {
			q = s.WorkStart - s.Arrive
			if s.LocalEnd >= 0 {
				local = s.LocalEnd - s.WorkStart
				wait = e.Now - s.LocalEnd
			} else {
				local = e.Now - s.WorkStart
			}
		}
		n.SumW += w
		n.SumQ += q
		n.SumLocal += local
		n.SumWait += wait
		n.Completed = append(n.Completed, completion{at: e.Now, w: w, queue: q, local: local, wait: wait, ok: ok})
	}
	e.integrateLoad(n)
	delete(n.Active, s.ID)
	for i, j := range n.Queue {
		if j == s {
			n.Queue = append(n.Queue[:i], n.Queue[i+1:]...)
			break
		}
	}
	n.Outstanding--
	s.trace.active--
	if s.trace.active == 0 && s.trace.done {
		delete(e.Traces, s.trace.ID)
	}
	e.pump(n)
	for _, box := range e.Nodes {
		if box.Group == n.Group {
			e.retireIfDrained(box)
		}
	}
}
func (e *Engine) cancel(s *Span, reason string) {
	if !s.done || !s.settled {
		e.traceEvent(s, "Cancellation", reason, 0)
	}
	if !s.settled {
		e.dropConnection(s)
	}
	if !s.done {
		e.end(s, false, reason)
	}
	s.settled = true
	e.releaseConnection(s)
	for _, c := range s.children {
		e.cancel(c, reason)
	}
}
func (e *Engine) SetNode(id, state string, service *float64, workers *int) error {
	var n *Node
	for _, v := range e.Nodes {
		if v.ID == id {
			n = v
		}
	}
	if n == nil || n.Retired {
		return errors.New("Node not found")
	}
	if service != nil {
		if *service < 0 || *service > 10000 {
			return errors.New("Processing: 0–10000 ms")
		}
		n.Service = *service
	}
	if workers != nil {
		if *workers < 1 || *workers > 512 {
			return errors.New("Workers: 1–512")
		}
		e.integrateLoad(n)
		n.Workers = *workers
	}
	if state != "" && state != n.State {
		if state != "healthy" && state != "down" && state != "hang" && state != "blackhole" {
			return errors.New("Unknown state")
		}
		n.State = state
		e.note(n.ID + " → " + state)
		if state == "down" {
			e.closeNodeConnections(n)
			for key := range e.connections {
				if strings.HasSuffix(key, ">"+n.ID) || strings.HasPrefix(key, n.ID+">") {
					delete(e.connections, key)
				}
			}
			spans := make([]*Span, 0, len(n.Visits))
			for _, s := range n.Visits {
				spans = append(spans, s)
			}
			sort.Slice(spans, func(i, j int) bool { return spans[i].ID < spans[j].ID })
			for _, s := range spans {
				e.respond(s, false, "connection_reset")
			}
		}
		if state == "healthy" {
			spans := make([]*Span, 0, len(n.Active))
			for _, s := range n.Active {
				spans = append(spans, s)
			}
			sort.Slice(spans, func(i, j int) bool { return spans[i].ID < spans[j].ID })
			for _, s := range spans {
				if s.parked != nil {
					s.parked()
				}
			}
		}
	}
	if n.Draining {
		e.pump(n)
		return nil
	}
	if e.C.Overrides == nil {
		e.C.Overrides = map[string]NodeConfig{}
	}
	o := e.C.Overrides[id]
	if service != nil {
		v := *service
		o.Service = &v
	}
	if workers != nil {
		v := *workers
		o.Workers = &v
	}
	if state != "" {
		o.State = state
	}
	e.C.Overrides[id] = o
	e.pump(n)
	return nil
}

// Retired nodes stay in Nodes for historical metrics and Little's identity.
// Groups contains only routing candidates. Draining nodes finish accepted calls.
func (e *Engine) retireIfDrained(n *Node) {
	if !n.Draining || n.Outstanding != 0 {
		return
	}
	// Keep the whole private bundle available for future stages and sibling calls,
	// including detached work after a parent stops waiting.
	if n.Index > 0 {
		for _, other := range e.Nodes {
			if other.Group == n.Group && other.Index == n.Index && other.Outstanding > 0 {
				return
			}
		}
	}
	e.integrateLoad(n)
	n.Draining = false
	n.Retired = true
	for key := range e.connections {
		if strings.HasSuffix(key, ">"+n.ID) || strings.HasPrefix(key, n.ID+">") {
			delete(e.connections, key)
		}
	}
	e.note(n.ID + ": finished accepted work, retired")
}
func (e *Engine) Update(c Config) error {
	normalize(&c)
	if len(c.Groups) != len(e.C.Groups) {
		return errors.New("Changing the topology requires a restart")
	}
	desired := map[string]int{}
	for i, g := range c.Groups {
		if g.ID != e.C.Groups[i].ID {
			return errors.New("Changing the topology requires a restart")
		}
		desired[g.ID] = g.Count
	}
	// Discard overrides for removed slots without mutating the current config on rejection.
	if err := e.validateResourceUpdate(c); err != nil {
		return err
	}
	if c.Overrides != nil {
		overrides := map[string]NodeConfig{}
		for id, o := range c.Overrides {
			overrides[id] = o
		}
		for _, n := range e.Nodes {
			if n.Index > desired[n.Group] && n.Owner != n.Group {
				delete(overrides, n.ID)
			}
		}
		c.Overrides = overrides
	}
	if err := Validate(c); err != nil {
		return err
	}
	// A removed slot is still a real execution target while draining. Keep
	// its placement and cost after its editable override is discarded.
	for _, n := range e.Nodes {
		if n.Index > desired[n.Group] && n.Owner != n.Group && n.FrozenLocality == nil {
			n.FrozenLocality = e.freezeLocality(n)
			settings := e.downstreamSettings(n)
			n.FrozenDownstream = &settings
		}
	}
	oldConnectionSettings := e.connectionSettingsSnapshot()
	e.syncAutoScale(c)
	oldRPS := e.C.RPS

	byID := map[string]*Node{}
	for _, n := range e.Nodes {
		byID[n.ID] = n
	}
	for _, g := range c.Groups {
		oldCount := len(e.Groups[g.ID])
		e.G[g.ID] = g
		candidates := make([]*Node, 0, g.Count)
		for i := 1; i <= g.Count; i++ {
			id := fmt.Sprintf("%s-%d", g.ID, i)
			n := byID[id]
			if n == nil {
				n = &Node{ID: id, Group: g.ID, Index: i, State: "healthy", Active: map[int]*Span{}, Visits: map[int]*Span{}, AreaAt: e.Now, CreatedAt: e.Now, LoadAt: e.Now}
				e.Nodes = append(e.Nodes, n)
				byID[id] = n
			}
			e.integrateLoad(n)
			if n.Retired {
				n.State = "healthy"
			}
			n.Draining = false
			n.Retired = false
			n.FrozenLocality = nil
			n.FrozenDownstream = nil
			n.Service = g.Service
			e.integrateLoad(n)
			n.Workers = g.Workers
			if o, ok := c.Overrides[id]; ok {
				if o.Service != nil {
					n.Service = *o.Service
				}
				if o.Workers != nil {
					n.Workers = *o.Workers
				}
			}
			candidates = append(candidates, n)
		}
		e.Groups[g.ID] = candidates
		if oldCount != g.Count {
			e.note(fmt.Sprintf("%s: %d → %d nodes, without reset", g.Name, oldCount, g.Count))
		}
		for _, n := range e.Nodes {
			if n.Resource == "" && n.Group == g.ID && n.Index > g.Count && !n.Retired {
				n.Draining = true
				e.retireIfDrained(n)
			}
		}
	}
	e.syncResources(c)
	e.C = c
	e.refreshConnectionSettings(oldConnectionSettings)
	// Routing/configuration is fully updated before starting queued work.
	for _, n := range e.Nodes {
		if !n.Retired {
			e.pump(n)
		}
	}
	if oldRPS > 0 && c.RPS == 0 {
		e.arrivalEpoch++
	}
	if oldRPS == 0 && c.RPS > 0 {
		e.scheduleArrival()
	}
	return nil
}

func trim(a []completion, t float64) []completion {
	i := 0
	for i < len(a) && a[i].at < t {
		i++
	}
	return a[i:]
}
func (e *Engine) sample() {
	e.sampleLoads()
	e.autoScaleTick()
	e.Results = trim(e.Results, e.Now-10000)
	for _, n := range e.Nodes {
		n.Completed = trim(n.Completed, e.Now-10000)
	}
	m := e.metrics()
	e.History = append(e.History, Point{e.Now, m.Goodput, m.P95, m.ErrorRate, m.Queue, m.Busy, m.Pending})
	if len(e.History) > 120 {
		e.History = e.History[1:]
	}
	e.at(500, e.sample)
}
func percentile(a []float64, p float64) float64 {
	if len(a) == 0 {
		return 0
	}
	sort.Float64s(a)
	return a[int(math.Ceil(float64(len(a))*p))-1]
}

type Metrics struct {
	Goodput   float64        `json:"goodput"`
	OutRPS    float64        `json:"outRps"`
	P95       float64        `json:"p95"`
	ErrorRate float64        `json:"errorRate"`
	Pending   int            `json:"pending"`
	Busy      int            `json:"busy"`
	Capacity  int            `json:"capacity"`
	Queue     int            `json:"queue"`
	Ghosts    int            `json:"ghosts"`
	Reasons   map[string]int `json:"reasons"`
	Arrivals  int            `json:"arrivals"`
	OK        int            `json:"ok"`
	Failed    int            `json:"failed"`
}

func (e *Engine) metrics() Metrics {
	m := Metrics{Pending: e.Pending, Arrivals: e.Arrivals, OK: e.OK, Failed: e.Failed, Reasons: map[string]int{}}
	var lat []float64
	ok := 0
	total := 0
	for _, r := range e.Results {
		if r.at < e.Now-10000 {
			continue
		}
		total++
		if r.ok {
			ok++
			lat = append(lat, r.w)
		}
	}
	sec := math.Max(.001, math.Min(e.Now, 10000)/1000)
	m.Goodput = float64(ok) / sec
	m.OutRPS = float64(total) / sec
	m.P95 = percentile(lat, .95)
	if total > 0 {
		m.ErrorRate = 100 * float64(total-ok) / float64(total)
	}
	for _, n := range e.Nodes {
		if n.Resource != "" {
			m.Queue += len(n.Queue)
			continue
		}
		m.Busy += len(n.Active)
		if !n.Retired {
			m.Capacity += n.Workers
		}
		m.Queue += len(n.Queue)
		for _, s := range n.Active {
			if s.trace.done {
				m.Ghosts++
			}
		}
	}
	for _, t := range e.Recent {
		if !t.OK {
			m.Reasons[t.Reason]++
		}
	}
	return m
}

type NodeView struct {
	Downstream   *DownstreamSettings `json:"downstream,omitempty"`
	Labels       map[string]string   `json:"labels,omitempty"`
	Cost         *CostRule           `json:"cost,omitempty"`
	CostKnown    int                 `json:"costKnown"`
	CostRemote   int                 `json:"costRemote"`
	HopKnown     int                 `json:"hopKnown"`
	HopRemote    int                 `json:"hopRemote"`
	LoadBusy     float64             `json:"loadBusy"`
	LoadCapacity float64             `json:"loadCapacity"`
	Resource     string              `json:"resource,omitempty"`
	ResourceName string              `json:"resourceName,omitempty"`
	Owner        string              `json:"owner,omitempty"`
	Utilization  float64             `json:"utilization"`

	Draining   bool     `json:"draining"`
	Retired    bool     `json:"retired"`
	ID         string   `json:"id"`
	Group      string   `json:"group"`
	Index      int      `json:"index"`
	State      string   `json:"state"`
	Service    float64  `json:"service"`
	Workers    int      `json:"workers"`
	Active     int      `json:"active"`
	Queue      int      `json:"queue"`
	Oldest     float64  `json:"oldest"`
	Phases     []string `json:"phases"`
	RPS        float64  `json:"rps"`
	ErrorRate  float64  `json:"errorRate"`
	W          float64  `json:"w"`
	WQueue     float64  `json:"wQueue"`
	WLocal     float64  `json:"wLocal"`
	WChildren  float64  `json:"wChildren"`
	P95        float64  `json:"p95"`
	L          float64  `json:"l"`
	Lambda     float64  `json:"lambda"`
	MeanW      float64  `json:"meanW"`
	Little     float64  `json:"little"`
	Unfinished float64  `json:"unfinished"`
	Arrivals   int      `json:"arrivals"`
	Exited     int      `json:"exited"`
}
type Snapshot struct {
	ManualMode   bool            `json:"manualMode"`
	Focus        *Trace          `json:"focus,omitempty"`
	FocusRunning bool            `json:"focusRunning"`
	Autoscalers  []AutoScaleView `json:"autoscalers"`
	ScaleEvents  []ScaleEvent    `json:"scaleEvents"`
	T            float64         `json:"t"`
	Config       Config          `json:"config"`
	Metrics      Metrics         `json:"metrics"`
	Resources    []NodeView      `json:"resources"`
	Nodes        []NodeView      `json:"nodes"`
	History      []Point         `json:"history"`
	Recent       []*Trace        `json:"recent"`
	Log          []Log           `json:"log"`
}

func (e *Engine) Snapshot() Snapshot {
	s := Snapshot{ManualMode: e.ManualMode, Focus: e.Focus, FocusRunning: e.FocusRunning(), Autoscalers: e.autoScaleViews(), ScaleEvents: e.ScaleEvents, T: e.Now, Config: e.C, Metrics: e.metrics(), History: e.History, Recent: e.Recent, Log: e.Log}
	for _, n := range e.Nodes {
		busy, capacity := e.loadWindow(n, 5000)
		util := 0.0
		if capacity > 0 {
			util = busy / capacity * 100
		}
		v := NodeView{Labels: e.nodeLabels(n), Cost: e.nodeCost(n), CostKnown: n.CostKnown, CostRemote: n.CostRemote, HopKnown: n.HopKnown, HopRemote: n.HopRemote, Resource: n.Resource, ResourceName: n.ResourceName, Owner: n.Owner, Utilization: util, LoadBusy: busy, LoadCapacity: capacity, Draining: n.Draining, Retired: n.Retired, ID: n.ID, Group: n.Group, Index: n.Index, State: n.State, Service: n.Service, Workers: n.Workers, Active: len(n.Active), Queue: len(n.Queue), Arrivals: n.Arrivals, Exited: n.Exited, Phases: []string{}}
		settings := e.downstreamSettings(n)
		v.Downstream = &settings
		if len(n.Queue) > 0 {
			v.Oldest = e.Now - n.Queue[0].Arrive
		}
		var lat []float64
		var sum, q, local, wait float64
		errs := 0
		for _, r := range n.Completed {
			if r.at < e.Now-10000 {
				continue
			}
			lat = append(lat, r.w)
			sum += r.w
			q += r.queue
			local += r.local
			wait += r.wait
			if !r.ok {
				errs++
			}
		}
		if len(lat) > 0 {
			d := float64(len(lat))
			v.W = sum / d
			v.WQueue = q / d
			v.WLocal = local / d
			v.WChildren = wait / d
			v.ErrorRate = float64(errs) / d * 100
			v.P95 = percentile(lat, .95)
		}
		v.RPS = float64(len(lat)) / math.Max(.001, math.Min(e.Now, 10000)/1000)
		active := make([]*Span, 0, len(n.Active))
		for _, sp := range n.Active {
			active = append(active, sp)
		}
		sort.Slice(active, func(i, j int) bool { return active[i].ID < active[j].ID })
		for _, sp := range active {
			if len(v.Phases) < 80 {
				v.Phases = append(v.Phases, sp.Phase)
			}
		}
		if e.Now > 0 {
			v.L = (n.Area + float64(len(n.Visits))*(e.Now-n.AreaAt)) / e.Now
			v.Lambda = float64(n.Exited) / e.Now * 1000
			if n.Exited > 0 {
				v.MeanW = n.SumW / float64(n.Exited)
			}
			v.Little = n.SumW / e.Now
			var ages float64
			for _, sp := range n.Visits {
				ages += e.Now - sp.Arrive
			}
			v.Unfinished = ages / e.Now
		}
		if n.Resource != "" {
			s.Resources = append(s.Resources, v)
		} else {
			s.Nodes = append(s.Nodes, v)
		}
	}
	return s
}
func (e *Engine) JSON() string { b, _ := json.Marshal(e.Snapshot()); return string(b) }
