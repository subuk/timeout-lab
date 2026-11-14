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
            <small>{unit}</small>
          </div>
          <div className="metric-foot">
            {i === 0
              ? `${fmt(s.config.rps)} ${t("incoming /s")}`
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
      const points = s.history || [];
      if (points.length < 2) return;
      const max = Math.max(10, ...points.flatMap((p) => [p.queue, p.busy])),
        start = Math.max(0, s.t - 60000),
        span = Math.max(1000, s.t - start);
      for (const [key, color] of [
        ["busy", "#4464e8"],
        ["queue", "#d99b35"],
      ] as const) {
        ctx.beginPath();
        points.forEach((p, i) => {
          const x = 30 + ((p.t - start) / span) * (w - 40),
            y = h - 25 - (p[key] / max) * (h - 40);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = "#687385";
      ctx.font = "11px monospace";
      ctx.fillText(String(max), 0, 15);
      ctx.fillText(`${fmt(s.t / 1000, 1)} s`, w - 75, h - 4);
    }
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(c);
    return () => observer.disconnect();
  }, [s.history, s.t]);
  return (
    <Panel title="System activity">
      <div className="legend-inline">
        {t("Workers")} · {t("Queue")} · 60 s
      </div>
      <div className="chart-wrap">
        <canvas id="load-chart" ref={ref} />
      </div>
    </Panel>
  );
}
