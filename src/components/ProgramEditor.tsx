import { useState } from "react";
import type { Config, Group, ResourceConfig, Stage } from "../model";
import { definition, resources, type Box } from "../model-utils";
import { name, t } from "../locale";
import { NumberField, Select, Toggle } from "./Fields";
import { LabelsField, RuleEditor, TextField } from "./Locality";

function MoveButtons({
  index,
  length,
  move,
  remove,
}: {
  index: number;
  length: number;
  move: (offset: number) => void;
  remove: () => void;
}) {
  return (
    <div className="reorder-buttons">
      <button
        aria-label={t("Move up")}
        disabled={index === 0}
        onClick={() => move(-1)}
      >
        ↑
      </button>
      <button
        aria-label={t("Move down")}
        disabled={index === length - 1}
        onClick={() => move(1)}
      >
        ↓
      </button>
      <button onClick={remove}>{t("Remove")}</button>
    </div>
  );
}
function move<T>(items: T[], index: number, offset: number) {
  const [item] = items.splice(index, 1);
  items.splice(index + offset, 0, item);
}
function relativePath(from: string, to: string) {
  const a = from.split("/").filter(Boolean),
    b = to.split("/");
  while (a.length && b.length && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  return [...a.map(() => ".."), ...b].join("/");
}
function OptionalNumber({
  label,
  value,
  max,
  change,
}: {
  label: string;
  value?: number;
  max: number;
  change: (v: number | undefined) => void;
}) {
  return (
    <div className="optional-number">
      <Toggle
        label={label}
        value={value !== undefined}
        onChange={(v) => change(v ? 0 : undefined)}
      />
      {value !== undefined && (
        <NumberField label={label} value={value} max={max} onChange={change} />
      )}
    </div>
  );
}
export function ProgramEditor({
  group,
  config,
  change,
}: {
  group: Group;
  config: Config;
  change: (g: Group) => void;
}) {
  const [path, setPath] = useState("");
  const items = resources(group),
    selected = items.find((r) => r.path === path),
    current = selected?.path || "",
    box = selected?.box || group;
  const update = (mutate: (b: Box, g: Group) => void) => {
    const copy = structuredClone(group);
    mutate(definition(copy, current), copy);
    change(copy);
  };
  const targets: [string, string][] = [
    ...config.groups
      .filter((g) => g.id !== group.id)
      .map((g) => [`g:${g.id}`, name(g)] as [string, string]),
    ...items
      .filter((r) => r.path !== current && (!selected?.shared || r.shared))
      .map(
        (r) =>
          [
            `r:${relativePath(current, r.path)}`,
            `${name(r.box)} · ${r.path}`,
          ] as [string, string],
      ),
  ];
  const addResource = () =>
    update((b) => {
      b.resources ??= [];
      let i = 1;
      while (b.resources.some((r) => r.id === `r${i}`)) i++;
      b.resources.push({
        id: `r${i}`,
        name: `Resource ${i}`,
        scope: "instance",
        workers: 8,
        service: 10,
        queueLimit: 0,
        stages: [],
      });
    });
  return (
    <div className="program-editor" key={current}>
      <Select
        label="Box"
        value={current}
        translateOptions={false}
        options={[
          ["", name(group)],
          ...items.map(
            (r) =>
              [
                r.path,
                `${"↳ ".repeat(r.path.split("/").length)}${name(r.box)} · ${r.path}`,
              ] as [string, string],
          ),
        ]}
        onChange={setPath}
      />
      <TextField
        label="Name"
        required
        maxLength={100}
        value={box.name}
        onChange={(v) =>
          update((b) => {
            b.name = v;
          })
        }
      />
      {selected && (
        <Select
          label="Ownership"
          value={selected.box.scope}
          options={[
            ["instance", "Per instance"],
            ["shared", "Shared"],
          ]}
          onChange={(v) =>
            update((b) => {
              (b as ResourceConfig).scope = v;
            })
          }
        />
      )}
      <div className="editor-grid">
        <NumberField
          label="Workers"
          value={box.workers}
          min={1}
          max={512}
          step={1}
          onChange={(v) =>
            update((b) => {
              b.workers = v;
            })
          }
        />
        <NumberField
          label="Processing, ms"
          value={box.service}
          max={10000}
          onChange={(v) =>
            update((b) => {
              b.service = v;
            })
          }
        />
        <NumberField
          label="Queue limit · 0 = unlimited"
          value={box.queueLimit}
          max={2000}
          step={1}
          onChange={(v) =>
            update((b) => {
              b.queueLimit = v;
            })
          }
        />
      </div>
      <details>
        <summary>{t("Labels and processing cost")}</summary>
        <LabelsField
          label="Own labels · key=value"
          value={box.labels}
          onChange={(v) =>
            update((b) => {
              b.labels = v;
            })
          }
        />
        <RuleEditor
          cost
          value={box.cost}
          onChange={(v) =>
            update((b) => {
              b.cost = v;
            })
          }
        />
      </details>
      <h3>{t("Internal resources")}</h3>
      {(box.resources || []).map((r, i) => (
        <div className="editor-item" key={r.id}>
          <button
            onClick={() => setPath([current, r.id].filter(Boolean).join("/"))}
          >
            {name(r)} · {r.id}
          </button>
          <MoveButtons
            index={i}
            length={box.resources!.length}
            move={(offset) => update((b) => move(b.resources!, i, offset))}
            remove={() =>
              update((b) => {
                b.resources!.splice(i, 1);
              })
            }
          />
        </div>
      ))}
      <button
        disabled={(box.resources?.length || 0) >= 8}
        onClick={addResource}
      >
        {t("Add resource")}
      </button>
      <p className="field-note">
        {t("Remove calls to a resource before removing the resource.")}
      </p>
      <h3>{t("Request stages")}</h3>
      <p className="field-note">
        {t("Stages run in order; calls within a stage run in parallel.")}
      </p>
      {box.stages.map((stage, si) => {
        const stageUpdate = (fn: (s: Stage) => void) =>
          update((b) => fn(b.stages[si]));
        return (
          <section className="stage-editor" key={si}>
            <div className="editor-item">
              <h3>
                {t("Stage")} {si + 1}
              </h3>
              <MoveButtons
                index={si}
                length={box.stages.length}
                move={(offset) => update((b) => move(b.stages, si, offset))}
                remove={() =>
                  update((b) => {
                    b.stages.splice(si, 1);
                  })
                }
              />
            </div>
            <Select
              label="Wait for"
              value={stage.join}
              options={[
                ["all", "All calls"],
                ["any", "Any successful call"],
                ["quorum", "Quorum"],
              ]}
              onChange={(v) =>
                stageUpdate((s) => {
                  s.join = v;
                  if (v === "quorum") s.quorum ??= 1;
                  else delete s.quorum;
                })
              }
            />
            {stage.join === "quorum" && (
              <NumberField
                label="Quorum"
                value={stage.quorum || 1}
                min={1}
                max={2048}
                step={1}
                onChange={(v) =>
                  stageUpdate((s) => {
                    s.quorum = v;
                  })
                }
              />
            )}
            <details>
              <summary>{t("Stage condition")}</summary>
              <LabelsField
                label="Request tags · key=value"
                value={stage.when}
                onChange={(v) =>
                  stageUpdate((s) => {
                    s.when = v;
                  })
                }
              />
            </details>
            {stage.calls.map((call, ci) => {
              const callUpdate = (fn: (c: typeof call) => void) =>
                stageUpdate((s) => fn(s.calls[ci]));
              const destination = call.resource
                ? `r:${call.resource}`
                : `g:${call.target}`;
              return (
                <div className="call-editor" key={ci}>
                  <div className="editor-item">
                    <b>
                      {t("Call")} {ci + 1}
                    </b>
                    <MoveButtons
                      index={ci}
                      length={stage.calls.length}
                      move={(offset) =>
                        stageUpdate((s) => move(s.calls, ci, offset))
                      }
                      remove={() =>
                        stageUpdate((s) => {
                          s.calls.splice(ci, 1);
                        })
                      }
                    />
                  </div>
                  <Select
                    label="Target"
                    value={destination}
                    translateOptions={false}
                    options={
                      targets.some(([v]) => v === destination)
                        ? targets
                        : [
                            [destination, call.target || call.resource || "—"],
                            ...targets,
                          ]
                    }
                    onChange={(v) =>
                      callUpdate((c) => {
                        delete c.target;
                        delete c.resource;
                        if (v.startsWith("g:")) c.target = v.slice(2);
                        else c.resource = v.slice(2);
                      })
                    }
                  />
                  <NumberField
                    label="Calls"
                    value={call.calls}
                    min={1}
                    max={16}
                    step={1}
                    onChange={(v) =>
                      callUpdate((c) => {
                        c.calls = v;
                      })
                    }
                  />
                  <Select
                    label="Routing"
                    value={call.route}
                    options={[
                      ["round_robin", "Round robin"],
                      ["random", "Random node"],
                      ["least_busy", "Least busy"],
                      ["broadcast", "Every node"],
                    ]}
                    onChange={(v) =>
                      callUpdate((c) => {
                        c.route = v;
                        if (v === "broadcast" && c.affinity)
                          c.affinity.enabled = false;
                      })
                    }
                  />
                  <Select
                    label="Transport"
                    value={call.transport}
                    options={[
                      ["network", "Network"],
                      ["ideal", "Ideal link"],
                    ]}
                    onChange={(v) =>
                      callUpdate((c) => {
                        c.transport = v;
                      })
                    }
                  />
                  <details>
                    <summary>{t("Overrides and conditions")}</summary>
                    <OptionalNumber
                      label="Network override, ms"
                      value={call.network}
                      max={5000}
                      change={(v) =>
                        callUpdate((c) => {
                          c.network = v;
                        })
                      }
                    />
                    <OptionalNumber
                      label="Timeout override, ms"
                      value={call.timeout}
                      max={60000}
                      change={(v) =>
                        callUpdate((c) => {
                          c.timeout = v;
                        })
                      }
                    />
                    <p className="field-note">
                      {t(
                        "Disabled overrides inherit defaults. Timeout 0 adds no call budget.",
                      )}
                    </p>
                    <LabelsField
                      label="Request tags · key=value"
                      value={call.when}
                      onChange={(v) =>
                        callUpdate((c) => {
                          c.when = v;
                        })
                      }
                    />
                    <RuleEditor
                      value={call.affinity}
                      disabled={call.route === "broadcast"}
                      onChange={(v) =>
                        callUpdate((c) => {
                          c.affinity = {
                            enabled: v.enabled,
                            source: v.source,
                            key: v.key,
                          };
                        })
                      }
                    />
                    <RuleEditor
                      value={call.networkCost}
                      cost
                      disabled={call.transport === "ideal"}
                      onChange={(v) =>
                        callUpdate((c) => {
                          c.networkCost = v;
                        })
                      }
                    />
                  </details>
                </div>
              );
            })}
            <button
              disabled={!targets.length || stage.calls.length >= 8}
              onClick={() =>
                stageUpdate((s) => {
                  const dest = targets[0][0];
                  s.calls.push({
                    [dest.startsWith("g:") ? "target" : "resource"]:
                      dest.slice(2),
                    calls: 1,
                    route: "round_robin",
                    transport: dest.startsWith("g:") ? "network" : "ideal",
                  });
                })
              }
            >
              {t("Add call")}
            </button>
          </section>
        );
      })}
      <button
        disabled={box.stages.length >= 16}
        onClick={() =>
          update((b) => {
            b.stages.push({ join: "all", calls: [] });
          })
        }
      >
        {t("Add stage")}
      </button>
    </div>
  );
}
