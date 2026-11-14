import { memo, useState } from "react";
import { command, editConfig, run } from "../engine";
import type { Config, Trace } from "../model";
import { NumberField, Panel, Select, Toggle } from "./Fields";
import { t, useLocale } from "../locale";
import { RequestLocality } from "./Locality";
export const Generator = memo(function Generator({
  config: c,
  manual,
  running,
  focus,
  onRequestError,
}: {
  config: Config;
  manual: boolean;
  running: boolean;
  focus?: Trace;
  onRequestError: () => void;
}) {
  useLocale();
  const [weight, setWeight] = useState(1),
    [deadlineDraft, setDeadline] = useState<number | null>(null),
    [labels, setLabels] = useState(""),
    [error, setError] = useState("");
  const deadline = deadlineDraft ?? c.deadline;
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
            onInvalidCapture={onRequestError}
            onSubmit={(e) => {
              e.preventDefault();
              if (e.currentTarget.querySelector('[aria-invalid="true"]')) {
                setError(t("Correct the highlighted fields before applying."));
                onRequestError();
                return;
              }
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
                }).catch((e) => {
                  setError(e.message);
                  onRequestError();
                });
              } catch (e) {
                setError(String(e));
                onRequestError();
              }
            }}
          >
            <p className="field-note">
              {t(
                "Background arrivals stop. Existing work and connections remain. Restart ↺ for an empty system.",
              )}
            </p>
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
                  !focus
                    ? "Ready to send one request."
                    : running
                      ? focus.end >= 0
                        ? "User response received; downstream work is still running."
                        : "Request in progress. Pause or step to inspect."
                      : "Request finished. Send another to reuse connections.",
                )}
            </p>
          </form>
        )}
        {(
          [
            ["rps", "Traffic into the entry group", 0, 2000],
            ["weight", "Request weight", 0.01, 10],
            ["deadline", "Deadline, ms", 1, 60000],
            ["network", "Network, ms", 0, 5000],
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
            step={key === "seed" ? 1 : "any"}
            slider={["rps", "weight", "deadline", "network"].includes(key)}
            sliderMax={key === "network" ? 250 : undefined}
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
              disabled={!c.client.keepalive}
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
        <RequestLocality config={c} />
        <p className="field-note">
          {t("Scaling does not change total incoming RPS.")}
        </p>
      </div>
    </Panel>
  );
});
