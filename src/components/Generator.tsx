import { memo, useState } from "react";
import { command, editConfig, run } from "../engine";
import type { Config } from "../model";
import { NumberField, Panel, Select, Toggle } from "./Fields";
import { t, useLocale } from "../locale";
export const Generator = memo(function Generator({
  config: c,
  manual,
  running,
  editAdvanced,
}: {
  config: Config;
  manual: boolean;
  running: boolean;
  editAdvanced: () => void;
}) {
  useLocale();
  const [weight, setWeight] = useState(1),
    [deadline, setDeadline] = useState(3000),
    [labels, setLabels] = useState(""),
    [error, setError] = useState("");
  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    run(
      editConfig((c) => {
        c[key] = value;
      }),
    );
  return (
    <Panel title="Generator">
      <div className="control-body">
        <Select
          id="request-mode"
          label="Request mode"
          value={manual ? "single" : "load"}
          options={[
            ["load", "Continuous load"],
            ["single", "Single request"],
          ]}
          onChange={(v) =>
            run(command({ type: "mode", manual: v === "single" }))
          }
        />
        {manual && (
          <form
            id="single-request"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const entries = labels
                  .split("\n")
                  .filter((s) => s.trim())
                  .map((line) => {
                    const i = line.indexOf("=");
                    if (i < 1)
                      throw Error(t("Labels: one key=value per line."));
                    return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
                  });
                if (new Set(entries.map((e) => e[0])).size !== entries.length)
                  throw Error(t("Check label names and duplicate keys."));
                setError("");
                void command({
                  type: "request",
                  request: {
                    weight,
                    deadline,
                    labels: Object.fromEntries(entries),
                  },
                }).catch((e) => setError(e.message));
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <NumberField
              id="single-weight"
              label="Request weight"
              value={weight}
              min={0.01}
              max={10}
              onChange={setWeight}
            />
            <NumberField
              id="single-deadline"
              label="Deadline, ms"
              value={deadline}
              min={1}
              max={60000}
              onChange={setDeadline}
            />
            <label className="locality-label">
              {t("Fixed labels · key=value")}
              <textarea
                id="single-labels"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
              />
            </label>
            <button id="send-request" disabled={running}>
              {t("Send one request →")}
            </button>{" "}
            <button
              id="request-step"
              type="button"
              onClick={() => run(command({ type: "step", ms: 10 }))}
            >
              +10 ms
            </button>
            <p role="status">
              {error ||
                t(
                  running
                    ? "Request in progress. Pause or step to inspect."
                    : "Ready to send one request.",
                )}
            </p>
          </form>
        )}
        {(
          [
            ["rps", "Traffic into the entry group", 0, 10000],
            ["weight", "Request weight", 0.01, 10],
            ["deadline", "Deadline, ms", 1, 60000],
            ["network", "Network, ms", 0, 10000],
            ["spread", "Weight spread, %", 0, 100],
            ["jitter", "Jitter, %", 0, 100],
            ["seed", "Seed", 1, Number.MAX_SAFE_INTEGER],
          ] as const
        ).map(([key, label, min, max]) => (
          <NumberField
            key={key}
            id={key}
            label={label}
            value={c[key]}
            min={min}
            max={max}
            disabled={
              manual && ["rps", "weight", "deadline", "spread"].includes(key)
            }
            onChange={(v) => set(key, v)}
          />
        ))}
        <Toggle
          id="cancel"
          label="Cancel downstream work"
          value={c.cancel}
          onChange={(v) => set("cancel", v)}
        />
        {c.client && (
          <details>
            <summary>{t("Client connections")}</summary>
            <Toggle
              id="client-keepalive"
              label="Keep-alive"
              value={c.client.keepalive}
              onChange={(v) =>
                run(
                  editConfig((c) => {
                    c.client!.keepalive = v;
                  }),
                )
              }
            />
            <NumberField
              id="client-idle"
              label="Idle timeout, s"
              value={c.client.keepaliveTimeout / 1000}
              max={3600}
              onChange={(v) =>
                run(
                  editConfig((c) => {
                    c.client!.keepaliveTimeout = v * 1000;
                  }),
                )
              }
            />
            <NumberField
              id="client-connect"
              label="Connect timeout, ms"
              value={c.client.connectTimeout}
              min={1}
              max={60000}
              onChange={(v) =>
                run(
                  editConfig((c) => {
                    c.client!.connectTimeout = v;
                  }),
                )
              }
            />
          </details>
        )}
        <button onClick={editAdvanced}>
          {t("Request labels")} / {t("Locality")}
        </button>
        <p className="field-note">
          {t("Scaling does not change total incoming RPS.")}
        </p>
      </div>
    </Panel>
  );
});
