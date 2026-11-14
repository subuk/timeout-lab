import { aggregate } from "../model-utils";
import { fmt, t } from "../locale";
import { Panel } from "./Fields";
export function Residence({
  stats: s,
}: {
  stats: ReturnType<typeof aggregate>;
}) {
  const portions = [
    ["queue", "Queue", s.wQueue],
    ["local", "Local processing", s.wLocal],
    ["children", "Waiting for children", s.wChildren],
  ] as const;
  const total = portions.reduce((a, p) => a + p[2], 0);
  return (
    <Panel title="Little’s law">
      <div className="control-body residence">
        <div className="little-equation">
          <strong>
            L <b>{fmt(s.l, 2)}</b>
          </strong>
          <span>=</span>
          <strong>
            λW <b>{fmt(s.little, 2)}</b>
          </strong>
          <span>+</span>
          <strong>
            {t("unfinished")}
            <b>{fmt(s.unfinished, 2)}</b>
          </strong>
        </div>
        <div
          className="little-track"
          aria-label={t("Completed and unfinished occupancy")}
        >
          <span style={{ width: `${s.l ? (100 * s.little) / s.l : 0}%` }} />
          <i style={{ width: `${s.l ? (100 * s.unfinished) / s.l : 0}%` }} />
        </div>
        <p className="field-note">
          λ = {fmt(s.lambda, 1)} /s · W = {fmt(s.meanW / 1000, 3)} s
        </p>
        <p className="field-note">
          {t(
            "Finite interval: unfinished visits also contribute to average occupancy.",
          )}
        </p>
        <h3>{t("Time inside this box")}</h3>
        <div
          className="residence-track"
          aria-label={t("Residence time breakdown")}
        >
          {portions.map(([key, label, value]) => (
            <span
              key={key}
              className={`trace-${key}`}
              style={{ width: `${total ? (100 * value) / total : 0}%` }}
              title={`${t(label)}: ${fmt(value, 1)} ms`}
            />
          ))}
        </div>
        <div className="residence-legend">
          {portions.map(([key, label, value]) => (
            <p key={key}>
              <span>
                <i className={`dot trace-${key}`} />
                {t(label)}
              </span>
              <b>{fmt(value, 1)} ms</b>
            </p>
          ))}
        </div>
        <p className="field-note">
          {t("Utilization")}: {fmt(s.utilization, 1)}% · Q {s.queue}
        </p>
      </div>
    </Panel>
  );
}
