import { useEffect, useRef, useState } from "react";
import type { Point, Snapshot } from "../model";
import { fmt, t } from "../locale";
import { Panel } from "./Fields";

const metrics = [
  {
    key: "goodput",
    label: "Successful responses",
    unit: "req/s",
    color: "#15957e",
    digits: 1,
  },
  {
    key: "p95",
    label: "Latency · p95",
    unit: "ms",
    color: "#4464e8",
    digits: 0,
  },
  {
    key: "errorRate",
    label: "User errors",
    unit: "%",
    color: "#d26462",
    digits: 1,
  },
  {
    key: "pending",
    label: "Inside the system",
    unit: "requests",
    color: "#b27b20",
    digits: 0,
  },
] as const;
type Metric = (typeof metrics)[number];
const left = 43,
  right = 230,
  top = 8,
  bottom = 91;

function metricValue(
  point: Pick<Point, "goodput" | "p95" | "errorRate" | "pending">,
  metric: Metric,
) {
  return metric.key === "p95" && !point.goodput ? null : point[metric.key];
}

export function Metrics({ snapshot: s }: { snapshot: Snapshot }) {
  const [cursor, setCursor] = useState<number | null>(null);
  const start = Math.max(0, s.t - 60000);
  const points = (s.history || []).filter(
    (point) => point.t >= start && point.t <= s.t,
  );
  // Resolve the cursor from the current history so resets and a moving window cannot show stale values.
  const selected =
    cursor === null || cursor < start || cursor > s.t
      ? undefined
      : points.reduce<Point | undefined>(
          (best, point) =>
            !best || Math.abs(point.t - cursor) < Math.abs(best.t - cursor)
              ? point
              : best,
          undefined,
        );
  const displayed = selected || s.metrics;
  const span = Math.max(1000, s.t - start);
  const time = (value: number) => `${fmt(value / 1000, 1)} ${t("s")}`;
  return (
    <div className="metric-history">
      <div className="metrics-timeline">
        <span>
          {t("Simulation time")} · {t("Last 60 s")}
        </span>
        <span className="metrics-reading" aria-live="off">
          {selected ? time(selected.t) : t("Now")}
        </span>
      </div>
      <section className="metrics" aria-label={t("System metrics")}>
        {metrics.map((metric, i) => {
          const value = metricValue(displayed, metric);
          return (
            <article key={metric.key}>
              <span>{t(metric.label)}</span>
              <div className="metric-value">
                <strong id={["goodput", "p95", "error-rate", "pending"][i]}>
                  {value === null ? "—" : fmt(value, metric.digits)}
                </strong>
                <small>{t(metric.unit)}</small>
              </div>
              <MetricChart
                points={points}
                metric={metric}
                start={start}
                span={span}
                selected={selected}
                onCursor={setCursor}
              />
              <div className="metric-foot">
                {i === 0
                  ? s.manualMode
                    ? t("Single request · background arrivals stopped")
                    : t("Successful responses · last 10 s")
                  : i === 1
                    ? t("Successful requests only · last 10 s")
                    : i === 2
                      ? t("All outcomes · last 10 s")
                      : selected
                        ? `Q ${fmt(selected.queue)}`
                        : `Q ${fmt(s.metrics.queue)} · ${fmt(s.metrics.ghosts)} ${t("after response")}`}
              </div>
            </article>
          );
        })}
        <article className="activity-metric">
          <Activity snapshot={s} />
        </article>
      </section>
      <div className="metrics-hint">
        <span className="metrics-pointer-hint">
          {t("Hover or use arrow keys to inspect")}
        </span>
        <span className="metrics-swipe-hint">
          {t("Swipe to see all charts")}
        </span>
      </div>
    </div>
  );
}

