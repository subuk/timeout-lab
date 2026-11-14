import { useEffect, useRef, useState } from "react";
import { useEngine, command, editConfig, run, startEngine } from "./engine";
import { I18n, name, t, useLocale } from "./locale";
import { Generator } from "./components/Generator";
import { Topology, type Selection } from "./components/Topology";
import { Inspector } from "./components/Inspector";
import { ModelEditor } from "./components/ModelEditor";
import { Traces } from "./components/Traces";
import { Metrics, Activity } from "./components/Metrics";
const presets = [
  ["normal", "Normal operation"],
  ["slow", "Slow database"],
  ["fanout", "3 database calls"],
  ["hang", "Hung backend"],
  ["autoscale", "Autoscaling"],
  ["az", "Two zones"],
  ["numa", "NUMA"],
  ["composition", "Nested boxes"],
];
function fromURL() {
  const id = new URLSearchParams(location.hash.slice(1)).get("template");
  return presets.some(([v]) => v === id) ? id! : "normal";
}
export function App() {
  const engine = useEngine((v) => v),
    s = engine.snapshot,
    locale = useLocale();
  const [selection, select] = useState<Selection>({
    node: "db-1",
    resource: "",
    scope: "node",
  });
  const [editor, setEditor] = useState<{ group?: string } | null>(null),
    [info, setInfo] = useState(false),
    [preset, setPreset] = useState(fromURL);
  const initialized = useRef(false);
  function choose(id: string, push = true) {
    setPreset(id);
    select({
      node:
        id === "numa"
          ? "cpu-1"
          : id === "az"
            ? "lb-1"
            : ["hang", "autoscale", "composition"].includes(id)
              ? "api-1"
              : "db-1",
      resource: id === "slow" ? "storage" : "",
      scope: id === "autoscale" ? "group" : "node",
    });
    const url = new URL(location.href);
    const params = new URLSearchParams(url.hash.slice(1));
    params.set("template", id);
    url.hash = params.toString();
    if (url.href !== location.href)
      history[push ? "pushState" : "replaceState"](null, "", url);
    run(command({ type: "preset", preset: id }));
  }
  useEffect(() => {
    startEngine();
  }, []);
  useEffect(() => {
    if (s && !initialized.current) {
      initialized.current = true;
      choose(fromURL(), false);
    }
  }, [!!s]);
  useEffect(() => {
    const restore = () => {
      if (initialized.current) choose(fromURL(), false);
    };
    addEventListener("popstate", restore);
    addEventListener("hashchange", restore);
    return () => {
      removeEventListener("popstate", restore);
      removeEventListener("hashchange", restore);
    };
  }, []);
  useEffect(() => {
    if (s) I18n.setModelLanguages(s.config);
  }, [s?.config]);
  useEffect(() => {
    if (
      !s ||
      s.nodes.some((node) => node.id === selection.node && !node.retired)
    )
      return;
    const group = s.nodes.find((node) => node.id === selection.node)?.group;
    const next =
      s.nodes.find((node) => node.group === group && !node.retired) ||
      s.nodes.find((node) => !node.retired);
    if (next) select((previous) => ({ ...previous, node: next.id }));
  }, [s?.nodes, selection.node]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    document.body.classList.toggle("paused", engine.paused);
  }, [engine.paused]);
  function download() {
    if (!s) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(s.config, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "boxes-model.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const sec = (s?.t || 0) / 1000;
  return (
    <>
      <header className="app-header">
        <a className="brand" href="./">
          <span className="brand-mark">◈</span>
          <span>
            boxes<span className="brand-caption">systems lab</span>
          </span>
        </a>
        <nav>
          <span className="nav-active">Lab</span>
          <button id="model-info" onClick={() => setInfo(!info)}>
            {t("How the model works ↗")}
          </button>
        </nav>
        <a
          className="github-link"
          href="https://github.com/subuk/timeout-lab"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
        <select
          id="language"
          aria-label={t("Language")}
          value={locale === "ru-RU" ? "ru" : locale === "en-US" ? "en" : locale}
          onChange={(e) => I18n.setLanguage(e.target.value)}
        >
          {I18n.languages().map((v: string) => (
            <option key={v} value={v}>
              {v.toUpperCase()}
            </option>
          ))}
        </select>
        <span className="runtime">Go / WebAssembly</span>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">INTERACTIVE EXPERIMENT</div>
            <h1>{t("How systems behave under load")}</h1>
            <p>
              {t("Adjust latency. Watch the queues. Find the system’s limits.")}
            </p>
          </div>
          <div className="transport">
            <span
              id="live-state"
              className={`live-state ${engine.paused ? "paused" : ""}`}
            >
              {t(
                !s
                  ? "Loading engine…"
                  : engine.paused
                    ? "Paused"
                    : "Simulation running",
              )}
            </span>
            <span id="clock" className="mono">
              {String(Math.floor(sec / 60)).padStart(2, "0")}:
              {(sec % 60).toFixed(1).padStart(4, "0")}
            </span>
            <div className="transport-buttons">
              <button
                id="pause"
                disabled={!s}
                onClick={() => run(command({ type: "pause" }))}
              >
                {t(engine.paused ? "▶ Resume" : "Ⅱ Pause")}
              </button>
              <button
                id="step"
                disabled={!s}
                onClick={() => run(command({ type: "step" }))}
              >
                +1 s
              </button>
              <select
                id="speed"
                aria-label={t("Simulation speed")}
                value={engine.speed}
                onChange={(e) =>
                  run(command({ type: "speed", value: +e.target.value }))
                }
              >
                {[0.125, 0.25, 0.5, 1, 2, 5].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
              <button
                id="reset"
                disabled={!s}
                onClick={() => run(editConfig(() => {}, true))}
              >
                ↺
              </button>
            </div>
          </div>
        </section>
        {engine.error && (
          <p className="error-banner" role="alert">
            {t(engine.error)}
          </p>
        )}
        <section className="scenario-bar">
          {presets.map(([id, label], i) => (
            <button
              data-scenario={id}
              key={id}
              disabled={!s}
              className={preset === id ? "active" : ""}
              onClick={() => choose(id)}
            >
              {String(i + 1).padStart(2, "0")} <span>{t(label)}</span>
            </button>
          ))}
        </section>
        {info && (
          <section className="panel control-body">
            <h2>{t("What is being modeled")}</h2>
            <p>
              {t(
                "Every box has a FIFO queue, workers and a program. Stages run in order; calls within a stage run in parallel. Workers remain occupied while waiting for children.",
              )}
            </p>
            <p>
              {t(
                "The generator sets total traffic into the entry group. Scaling does not change incoming RPS. Connection settings belong to the caller. A user deadline bounds the whole request.",
              )}
            </p>
            <p>
              {t(
                "Little’s law includes unfinished visits. Nested span durations must not be added to calculate end-to-end latency.",
              )}
            </p>
          </section>
        )}
        {s && (
          <>
            <p id="model-description">{I18n.description(s.config)}</p>
            <Metrics snapshot={s} />
            <div className="workspace">
              <Generator
                config={s.config}
                manual={s.manualMode}
                running={s.focusRunning}
                editAdvanced={() => setEditor({})}
              />
              <div className="center-column">
                <Topology
                  key={`topology-${engine.epoch}`}
                  snapshot={s}
                  selection={selection}
                  select={select}
                  edit={() => setEditor({})}
                />
                <Activity snapshot={s} />
                <Traces key={`traces-${engine.epoch}`} snapshot={s} />
              </div>
              <Inspector
                snapshot={s}
                selection={selection}
                select={select}
                edit={(group) => setEditor({ group })}
              />
            </div>
            <footer>
              <button id="export" onClick={download}>
                {t("Export JSON")}
              </button>
              <span>{name(s.config)}</span>
            </footer>
            {editor && (
              <ModelEditor
                config={s.config}
                group={editor.group}
                close={() => setEditor(null)}
              />
            )}
          </>
        )}
      </main>
    </>
  );
}
