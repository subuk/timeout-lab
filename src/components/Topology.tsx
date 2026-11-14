import { useLayoutEffect, useRef, useState } from "react";
import type { Snapshot, Group, NodeView } from "../model";
import { aggregate, outgoing, resources } from "../model-utils";
import { fmt, name, t } from "../locale";
import { Panel } from "./Fields";
export interface Selection {
  node: string;
  resource: string;
  scope: "node" | "group";
}
export function Topology({
  snapshot: s,
  selection,
  select,
  edit,
}: {
  snapshot: Snapshot;
  selection: Selection;
  select: (s: Selection) => void;
  edit: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  // Measure only topology/layout changes; metrics do not rebuild SVG geometry.
  const layout = JSON.stringify([
    s.config.groups.map((g) => [g.id, g.count, name(g), outgoing(g)]),
    s.nodes.map((n) => [n.id, n.retired, n.draining]),
    collapsed,
  ]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const groups = new Map(
        Array.from(el.querySelectorAll<HTMLElement>("[data-group]")).map(
          (e) => [e.dataset.group, e.getBoundingClientRect()],
        ),
      );
      setPaths(
        s.config.groups.flatMap((g) =>
          outgoing(g).flatMap((call) => {
            const a = groups.get(g.id),
              b = groups.get(call.target);
            if (!a || !b) return [];
            const x = a.right - rect.left + el.scrollLeft,
              y = a.top + a.height / 2 - rect.top,
              xx = b.left - rect.left + el.scrollLeft,
              yy = b.top + b.height / 2 - rect.top;
            return [`M${x},${y} C${x + 25},${y} ${xx - 25},${yy} ${xx},${yy}`];
          }),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.querySelectorAll("[data-group]").forEach((e) => observer.observe(e));
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
              className={`resource-bar ${v.utilization > 80 ? "hot" : ""}`}
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
    <Panel
      title="System of boxes"
      action={
        <button id="edit-config" onClick={edit}>
          {"{ } " + t("Configuration")}
        </button>
      }
    >
      <div className="panel-head">
        <p>{name(s.config)}</p>
      </div>
      <div
        id="topology"
        className="topology"
        ref={root}
        style={{ overflowX: "auto" }}
      >
        <svg
          id="wires"
          style={{ width: Math.max(0, root.current?.scrollWidth || 0) }}
          aria-hidden="true"
        >
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
        <div
          id="groups"
          style={{
            minWidth:
              s.config.groups.length > 3
                ? s.config.groups.length * 180
                : undefined,
          }}
        >
          {s.config.groups.map((g) => {
            const nodes = s.nodes.filter((n) => n.group === g.id && !n.retired),
              fold = collapsed[g.id] ?? nodes.length > 6;
            return (
              <section
                className="group"
                data-group={g.id}
                key={g.id}
                style={{ width: `${100 / s.config.groups.length}%` }}
              >
                <div className="group-title">
                  {name(g)}
                  <span>
                    {g.id === s.config.entry ? "ENTRY · " : ""}×{g.count}
                  </span>
                  <button
                    className="group-toggle"
                    aria-label={t(fold ? "Show nodes" : "Collapse group")}
                    onClick={() =>
                      setCollapsed({ ...collapsed, [g.id]: !fold })
                    }
                  >
                    {fold ? "＋" : "−"}
                  </button>
                </div>
                {fold && nodes[0] ? (
                  <div className="group-summary">
                    <button
                      onClick={() =>
                        select({
                          node: nodes[0].id,
                          resource: "",
                          scope: "group",
                        })
                      }
                    >
                      {name(g)} ×{g.count}
                    </button>
                    <p>Q {aggregate(nodes).queue}</p>
                    {bars(g, nodes[0], true)}
                  </div>
                ) : (
                  nodes.map((n) => (
                    <div
                      key={n.id}
                      data-node={n.id}
                      className={`box ${n.state !== "healthy" ? "unhealthy" : ""} ${n.draining ? "draining" : ""} ${(selection.scope === "group" ? s.nodes.find((v) => v.id === selection.node)?.group === n.group : selection.node === n.id) ? "selected" : ""} ${s.manualMode && s.focus?.spans.some((span) => span.node === n.id) ? "trace-path" : ""}`}
                    >
                      <button
                        className="node-select"
                        onClick={() =>
                          select({
                            node: n.id,
                            resource: "",
                            scope: selection.scope,
                          })
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
                      {bars(g, n)}
                    </div>
                  ))
                )}
                <div className="group-foot">
                  {outgoing(g)
                    .filter((c) => c.target)
                    .map((c) => `→ ${c.target} ×${c.calls}`)
                    .join(" · ") || t("return response ↩")}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
