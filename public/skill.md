---
name: timeout-lab-model
description: Build or edit Timeout Lab simulation configurations from a user's system description and return a link that opens the model. Use for queues, resource limits, timeouts, fan-out, locality and scaling experiments.
---

# Build and view a Timeout Lab model

This is a self-contained skill for an agent that can read URLs and generate text/code. No repository clone, installation, account, backend or deployment is required. The user gives you this page and describes their system. Produce a working **[Open model](https://tmlab.krglv.com/#model=...)** link containing their configuration, with a short explanation of assumptions and what to observe. Do not return a built-in preset link as if it contained the user's changes.

## Workflow

1. Map the description to groups of instances, processing slots, queues and explicit calls. Ask only for missing choices that materially affect the experiment; choose and disclose illustrative numbers when real measurements are unavailable. Preserve user-provided names. Model queues and bounded resources, not protocol fidelity, storage capacity, replication or data consistency.
2. Start from the complete example below. Change its topology, counts, rates and timings to match the request. Use schema version 2, explicit `stages` on every box and milliseconds for all JSON durations. Give new default names/descriptions in English; put translations in `i18n` when helpful. User-provided names remain literal.
3. Encode the complete JSON as UTF-8, then unpadded URL-safe base64, and append it to `https://tmlab.krglv.com/#model=`. Use code to encode if available; do not invent or truncate encoded text. The code snippets below need only the standard library. No network call uploads the model: it is carried in the URL fragment.
4. When browser control is available, open the resulting link, wait for the diagram and check that the custom groups appear without an error banner. Use **Generator → Request mode → Single request** to inspect the call tree, or continuous load to observe queues and throughput. Correct validation errors and regenerate the link. With no browser, decode the generated link and compare its JSON to the intended model; say that browser/engine validation has not been performed. Never claim measured behavior without running it.
5. Return the clickable model link first, then concise assumptions and a concrete experiment (for example, increase RPS and watch a specific resource queue). Attach JSON as a useful backup when supported, but do not require manual import as the normal path. Subsequent changes produce a new complete link. The app's **Share model** button captures edits made in the viewer.

Opening a model link starts a new experiment. It carries configuration and seed, not elapsed time, in-flight requests, traces, manual-request mode or history. Reload reopens the linked configuration; edits in the viewer require a new share link. Links are readable by anyone who receives them. Keep models concise (prefer links below about 8,000 characters for chat clients); the viewer accepts at most 128 KiB of JSON. Do not remove requested behavior just to shorten a link. If a channel truncates a long URL, also provide the full URL as a text file.

## Complete example: API with a database bottleneck

At 30 incoming requests/s, the database has one slot doing 50 ms of work per visit: roughly 20 visits/s of local capacity at weight 1. Its queue should grow until timeout/cancellation or overflow limits the work. This is an expectation to check, not a measured result.

```json
{
  "version": 2,
  "name": "API and database bottleneck",
  "description": "Watch the database queue and API workers waiting for child calls. Reduce incoming RPS to 10 and compare.",
  "entry": "api",
  "rps": 30,
  "weight": 1,
  "spread": 0,
  "network": 2,
  "jitter": 0,
  "deadline": 3000,
  "cancel": true,
  "seed": 42,
  "client": {"keepalive": true, "keepaliveTimeout": 30000, "connectTimeout": 200},
  "groups": [
    {
      "id": "api", "name": "API", "count": 2,
      "workers": 16, "service": 5, "queueLimit": 100,
      "timeout": 2000, "connectTimeout": 200,
      "stages": [{"join": "all", "calls": [
        {"target": "db", "calls": 1, "route": "round_robin", "transport": "network"}
      ]}]
    },
    {
      "id": "db", "name": "Database", "count": 1,
      "workers": 1, "service": 50, "queueLimit": 100,
      "timeout": 1000, "connectTimeout": 200,
      "stages": []
    }
  ]
}
```

Python (given your model in `model.json`):

```python
import base64, json
from pathlib import Path
model = json.loads(Path("model.json").read_text(encoding="utf-8"))
payload = json.dumps(model, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
assert len(payload) <= 128 * 1024
encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
url = "https://tmlab.krglv.com/#model=" + encoded
assert json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))) == model
print(url)
```

Node.js alternative, with your model in the `model` variable:

```js
const encoded = Buffer.from(JSON.stringify(model), "utf8").toString("base64url");
console.log("https://tmlab.krglv.com/#model=" + encoded);
```

To edit an existing link, decode the `model` fragment with the reverse operation, modify the JSON and re-encode it. A `#template=normal` link selects only a built-in preset. `model` takes precedence when both fields occur. There is no remote-JSON URL parameter or model storage API.

## Format and modeling rules

Unknown fields are rejected, including nested ones. Do not use legacy `edges`, group-level `join`/`quorum`, `downstream` stages or global `keepalive`. Every group and internal resource requires `stages: []` even if it has no children. IDs reference definitions; names are display data.

### Top-level configuration

Required fields are shown in the example. `rps` is **total incoming traffic to `entry`**, not per instance. Scaling never multiplies incoming RPS. `weight` multiplies local processing time; `spread` is uniform weight variation in percent, `jitter` is duration variation in percent. Use a fixed nonzero integer `seed` for reproducible comparisons. Imported models keep literal timings; they are not retimed to match built-in presets.

Ranges: `rps` 0–2000; `weight` greater than 0 through 10; `spread`/`jitter` 0–100; `network` 0–5000 ms one way; `deadline` 1–60000 ms. `cancel` controls cancellation of unfinished work after callers stop waiting. `client` configures generator-to-entry connections separately from group outgoing connections.

Optional fields: `description` (up to 4000 UTF-8 bytes), `i18n`, `requestLabels` (string map), `requestTag: {"key":"op","a":"read","b":"write","percent":80}`, `entryAffinity`, `overrides`. The tag generator chooses `a` at `percent` percent and `b` otherwise. All request labels are carried into descendants. For manual requests, enter their labels explicitly.

### Groups and resources

Groups require unique `id` (up to 40 bytes), `name`, `count` (1–16), `workers` (1–512), `service` (0–10000 ms), `queueLimit` (0–2000 waiting requests per instance), `timeout` and `connectTimeout` (1–60000 ms), and `stages`. There must be 1–12 groups, no more than 64 top-level instances, and `entry` must name a group.

`workers` counts occupied service handlers, including time spent waiting for children. Do not mistake this for CPU utilization. `service` is local work before the stages. `queueLimit: 0` means no waiting. Each instance has its own queue.

Optional group fields: `resources`, `keepalive` (default true), `keepaliveTimeout` (0–3600000 ms; 0 keeps idle connections indefinitely), `retryConnect` (default true), `labels`, `cost`, `autoscale`, `i18n`. Timeouts and connection settings belong to the **caller**. Connect retries only cover establishment failures, trying other instances once each within the shared call budget; errors after establishment are not retried.

`resources` is an array of internal boxes. Each needs `id`, `name`, `scope` (`instance` or `shared`), `workers`, `service`, `queueLimit`, `stages`, and may recursively contain `resources`. It may also have the optional connection fields (`timeout`, `connectTimeout`, `keepalive`, `keepaliveTimeout`, `retryConnect`), `labels`, `cost`, `i18n`. Connection fields inherit from the containing box unless overridden. `instance` creates a resource per owner; `shared` creates one per definition path per top-level group. Descendants of shared boxes stay shared. A container itself consumes slots: do not add decorative containers.

Example resource and stage inside an API group:

```json
{
  "resources": [
    {"id":"cpu","name":"CPU","scope":"instance","workers":2,"service":20,"queueLimit":100,"stages":[]}
  ],
  "stages": [
    {"join":"all","calls":[{"resource":"cpu","calls":1,"route":"round_robin","transport":"ideal","timeout":0}]},
    {"join":"all","calls":[{"target":"db","calls":1,"route":"round_robin","transport":"network"}]}
  ]
}
```

This is a fragment to merge into a group, not a complete model. Containment alone never schedules a resource visit. Avoid counting the same CPU work in both the service and its CPU resource.

### Stages and calls

Stages execute sequentially; calls within a stage execute in parallel. Each stage requires nonempty `calls` (up to 8 directions) and `join`: `all`, `any`, or `quorum`; the last requires integer `quorum` achievable by the batch. A call specifies exactly one `target` (group ID) or `resource` (relative internal path), `calls` (1–16), `route` (`round_robin`, `random`, `least_busy`, `broadcast`) and `transport` (`network`, `ideal`). Broadcast calls every instance; other routes select instances. `calls: 3` is parallel fan-out; three stages are sequential revisits.

Optional call fields: `timeout` (0–60000 ms; 0 means no additional budget, still subject to ancestor limits), `network` (one-way delay overriding the global value), `when` (string-map label condition), `affinity`, `networkCost`. `network: 0` retains connection behavior with zero link delay. `transport: "ideal"` bypasses connection setup and transit but still queues, processes, times out and can fail. A missing call timeout inherits the caller's outgoing timeout.

`when` also works on stages. All its labels must match; matching branches all run, not just the first. No eligible calls skips an all/any stage successfully; an unreachable quorum fails. Resource paths such as `cpu`, `worker/cpu`, `../cpu` are relative to the calling box. A shared caller cannot select a private relative. Calls must form a DAG; sequential revisits are allowed. Limits: 8 immediate resources per box, 16 stages per box, 512 internal boxes total and 512 original visits per root request.

### Locality, instance overrides, autoscaling and translations

- `labels: {"az":"a"}` places a box. A matching rule is `{"enabled":true,"source":"caller","key":"az"}`; source is `caller` or `request`. Use it as call `affinity`, or `entryAffinity` with source `request`. Affinity prefers matching instances, including busy ones. A `cost` or call `networkCost` adds `"match":1,"mismatch":3` to the rule. Missing labels give factor 1. Cost changes processing; networkCost changes transit. These are illustrative multipliers, not protocol emulation.
- Top-level `overrides` maps instance IDs such as `api-1` to fields: `workers`, `service`, `state` (`healthy`, `down`, `hang`), caller connection settings, `labels`, `cost`. Preserve overrides when editing unless the user requests changing them.
- Example group `autoscale`: `{"enabled":true,"min":1,"max":8,"resource":"cpu","signal":"both","upUtilization":75,"window":5000,"upQueue":2,"downUtilization":30,"upDelay":2000,"downDelay":10000,"cooldown":3000}`. Signals are `queue`, `utilization`, `both`; omit `resource` to observe handlers. Durations are ms, utilization is percent. Scale-down drains accepted work without moving queues. Shared resources gain no capacity when the group scales.
- Model, group and resource translations use `"i18n":{"ru":{"name":"Имя","description":"Описание"}}`. Do not translate IDs or routing labels. Changing the viewer language does not modify model JSON or reset the experiment.

## Interpreting the experiment

State whether values are measured or illustrative. Approximate leaf capacity as `instances × workers × 1000 / (service × mean weight)` visits/s only when service is positive and downstream waits do not consume those slots; account for visits per root request. Parent durations already include children, so never add all spans to estimate end-to-end latency. Successful-response p95 excludes errors; inspect both p95 and error rate. Resource utilization and handler utilization are separate. Playback speed changes wall-clock pace, not virtual-time semantics. Compare models with the same seed and virtual observation window; allow enough time for queues and autoscaling delays to develop.
