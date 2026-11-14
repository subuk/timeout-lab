# Timeout Lab — systems lab

A static interactive simulator of queues, bounded resources, timeouts, and scaling. A generic Go engine compiles to WebAssembly and runs in a Web Worker; the interface uses React and TypeScript, bundled locally by Vite. Deployment remains static, with no backend or runtime CDN dependencies.

The first preset is a load balancer → 4 backends → database. The generator sends a total of 30 RPS only to the entry group (`entry`, the load balancer in this preset). Traffic is distributed round-robin among its active nodes. Further requests arise only from outgoing graph edges; their rate depends on call counts, fan-out, processing, and routing. Scaling any group does not change the configured total incoming RPS.

All eight built-in presets start at 30 RPS. Their original reference workloads (200 RPS, or 80 for Nested boxes) are retimed by `reference RPS / 30`: local processing at every nesting level, network delays, caller/client timeouts, idle expiry, and autoscaler windows/delays/cooldowns all use the same factor. Workers, queues, routing, fan-out, cost multipliers, and request weights keep their original values. This preserves offered work per slot and relative budgets while producing fewer events per second. Scenarios unfold 6⅔ times more slowly (2⅔ for Nested boxes); overload, hanging work and scaling therefore need longer observation at 1× playback. Live RPS edits and imported JSON are never automatically retimed. The 10-second metric windows, 5-second card utilization window, 60-second charts and 500 ms controller sampling remain literal virtual time, so shorter-window statistics and exact event sequences need not match the reference runs.

Representative preset settings (milliseconds; rounded to 0.001 ms):

| Setting | Original reference | 30 RPS preset |
| --- | ---: | ---: |
| Normal: backend CPU per visit, two visits/request | 8 | 53.333 |
| Normal: database disk per visit | 4 | 26.667 |
| Slow database: disk per visit | 600 | 4000 |
| Three database calls: disk per visit | 50 | 333.333 |
| Autoscaling: backend CPU per visit, two visits/request | 12 | 80 |
| Normal: one-way network delay | 5 | 33.333 |
| Normal: user deadline | 3000 | 20000 |
| Normal: LB / API outgoing-call budgets | 1500 / 700 | 10000 / 4666.667 |
| Nested boxes: CPU / nested memory per visit | 4 / 2 | 10.667 / 5.333 |

English is the project's primary language: documentation, contributor instructions, source comments, and default interface/model text use English. Russian is supported through explicit localization.

## Getting started

After cloning, build the project first. You need Node.js 22.12+ (or 24+), Go 1.24+ with `lib/wasm/wasm_exec.js`, and Python 3:

```sh
npm ci
npm run build
```

Source files live in `src/` and the root `index.html`. The entire `dist/` directory and generated Worker/WASM files in `public/` are excluded from Git. `npm run dev` builds the Go engine and Worker, then starts Vite with hot reload. `npm run preview` serves the production build.

The simplest way to run the app is to open **`dist/standalone.html`** in a modern browser. It embeds Go WebAssembly, the Worker, CSS, and JS; no HTTP server or internet connection is needed. The regular build generates this file; `python3 scripts/standalone.py` can repack it after the WASM and runtime exist.

For the multi-file version, serve the built `dist/` directory:

```sh
python3 -m http.server 8791 --directory dist
```

Open `http://localhost:8791`. This version requires HTTP; the standalone HTML uses an embedded Blob Worker and works over `file://`. Static hosting needs only the contents of `dist/`, with no external APIs, fonts, CDN scripts, or Node.js server.

To test and rebuild (previously verified with Go 1.27.3):

```sh
go test ./...
node scripts/check-i18n.cjs
npm run build
node scripts/check-manual.cjs
npm run test:browser
```

`wasm_exec.js` is copied from the same Go installation that compiles `core.wasm`. The binary is part of the built distribution, not the source repository. WASM provides a shared native/browser engine; no performance advantage over JavaScript is claimed without a comparative benchmark.

Install a test browser once with `npx playwright install chromium`. `npm run test:browser` starts its own local server and exercises the built HTTP app and offline `file://` artifact: live settings, group overrides, focused drafts, language changes, trace selection, manual requests, validation, resets, preset history, and rendering at 64 instances. Tests use the real Go/WASM Worker.

## Browser workload benchmark

Keep a copy of each production build and compare them with:

```sh
BENCH_SECONDS=10 node scripts/benchmark-browser.mjs /tmp/timeout-lab-before dist /tmp/browser-comparison.json
```

The script runs all eight presets sequentially in fresh headless Chromium browsers at 1×, 1440×1100, with three repetitions and alternating before/after order. `BENCH_PRESETS`, `BENCH_REPEATS`, and `BENCH_SECONDS` override the selection and duration. Each run first advances the engine to 60 reference seconds (400 seconds at 30 RPS; 160 for Nested boxes), warming equal expected arrival counts, then runs normally for three seconds before measurement. This compares established workloads, not initial loading or equal wall-clock time since reset. Avoid concurrent builds/tests during measurement.