function MetricChart({
  points,
  metric,
  start,
  span,
  selected,
  onCursor,
}: {
  points: Point[];
  metric: Metric;
  start: number;
  span: number;
  selected?: Point;
  onCursor: (time: number | null) => void;
}) {
  const values = points.map((point) => metricValue(point, metric));
  const peak = Math.max(1, ...values.map((value) => value ?? 0));
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const max =
    metric.key === "errorRate" ? 100 : Math.ceil(peak / magnitude) * magnitude;
  const x = (time: number) => left + ((time - start) / span) * (right - left);
  const y = (value: number) => bottom - (value / max) * (bottom - top);
  let previous = false;
  const path = points
    .map((point, i) => {
      const value = values[i];
      if (value === null) {
        previous = false;
        return "";
      }
      const segment = `${previous ? "L" : "M"}${x(point.t)},${y(value)}`;
      previous = true;
      return segment;
    })
    .join(" ");
  const selectedValue = selected ? metricValue(selected, metric) : null;
  const last = points.at(-1);
  const lastValue = last ? metricValue(last, metric) : null;
  const ticks = [0, max / 2, max].filter(
    (value) => metric.key !== "pending" || Number.isInteger(value),
  );
  const axisValue = (value: number) =>
    value >= 10000 ? `${fmt(value / 1000, 1)}k` : fmt(value, 1);
  return (
    <svg
      className="metric-chart"
      viewBox="0 0 240 114"
      role="img"
      tabIndex={0}
      aria-label={`${t(metric.label)} · ${t("Recent history")} · ${t(metric.unit)}`}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const position = ((event.clientX - rect.left) / rect.width) * 240;
        onCursor(
          start +
            Math.max(0, Math.min(1, (position - left) / (right - left))) * span,
        );
      }}
      onPointerLeave={() => onCursor(null)}
      onBlur={() => onCursor(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCursor(null);
          return;
        }
        if (
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
          !points.length
        )
          return;
        event.preventDefault();
        const index = selected ? points.indexOf(selected) : points.length - 1;
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? points.length - 1
              : Math.max(
                  0,
                  Math.min(
                    points.length - 1,
                    index + (event.key === "ArrowLeft" ? -1 : 1),
                  ),
                );
        onCursor(points[next].t);
      }}
    >
      <title>
        {t(metric.label)} · {t("Simulation time")} · {t("Last 60 s")}
      </title>
      {ticks.map((value) => (
        <g key={value} className="metric-chart-axis">
          <line x1={left} x2={right} y1={y(value)} y2={y(value)} />
          <text x={left - 7} y={y(value) + 3} textAnchor="end">
            {axisValue(value)}
          </text>
        </g>
      ))}
      {[0, 0.5, 1].map((fraction) => (
        <text
          key={fraction}
          className="metric-chart-time"
          x={left + fraction * (right - left)}
          y={109}
          textAnchor={
            fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"
          }
        >
          {fmt((start + fraction * span) / 1000, 1)} {t("s")}
        </text>
      ))}
      <path className="metric-chart-line" d={path} stroke={metric.color} />
      {last && lastValue !== null && (
        <circle cx={x(last.t)} cy={y(lastValue)} r={2.5} fill={metric.color} />
      )}
      {selected && (
        <g className="metric-chart-cursor">
          <line x1={x(selected.t)} x2={x(selected.t)} y1={top} y2={bottom} />
          {selectedValue !== null && (
            <circle
              cx={x(selected.t)}
              cy={y(selectedValue)}
              r={3.5}
              fill={metric.color}
            />
          )}
        </g>
      )}
    </svg>
  );
}

function Activity({ snapshot: s }: { snapshot: Snapshot }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    function draw() {
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const rect = c.getBoundingClientRect(),
        d = devicePixelRatio || 1,
        w = rect.width,
        h = rect.height;
      c.width = w * d;
      c.height = h * d;
      ctx.scale(d, d);
      const points = (s.history || []).filter(
        (p) => p.t >= Math.max(0, s.t - 60000),
      );
      const max = Math.max(10, ...points.flatMap((p) => [p.queue, p.busy])),
        start = Math.max(0, s.t - 60000),
        span = Math.max(1000, s.t - start);
      ctx.font = "10px monospace";
      for (let i = 0; i <= 2; i++) {
        const y = h - 25 - (i / 2) * (h - 40),
          x = 35 + (i / 2) * (w - 45);
        ctx.strokeStyle = "#e8ecf3";
        ctx.beginPath();
        ctx.moveTo(35, y);
        ctx.lineTo(w - 10, y);
        ctx.stroke();
        ctx.fillStyle = "#687385";
        ctx.textAlign = "right";
        ctx.fillText(fmt((max * i) / 2), 30, y + 3);
        ctx.textAlign = i === 2 ? "right" : i === 0 ? "left" : "center";
        ctx.fillText(
          `${fmt((start + (span * i) / 2) / 1000, 1)} ${t("s")}`,
          x,
          h - 5,
        );
      }
      for (const [key, color] of [
        ["busy", "#4464e8"],
        ["queue", "#d99b35"],
      ] as const) {
        ctx.beginPath();
        points.forEach((p, i) => {
          const x = 35 + ((p.t - start) / span) * (w - 45),
            y = h - 25 - (p[key] / max) * (h - 40);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(c);
    return () => observer.disconnect();
  }, [s.history, s.t]);
  return (
    <Panel title="System activity">
      <div className="legend-inline">
        <span>
          <i className="dot trace-local" />
          {t("Busy workers")}
        </span>
        <span>
          <i className="dot trace-queue" />
          {t("Queue")}
        </span>
        <span>{t("Simulation time")} · 60 s</span>
      </div>
      <div className="chart-wrap">
        <canvas
          id="load-chart"
          ref={ref}
          role="img"
          aria-label={t("Busy workers and queue over simulation time")}
        />
      </div>
    </Panel>
  );
}
