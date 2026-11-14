import type { Snapshot, NodeConfig } from "../model";
import { definition, resources, aggregate } from "../model-utils";
import { editConfig, command, run } from "../engine";
import { name, fmt, t } from "../locale";
import { NumberField, Panel, Select, Toggle } from "./Fields";
import { Autoscale } from "./Autoscale";
import { BoxLocality } from "./Locality";
import { Residence } from "./Residence";
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
    if (!all && one && (field === "service" || field === "workers")) {
      run(command({ type: "node", id: one.id, [field]: value }));
      return;
    }
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
      <Panel title={name(box)} translateTitle={false} className="inspector">
        <div className="control-body">
          <div className="selection-heading">
            <span className="node-symbol" aria-hidden="true">
              {all ? "▦" : "□"}
            </span>
            <div>
              <strong id="selected-id">{all ? g.id : one?.id}</strong>
              <p>
                {t(all ? "Whole group" : "One node · independent queue")}
                {all ? ` · ×${g.count}` : ""}
              </p>
            </div>
          </div>
          <div
            id="scope"
            className="segmented"
            role="group"
            aria-label={t("Edit scope")}
          >
            {(["node", "group"] as const).map((scope) => (
              <button
                key={scope}
                data-scope={scope}
                className={(all ? "group" : "node") === scope ? "active" : ""}
                aria-pressed={(all ? "group" : "node") === scope}
                disabled={!!resource?.shared && scope === "node"}
                onClick={() => select({ ...selection, scope })}
              >
                {t(scope === "group" ? "Whole group" : "One node")}
              </button>
            ))}
          </div>
          {resource?.shared && (
            <p className="field-note">
              {t(
                "This resource is shared: adding service instances does not increase its capacity.",
              )}
            </p>
          )}
          <div id="resource-tabs" className="resource-tabs">
            <button
              className={!path ? "active" : ""}
              aria-pressed={!path}
              onClick={() => select({ ...selection, resource: "" })}
            >
              {t("Requests")}
            </button>
            {resources(g).map((r) => (
              <button
                key={r.path}
                className={path === r.path ? "active" : ""}
                aria-pressed={path === r.path}
                onClick={() => select({ ...selection, resource: r.path })}
              >
                {name(r.box)}
              </button>
            ))}
          </div>
          <NumberField
            id="service"
            slider
            sliderMax={2000}
            label="Processing, ms"
            value={all ? box.service : (one?.service ?? box.service)}
            max={10000}
            onChange={(v) => set("service", v)}
          />
          <NumberField
            id="workers"
            slider
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
              disabled={!box.stages.length || (!all && !!one?.draining)}
              onChange={(v) => set("keepalive", v)}
            />
            <Toggle
              id="retry-connect"
              label="Retry connection failures"
              value={settings.retryConnect ?? true}
              disabled={!box.stages.length || (!all && !!one?.draining)}
              onChange={(v) => set("retryConnect", v)}
            />
            <NumberField
              id="keepalive-timeout"
              label="Idle timeout, s"
              value={(settings.keepaliveTimeout ?? 30000) / 1000}
              disabled={
                !settings.keepalive ||
                !box.stages.length ||
                (!all && !!one?.draining)
              }
              max={3600}
              onChange={(v) => set("keepaliveTimeout", v * 1000)}
            />
            <NumberField
              id="connect"
              label="Connect timeout, ms"
              value={settings.connectTimeout ?? 200}
              disabled={!box.stages.length || (!all && !!one?.draining)}
              min={1}
              max={60000}
              onChange={(v) => set("connectTimeout", v)}
            />
            <NumberField
              id="timeout"
              label="Call timeout, ms"
              value={settings.timeout ?? 500}
              disabled={!box.stages.length || (!all && !!one?.draining)}
              min={1}
              max={60000}
              onChange={(v) => set("timeout", v)}
            />
            {!all && one && (
              <button
                id="inherit-downstream"
                disabled={!box.stages.length || !!one.draining}
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
          <BoxLocality
            config={s.config}
            group={g.id}
            path={path}
            box={box}
            all={all}
            one={one}
            views={views}
          />
          <button id="edit-resources" onClick={() => edit(g.id)}>
            {t("Boxes and request paths")}
          </button>
          <Autoscale group={g} snapshot={s} />
        </div>
      </Panel>
      <Residence stats={stats} />
    </div>
  );
}
