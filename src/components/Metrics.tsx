import { useEffect, useRef } from "react";
import type { Snapshot } from "../model";
import { fmt, t } from "../locale";
import { Panel } from "./Fields";
export function Metrics({ snapshot: s }: { snapshot: Snapshot }) {
  return (
    <section className="metrics">
      {[
        ["Successful responses", fmt(s.metrics.goodput, 1), "req/s"],
        ["Latency · p95", s.metrics.goodput ? fmt(s.metrics.p95) : "—", "ms"],
        ["User errors", fmt(s.metrics.errorRate, 1), "%"],
        ["Inside the system", fmt(s.metrics.pending), "requests"],
      ].map(([label, value, unit], i) => (
        <article key={label}>
          <span>{t(label)}</span>
          <div>
            <strong id={["goodput", "p95", "error-rate", "pending"][i]}>
              {value}
            </strong>
            <small>{t(unit)}</small>
          </div>
          <Sparkline
            values={(s.history || []).map(
              (p) =>
                p[(["goodput", "p95", "errorRate", "pending"] as const)[i]],
            )}
            color={["#15957e", "#4464e8", "#d26462", "#d99b35"][i]}
            label={label}
          />
          <div className="metric-foot">
            {i === 0
              ? s.manualMode
                ? t("Single request · background arrivals stopped")
                : `${fmt(s.config.rps)} ${t("incoming /s")}`
              : i === 1
                ? t("Successful requests only")
                : i === 2
                  ? t("All outcomes · last 10 s")
                  : `Q ${s.metrics.queue} · ${s.metrics.ghosts} ${t("after response")}`}
          </div>
        </article>
      ))}
    </section>
  );
}
function Sparkline({
  values,
  color,
  label,
}: {
  values: number[];
  color: string;
  label: string;
}) {
  const max = Math.max(1, ...values),
    span = Math.max(1, values.length - 1);
  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 34"
      role="img"
      aria-label={t(label) + " · " + t("Recent history")}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        points={values
          .map((v, i) => `${(i * 100) / span},${32 - (v / max) * 30}`)
          .join(" ")}
      />
    </svg>
  );
}
export function Activity({ snapshot: s }: { snapshot: Snapshot }) {
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
      for (let i = 0; i <= 4; i++) {
        const y = h - 25 - (i / 4) * (h - 40),
          x = 35 + (i / 4) * (w - 45);
        ctx.strokeStyle = "#e8ecf3";
        ctx.beginPath();
        ctx.moveTo(35, y);
        ctx.lineTo(w - 10, y);
        ctx.stroke();
        ctx.fillStyle = "#687385";
        ctx.textAlign = "right";
        ctx.fillText(fmt((max * i) / 4), 30, y + 3);
        ctx.textAlign = i === 4 ? "right" : i === 0 ? "left" : "center";
        ctx.fillText(`${fmt((start + (span * i) / 4) / 1000, 1)} s`, x, h - 5);
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
