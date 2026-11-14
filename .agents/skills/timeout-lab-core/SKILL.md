---
name: timeout-lab-core
description: Change and verify the Timeout Lab Go engine, including queues, metrics, resources, locality, connections, and autoscaling. Use for model semantics and regressions, not interface copy or deployment.
---

# Timeout Lab engine

Work from the project root, three levels above this directory. Read `AGENTS.md` and the relevant `README.md` section; do not duplicate detailed semantics in this skill.

## Code map

| Area | Code and regression tests |
| --- | --- |
| Config, DAG validation, event heap, FIFO, spans, metrics, live updates/draining | `core/model.go`, `core/model_test.go` |
| Resources and execution stages | `core/resources.go`, `core/resources_test.go` |
| Autoscaler, windows, delays, and cooldown | `core/autoscale.go`, `core/autoscale_test.go` |
| Labels, routing, cost, AZ/NUMA | `core/locality.go`, `core/locality_test.go` |
| Retries before connection establishment | `core/retry.go`, `core/retry_test.go` |
| Connection cache, idle expiry, caller settings | `core/connections.go`, `core/connections_test.go`, `core/idle_test.go` |
| Localization metadata | `core/i18n.go`, `core/i18n_test.go` |
| Browser JSON contract | `cmd/wasm/main.go`, `src/worker.ts`, `src/engine.ts`, generated `src/model.ts` |

## Making changes

1. Reproduce the issue with a minimal configuration and fixed seed. If transport is involved, check both new and warm connections. Measure request outcomes, occupancy, and queues, not just displayed counters.
2. Carry new fields through JSON, normalization of older configurations, validation, live updates, export, and snapshots. Distinguish absence, false, and zero for optional booleans/numbers: idle `0` means infinity; absence means the default.
3. Before changing events, determine what is captured at call/stage start and what applies live. Do not retroactively recalculate scheduled durations or budgets. Invalid updates must not partially mutate the engine.
4. Scale-down must account for accepted requests still in transit and future resource stages. Retired-node history remains in Little's law accounting; capacity and routing no longer include retired nodes.

## Relevant invariants

- Ending a wait and stopping work are separate events. With cancellation disabled, work may continue after the user receives a response; never count terminal outcomes or slot release twice.
- Retries consume the original call's remaining budget, with each candidate attempted at most once. All/any/quorum counts logical calls, not attempts. Broadcast and generator calls are not retried.
- Connection caching is tied to the caller/target pair and connection identity. A late failure cannot remove a replacement connection; a handshake completed after timeout cannot restore the cache. Keep-alive changes affect only the relevant caller.
- Idle time starts after the final complete response, including return network time. Active calls are protected. Shortening timeout accounts for elapsed idle time. Do not accumulate unnecessary per-request timers.
- Resources are generic and use no TCP inside a composite box. `instance` scales with the service; `shared` does not. Utilization uses slot-time; queueing is separate.
- Locality selects a candidate subset. Processing cost multiplies local work only; network cost multiplies link delay. Missing comparable labels mean ×1. Do not add special behavior based on CPU/DB/NUMA names.
- User p95 includes successful responses; error rate includes all completed responses; visit metrics include cancellation/failure. Check finite-horizon Little's law and history preservation during scaling.

Select only cases relevant to the task; this is not a requirement to retest every subsystem for every change.

## Completion

Add an observable-behavior regression alongside existing tests. Run targeted tests, then `go test ./...`. If events/controller behavior changed, check independence from `Advance` step size. Format changed Go files with `gofmt`.

`cmd/wasm` has build tags: ordinary `go test ./...` does not check its build. Run `sh scripts/build.sh` to verify the bridge and update WASM/runtime/standalone. Apply the neighboring `timeout-lab-ui` skill for changed interface fields. Update the corresponding README section when public semantics change. This skill does not deploy the result.