CPU is the sum of Chromium process CPU-time deltas, including renderers, the Worker, GPU process and browser, expressed as milliseconds per wall second (100 ms/s = 10% of one core). The synchronous WASM timer includes engine advancement, snapshot metrics and JSON encoding; it excludes Worker-side JSON parsing/message cloning and rendering. Main-thread task duration is recorded separately. These measurements overlap and must not be added. Snapshots and virtual-time progress are also recorded to verify that a lower CPU cost is not caused by fewer updates or slower playback. Build hashes, environment and individual samples are kept in the output JSON. Results describe this machine and Chromium configuration, not every browser or battery usage.

### 30 RPS comparison — 2026-11-14

Measured on Apple M1 Pro, macOS arm64, headless Chromium 159.0.8154.6. The baseline is commit `534f910668b7ee4aa0169ab9646810284e805920`; both builds used the same installed toolchain. Each value is the median of three 10-second measurements; CPU ranges show the minimum and maximum individual runs. Negative changes mean less work per wall second. Raw samples and exact build hashes: [`benchmarks/browser-30rps.json`](benchmarks/browser-30rps.json).

| Preset | Before CPU, ms/s (range) | 30 RPS CPU, ms/s (range) | CPU change | WASM time change |
| --- | ---: | ---: | ---: | ---: |
| Normal operation | 285.9 (268.8–299.5) | 261.3 (213.1–287.5) | -8.6% | -37.2% |
| Slow database | 408.3 (400.0–417.8) | 406.2 (391.5–426.9) | -0.5% | -42.0% |
| 3 database calls | 433.1 (414.7–433.2) | 410.4 (382.1–431.4) | -5.2% | -52.2% |
| Hung backend | 272.1 (240.8–291.3) | 231.4 (211.9–265.7) | -15.0% | -36.2% |
| Autoscaling | 274.5 (254.2–297.7) | 241.9 (224.7–279.7) | -11.9% | -39.1% |
| Two zones | 299.9 (285.6–334.5) | 246.9 (238.5–289.6) | -17.7% | -35.2% |
| NUMA | 209.7 (167.3–215.6) | 165.5 (161.0–169.9) | -21.1% | -30.7% |
| Nested boxes | 280.5 (247.6–287.5) | 255.7 (244.2–279.8) | -8.8% | -13.2% |

All 48 runs maintained 9.98–10.00 snapshots/s and 998.5–999.7 virtual ms per wall second. The normal preset reduced median total CPU from about 28.6% to 26.1% of one core; its paired reductions ranged from 4.0% to 20.7%. The slow-database result is effectively unchanged within run-to-run variation. NUMA and Nested boxes are especially variable: one Nested boxes pair increased total CPU by 13.0%, while the other two decreased it.

The engine/snapshot work decreased more consistently than total browser CPU. Main-thread task time did not show a consistent reduction; frequent snapshot handling, DOM work and painting remain material costs. These short measurements support a moderate, scenario-dependent benefit, not a 6⅔-fold browser speedup. Increasing playback speed also increases real event throughput and reduces the saving.

## Frontend architecture

- `src/App.tsx` and `src/components/`: React components for playback, generator, topology, inspector, model forms, charts, and traces.
- `src/engine.ts`: typed Worker commands, correlated acknowledgements, serialized configuration edits, and an external snapshot store. Unchanged configurations retain object identity; form drafts and selected traces live separately from simulation snapshots.
- `src/model.ts`: wire types generated from Go JSON structs by `scripts/generate-types.py`; do not edit by hand.
- `src/worker.ts`: simulation playback and WASM bridge, bundled as a classic Worker. The engine still advances virtual time independently of React rendering.
- `src/i18n.js`: existing translation dictionary and language selection, exposed as a React subscription; it no longer modifies the DOM.
- `src/style.css`: local styles. `vite.config.ts` builds the application; `vite.worker.config.ts` builds the Worker. `scripts/standalone.py` embeds the built JS, CSS, Worker, Go runtime and WASM in one HTML file.

The interface is a full-viewport canvas with automatic group layout and a required generator connected to the configured entry group. Drag the background or scroll to pan; use the zoom buttons, Ctrl/Command + scroll, or a two-finger pinch to zoom. Fit diagram restores the automatic view. With the canvas focused, arrow keys pan, +/− zoom, and 0 fits the diagram. Groups with four or more expanded instances use two columns; positions are not manually editable.

