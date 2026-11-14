import { useEffect, useRef, useState } from "react";
import { useEngine, command, editConfig, run, startEngine } from "./engine";
import { I18n, t, useLocale } from "./locale";
import { Generator } from "./components/Generator";
import { Topology, DiagramNotes, type Selection } from "./components/Topology";
import { Inspector } from "./components/Inspector";
import { ModelEditor } from "./components/ModelEditor";
import { ModelHelp } from "./components/ModelHelp";
import { ShareModel } from "./components/ShareModel";
import { AgentGuide } from "./components/AgentGuide";
import { modelFromHash, modelURL } from "./sharing";
import { Traces } from "./components/Traces";
import { Metrics, Activity } from "./components/Metrics";
import { Canvas } from "./components/Canvas";
import { Dock, SettingsWindow } from "./components/Overlay";
import type { Trace } from "./model";
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
  if (new URLSearchParams(location.hash.slice(1)).has("model")) return "custom";
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
  const [settings, setSettings] = useState<"box" | "generator" | null>(null);
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(true);
  const [tracesOpen, setTracesOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);
  useEffect(() => {
    const compact = matchMedia("(max-height: 600px)");
    const fold = () => {
      if (compact.matches) {
        setMetricsOpen(false);
        setActivityOpen(false);
      }
    };
    fold();
    compact.addEventListener("change", fold);
    return () => compact.removeEventListener("change", fold);
  }, []);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [linkError, setLinkError] = useState("");
  const [shareURL, setShareURL] = useState("");
  const [customModelVersion, setCustomModelVersion] = useState(0);
  const [editor, setEditor] = useState<{ group?: string } | null>(null),
    [info, setInfo] = useState(false),
    [preset, setPreset] = useState(fromURL);
  const initialized = useRef(false);
  const restoredHash = useRef<string | null>(null);
  const presetRequest = useRef(0);
  const changingPreset = useRef(false);
  async function choose(id: string, push = true) {
    const request = ++presetRequest.current;
    changingPreset.current = true;
    setLinkError("");
    setPreset(id);
    const nextSelection: Selection = {
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
    };
    const url = new URL(location.href);
    const params = new URLSearchParams(url.hash.slice(1));
    params.delete("model");
    params.set("template", id);
    url.hash = params.toString();
    if (url.href !== location.href)
      history[push ? "pushState" : "replaceState"](null, "", url);
    restoredHash.current = location.hash;
    try {
      await command({ type: "preset", preset: id });
      if (request === presetRequest.current) select(nextSelection);
    } catch {
    } finally {
      if (request === presetRequest.current) changingPreset.current = false;
    }
  }
  async function restoreURL() {
    if (restoredHash.current === location.hash) return;
    restoredHash.current = location.hash;
    const request = ++presetRequest.current;
    changingPreset.current = true;
    setLinkError("");
    try {
      const config = modelFromHash(location.hash);
      if (!config) {
        await choose(fromURL(), false);
        return;
      }
      await command({ type: "reset", config });
      if (request === presetRequest.current) {
        setPreset("custom");
        setCustomModelVersion((version) => version + 1);
        setShareURL("");
        setSelectedTrace(null);
        setEditor(null);
        setSettings(null);
        select({ node: `${config.entry}-1`, resource: "", scope: "group" });
      }
    } catch (error) {
      if (request === presetRequest.current)
        setLinkError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === presetRequest.current) changingPreset.current = false;
    }
  }
  useEffect(() => {
    startEngine();
  }, []);
  useEffect(() => {
    if (s && !initialized.current) {
      initialized.current = true;
      void restoreURL();
    }
  }, [!!s]);
  useEffect(() => {
    const restore = () => {
      if (initialized.current) void restoreURL();
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
      changingPreset.current ||
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
  useEffect(() => {
    if (s?.focus) setTracesOpen(true);
  }, [s?.focus?.id]);
  function selectBox(next: Selection) {
    select(next);
    setSettings("box");
  }
  const sec = (s?.t || 0) / 1000;
  return (
    <main
      className={`lab-workspace ${settings ? "has-settings" : ""} ${metricsOpen ? "has-metrics" : ""} ${activityOpen ? "has-activity" : ""} ${tracesOpen ? "has-traces" : ""}`}
    >
      <header className="lab-toolbar floating-block">
        <a className="brand" href="./" aria-label="boxes · systems lab">
          <span className="brand-mark">◈</span>
          <span>
            boxes<span className="brand-caption">systems lab</span>
          </span>
        </a>
        <label className="preset-picker">
          <span>{t("Scenario")}</span>
          <select
            id="preset"
            aria-label={t("Scenario")}
            value={preset}
            disabled={!s}
            onChange={(e) => choose(e.target.value)}
          >
            {preset === "custom" && (
              <option value="custom" disabled>
                {t("Custom model")}
              </option>
            )}
            {presets.map(([id, label]) => (
              <option key={id} value={id}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <button
          id="create-with-agent"
          className="agent-create-button"
          aria-haspopup="dialog"
          onClick={() => setAgentGuideOpen(true)}
        >
          <span aria-hidden="true">＋</span> {t("Create with an agent")}
        </button>
        <a
          className="github-link"
          href="https://github.com/subuk/timeout-lab"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
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
              title={t("Advance the simulation by 1 second")}
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
              aria-label={t("Restart with the current settings")}
              disabled={!s}
              onClick={() => run(editConfig(() => {}, true))}
            >
              ↺
            </button>
          </div>
        </div>
        <div className="toolbar-actions">
          <button
            id="share-model"
            disabled={!s}
            title={t("Share model")}
            aria-label={t("Share model")}
            onClick={() => {
              if (!s) return;
              try {
                setShareURL(modelURL(s.config));
                setLinkError("");
              } catch (error) {
                setLinkError(
                  error instanceof Error ? error.message : String(error),
                );
              }
            }}
          >
            ↗
          </button>
          <button
            id="edit-config"
            disabled={!s}
            onClick={() => setEditor({})}
            title={t("Configuration")}
            aria-label={t("Configuration")}
          >
            {"{ }"}
          </button>
          <button
            id="export"
            disabled={!s}
            onClick={download}
            title={t("Export JSON")}
            aria-label={t("Export JSON")}
          >
            ↓
          </button>
          <button
            id="model-info"
            aria-haspopup="dialog"
            title={t("How the model works")}
            aria-label={t("How the model works")}
            onClick={() => setInfo(true)}
          >
            ?
          </button>
          <select
            id="language"
            aria-label={t("Language")}
            value={
              locale === "ru-RU" ? "ru" : locale === "en-US" ? "en" : locale
            }
            onChange={(e) => I18n.setLanguage(e.target.value)}
          >
            {I18n.languages().map((v: string) => (
              <option key={v} value={v}>
                {v.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </header>
      {(linkError || engine.error) && (
        <p className="error-banner" role="alert">
          {t(linkError || engine.error)}
        </p>
      )}
      {s ? (
        <>
          <Canvas key={`canvas-${engine.epoch}`}>
            <Topology
              snapshot={s}
              trace={selectedTrace}
              selection={selection}
              select={selectBox}
              active={settings === "box"}
              generatorSelected={settings === "generator"}
              openGenerator={() => setSettings("generator")}
            />
          </Canvas>
          <Dock
            id="metrics"
            title="System metrics"
            className="metrics-dock"
            open={metricsOpen}
            toggle={() => setMetricsOpen(!metricsOpen)}
          >
            <Metrics snapshot={s} />
          </Dock>
          <Dock
            id="activity"
            title="System activity"
            className="activity-dock"
            open={activityOpen}
            toggle={() => setActivityOpen(!activityOpen)}
          >
            <Activity snapshot={s} />
          </Dock>
          <Dock
            id="notes"
            title="About this experiment"
            className="notes-dock"
            open={notesOpen}
            toggle={() => setNotesOpen(!notesOpen)}
          >
            <DiagramNotes snapshot={s} />
            <a
              className="source-link"
              href="https://tmlab.krglv.com/skill.md"
              target="_blank"
              rel="noreferrer"
            >
              {t("Build a model with an agent ↗")}
            </a>
          </Dock>
          <Dock
            id="traces"
            title="End-to-end traces"
            className="traces-dock"
            open={tracesOpen}
            toggle={() => setTracesOpen(!tracesOpen)}
          >
            <Traces
              key={`traces-${engine.epoch}`}
              snapshot={s}
              onTraceChange={setSelectedTrace}
            />
          </Dock>
          <SettingsWindow
            open={settings !== null}
            label={t(settings === "generator" ? "Generator" : "Box settings")}
            close={() => setSettings(null)}
          >
            <div hidden={settings !== "generator"}>
              <Generator
                key={`generator-${preset}-${customModelVersion}`}
                config={s.config}
                manual={s.manualMode}
                running={s.focusRunning}
                focus={s.focus}
                onRequestError={() => setSettings("generator")}
              />
            </div>
            <div hidden={settings !== "box"}>
              <Inspector
                key={`${engine.epoch}/${selection.node}/${selection.resource}/${selection.scope}`}
                snapshot={s}
                selection={selection}
                select={selectBox}
                edit={(group) => setEditor({ group })}
              />
            </div>
          </SettingsWindow>
          {editor && (
            <ModelEditor
              config={s.config}
              group={editor.group}
              close={() => setEditor(null)}
            />
          )}
        </>
      ) : (
        <div className="topology-loading">{t("Loading engine…")}</div>
      )}
      {info && <ModelHelp close={() => setInfo(false)} />}
      {agentGuideOpen && <AgentGuide close={() => setAgentGuideOpen(false)} />}
      {shareURL && <ShareModel url={shareURL} close={() => setShareURL("")} />}
    </main>
  );
}
