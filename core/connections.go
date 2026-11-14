package core

import "errors"

// Generator settings apply only to generator -> entry, not to downstream boxes.
type ClientConnections struct {
	Keepalive        bool    `json:"keepalive"`
	KeepaliveTimeout float64 `json:"keepaliveTimeout"`
	ConnectTimeout   float64 `json:"connectTimeout"`
}
type DownstreamSettings struct {
	Keepalive        bool    `json:"keepalive"`
	KeepaliveTimeout float64 `json:"keepaliveTimeout"`
	ConnectTimeout   float64 `json:"connectTimeout"`
	Timeout          float64 `json:"timeout"`
	RetryConnect     bool    `json:"retryConnect"`
}

func normalizeConnections(c *Config) {
	enabled := true
	if c.Keepalive != nil {
		enabled = *c.Keepalive
	}
	if c.Client == nil {
		c.Client = &ClientConnections{enabled, 30000, 200}
	}
	for i := range c.Groups {
		g := &c.Groups[i]
		if g.Keepalive == nil {
			v := enabled
			g.Keepalive = &v
		}
		if g.KeepaliveTimeout == nil {
			v := 30000.0
			g.KeepaliveTimeout = &v
		}
	}
	c.Keepalive = nil // Legacy global flag is migrated once, never exported again.
}
func validateConnections(c Config) error {
	valid := func(v *float64, min, max float64) bool { return v == nil || (finite(*v) && *v >= min && *v <= max) }
	if c.Client != nil && (!valid(&c.Client.ConnectTimeout, 1, 60000) || !valid(&c.Client.KeepaliveTimeout, 0, 3600000)) {
		return errors.New("Connections: connect/call timeout 1-60000 ms, idle timeout 0-3600000 ms")
	}
	for _, g := range c.Groups {
		if !valid(g.KeepaliveTimeout, 0, 3600000) || !valid(&g.Timeout, 1, 60000) || !valid(&g.ConnectTimeout, 1, 60000) {
			return errors.New("Connections: connect/call timeout 1-60000 ms, idle timeout 0-3600000 ms")
		}
	}
	for _, o := range c.Overrides {
		if !valid(o.KeepaliveTimeout, 0, 3600000) || !valid(o.Timeout, 1, 60000) || !valid(o.ConnectTimeout, 1, 60000) {
			return errors.New("Connections: connect/call timeout 1-60000 ms, idle timeout 0-3600000 ms")
		}
	}
	return nil
}
func (e *Engine) downstreamSettings(n *Node) DownstreamSettings {
	if n.FrozenDownstream != nil {
		return *n.FrozenDownstream
	}
	g := e.G[n.Group]
	p := DownstreamSettings{Keepalive: true, KeepaliveTimeout: 30000, ConnectTimeout: g.ConnectTimeout, Timeout: g.Timeout, RetryConnect: true}
	if g.Keepalive != nil {
		p.Keepalive = *g.Keepalive
	}
	if g.KeepaliveTimeout != nil {
		p.KeepaliveTimeout = *g.KeepaliveTimeout
	}
	if g.RetryConnect != nil {
		p.RetryConnect = *g.RetryConnect
	}
	o := e.C.Overrides[n.ID]
	if o.Keepalive != nil {
		p.Keepalive = *o.Keepalive
	}
	if o.KeepaliveTimeout != nil {
		p.KeepaliveTimeout = *o.KeepaliveTimeout
	}
	if o.ConnectTimeout != nil {
		p.ConnectTimeout = *o.ConnectTimeout
	}
	if o.Timeout != nil {
		p.Timeout = *o.Timeout
	}
	if o.RetryConnect != nil {
		p.RetryConnect = *o.RetryConnect
	}
	return p
}
func (e *Engine) connectionSettings(owner *Node) ClientConnections {
	if owner == nil {
		return *e.C.Client
	}
	p := e.downstreamSettings(owner)
	return ClientConnections{p.Keepalive, p.KeepaliveTimeout, p.ConnectTimeout}
}
func ownerKey(n *Node) string {
	if n == nil {
		return "client"
	}
	return n.ID
}
func (e *Engine) connectionSettingsSnapshot() map[string]ClientConnections {
	result := map[string]ClientConnections{"client": *e.C.Client}
	for _, n := range e.Nodes {
		if n.Resource == "" {
			result[n.ID] = e.connectionSettings(n)
		}
	}
	return result
}
func (e *Engine) refreshConnectionSettings(old map[string]ClientConnections) {
	for key, enabled := range e.connectionSettingsSnapshot() {
		if before, ok := old[key]; ok && before.Keepalive != enabled.Keepalive {
			e.connectionEpochs[key]++
		}
	}
	for _, c := range e.connections {
		if !e.connectionSettings(c.Owner).Keepalive {
			e.evictConnection(c)
			continue
		}
		if before, ok := old[ownerKey(c.Owner)]; !ok || before.KeepaliveTimeout != e.connectionSettings(c.Owner).KeepaliveTimeout {
			e.armIdle(c, true)
		}
	}
}