Metrics, system activity, experiment notes and traces stay fixed above the canvas and can be folded without losing the selected trace. On screens at most 600 px tall, metrics and activity start folded (and fold when rotating into that height) to preserve space for the diagram. Click a generator, group heading, instance or resource to open its settings in a nonmodal window on the right (a bottom sheet on small screens). Close it with the cross or Escape; playback continues, and generator drafts survive closing and reopening. In single-request mode, the generator card can submit the current weight, deadline and label draft directly; validation reopens its settings when necessary. A new manual request opens the trace panel. Numeric settings use sliders and precise inputs. Boxes and request paths opens a structured editor for nested resources, ordered stages, parallel calls, routing, join policy, transport, conditions, and optional overrides, with a JSON tab available. Configuration opens the complete model directly in a JSON editor. Apply without reset validates a live update; Apply and restart explicitly restarts structural changes. Editors merge only changed fields into the latest model, preserving automatic scaling and reporting conflicting edits. Names and model translations remain literal data. Number fields commit on blur or Enter and retain invalid drafts with an explanation. The topology supports selection; graph structure is edited through the forms or JSON.

## Model

- Generator: Poisson arrivals into `entry` only, with a configurable total RPS for the entry group, mean weight, uniform weight spread, and seed.
- Node: bounded FIFO queue, worker count, local processing time × weight, and failure state. A worker remains occupied for the entire operation, including waiting for children.
- **Queue limit, requests** in the inspector sets the maximum waiting requests, excluding active workers (0–2000; `0` means no waiting). It applies to every instance of the selected box definition in its group, or to the selected shared resource. Each instance has its own queue. The limit changes live without resetting the experiment or removing accepted work; it is also available in **Boxes and request paths**.
- Group: identically configured instances with optional individual overrides.
- Call: a target group or relative internal-box path, call count, round_robin/random/least_busy/broadcast routing, explicit network/ideal transport, and optional delay and timeout. Every box runs explicit sequential stages; calls within each stage run in parallel. Broadcast × calls sends that many calls to every node in the target group. Children inherit request weight.
- Join: all successful responses, the first successful response, or N successful responses (quorum). An impossible quorum fails the parent. When cancellation is enabled, unfinished children are canceled.
- Connect timeout bounds an abstract connection handshake (2 × one-way network delay); keep-alive reuses connections.
- The calling box's timeout, inherited from its group by default, is the budget for each outgoing child call, including connection setup, network, queueing, processing, and return network time. It is not an nginx read timeout. The user deadline bounds the root call.
- With cancellation disabled, a timeout stops the caller's wait while work continues to occupy resources. Connection errors may be retried according to `retryConnect`; there are no health checks or automatic exclusion of failed nodes.
- Down causes connection refused/reset; hang parks local processing; blackhole also prevents new connections. State changes take effect immediately. Parked work resumes after recovery. The model does not simulate TCP retransmission, the operating system, or physical CPU execution.
- The first preset does not emulate MongoDB, Redis, nginx, or RAID protocols. Separate presets and protocol models could be added later; the current model is an abstract resource graph without replication.

The engine uses discrete events: an event heap, virtual time in milliseconds, and a deterministic RNG. Rendering does not determine arrival rates. With a demanding model, virtual time may advance more slowly than wall-clock time.

## Single-request mode

Select **Generator → Request mode → Single request**, enter a weight (greater than 0, up to 10), deadline (1–60000 ms) and optional `key=value` labels, then click **Send one request**. Until edited, the single-request deadline follows the model deadline; a user-entered value is retained during live updates. Selecting another preset starts fresh per-request inputs. Weight and labels are exact: generator weight variation and label distribution do not apply. Network, processing variation, cancellation, routing and caller connection settings still come from the model. These per-request inputs do not modify the model defaults.

Entering this mode pauses playback and stops background arrivals without resetting virtual time, queues, RNG, history or reusable connections. Accepted work remains; use **↺** explicitly for an empty-system experiment. Sending starts playback; it pauses automatically after this request and all its descendant work finish. **Pause**, speed and **+10 ms** allow closer inspection. With cancellation disabled, a user deadline can expire while downstream work continues; the UI reports this and waits for the work to finish before enabling another send. Recover a hung node or restart if work cannot finish. Switching back to Continuous load preserves configured RPS; press Resume to continue.

The latest manual trace stays available while running and after completion. Its full call tree includes every service, resource visit and connection retry, with span IDs, parent IDs, timing, connection reuse, locality decisions and final outcomes. Visited service boxes are highlighted. The chronological event journal records actual engine transitions, including connection readiness, queueing, worker acquisition, scheduled processing duration, child/resource waits, failures, cancellation and the user response. Times are relative to sending; an early user response does not imply downstream completion. Detailed events are collected only for manual requests.

The Worker echoes an optional `requestId` on command responses and errors; periodic snapshots have no request ID. The interface waits for the matching response before closing an editor and clears trace selection again when a reset is confirmed.

