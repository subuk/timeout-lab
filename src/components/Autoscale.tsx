import type { AutoScalePolicy, Group, Snapshot } from "../model";
import { editConfig, run } from "../engine";
import { resources } from "../model-utils";
import { fmt, name, t } from "../locale";
import { NumberField, Panel, Select, Toggle } from "./Fields";
export function Autoscale({
  group: g,
  snapshot: s,
}: {
  group: Group;
  snapshot: Snapshot;
}) {
  const p = g.autoscale;
  if (!p) return null;
  const sensor = s.autoscalers?.find((a) => a.group === g.id),
    resource = resources(g).find((r) => r.path === p.resource);
  const set = <K extends keyof AutoScalePolicy>(
    key: K,
    value: AutoScalePolicy[K],
  ) =>
    run(
      editConfig((c) => {
        c.groups.find((v) => v.id === g.id)!.autoscale![key] = value;
      }),
    );
  return (
    <Panel title="Group autoscaling">
      <div id="auto-controls" className="control-body">
        <div className="selection-heading">
          <h3>{name(g)}</h3>
        </div>
        <Toggle
          id="auto-enabled"
          label="Enabled"
          value={p.enabled}
          onChange={(v) => set("enabled", v)}
        />
        <div className="auto-readings" role="status">
          <strong>{t(sensor?.message || "Disabled")}</strong>
          <p>
            {t("Current instances")}: {g.count} → {t("Target")}:{" "}
            {sensor?.target ?? g.count}
          </p>
          <p>
            {t("Queue per node")}: {fmt(sensor?.queue, 2)} · {t("Utilization")}:{" "}
            {fmt(sensor?.utilization, 1)}%
          </p>
          {!!sensor?.remaining && (
            <p>
              {t("Remaining")}: {fmt(sensor.remaining / 1000, 1)} {t("s")}
            </p>
          )}
        </div>
        <p className="field-note">
          {t("Sampled every 0.5 seconds of simulation time.")}
        </p>
        <Select
          label="Signal"
          value={p.signal || "queue"}
          options={[
            ["queue", "Queue"],
            ["utilization", "Utilization"],
            ["both", "Queue or utilization"],
          ]}
          onChange={(v) => set("signal", v)}
        />
        <Select
          label="Resource"
          translateOptions={false}
          value={p.resource || ""}
          options={[
            ["", t("Requests")],
            ...resources(g).map(
              (r) => [r.path, name(r.box)] as [string, string],
            ),
          ]}
          onChange={(v) => set("resource", v)}
        />
        <p className="field-note">
          {t(
            resource?.shared
              ? "This resource is shared: adding service instances does not increase its capacity."
              : "The selected resource supplies the signal; scaling changes the service group.",
          )}
        </p>
        <NumberField
          label="Minimum"
          value={p.min}
          min={1}
          max={p.max}
          step={1}
          onChange={(v) => set("min", v)}
        />
        <NumberField
          label="Maximum"
          value={p.max}
          min={p.min}
          max={16}
          step={1}
          onChange={(v) => set("max", v)}
        />
        <NumberField
          label="Utilization window, ms"
          value={p.window}
          max={60000}
          slider
          onChange={(v) => set("window", v)}
        />
        <h3>{t("↑ ADD A BOX")}</h3>
        <NumberField
          label="Queue per node >"
          value={p.upQueue}
          max={2000}
          disabled={p.signal === "utilization"}
          onChange={(v) => set("upQueue", v)}
        />
        <NumberField
          label="Scale up when utilization > %"
          value={p.upUtilization}
          max={100}
          slider
          disabled={!p.signal || p.signal === "queue"}
          onChange={(v) => set("upUtilization", v)}
        />
        <NumberField
          label="Scale-up hold, ms"
          value={p.upDelay}
          max={300000}
          onChange={(v) => set("upDelay", v)}
        />
        <h3>{t("↓ REMOVE A BOX")}</h3>
        <NumberField
          label="Worker utilization ≤ %"
          value={p.downUtilization}
          max={100}
          slider
          onChange={(v) => set("downUtilization", v)}
        />
        <NumberField
          label="Scale-down hold, ms"
          value={p.downDelay}
          max={300000}
          onChange={(v) => set("downDelay", v)}
        />
        <p className="field-note">
          {t(
            "Requires empty queues, healthy nodes and completion of the previous drain.",
          )}
        </p>
        <NumberField
          label="Cooldown, ms"
          value={p.cooldown}
          max={300000}
          onChange={(v) => set("cooldown", v)}
        />
        <p className="field-note">
          {t(
            "The condition must hold at every check. After cooldown, the hold timer starts over. All times follow simulation time, including slow motion and pause.",
          )}
        </p>
        {s.scaleEvents
          ?.filter((e) => e.group === g.id)
          .slice(0, 4)
          .map((e, i) => (
            <p className="field-note" key={i}>
              {fmt(e.t / 1000, 1)} s · {e.from} → {e.to} · {t(e.reason)}
            </p>
          ))}
      </div>
    </Panel>
  );
}

export function AutoscaleCard({
  group: g,
  snapshot: s,
  selected,
  open,
}: {
  group: Group;
  snapshot: Snapshot;
  selected: boolean;
  open: () => void;
}) {
  const p = g.autoscale;
  if (!p) return null;
  const sensor = s.autoscalers?.find((a) => a.group === g.id);
  return (
    <button
      className={`autoscale-card ${p.enabled ? "enabled" : ""}`}
      aria-label={`${t("Group autoscaling")} · ${name(g)}`}
      aria-pressed={selected}
      aria-haspopup="dialog"
      aria-controls="settings-window"
      onClick={open}
    >
      {p.enabled ? (
        <span className="autoscale-card-metrics">
          <strong className="autoscale-card-name" title={name(g)}>
            {name(g)}
          </strong>
          <span title={`${t("Current instances")} → ${t("Target")}`}>
            {g.count} → {sensor?.target ?? g.count}
          </span>
          <span title={t("Queue per node")}>Q {fmt(sensor?.queue, 2)}</span>
          <span title={t("Utilization")}>{fmt(sensor?.utilization, 1)}%</span>
          <span
            className="autoscale-card-timer"
            title={`${t("Remaining")} · ${t(sensor?.message || "Waiting to check conditions")}`}
          >
            {sensor &&
            ["holding_up", "holding_down", "cooldown"].includes(sensor.mode)
              ? `${sensor.mode === "cooldown" ? "↻ " : ""}${fmt(sensor.remaining / 1000, 1)} ${t("s")}`
              : "—"}
          </span>
        </span>
      ) : (
        <span className="autoscale-card-heading">
          <strong>{t("Autoscaling")}</strong>
          <span>{t("Disabled")}</span>
        </span>
      )}
    </button>
  );
}
