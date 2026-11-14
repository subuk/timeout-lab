import type { Snapshot, NodeConfig, DownstreamSettings, Group } from "../model";
import { definition, resources, aggregate } from "../model-utils";
import { editConfig, command, run } from "../engine";
import { name, fmt, t } from "../locale";
import { NumberField, Panel, Select, Toggle } from "./Fields";
import type { Selection } from "./Topology";
const downstreamKeys = [
  "keepalive",
  "keepaliveTimeout",
  "connectTimeout",
  "timeout",
  "retryConnect",
] as const;
export function Inspector({
  snapshot: s,
  selection,
  select,
  edit,
}: {
  snapshot: Snapshot;
  selection: Selection;
  select: (v: Selection) => void;
  edit: (group?: string) => void;
}) {
  const n =
    s.nodes.find((n) => n.id === selection.node && !n.retired) ||
    s.nodes.find((n) => !n.retired);
  if (!n) return null;
  const g = s.config.groups.find((g) => g.id === n.group)!;
  const resource = resources(g).find((r) => r.path === selection.resource);
  const path = resource?.path || "",
    box = resource?.box || g,
    all = selection.scope === "group" || !!resource?.shared;
  const views = resource
    ? (s.resources || []).filter(
        (v) =>
          v.group === g.id &&
          v.resource === path &&
          (v.index === 0 || all || v.index === n.index),
      )
    : s.nodes.filter((v) => v.group === g.id && (all || v.id === n.id));
  const live = views.filter((v) => !v.retired),
    one = live[0],
    stats = aggregate(views);
  const effective = path
    .split("/")
    .filter(Boolean)
    .reduce(
      (out, id) => ({ ...out, ...out.resources!.find((r) => r.id === id)! }),
      g,
    );
  const settings = all ? effective : one?.downstream || effective;
  function set<K extends keyof NodeConfig>(field: K, value: NodeConfig[K]) {
    run(
      editConfig((c) => {
        if (all) {
          const target = definition(
            c.groups.find((v) => v.id === g.id)!,
            path,
          );
          Object.assign(target, { [field]: value });
          for (const v of live)
            if (c.overrides?.[v.id]) delete c.overrides[v.id][field];
        } else if (one) {
          c.overrides ??= {};
          c.overrides[one.id] ??= {};
          c.overrides[one.id][field] = value;
        }
      }),
    );
  }
  return (
    <div className="right-column">
      <Panel title={name(box)} translateTitle={false}>
        <div className="control-body">
          <p id="selected-id">{all ? g.id : one?.id}</p>
          <div id="scope" className="tabs">
            {(["node", "group"] as const).map((scope) => (
              <button
                key={scope}
                data-scope={scope}
                className={selection.scope === scope ? "active" : ""}
                onClick={() => select({ ...selection, scope })}
              >
                {t(scope === "group" ? "Whole group" : "One node")}
              </button>
            ))}
          </div>
          <div id="resource-tabs" className="resource-tabs">
            <button onClick={() => select({ ...selection, resource: "" })}>
              {t("Requests")}
            </button>
            {resources(g).map((r) => (
              <button
                key={r.path}
                className={path === r.path ? "active" : ""}
                onClick={() => select({ ...selection, resource: r.path })}
              >
                {name(r.box)}
              </button>
            ))}
          </div>
          <NumberField
            id="service"
            label="Processing, ms"
            value={all ? box.service : (one?.service ?? box.service)}
            max={10000}
            onChange={(v) => set("service", v)}
          />
          <NumberField
            id="workers"
            label="Workers"
            value={all ? box.workers : (one?.workers ?? box.workers)}
            min={1}
            max={512}
            step={1}
            onChange={(v) => set("workers", v)}
          />
          <NumberField
            id="node-count"
            label="Instances"
            value={g.count}
            min={1}
            max={16}
            step={1}
            onChange={(v) =>
              run(
                editConfig((c) => {
                  c.groups.find((v) => v.id === g.id)!.count = v;
                }),
              )
            }
          />
          <Select
            id="fault"
            label="State"
            value={one?.state || "healthy"}
            options={["healthy", "down", "hang", "blackhole"]}
            onChange={(state) =>
              live.forEach((n) =>
                run(command({ type: "node", id: n.id, state })),
              )
            }
          />
          <details className="advanced">
            <summary>{t("Connections and timeouts")}</summary>
            <p className="field-note">
              {t(
                all
                  ? "Connections and timeouts for every instance. Editing a field replaces its individual overrides."
                  : "Outgoing connections of this box. Settings inherit from its group by default.",
              )}
            </p>
            <Toggle
              id="keepalive"
              label="Keep-alive"
              value={settings.keepalive ?? true}
              onChange={(v) => set("keepalive", v)}
            />
            <Toggle
              id="retry-connect"
              label="Retry connection failures"
              value={settings.retryConnect ?? true}
              onChange={(v) => set("retryConnect", v)}
            />
            <NumberField
              id="keepalive-timeout"
              label="Idle timeout, s"
              value={(settings.keepaliveTimeout ?? 30000) / 1000}
              max={3600}
              onChange={(v) => set("keepaliveTimeout", v * 1000)}
            />
            <NumberField
              id="connect"
              label="Connect timeout, ms"
              value={settings.connectTimeout ?? 200}
              min={1}
              max={60000}
              onChange={(v) => set("connectTimeout", v)}
            />
            <NumberField
              id="timeout"
              label="Call timeout, ms"
              value={settings.timeout ?? 500}
              min={1}
              max={60000}
              onChange={(v) => set("timeout", v)}
            />
            {!all && one && (
              <button
                id="inherit-downstream"
                onClick={() =>
                  run(
                    editConfig((c) => {
                      for (const key of downstreamKeys)
                        if (c.overrides?.[one.id])
                          delete c.overrides[one.id][key];
                    }),
                  )
                }
              >
                {t("Inherit")}
              </button>
            )}
          </details>
          <details>
            <summary>{t("Locality")}</summary>
            <p>
              {Object.entries(one?.labels || {})
                .map(([k, v]) => `${k}=${v}`)
                .join(" · ")}
            </p>
            <button onClick={() => edit()}>
              {t("Own labels · key=value")} / {t("Processing time of this box")}
            </button>
          </details>
          <button id="edit-resources" onClick={() => edit(g.id)}>
            {t("Boxes and request paths")}
          </button>
          {g.autoscale && (
            <details id="auto-controls">
              <summary>{t("Autoscaling")}</summary>
              <Toggle
                id="auto-enabled"
                label="Enabled"
                value={g.autoscale.enabled}
                onChange={(v) =>
                  run(
                    editConfig((c) => {
                      c.groups.find((v) => v.id === g.id)!.autoscale!.enabled =
                        v;
                    }),
                  )
                }
              />
              <Select
                label="Signal"
                value={g.autoscale.signal || "queue"}
                options={["queue", "utilization", "both"]}
                onChange={(v) =>
                  run(
                    editConfig((c) => {
                      c.groups.find((v) => v.id === g.id)!.autoscale!.signal =
                        v;
                    }),
                  )
                }
              />
              <Select
                label="Resource"
                value={g.autoscale.resource || ""}
                options={[
                  ["", t("Requests")],
                  ...resources(g).map(
                    (r) => [r.path, name(r.box)] as [string, string],
                  ),
                ]}
                onChange={(v) =>
                  run(
                    editConfig((c) => {
                      c.groups.find((v) => v.id === g.id)!.autoscale!.resource =
                        v;
                    }),
                  )
                }
              />
              {(
                [
                  "min",
                  "max",
                  "upQueue",
                  "upUtilization",
                  "downUtilization",
                  "window",
                  "upDelay",
                  "downDelay",
                  "cooldown",
                ] as const
              ).map((key) => (
                <NumberField
                  key={key}
                  label={
                    key +
                    (["window", "upDelay", "downDelay", "cooldown"].includes(
                      key,
                    )
                      ? " (ms)"
                      : "")
                  }
                  value={g.autoscale![key]}
                  onChange={(v) =>
                    run(
                      editConfig((c) => {
                        c.groups.find((v) => v.id === g.id)!.autoscale![key] =
                          v;
                      }),
                    )
                  }
                />
              ))}
              <p>
                {t(s.autoscalers?.find((a) => a.group === g.id)?.message || "")}
              </p>
              {s.scaleEvents
                ?.filter((e) => e.group === g.id)
                .slice(0, 4)
                .map((e, i) => (
                  <p key={i}>
                    {fmt(e.t / 1000, 1)} s · {e.from} → {e.to} · {t(e.reason)}
                  </p>
                ))}
            </details>
          )}
        </div>
      </Panel>
      <Panel title="Little’s law">
        <div className="control-body">
          <p>L = {fmt(stats.l, 2)}</p>
          <p>
            λ = {fmt(stats.lambda, 1)} /s · W = {fmt(stats.meanW / 1000, 3)} s
          </p>
          <p>
            {fmt(stats.l, 2)} = {fmt(stats.little, 2)} +{" "}
            {fmt(stats.unfinished, 2)} {t("unfinished")}
          </p>
          <p>
            {t("Queue")}: {fmt(stats.wQueue, 1)} ms · {t("Local processing")}:{" "}
            {fmt(stats.wLocal, 1)} ms · {t("Waiting for children")}:{" "}
            {fmt(stats.wChildren, 1)} ms
          </p>
          <p>
            {t("Utilization")}: {fmt(stats.utilization, 1)}% · Q {stats.queue}
          </p>
        </div>
      </Panel>
    </div>
  );
}