// One reusable connection per caller/target pair. Busy counts all outstanding
// users; idle starts only after the last full reply (including return network).
type pooledConnection struct {
	ID           uint64
	Key          string
	Owner        *Node
	Busy         int
	IdleSince    float64
	Closed       bool
	Timer        bool
	TimerVersion uint64
}

func (e *Engine) acquireConnection(s, parent *Span, key string) {
	var owner *Node
	if parent != nil {
		owner = parent.node
	}
	p := e.connectionSettings(owner)
	s.connectionKey = key
	s.cacheConnection = p.Keepalive
	s.connectionEpoch = e.connectionEpochs[ownerKey(owner)]
	c := e.connections[key]
	if c != nil {
		e.armIdle(c, false)
		c = e.connections[key]
	}
	s.Connection = "new"
	if p.Keepalive && c != nil && !c.Closed {
		s.Connection = "reused"
		s.connected = true
		s.ConnectionEstablished = true
	} else {
		e.nextConnection++
		c = &pooledConnection{ID: e.nextConnection, Key: key, Owner: owner}
	}
	s.connectionRef = c
	s.connectionID = c.ID
	c.Busy++
}
func (e *Engine) cacheEstablishedConnection(s *Span) {
	c := s.connectionRef
	if s.cacheConnection && !s.settled && !c.Closed && e.connectionSettings(c.Owner).Keepalive && s.connectionEpoch == e.connectionEpochs[ownerKey(c.Owner)] {
		e.connections[c.Key] = c
	}
}
func (e *Engine) evictConnection(c *pooledConnection) {
	if e.connections[c.Key] == c {
		delete(e.connections, c.Key)
	}
	c.Closed = true
	c.TimerVersion++
	c.Timer = false
}
func (e *Engine) armIdle(c *pooledConnection, reschedule bool) {
	if reschedule {
		c.TimerVersion++
		c.Timer = false
	}
	if e.connections[c.Key] != c || c.Closed || c.Busy != 0 {
		return
	}
	p := e.connectionSettings(c.Owner)
	if !p.Keepalive {
		e.evictConnection(c)
		return
	}
	if p.KeepaliveTimeout == 0 {
		return
	}
	remaining := c.IdleSince + p.KeepaliveTimeout - e.Now
	if remaining <= 0 {
		e.evictConnection(c)
		return
	}
	if c.Timer {
		return
	}
	c.Timer = true
	version := c.TimerVersion
	e.at(remaining, func() {
		if version != c.TimerVersion {
			return
		}
		c.Timer = false
		e.armIdle(c, false)
	})
}
func (e *Engine) releaseConnection(s *Span) {
	if s.connectionRef == nil || s.connectionReleased {
		return
	}
	s.connectionReleased = true
	c := s.connectionRef
	c.Busy--
	if c.Busy == 0 {
		c.IdleSince = e.Now
		e.armIdle(c, false)
	}
}

// Identity protects a replacement from late errors on the old connection.
func (e *Engine) dropConnection(s *Span) {
	if s.connectionRef == nil {
		return
	}
	s.cacheConnection = false
	e.evictConnection(s.connectionRef)
	if s.ConnectionEstablished {
		s.ConnectionClosed = true
	}
}
func (e *Engine) closeNodeConnections(n *Node) {
	for _, tr := range e.Traces {
		for _, s := range tr.Spans {
			if !s.settled && (s.Node == n.ID || s.connectionKey == n.ID+">"+s.Node) {
				e.dropConnection(s)
			}
		}
	}
}