The WASM bridge accepts `{"type":"mode","manual":true}` and `{"type":"request","request":{"weight":1,"deadline":3000,"labels":{"az":"az1"}}}`. Snapshots expose `manualMode`, `focus`, and `focusRunning`; a running trace has `end: -1`. Mode is session state, retained across resets/presets but not exported in model JSON. Only one unfinished manual request is accepted at a time. Event `value` is a duration in ms for call-start budget, processing-start duration and connection-ready one-way network delay, a queue depth for queue insertion, or an attempt number for retries. Ordinary load traces keep their existing lightweight spans. After building, run `node scripts/check-manual.cjs` to verify the real WASM/Worker commands and the embedded offline Worker.

## Traces and measurements

Each root request has one trace ID; each visit has a span ID and parent ID. A span records call start, queue entry, processing start, local work completion, box departure, response arrival at the caller, and completion reason.

End-to-end latency is measured at the root request. Parent time includes waiting for children, so span durations must not be added together. User-facing p95 includes only successful responses; error rate includes all completed responses. Average box times include all outcomes, including cancellation and failure.

The current request count in a box is its queue plus occupied workers. For Little's law, this count is integrated from the start of the experiment:

```text
L = area under N(t) / T
λ = completed visits / T
W = total duration of completed visits / completed visits
L = λ × W + sum of unfinished visit ages / T
```

The last equation is an exact finite-horizon balance when starting empty. It prevents misinterpreting Little's law during overload and transitions. RPS, p95, and average time components use a 10-second window; charts retain 60 seconds.

## Configuration and extension

The Configuration button opens the JSON editor; Export JSON saves group and node parameters. Importing a new graph restarts the experiment. Node counts change live: new instances immediately join routing, while removed instances stop receiving new assignments and finish accepted work, including requests still in transit. Queues do not migrate. Time, RNG state, counters, charts, and traces are preserved; retired-node history remains in group-level Little's law accounting. A hung node without cancellation can remain draining until it recovers or is explicitly taken down. Scaling back up returns an unfinished draining node to routing; an already retired slot returns healthy with group settings. Other settings also apply live, preserving already scheduled durations and call budgets. Individual edits appear in `overrides` and survive reset.

The call graph, including nested boxes and conditional branches, must be acyclic. Sequential revisits are allowed. Current limits are 12 groups, 64 top-level nodes, 512 internal boxes, and 512 visits per root request (before connection retries). Type semantics live in `core/model.go`: `Config`, `Group`, `Call`, and `NodeConfig`. Adding a preset does not require changing the event scheduler.

Files:

- `core/model.go`: configuration, DAG validation, scheduling, model, tracing, and metrics.
- `core/model_test.go`: queues, weights, fan-out, quorum, timeouts, cancellation, recovery, determinism, and finite-horizon Little's law tests.
- `cmd/wasm/main.go`: the `labCommand` JSON bridge for WebAssembly.
- `src/worker.ts`: WASM loading, virtual ticks, pause, and speed.
- `src/App.tsx`, `src/components/`, `src/style.css`: interactive diagram, controls, charts, and traces.

Visual edge editing, separate request classes, two synchronized comparison runs, and additional presets are left for future work. Arbitrary graphs can currently be defined through JSON.

## Autoscaling

Enable autoscaling separately for each group in the inspector. JSON stores it in `groups[].autoscale`. Autoscaler durations use milliseconds in both JSON and the labeled form fields. The status shows sampled queue/utilization, target count, and remaining virtual time in seconds.

- `enabled`: enables the controller; defaults to false.
- `min` / `max`: desired instance bounds, from 1 to 16.
- `resource`: ID of the internal resource to observe; empty means service handlers.
- `signal`: `queue`, `utilization`, or `both` (scale up when either condition holds).
- `upUtilization`: upper utilization threshold (%).
- `window`: utilization measurement window, default 5000 ms, maximum 60000 ms.
- `upQueue`: upper threshold for the average queue per active observed box.
- `upDelay`: time the scale-up condition must persist.
- `downUtilization`: remove a box when worker utilization is at or below this threshold (%) and all active queues are empty.
- `downDelay`: time the scale-down condition must persist.
- `cooldown`: pause after a count change; condition timing then starts again.

Checks run every 0.5 seconds of virtual time, so the controller behaves consistently at any playback speed. Conditions must hold across successive checks; short spikes between checks may be missed. A zero delay makes the decision at the next check.

Each step changes the count by one node without resetting the experiment. New boxes inherit group settings. Removed boxes drain accepted work. Failed nodes and an unfinished previous drain block ordinary low-load scale-down. Controller metrics exclude draining and retired nodes. Counts outside the configured bounds are gradually brought to a boundary using the same delays. Incoming RPS stays unchanged.

Manual count changes start cooldown; policy changes reset accumulated condition time. Quorum, total-node, and fan-out limits are checked before acting; an impossible step is blocked with an explanation. Groups are processed in configuration order. Status shows the reason, metrics, and countdown; the log shows recent decisions.

