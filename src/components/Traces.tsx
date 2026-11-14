import { useEffect, useState } from "react";
import type { Snapshot, Span, Trace, TraceEvent } from "../model";
import { fmt, name, t } from "../locale";
import { Panel } from "./Fields";

const reasons: Record<string, string> = {
  ok: "success",
  pending: "In progress",
  request_timeout: "call timeout",
  client_deadline: "user deadline",
  connect_timeout: "connect timeout",
  connection_refused: "connection refused",
  connection_reset: "connection reset",
  queue_full: "queue full",
  cancelled: "cancelled",
  quorum_unreachable: "not enough matching calls for quorum",
  resource_unavailable: "internal box unavailable",
};
const phases = [
  ["network", "Network / connect"],
  ["queue", "Queue"],
  ["local", "Processing"],
  ["children", "Waiting for children"],
] as const;
const result = (reason: string) => t(reasons[reason] || reason);
const spanName = (span: Span) =>
  span.resource
    ? name({
        name: span.resourceName || span.resource,
        i18n: span.resourceI18n,
      })
    : span.node;

function eventDetail(event: TraceEvent) {
  const detail = event.reason ? [result(event.reason)] : [];
  const values: Record<string, [string, boolean]> = {
    "Call started": ["Budget", true],
    "Processing started": ["Duration", true],
    "Connection ready": ["One-way network", true],
    Queued: ["Queue depth", false],
    "Connection retry": ["Attempt", false],
    "Stage started": ["Stage", false],
    "Stage skipped": ["Stage", false],
  };
  const value = values[event.kind];
  if (value)
    detail.push(
      `${t(value[0])}: ${fmt(event.value ?? 0, 3)}${value[1] ? ` ${t("ms")}` : ""}`,
    );
  return detail.join(" · ");
}

