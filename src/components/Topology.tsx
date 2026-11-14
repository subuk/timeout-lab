import { useLayoutEffect, useRef, useState } from "react";
import type { Snapshot, Group, NodeView, Trace } from "../model";
import { aggregate, outgoing, resources } from "../model-utils";
import { fmt, name, t, I18n } from "../locale";
export interface Selection {
  node: string;
  resource: string;
  scope: "node" | "group";
}
export function Topology({
  snapshot: s,
  trace,
  selection,
  select,
  generatorSelected,
  openGenerator,
  active,
}: {
  snapshot: Snapshot;
  trace: Trace | null;
  selection: Selection;
  select: (s: Selection) => void;
  generatorSelected: boolean;
  openGenerator: () => void;
  active: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  // Measure only topology/layout changes; metrics do not rebuild SVG geometry.
  const layout = JSON.stringify([
    s.config.groups.map((g) => [g.id, g.count, name(g), outgoing(g)]),
    s.nodes.map((n) => [n.id, n.retired, n.draining]),
    collapsed,
    s.config.entry,
    s.manualMode,
  ]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const scale = rect.width / el.offsetWidth;
      const groups = new Map(
        Array.from(el.querySelectorAll<HTMLElement>("[data-endpoint]")).map(
          (e) => [e.dataset.endpoint, e.getBoundingClientRect()],
        ),
      );
      const connections = [
        { from: "generator", to: `group:${s.config.entry}` },
        ...s.config.groups.flatMap((g) =>
          outgoing(g).map((call) => ({
            from: `group:${g.id}`,
            to: `group:${call.target}`,
          })),
        ),
      ];
      setPaths(
        connections.flatMap(({ from, to }) => {
          const a = groups.get(from),
            b = groups.get(to);
          if (!a || !b) return [];
          const x = (a.right - rect.left) / scale,
            y = (a.top + a.height / 2 - rect.top) / scale,
            xx = (b.left - rect.left) / scale,
            yy = (b.top + b.height / 2 - rect.top) / scale;
          const bend = Math.max(32, Math.abs(xx - x) / 2);
          return [
            `M${x},${y} C${x + bend},${y} ${xx - bend},${yy} ${xx},${yy}`,
          ];
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.querySelectorAll("[data-endpoint]").forEach((e) => observer.observe(e));
    return () => observer.disconnect();
  }, [layout]);
  function bars(g: Group, n: NodeView, all = false) {
    return (
      <div className="resource-bars">
        {resources(g).map((r) => {
          const v = aggregate(
            (s.resources || []).filter(
              (v) =>
                v.group === g.id &&
                v.resource === r.path &&
                !v.retired &&
                (v.index === 0 || all || v.index === n.index),
            ),
          );
          return (
            <button
              key={r.path}
              title={`${name(r.box)} · ${t("Utilization")}: ${fmt(v.utilization, 1)}% · ${t("Queue")}: ${v.queue} · ${t("Time inside this box")}: ${fmt(v.w, 1)} ms`}
              className={`resource-bar ${v.utilization > 80 ? "hot" : ""}`}
              aria-pressed={
                active &&
                selection.resource === r.path &&
                (selection.scope === "group"
                  ? s.nodes.find((v) => v.id === selection.node)?.group === g.id
                  : selection.node === n.id)
              }
              onClick={(e) => {
                e.stopPropagation();
                select({
                  node: n.id,
                  resource: r.path,
                  scope: all ? "group" : selection.scope,
                });
              }}
            >
              <span>
                {name(r.box)}
                {r.shared ? " ◇" : ""}
              </span>
              <span className="meter">
                <i style={{ width: `${Math.min(100, v.utilization)}%` }} />
              </span>
              <b>
                {fmt(v.utilization)}% · Q {v.queue}
              </b>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div id="topology" className="topology" ref={root}>
      <svg id="wires" aria-hidden="true">
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10Z" fill="#a9b8d3" />
          </marker>
        </defs>
        {paths.map((d, i) => (
          <path key={i} d={d} markerEnd="url(#arrow)" />
        ))}
      </svg>
      <div id="groups">
        <section
          className={`generator-node ${generatorSelected ? "selected" : ""}`}
          data-endpoint="generator"
        >
          <button
            id="generator-node"
            className="generator-select"
            onClick={openGenerator}
            aria-pressed={generatorSelected}
          >
            <span className="generator-symbol" aria-hidden="true">
              ↗
            </span>
            <span className="generator-title">{t("Generator")}</span>
            <span className="generator-value">
              {s.manualMode ? "1" : fmt(s.config.rps)}{" "}
              <small>{t(s.manualMode ? "request" : "req/s")}</small>
            </span>
            <span className="generator-mode">
              {t(s.manualMode ? "Single request" : "Continuous load")}
            </span>
          </button>
          {s.manualMode && (
            <button
              id="canvas-send-request"
              className="generator-send"
              disabled={s.focusRunning}
              type="submit"
              form="single-request"
            >
              {t("Send one request →")}
            </button>
          )}
        </section>
        {s.config.groups.map((g) => {
          const nodes = s.nodes.filter((n) => n.group === g.id && !n.retired),
            fold = collapsed[g.id] ?? nodes.length > 6;
          return (
            <section
              className={`group ${!fold && nodes.length >= 4 ? "group-wide" : ""}`}
              data-group={g.id}
              data-endpoint={`group:${g.id}`}
              key={g.id}
            >
              <div className="group-title">
                <button
                  className="group-heading"
                  disabled={!nodes.length}
                  onClick={() =>
                    nodes[0] &&
                    select({ node: nodes[0].id, resource: "", scope: "group" })
                  }
                >
                  {name(g)}
                </button>
                <span>
                  {g.id === s.config.entry ? `${t("Entry")} · ` : ""}×{g.count}
                </span>
                <button
                  className="group-toggle"
                  aria-label={t(fold ? "Show nodes" : "Collapse group")}
                  onClick={() => setCollapsed({ ...collapsed, [g.id]: !fold })}
                >
                  {fold ? "＋" : "−"}
                </button>
              </div>
              {fold && nodes[0] ? (
                <div
                  className={`group-summary ${active && selection.scope === "group" && nodes.some((n) => n.id === selection.node) ? "selected" : ""}`}
                  onClick={() =>
                    select({
                      node: nodes[0].id,
                      resource: "",
                      scope: "group",
                    })
                  }
                >
                  <button
                    className="group-select"
                    aria-pressed={
                      active &&
                      selection.scope === "group" &&
                      nodes.some((n) => n.id === selection.node)
                    }
                  >
                    {name(g)} ×{g.count}
                  </button>
                  <p>Q {aggregate(nodes).queue}</p>
                  {bars(g, nodes[0], true)}
                </div>
              ) : (
                <div className="group-instances">
                  {nodes.map((n) => (
                    <div
                      key={n.id}
                      data-node={n.id}
                      title={`${t("State")}: ${t(n.state)} · ${t("Queue")}: ${n.queue} · ${t("Oldest wait")}: ${fmt(n.oldest, 1)} ms · p95: ${fmt(n.p95, 1)} ms · ${t("User errors")}: ${fmt(n.errorRate, 1)}%`}
                      onClick={() =>
                        select({
                          node: n.id,
                          resource: "",
                          scope: selection.scope,
                        })
                      }
                      className={`box ${n.state !== "healthy" ? "unhealthy" : ""} ${n.draining ? "draining" : ""} ${active && (selection.scope === "group" ? s.nodes.find((v) => v.id === selection.node)?.group === n.group : selection.node === n.id) ? "selected" : ""} ${s.manualMode && trace?.manual && trace.spans.some((span) => span.node === n.id) ? "trace-path" : ""}`}
                    >
                      <button
                        className="node-select"
                        aria-pressed={
                          active &&
                          (selection.scope === "group"
                            ? s.nodes.find((v) => v.id === selection.node)
                                ?.group === n.group
                            : selection.node === n.id)
                        }
                      >
                        <div className="box-title">
                          <span>
                            {n.id}
                            {n.draining ? " · drain" : ""}
                          </span>
                          <i className="health" />
                        </div>
                      </button>
                      <div className="box-placement">
                        {Object.entries(n.labels || {})
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" · ")}
                      </div>
                      <div className="worker-grid">
                        {Array.from(
                          { length: Math.min(48, n.workers) },
                          (_, i) => {
                            const j = Math.floor(
                                (i * n.workers) / Math.min(48, n.workers),
                              ),
                              phase =
                                j < n.active
                                  ? n.phases[
                                      Math.min(j, n.phases.length - 1)
                                    ] || "local"
                                  : "";
                            return (
                              <i
                                key={i}
                                className={`worker-cell ${phase}`}
                                title={phase || t("idle")}
                              />
                            );
                          },
                        )}
                      </div>
                      <div className="box-stats">
                        <span>
                          {n.active}/{n.workers}
                        </span>
                        <span>
                          Q {n.queue} · {fmt(n.rps)}/s
                        </span>
                      </div>
                      <div
                        className="queue-track"
                        title={`${t("Queue")}: ${n.queue}`}
                      >
                        <span
                          style={{
                            width: `${Math.min(100, (n.queue / Math.max(1, g.queueLimit || n.workers)) * 100)}%`,
                          }}
                        />
                      </div>
                      {bars(g, n)}
                    </div>
                  ))}
                </div>
              )}
              <div className="group-foot">
                <details className="execution-plan">
                  <summary>{t("Execution plan")}</summary>
                  {[{ path: "", box: g }, ...resources(g)].map(
                    ({ path, box }) => (
                      <div key={path}>
                        <b>{name(box)}</b>
                        {box.stages.map((stage, i) => (
                          <p key={i}>
                            {i + 1}.{" "}
                            {stage.calls
                              .map(
                                (c) =>
                                  `→ ${c.target || c.resource} ×${c.calls} · ${t(c.route)} · ${t(c.transport)}`,
                              )
                              .join(" + ")}{" "}
                            · {t(stage.join)}
                            {stage.join === "quorum" ? ` ${stage.quorum}` : ""}
                          </p>
                        ))}
                        {!box.stages.length && <p>{t("return response ↩")}</p>}
                      </div>
                    ),
                  )}
                </details>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function DiagramNotes({ snapshot: s }: { snapshot: Snapshot }) {
  const bottleneck = [...s.nodes, ...(s.resources || [])]
    .filter((n) => !n.retired)
    .sort((a, b) => b.queue - a.queue || b.utilization - a.utilization)[0];
  return (
    <>
      <p className="model-name">{name(s.config)}</p>
      {I18n.description(s.config) && (
        <p id="model-description">{I18n.description(s.config)}</p>
      )}
      <div className="diagram-legend">
        <span>
          <i className="dot trace-local" />
          {t("Processing")}
        </span>
        <span>
          <i className="dot worker-children-key" />
          {t("Waiting for children")}
        </span>
        <span>
          <i className="dot red" />
          {t("hang")}
        </span>
        <span>
          <i className="dot idle-key" />
          {t("idle")}
        </span>
        <span>
          Q · {t("Queue")} · ◇ {t("Shared")}
        </span>
      </div>
      <div className="topology-insight" role="status">
        <strong>
          {t(bottleneck?.queue ? "Largest queue" : "Highest utilization")}
        </strong>
        {bottleneck && (
          <span>
            {" "}
            · {bottleneck.id} · Q {bottleneck.queue} ·{" "}
            {fmt(bottleneck.utilization, 1)}%
          </span>
        )}
        <p>
          {t(
            bottleneck?.queue
              ? "Accepted work is waiting here. Compare processing time, workers and child waits in the inspector."
              : "Watch queues and resource utilization as you change the load. Service workers remain occupied while waiting for children.",
          )}
        </p>
      </div>
      <p className="canvas-hint">
        {t(
          "Drag the background or scroll to pan. Use +/−, pinch, or Ctrl/Command + scroll to zoom. Fit diagram restores the view.",
        )}
      </p>
    </>
  );
}
