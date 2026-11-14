package core

// A logical child call may have several connection attempts, but only one result
// for all/any/quorum. All attempts share the original call deadline.
func (e *Engine) callDownstream(parent *Span, first *Node, network, connectTimeout, timeout float64, retry bool, cb func(bool, string), calls ...*Call) {
	deadline := e.Now + timeout
	stage := parent.stage
	candidates := []*Node{first}
	if retry {
		// Snapshot a bounded ring starting after the routed node. Autoscaling can
		// remove candidates while connecting; never visit a node twice per call.
		nodes := e.Groups[first.Group]
		for i, n := range nodes {
			if n == first {
				for j := 1; j < len(nodes); j++ {
					candidates = append(candidates, nodes[(i+j)%len(nodes)])
				}
				break
			}
		}
	}
	if len(calls) > 0 && calls[0] != nil {
		candidates = e.orderRetry(candidates, calls[0].Affinity, parent.trace.Labels, parent.Labels)
	}
	next, attempt, firstSpan := 0, 0, 0
	var start func(*Node)
	start = func(n *Node) {
		attempt++
		var current *Span
		remaining := 0.0
		if timeout > 0 {
			remaining = deadline - e.Now
		}
		current = e.call(parent.trace, parent, n, network, connectTimeout, remaining, func(ok bool, why string) {
			connectionFailure := !current.connected && (why == "connection_refused" || why == "connect_timeout")
			if !ok && connectionFailure && !parent.done && !parent.settled && !parent.trace.done && parent.stage == stage && (timeout == 0 || e.Now < deadline) {
				for next < len(candidates) {
					candidate := candidates[next]
					next++
					if !candidate.Draining && !candidate.Retired {
						start(candidate)
						return
					}
				}
			}
			cb(ok, why)
		}, calls...)
		current.Attempt = attempt
		if firstSpan == 0 {
			firstSpan = current.ID
		} else {
			current.RetryOf = firstSpan
			e.traceEvent(current, "Connection retry", "", float64(attempt))
		}
		parent.children = append(parent.children, current)
	}
	next = 1
	start(first)
}