The Autoscaling preset starts the backend group with one node (32 handlers, a private compute resource with two slots, 80 ms per visit, twice per request) and scales it using compute utilization/queue at 30 incoming req/s. Its window is about 33.33 s, up delay 13.33 s, down delay 66.67 s, and cooldown 20 s. The database remains one node. Reduce incoming RPS to see the backend group shrink; the longer window and down delay intentionally require a sustained reduction.

Implementation: `core/autoscale.go`; tests: `core/autoscale_test.go`.

## Interface language

English and Russian share one URL. On first load, JavaScript selects the first supported language in `navigator.languages`, including regional variants such as `ru-RU` and `en-GB`; English is the fallback. The language selector saves the user's choice in `localStorage`, taking precedence over browser preferences. If storage is unavailable, selection works until reload.

Changing language only redraws the interface: time, queues, settings, selected trace, and pause state are preserved. Model JSON and user-defined names are not rewritten. Label, tooltip, trace, and engine-message translations live in `src/i18n.js`. Standalone HTML embeds the same dictionary. Run `node scripts/check-i18n.cjs` to check selection and translations.

## Retrying connection failures

Try next node is enabled by default in group outgoing-call settings. In JSON it is `groups[].retryConnect`; a missing optional field means `true`. Changes apply to new logical calls.

On `connection_refused` or `connect_timeout` **before connection establishment**, the caller tries the next node in the same downstream group. Normal routing selects the first node; remaining candidates follow in ring order. Each candidate is attempted at most once. The list is captured at call start; nodes removed from the group are skipped. No new attempts start after the parent stops waiting or the user receives a response.

All attempts share the original call timeout. Connect timeout applies separately to each attempt within the remaining budget. There are no retries after establishment: response timeout, reset, queue overflow, and downstream errors are not retried. Broadcast is not retried because all nodes have already been called and another attempt could be incorrectly counted toward quorum. Generator entry calls are not retried either.

Each attempt has a separate span with `attempt` and a `retryOf` link to the first attempt; traces mark retries with `↻`. For all/any/quorum it remains one logical call. User error metrics reflect the final outcome, and waiting time includes every attempt. The 512-call limit applies to logical graph fan-out; attempts are bounded by the target group's node count.

Tests: `core/retry_test.go`.

## Composite boxes and request programs

Models use `"version": 2`. Every box requires an explicit `stages` array, including `stages: []` for a leaf. Imports reject unknown fields and unsupported/missing versions. The old `edges`, group-level `join`/`quorum`, `downstream` stage, resource-stage shorthand, and global `keepalive` are not accepted or converted.

`groups[].resources` defines named boxes inside a group. Every internal box can recursively define its own `resources` and `stages`: all boxes use the same Node/FIFO/worker/Span and program execution mechanism. A name does not imply a physical type. Each box first performs its local `service` (ms × request weight), then runs its stages, holding its worker while children execute. A child releases its worker when its own operation ends. Containment determines ownership; explicit calls determine execution. A containing box remains a real queue/worker limit, so do not add one solely as a decorative server boundary.

Each box can have up to eight immediate children and sixteen stages, with no separate hard-coded nesting-depth limit. The total internal-box and per-request visit limits still apply. `scope: instance` creates a child per owner; descendants of a shared owner are also shared. `scope: shared` creates one copy of that definition path per top-level group, independent of the number of instances. A shared box can call shared relatives and external groups; it cannot select a private relative because it has no owning instance.

Example group fields:

```json
{
  "resources": [
    {"id":"compute","name":"CPU","scope":"instance","workers":2,"service":8,"queueLimit":500,"stages":[]},
    {"id":"pool","name":"Connection pool","scope":"shared","workers":20,"service":5,"queueLimit":500,"stages":[]}
  ],
  "stages": [
    {"join":"all","calls":[{"resource":"compute","calls":1,"route":"round_robin","transport":"ideal","timeout":0}]},
    {"join":"all","calls":[{"resource":"pool","calls":1,"route":"round_robin","transport":"ideal"}]},
    {"join":"all","calls":[{"resource":"compute","calls":1,"route":"round_robin","transport":"ideal","timeout":0}]}
  ]
}
```

A leaf box returns after local processing. Contained resources are visited only when a call names them; containment never creates implicit stages.

Every stage defines a nonempty `calls` batch of up to eight call directions and a required `join` (`all`, `any`, `quorum`); `quorum` is required for the last policy. Multiple stages express sequential work. Each call chooses exactly one `target` (a top-level group) or `resource` (a relative internal-box path), plus `calls` (1–16), `route` (`round_robin`, `random`, `least_busy`, `broadcast`) and `transport` (`network`, `ideal`). Routing selects instances of a target group; an internal resource path identifies one owned/shared box. From `app`, `../compute` selects a sibling; `worker/cpu` selects a descendant. Internal references cannot escape their top-level group.

