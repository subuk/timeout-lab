# Timeout Lab — project conventions

Scope: this standalone project and its subdirectories.

## Purpose and layout

Timeout Lab / Systems Lab is a static interactive simulator of queues, bounded resources, timeouts, and scaling. The engine is generic: LB, API, CPU, disk, memory, and zones are applications of the common model, not special scheduler types. Do not add MongoDB, TCP, or NUMA protocol fidelity without a separate task.

English is the primary project language. Write documentation, contributor instructions, source comments, and default UI/model text in English. Keep other languages in explicit localization data and localization tests; preserve user-defined names verbatim.

- `core/`: Go model, virtual time, metrics, and tests.
- `cmd/wasm/main.go`: `labCommand` JSON bridge; `src/worker.ts`: Web Worker execution.
- `src/`: React/TypeScript interface, styles, translations, typed Worker bridge, and generated Go wire types.
- Root `index.html`, `vite.config.ts`, `vite.worker.config.ts`: application and Worker build entries.
- `dist/` and `public/{worker.js,core.wasm,wasm_exec.js}`: generated build output; do not edit manually or commit it.
- `scripts/build.sh`: type generation/checking, WASM, Vite and standalone build; `scripts/standalone.py`: offline packaging and Worker asset versioning.
- `README.md`: detailed semantics and JSON; `deployment/DEPLOYMENT.txt`: deployment history, not the current model specification.

The interface uses React and TypeScript with Vite. Bundle dependencies locally; no runtime CDN, external fonts, APIs, or backend. Preserve offline `standalone.html` operation over `file://`. React owns the DOM; keep imperative drawing inside canvas/layout effects. Separate form drafts and selection from simulation snapshots.

## Invariants

- The generator sets the **total RPS for the entry group** `entry`. Scaling does not change incoming traffic. Children arise only through graph edges.
- Engine time is virtual, in milliseconds; RNG is reproducible. Playback speed and rendering frequency do not change experiment semantics.
- Numeric settings, failures, and instance counts change without resetting time, queues, RNG, or history. Scale-down stops new assignments and drains accepted work; queues do not migrate. Graph/resource structure changes may require an explicitly indicated restart.
- Service workers remain occupied while waiting for children. Internal resources have their own queues and slots; their utilization is distinct from service-handler utilization.
- Keep-alive, idle/connect/call timeouts, and connection retries belong to the **caller**: group settings followed by individual overrides. The generator has a separate `client`; the user `deadline` bounds the root call.
- Retries are enabled by default only for connection-establishment failures, within the logical call's shared budget. Failures after establishment are not retried. Idle timeout never interrupts active calls.
- Do not adjust metrics to fit the visualization. Over a finite interval, `L = λW + sum of unfinished visit ages / T`. Nested span durations cannot be added to obtain end-to-end latency.
- User names are data. English is the default; model translations are explicit `i18n` entries. Switching language does not rewrite JSON or reset the experiment.

## Local skills

Skills live in **this project's** `.agents/skills/`. Open the project in Codex from its root; global skill installation is unnecessary.

| Task | Skill |
| --- | --- |
| Change the Go model, metrics, queues, resources, timeouts, or autoscaler | [timeout-lab-core](.agents/skills/timeout-lab-core/SKILL.md) |
| Change the interface, localization, presets, URLs, or Worker bridge | [timeout-lab-ui](.agents/skills/timeout-lab-ui/SKILL.md) |
| Package, publish, or restore a release on the existing server | [timeout-lab-release](.agents/skills/timeout-lab-release/SKILL.md) |

Combine relevant skills for changes spanning multiple areas. For behavioral questions, reading relevant code/README is sufficient; do not run the entire release workflow.

## Checks and build

Run from this directory:

```sh
go test ./...
node scripts/check-i18n.cjs
npm run build
node scripts/check-manual.cjs
npm run test:browser
```

Go must include `lib/wasm/wasm_exec.js`; use the runtime from the same installation that compiles WASM. If the Go cache is unavailable in the sandbox, use `GOCACHE=/tmp/timeout-lab-go-cache`.

Match verification to the change: frontend changes need TypeScript/i18n checks and a Vite build before standalone packaging; engine changes need Go tests and a full build; interface behavior needs relevant Playwright scenarios. Run `npm ci` before building a fresh checkout. Install Chromium once using `npx playwright install chromium`. Add tests for changed semantics/regressions, not exact heading wording. Do not hard-code the current test count in instructions.

## Publication and boundaries

Live URL: `https://tmlab.krglv.com/`, server: `subuk@net.krglv.com`. The user chose their own nginx hosting. Do not register a Site or change hosting without a new task. Publish only the static build to the web server. The source repository is `https://github.com/subuk/timeout-lab`; keep generated build artifacts out of Git.

If service tokens or passwords are needed, use the personal [bitwarden](/Users/subuk/.codex/skills/bitwarden/SKILL.md) skill. The primary source is the `AI` folder in Bitwarden/Vaultwarden; helper: `python3 ~/.codex/skills/bitwarden/scripts/bw-session.py status` (also `unlock`, `lock`, `exec`). Never print secrets or commit them; use them only for the current task.

Ordinary live-demo improvements in this conversation may be published under previously granted authorization. Documentation/skill tasks, discussion, or explicit “local only” work do not themselves justify deployment. This file does not grant separate authorization for external actions.

Do not modify neighboring projects, shared DNS, other nginx vhosts, or cluster settings for this demo. Do not include unrelated working-tree changes in commits. Report the result, checks, and limitations; provide the live URL when deploying.
