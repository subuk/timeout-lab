---
name: timeout-lab-ui
description: Improve the Timeout Lab HTML/JS interface, presets, model and UI localization, sharing links, and WASM integration. Use for demo behavior and presentation.
---

# Timeout Lab interface

Work from the project root, three levels above this directory. Read `AGENTS.md`; consult the relevant `README.md` section for JSON and behavior.

## Sources and state

Editable sources live directly in `dist/`: `index.html` markup, `style.css` styles, `app.js` controller/rendering, `i18n.js` translations, and `worker.js` Worker. Do not edit embedded copies in `standalone.html`.

Computation stays in Go/Worker; the UI sends commands and renders snapshots. Ordinary settings use `config`/`node`, not `reset`. A new preset, graph import, or structural change may use an explicit reset. Do not duplicate model calculations in JavaScript for display.

For a new control, define units, scope (node, group, resource, generator), default, and override behavior. JSON uses milliseconds; idle timeout and autoscaler delays use seconds in the UI. Check round-trips, including 0 and false. Downstream controls show the effective caller settings. A group edit clears overrides only for the changed field; inheriting all settings is a separate action. Do not apply that rule to locality labels, where individual overrides take precedence.

Place optional mechanisms in suitable expandable sections/tabs instead of showing CPU and disk on every box. Resources may have arbitrary names. Regular snapshots must preserve active input, trace selection, and focus.

## Localization and presets

- Use English as the source/default language for UI labels, tooltips, dynamic messages, and accessibility text. Keep Russian translations in `i18n.js`, using the existing functions and `app.js` conventions rather than a second dictionary system.
- User `name`/`description` values are literal data. Use only model/group/resource `i18n.<language>` translations: exact tag → base language → explicit English → base field. Never translate IDs or routing labels.
- Built-in presets have English base text and explicit Russian translations. JavaScript selects the browser language with saved user choice taking precedence. Model languages appear in the selector; unsupported UI languages use English. Switching language preserves configuration and experiment state.
- URLs store only `#template=<id>`. Preserve `normal`, `slow`, `fanout`, `hang`, `autoscale`, `az`, and `numa` IDs when renaming buttons. Modified experiments are shared as JSON. Check direct opening after WASM-ready, reload, back/forward, and unknown IDs.
- Preset names/descriptions should explain the experiment. Autoscaling demonstrates API growth; NUMA sends traffic to both nodes. Express new scenarios as ordinary configuration first; change the engine only when a required generic mechanism is missing.

## Checks and build

Run `node --check <file>` for changed JS files and `node scripts/check-i18n.cjs` for translations/presets. After HTML/CSS/JS edits, run `python3 scripts/standalone.py` to update asset hashes, Worker dependencies, and standalone HTML. If the engine changed, run `sh scripts/build.sh` instead of packaging separately.

For interactive changes, run `python3 -m http.server 8791 --bind 127.0.0.1 --directory dist` and check in an available browser:

- The specific user action and observable result, including leaving fields to trigger `change`.
- Application to the correct node/group and preservation of experiment time.
- English/Russian, preservation of user input, and console errors.
- Standalone HTML when Worker, loading, export, or localization is affected.

Check only relevant scenarios. Simple copy changes need dictionary checks and a build, not a full model run. If a browser is unavailable, identify unverified behavior explicitly; syntax checks are not visual verification. Stop only your own preview server afterward. Deployment uses the separate `timeout-lab-release` skill within the task's authorization.