Stages and individual calls can include `when: {"op":"read"}`. All listed request tags must exist and match exactly; missing tags do not match. Every matching stage/call runs, so conditions are not first-match rules. Request labels remain unchanged throughout the call tree. With no eligible calls, an `all` or `any` stage is skipped successfully; a quorum that cannot be reached fails immediately with `quorum_unreachable`. Conditions are separate from locality affinity, which selects instances within an already selected group.

For example, an application box can use a sibling CPU, select a cache or database by request tag while always calling audit, then revisit the CPU:

```json
{
  "id":"app", "name":"Application", "scope":"instance",
  "workers":16, "service":1, "queueLimit":500,
  "stages":[
    {"join":"all","calls":[{"resource":"../compute","calls":1,"route":"round_robin","transport":"ideal","timeout":0}]},
    {"join":"all", "calls":[
      {"target":"cache", "calls":1, "route":"round_robin", "when":{"op":"read"}, "transport":"ideal"},
      {"target":"db", "calls":1, "route":"round_robin", "when":{"op":"write"}, "transport":"network", "network":5},
      {"target":"audit", "calls":1, "route":"round_robin", "transport":"network"}
    ]},
    {"join":"all","calls":[{"resource":"../compute","calls":1,"route":"round_robin","transport":"ideal","timeout":0}]}
  ]
}
```

This fragment assumes a sibling `compute` resource and top-level `cache`, `db`, and `audit` groups. The `#template=composition` preset supplies a complete example: each backend’s application calls a sibling CPU, the CPU calls its own memory, and read/write tags choose cache/database alongside audit.

`transport: "network"` uses the abstract connection model: handshake, keep-alive, idle/connect/call timeouts, and connection-establishment retries for target groups. `network` sets the one-way link delay, including reply and handshake; absent means the model default. An explicit `network: 0` has exactly zero transit/handshake delay, including on a new connection, while retaining connection state and failure behavior. `transport: "ideal"` bypasses connections and adds exactly zero link delay. It does not bypass queueing, processing, failure state, the call budget, or cancellation. Ideal links do not retry connection failures because they have no connection establishment.

Transport is always explicit, and either target kind can use either transport. A call's optional `timeout` overrides the caller's budget: absent inherits the caller setting, a positive value sets milliseconds, and `0` adds no independent call timer. Outer call timeouts, the user deadline and cancellation still apply. This rule is identical for group and internal targets. Built-in CPU/disk visits explicitly use ideal transport and `timeout: 0`, preserving their original wait behavior. A leaf shared box with a fixed duration models bounded parallelism, not a lease across other stages. To hold its slot over child work, give that box its own program.

Utilization is the integral of occupied slots divided by the integral of available slots over the window. Counters integrate at changes; samples are saved every 0.5 seconds, with interpolation at the rolling-window boundary. Cards use a 5-second window. Groups aggregate by available slot-time, not by averaging percentages. New nodes count from creation. Queues are measured separately and do not contribute to utilization. Capacity changes limit admission of new work; ongoing visits finish.

Scaling preserves the experiment. Instance resources scale with the service; shared resources remain. Removed instances retain their entire private bundle for not-yet-started descendant and sibling calls of accepted requests, including work continuing after an early user response when cancellation is disabled. Retired-resource history stays in Little's law accounting. The autoscaler changes service instance counts while observing a selected resource; adding services does not increase shared-resource capacity.

The interface offers resource bars on cards, inspector tabs, separate metrics and Little's law, and expandable internal spans. Groups can collapse; those with more than six nodes start collapsed. The summary bar shows aggregate utilization. The **Boxes and request paths** dialog edits the group's nested model through a structured form and JSON. The form supports adding/removing/reordering children, stages and calls; ownership, relative resource targets, join policies, conditions, transport and optional network/timeout overrides are explicit controls. Resource bars, tabs and autoscaling sensors include all nesting levels. A stage captures its conditions, calls, join policy and budgets when it begins; executing work and attempts retain their scheduled durations/budgets. Numeric settings, conditions, call counts, join policies and transport settings apply without resetting time, RNG, queues, or history. Changes to child identities/ownership, call targets, or stage order/count require an explicit restart. Invalid updates are rejected before engine state changes. Model JSON preserves all nested programs and overrides.

Composite-box tests: `core/resources_test.go` and `core/program_test.go`. Format rejection and all eight preset round-trips are covered by `core/schema_test.go`; `core/presets_test.go` preserves the original reference fixtures and compares outcomes and time-average occupancy after retiming at equal expected arrival counts. It also checks overload, hanging work, scale-up/down, and literal imports/live load edits. All presets are defined by `core.PresetConfig`; the interface and WASM bridge use that single source. Browser checks: `npm run test:browser` exercises the HTTP and embedded builds.

## Locality and illustrative cost