function TraceDetail({ trace, now }: { trace: Trace; now: number }) {
  const [expanded, setExpanded] = useState(!!trace.manual);
  const byID = new Map(trace.spans.map((span) => [span.id, span]));
  const children = new Map<number, Span[]>();
  for (const span of trace.spans) {
    const siblings = children.get(span.parent) || [];
    siblings.push(span);
    children.set(span.parent, siblings);
  }
  const rows: { span: Span; depth: number }[] = [];
  function visit(parent: number, depth: number) {
    for (const span of children.get(parent) || []) {
      const visible = expanded || !span.resource;
      if (visible) rows.push({ span, depth });
      visit(span.id, depth + (visible ? 1 : 0));
    }
  }
  visit(0, 0);
  const pending = trace.end < 0;
  const response = pending ? now : trace.end;
  const end = Math.max(
    response,
    ...trace.spans.map((span) =>
      Math.max(span.end < 0 || span.reply < 0 ? now : span.end, span.reply),
    ),
  );
  const duration = Math.max(1, end - trace.start);
  const percent = (at: number) =>
    Math.max(0, Math.min(100, ((at - trace.start) / duration) * 100));
  const running = trace.spans.some((span) => span.end < 0 || span.reply < 0);
  const hasResources = trace.spans.some((span) => span.resource);
  return (
    <div id="trace-detail" className="trace-detail">
      <div className="trace-summary">
        <strong>#{trace.id}</strong>
        <span
          className={`result ${pending ? "pending" : trace.ok ? "" : "error"}`}
        >
          {pending ? t("In progress") : result(trace.reason)}
        </span>
        <span className="trace-duration">
          {fmt(response - trace.start, 1)} {t("ms")}
        </span>
        <span>
          {t("Request weight")} {fmt(trace.weight, 2)}×
        </span>
      </div>
      {!!Object.keys(trace.labels || {}).length && (
        <p className="trace-tags">
          {Object.entries(trace.labels!)
            .map(([key, value]) => `${key}=${value}`)
            .join(" · ")}
        </p>
      )}
      {!pending && running && (
        <p className="trace-running-note">
          {t("User response received; downstream work is still running.")}
        </p>
      )}
      <div className="trace-toolbar">
        <span>{t("Time since request, ms")}</span>
        {hasResources && (
          <button
            className="trace-expand"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>{" "}
            {t(expanded ? "Hide resources" : "Show resources")}
          </button>
        )}
      </div>
      <div className="trace-waterfall">
        <div className="trace-axis trace-row" aria-hidden="true">
          <span>{t("Call tree")}</span>
          <div className="trace-ticks">
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
              <span key={fraction} style={{ left: `${fraction * 100}%` }}>
                {fmt((end - trace.start) * fraction, 1)}
              </span>
            ))}
          </div>
          <span>{t("In box")}</span>
        </div>
        {rows.map(({ span, depth }) => {
          const finish = span.end < 0 ? now : span.end;
          const arrive = span.arrive < 0 ? finish : span.arrive;
          const work = span.workStart < 0 ? finish : span.workStart;
          const local = span.localEnd < 0 ? finish : span.localEnd;
          const reply = span.reply < 0 ? now : span.reply;
          const segments: [(typeof phases)[number][0], number, number][] = [
            ["network", span.start, arrive],
            ["queue", arrive, work],
            ["local", work, local],
            ["children", local, finish],
            ["network", finish, reply],
          ];
          const parent = byID.get(span.parent);
          const status = span.end < 0 ? t("In progress") : result(span.status);
          return (
            <div
              key={span.id}
              className={`trace-row ${span.resource ? "resource-row" : ""}`}
              data-span={span.id}
              data-parent={span.parent}
            >
              <div
                className="trace-label"
                style={{ paddingLeft: `${Math.min(depth, 8) * 10}px` }}
                title={`${span.node} · #${span.id} ← ${parent ? `#${parent.id} ${spanName(parent)}` : t("Client")} · ${status}`}
              >
                <span className="trace-node-name">
                  {depth > 0 && (
                    <span className="trace-branch" aria-hidden="true">
                      ↳{" "}
                    </span>
                  )}
                  {spanName(span)}
                  {(span.attempt || 0) > 1 ? ` ↻${span.attempt}` : ""}
                </span>
                <small
                  className={
                    span.end >= 0 && span.status !== "ok" ? "trace-error" : ""
                  }
                >
                  #{span.id} · {status}
                </small>
              </div>
              <div className="trace-track">
                {segments
                  .filter(([, a, b]) => b > a)
                  .map(([kind, a, b], index) => (
                    <span
                      key={index}
                      className={`trace-segment trace-${kind}`}
                      style={{
                        left: `${percent(a)}%`,
                        width: `${percent(b) - percent(a)}%`,
                      }}
                      title={`${t(phases.find(([value]) => value === kind)![1])}: ${fmt(b - a, 3)} ${t("ms")}`}
                    />
                  ))}
                {!pending && (
                  <span
                    className="trace-response-marker"
                    style={{ left: `${percent(trace.end)}%` }}
                    title={`${t("User response")}: ${fmt(trace.end - trace.start, 1)} ${t("ms")}`}
                  />
                )}
              </div>
              <span
                className="trace-box-time"
                title={t("Time inside the box, excluding network")}
              >
                {fmt(Math.max(0, finish - arrive), 1)} {t("ms")}
              </span>
            </div>
          );
        })}
      </div>
      <div className="trace-legend">
        {phases.map(([kind, label]) => (
          <span key={kind}>
            <i className={`dot trace-${kind}`} />
            {t(label)}
          </span>
        ))}
        {!pending && (
          <span>
            <i className="trace-response-key" />
            {t("User response")}
          </span>
        )}
      </div>
      <p className="trace-caption">
        {t(
          "All rows share one time axis. Right: time inside the box, excluding network. Parent wait includes children; row durations must not be added together.",
        )}
      </p>
      {!!trace.events?.length && (
        <>
          <div className="event-heading">
            <h3>{t("Detailed events")}</h3>
            <span>
              {t("Deadline, ms")}: {fmt(trace.deadline)}
            </span>
          </div>
          <p className="field-note">
            {t(
              "Times are relative to sending. Span IDs and parent IDs connect parallel calls, retries and resource visits.",
            )}
          </p>
          <div id="trace-events" className="trace-events">
            <table>
              <thead>
                <tr>
                  <th>{t("Time, ms")}</th>
                  <th>{t("Span / parent")}</th>
                  <th>{t("Event")}</th>
                </tr>
              </thead>
              <tbody>
                {trace.events.map((event, index) => {
                  const span = byID.get(event.span || 0);
                  const detail = eventDetail(event);
                  return (
                    <tr key={index}>
                      <td>+{fmt(event.at - trace.start, 3)}</td>
                      <td>
                        {span ? (
                          <>
                            #{span.id} · {spanName(span)}
                            <small>
                              {span.parent ? `← #${span.parent}` : t("Client")}
                            </small>
                          </>
                        ) : (
                          t("Client")
                        )}
                      </td>
                      <td>
                        {t(event.kind)}
                        {detail && <small>{detail}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <details className="trace-technical">
        <summary>{t("Connections and locality")}</summary>
        {trace.spans.map((span) => (
          <div key={span.id}>
            <b>
              #{span.id} {spanName(span)}
            </b>
            <p>
              {t(span.connection || "Ideal link")} · {t("One-way network")}:{" "}
              {fmt(span.networkDelay, 3)} {t("ms")}
              {span.workCost
                ? ` · ${t("Processing")}: ${fmt(span.workCost.base)} × ${fmt(span.workCost.weight, 2)} × ${fmt(span.workCost.factor, 2)}`
                : ""}
            </p>
            <pre>
              {JSON.stringify(
                {
                  labels: span.labels,
                  callerLabels: span.callerLabels,
                  routing: span.routingLocality,
                  network: span.networkLocality,
                  work: span.workCost,
                },
                null,
                2,
              )}
            </pre>
          </div>
        ))}
      </details>
    </div>
  );
}

export function Traces({
  snapshot: s,
  onTraceChange,
}: {
  snapshot: Snapshot;
  onTraceChange: (trace: Trace | null) => void;
}) {
  const [cache, setCache] = useState<Trace[]>(() =>
    s.focus ? [s.focus] : s.recent?.slice(0, 10) || [],
  );
  const [selected, setSelected] = useState<number | null>(s.focus?.id ?? null);
  useEffect(() => {
    setCache((previous) => {
      const updates = new Map(
        (s.recent || []).map((trace) => [trace.id, trace]),
      );
      if (s.focus) updates.set(s.focus.id, s.focus);
      const next = previous.map((trace) => updates.get(trace.id) || trace);
      if (s.focus && !next.some((trace) => trace.id === s.focus!.id))
        next.unshift(s.focus);
      if (!next.length) next.push(...(s.recent || []).slice(0, 10));
      return next.slice(0, 24);
    });
  }, [s.recent, s.focus]);
  const focusID = s.focus?.id;
  useEffect(() => {
    if (focusID !== undefined) setSelected(focusID);
  }, [focusID]);
  const trace = cache.find((trace) => trace.id === selected) || cache[0];
  useEffect(() => {
    onTraceChange(trace || null);
  }, [trace, onTraceChange]);
  return (
    <Panel
      title="End-to-end traces"
      className="traces-panel"
      action={
        <button
          id="refresh-traces"
          onClick={() => {
            setCache(
              s.focus
                ? [
                    s.focus,
                    ...(s.recent || [])
                      .filter((trace) => trace.id !== s.focus!.id)
                      .slice(0, 9),
                  ]
                : (s.recent || []).slice(0, 10),
            );
            setSelected(null);
          }}
        >
          {t("Refresh list ↻")}
        </button>
      }
    >
      <p className="trace-list-hint">
        {t("Select a request to inspect its path.")}
      </p>
      <div id="trace-list" className="trace-list">
        {cache.map((item) => (
          <button
            key={item.id}
            data-trace={item.id}
            className={`trace-chip ${item.end < 0 ? "pending" : item.ok ? "" : "error"} ${trace?.id === item.id ? "active" : ""}`}
            aria-pressed={trace?.id === item.id}
            title={item.end < 0 ? t("In progress") : result(item.reason)}
            onClick={() => setSelected(item.id)}
          >
            <i
              className={`dot ${item.end < 0 ? "blue" : item.ok ? "green" : "red"}`}
              aria-hidden="true"
            />
            #{item.id}
            <span>
              {fmt((item.end < 0 ? s.t : item.end) - item.start)} {t("ms")}
            </span>
          </button>
        ))}
      </div>
      {trace ? (
        <TraceDetail key={trace.id} trace={trace} now={s.t} />
      ) : (
        <p className="trace-empty">
          {t("Waiting for the first completed requests…")}
        </p>
      )}
    </Panel>
  );
}
