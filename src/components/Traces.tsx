import { useEffect, useState } from "react";
import type { Snapshot, Trace } from "../model";
import { fmt, name, t } from "../locale";
import { Panel } from "./Fields";
export function Traces({ snapshot: s }: { snapshot: Snapshot }) {
  const [cache, setCache] = useState<Trace[]>(() =>
    s.focus ? [s.focus] : s.recent?.slice(0, 10) || [],
  );
  const [selected, setSelected] = useState<number | null>(s.focus?.id ?? null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setCache((previous) => {
      const updates = new Map((s.recent || []).map((v) => [v.id, v]));
      if (s.focus) updates.set(s.focus.id, s.focus);
      const next = previous.map((v) => updates.get(v.id) || v);
      if (s.focus && !next.some((v) => v.id === s.focus!.id))
        next.unshift(s.focus);
      if (!next.length) next.push(...(s.recent || []).slice(0, 10));
      return next.slice(0, 24);
    });
  }, [s.recent, s.focus]);
  const focusID = s.focus?.id;
  useEffect(() => {
    if (focusID !== undefined) setSelected(focusID);
  }, [focusID]);
  const trace = cache.find((v) => v.id === selected) || cache[0];
  const end = trace
    ? Math.max(
        trace.end < 0 ? s.t : trace.end,
        ...trace.spans.map((v) => Math.max(v.end < 0 ? s.t : v.end, v.reply)),
      )
    : 0;
  const duration = trace ? Math.max(1, end - trace.start) : 1;
  return (
    <Panel
      title="End-to-end traces"
      action={
        <button
          id="refresh-traces"
          onClick={() => {
            setCache(
              s.focus
                ? [
                    s.focus,
                    ...(s.recent || [])
                      .filter((v) => v.id !== s.focus!.id)
                      .slice(0, 9),
                  ]
                : (s.recent || []).slice(0, 10),
            );
            setSelected(null);
          }}
        >
          {t("Refresh")}
        </button>
      }
    >
      <div className="trace-body">
        <div id="trace-list" className="trace-list">
          {cache.map((v) => (
            <button
              key={v.id}
              className={`trace-chip ${v.ok ? "" : "error"}`}
              aria-pressed={trace?.id === v.id}
              onClick={() => setSelected(v.id)}
            >
              #{v.id} · {fmt((v.end < 0 ? s.t : v.end) - v.start)} ms
            </button>
          ))}
        </div>
        {trace ? (
          <div id="trace-detail">
            <p>
              #{trace.id} · {t(trace.reason || "Request in progress.")} ·{" "}
              {fmt((trace.end < 0 ? s.t : trace.end) - trace.start, 1)} ms
            </p>
            <button
              className="trace-expand"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {t("Show resources")}
            </button>
            {trace.spans
              .filter((v) => trace.manual || expanded || !v.resource)
              .slice(0, 512)
              .map((v) => {
                const finish = v.end < 0 ? s.t : v.end,
                  arrive = v.arrive < 0 ? finish : v.arrive,
                  work = v.workStart < 0 ? finish : v.workStart,
                  local = v.localEnd < 0 ? finish : v.localEnd;
                const segments: [string, number, number][] = [
                  ["network", v.start, arrive],
                  ["queue", arrive, work],
                  ["local", work, local],
                  ["children", local, finish],
                  ["network", finish, v.reply],
                ];
                return (
                  <div
                    key={v.id}
                    className="trace-row"
                    title={`#${v.id} ← #${v.parent} · ${v.status}`}
                  >
                    <span>
                      #{v.id}{" "}
                      {v.resource
                        ? name({
                            name: v.resourceName || v.resource,
                            i18n: v.resourceI18n,
                          })
                        : v.node}
                    </span>
                    <div className="trace-track">
                      {segments
                        .filter(([, a, b]) => b > a)
                        .map(([kind, a, b], i) => (
                          <span
                            key={i}
                            className={`trace-segment trace-${kind}`}
                            style={{
                              left: `${Math.max(0, ((a - trace.start) / duration) * 100)}%`,
                              width: `${Math.max(0, Math.min(100, ((b - a) / duration) * 100))}%`,
                            }}
                            title={`${t(kind)}: ${fmt(b - a, 3)} ms`}
                          />
                        ))}
                    </div>
                    <small>{fmt(finish - v.start, 1)} ms</small>
                  </div>
                );
              })}
            {trace.events?.length ? (
              <div id="trace-events" className="trace-events">
                <h3>{t("Detailed events")}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>{t("Time, ms")}</th>
                      <th>{t("Span / parent")}</th>
                      <th>{t("Event")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.events.map((e, i) => (
                      <tr key={i}>
                        <td>+{fmt(e.at - trace.start, 3)}</td>
                        <td>
                          {e.span
                            ? `#${e.span} \u2190 #${trace.spans.find((v) => v.id === e.span)?.parent ?? 0}`
                            : t("Client")}
                        </td>
                        <td>
                          {t(e.kind)} {e.reason ? ` · ${t(e.reason)}` : ""}{" "}
                          {e.value !== undefined ? ` · ${fmt(e.value, 3)}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <details>
              <summary>
                {t("Connection: ")} / {t("Locality")}
              </summary>
              {trace.spans.map((v) => (
                <div key={v.id}>
                  <b>
                    #{v.id}{" "}
                    {v.resource
                      ? name({
                          name: v.resourceName || v.resource,
                          i18n: v.resourceI18n,
                        })
                      : v.node}
                  </b>
                  <p>
                    {t(v.connection || "ideal")} · {fmt(v.networkDelay, 3)} ms ·{" "}
                    {v.workCost
                      ? `${fmt(v.workCost.base)} × ${fmt(v.workCost.weight, 2)} × ${fmt(v.workCost.factor, 2)}`
                      : ""}
                  </p>
                  <pre>
                    {JSON.stringify(
                      {
                        labels: v.labels,
                        callerLabels: v.callerLabels,
                        routing: v.routingLocality,
                        network: v.networkLocality,
                        work: v.workCost,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              ))}
            </details>
          </div>
        ) : (
          <p>{t("Waiting for the first completed requests…")}</p>
        )}
      </div>
    </Panel>
  );
}