Open Request labels in the generator to edit constant labels, tag distribution and entry preference. Locality in the inspector edits scoped labels and processing cost, shows effective labels and mismatch counters, and exposes outgoing-call affinity and link cost for the selected box definition. Individual label overrides remain in effect after a group edit; Inherit removes only the selected instance's locality overrides. Labels are string maps with arbitrary keys; manual request labels use `key=value` lines. An empty instance label value removes an inherited label. Requests keep their labels in all descendants. The generator can distribute one key between two values at a chosen ratio; constant labels are configured separately.

Three independent mechanisms compare the same kind of key:

- `entryAffinity` / `stages[].calls[].affinity` selects matching boxes, using `request` or `caller` as the source. Round-robin/random/least-busy operates within the selected subset. With no matches, the entire group is eligible. Overload in the local subset does not trigger cross-zone routing. Broadcast cannot be combined with subset preference.
- A service, resource, or individual override's `cost` multiplies **only local processing**: base time × weight × match/mismatch. Queueing and child waits are not multiplied. A missing label on either side means ×1.
- `stages[].calls[].networkCost` multiplies one-way link delay, including handshake and return traffic. The factor is recalculated per attempt. A zero base delay remains zero.

A cost rule has the form `{"enabled":true,"source":"caller","key":"az","match":1,"mismatch":3}`. Affinity rules use the same first three fields. Behavior is unchanged when no rules are set.

Labels inherit from group → instance → instance resource; resources may override them. Shared resources inherit only the group. Service processing factors are not inherited by resources. Individual overrides take precedence over group changes. New instances receive group labels; there is no automatic placement across zones.

Changes apply without reset. Request labels are captured at generation, executing-box placement when a worker is acquired, processing duration when processing starts, and network factors at attempt start. Scheduled work is not recalculated. Connection retries visit matching candidates first, then the remainder, within the original budget. Traces show both labels, comparison results, and delay calculations. Inspector mismatch counters are cumulative and exclude comparisons with missing labels.

The **Two zones** preset has 2 LB, 4 API, and 2 DB nodes with `az` labels. Incoming requests split between az1/az2; downstream routing prefers the caller's zone; remote network cost is ×3. DB nodes are independent abstract boxes without replication or data consistency. Disable LB affinity to compare cross-zone traffic.

The **NUMA** preset has 2 CPU boxes and 2 memory boxes. A request's `numa` label specifies data placement (50/50 between nodes by default). CPUs use round-robin; memory is selected by request label. Memory cost compares its placement with the calling CPU: local ×1, remote ×3. Enabling `entryAffinity` on `request.numa` models placing computation near data. Millisecond timings are illustrative: the model does not predict real nanosecond access times, cache coherence, memory bandwidth, or page migration. It uses the same label and queue mechanisms, without a special NUMA scheduler.

## Preset links

Preset selection appears in the URL, such as `https://tmlab.krglv.com/#template=numa` or `#template=az`. Direct links and reloads start the selected preset after WASM is ready. Back/forward switches presets. Unknown IDs open the normal setup. IDs are `normal`, `slow`, `fanout`, `hang`, `autoscale`, `az`, `numa`, and `composition`.

Preset links store only the preset. **Share model** creates a link containing the current configuration, including user names, translations, overrides and seed. It starts a new experiment, without history or traces. Live edits do not rewrite the link; share again to capture them. Language follows browser preferences or user selection. Both kinds of fragments work in standalone HTML; a file URL points to the recipient's local copy, so use the hosted URL to share with others.

## Build models with an agent

Click **Create with an agent** beside the scenario selector for a short guide and an editable prompt to copy into your preferred agent. The guide is available in English and Russian, including the standalone app. It does not change or restart the current experiment. An agent that can read links can use [the model-building skill](https://tmlab.krglv.com/skill.md) with your system description, for example:

> Read https://tmlab.krglv.com/skill.md. Model two API instances calling one database, with 30 incoming requests per second and a database bottleneck. Give me a link to view the model.

The agent needs no repository clone, installed skill or credentials. The self-contained instructions in `public/skill.md` include the version 2 format, a complete model, encoding snippets and verification guidance. Vite publishes this file unchanged. It is a public user-facing skill, separate from the contributor skills in `.agents/skills/`.

Custom links use `#model=<base64url>`: UTF-8 JSON encoded as URL-safe base64 without padding. `model` takes precedence over `template`. The fragment is decoded locally and submitted to the same Go validator as the JSON editor after WASM is ready. On initial load, invalid links show an error with its cause instead of displaying the default model; opening a normal scenario requires an explicit action. When an experiment is already open, invalid links show an error and preserve that experiment. The payload is limited to 128 KiB of JSON; keep links small enough for the sharing channel. There is no server-side model storage. Anyone with the link can decode the configuration. Use JSON export as a backup for large models.

## Model localization in JSON

Names are model data, not interface dictionary keys. `name` holds the default name in English; JSON without translations is displayed literally, with no automatic translation. The model, each group, and each resource can include an optional field:

```json
{
  "name": "Database",
  "i18n": {
    "de": {"name": "Datenbank"},
    "fr-CA": {"name": "Stockage"}
  }
}
```

Text selection is exact language tag → base language → `i18n.en.name`, if supplied → `name`. Empty translations are skipped. Tags are case-insensitive and use hyphens, such as `pt-BR`. Each object supports up to 32 translations; translated names are limited to 200 UTF-8 bytes. IDs, group references, and routing labels are never translated.

Languages from every object's `i18n` appear in the shared selector. User preference takes precedence over browser language; English is the fallback. The interface supports English and Russian; for other languages, names come from the model while controls remain English. Switching language does not modify model parameters or reset the experiment.

Translations appear in the diagram, inspector, resource/autoscaler lists, stages, and traces. Export/import preserves them. Built-in presets use English `name` values and explicit Russian `i18n`. The box editor edits the base `name`; the full model schema form edits existing translations, and JSON can add translations. Resources can be added in the box editor or JSON. Use English defaults for new resources. Historical spans retain the resource name and translations from call time.

## Connection reuse

Keep-alive stores one abstract reusable connection for each caller → target pair; it is not a complete TCP pool. Trace attempts show `connection: "new" | "reused"`, establishment (`connectionEstablished`), and closure (`connectionClosed`). Internal calls use ideal links by default; an explicit network transport uses the same connection cache and settings as other box calls.

Local timeout/deadline, cancellation of an unfinished call, or transport failure evicts that call's connection from the reuse cache. Taking a node down removes its incoming/outgoing connections. An ordinary downstream error response, such as a full queue, does not by itself break the upstream connection. Disabling keep-alive clears the corresponding caller's cache; new calls do not populate it while disabled.

Eviction is tied to connection identity: a late failure from an old call cannot remove a replacement connection created after recovery. With cancellation disabled, work may continue after timeout, but a late handshake cannot restore the closed connection to the cache.

Blackhole on a warm connection still causes response timeouts for already sent requests. These are not retried after establishment. After eviction, subsequent requests establish new connections, receive connect timeouts, and may retry on the next node. The 10-second error metric initially includes the first wave of failures, then declines.

The `#template=fanout` preset is named **3 database calls**. Its description below preset selection explains three parallel calls, waiting for all responses, and disk work of approximately 333.333 ms: at 30 incoming RPS, nominal downstream demand is 90 calls/s before capacity limits. The link ID is unchanged.

Set model descriptions through `description` in JSON, with English as the default, and translations through `i18n.ru.description` or other languages. All built-in presets use this same field and display their description below preset selection, above the metrics and diagram. There is no separate diagram explanation field. Descriptions render as plain text, not HTML, and survive export. The optional field accepts up to 4000 UTF-8 bytes per description.

## Keep-alive and outgoing-call timeouts

Settings belong to the **calling box**, not the receiver. Each group defines `keepalive` (default true), `keepaliveTimeout` (idle timeout, 30000 ms when omitted; explicitly retimed in built-in presets), `connectTimeout`, `timeout`, and `retryConnect`. The same fields can be overridden in `overrides["api-1"]`. The interface places them under Downstream calls; This node / Whole group controls edit scope. A group edit removes individual overrides only for that field. Inherit group settings clears the selected node's overrides for all five connection settings. New instances inherit the group; draining boxes retain their settings until work finishes.

Example individual settings:

```json
{"overrides":{"api-1":{"keepalive":true,"keepaliveTimeout":30000,"connectTimeout":15,"timeout":700,"retryConnect":true}}}
```

Idle timeout starts when the last response returns over the connection, including return network time. Concurrent calls keep it active until the last response. Idle expiry never interrupts active work. `0` retains idle connections indefinitely; `keepalive: false` prevents reuse. The interface shows idle timeout in seconds; JSON uses milliseconds (0–3600000). Connect/call timeout is 1–60000 ms. Changes apply without reset: shortening idle timeout accounts for elapsed idle time, lengthening it moves expiry, and started-call budgets are preserved. Disabling keep-alive removes only that box's outgoing cache without interrupting active calls.

Generator-to-entry connections are configured separately in `client`: `keepalive`, `keepaliveTimeout`, and `connectTimeout` (defaults true / 30000 / 200 when omitted in imported models). Built-in presets explicitly carry their retimed values: true / 200000 / approximately 1333.33 for the normal preset. The total budget remains `deadline`. The interface exposes these under Connections to entry group. LB settings no longer control the generator's connect timeout.

Internal boxes can have downstream calls and their own optional `keepalive`, `keepaliveTimeout`, `connectTimeout`, `timeout`, and `retryConnect`. Missing fields inherit their containing definition’s settings recursively; individual node overrides apply only to that caller. For example, `overrides["api-1/~app"]` changes one application box’s outgoing calls. Ordinary and internal boxes use the same caller connection machinery, regardless of CPU/Disk/LB/API names.
