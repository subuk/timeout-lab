import { useState } from "react";
import type { Config, CostRule, MatchRule, NodeView } from "../model";
import { definition, type Box } from "../model-utils";
import { editConfig, run } from "../engine";
import { t } from "../locale";
import { NumberField, Select, Toggle } from "./Fields";

export function TextField({
  label,
  value,
  onChange,
  pattern,
  maxLength,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  pattern?: string;
  maxLength?: number;
  required?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  return (
    <label className="text-field">
      {t(label)}
      <input
        aria-label={t(label)}
        value={draft ?? value}
        pattern={pattern}
        maxLength={maxLength}
        required={required}
        aria-invalid={error}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(false);
        }}
        onBlur={(e) => {
          if (draft === null) return;
          if (!e.currentTarget.checkValidity()) {
            setError(true);
            return;
          }
          onChange(draft);
          setDraft(null);
        }}
      />
      {error && (
        <span className="field-error" role="alert">
          {t("Check this value.")}
        </span>
      )}
    </label>
  );
}
export function LabelsField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null),
    [error, setError] = useState("");
  return (
    <label className="locality-label">
      {t(label)}
      <textarea
        aria-label={t(label)}
        value={
          draft ??
          Object.entries(value || {})
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        }
        aria-invalid={!!error}
        onChange={(e) => {
          setDraft(e.target.value);
          setError("");
        }}
        onBlur={() => {
          if (draft === null) return;
          const pairs = draft
            .split("\n")
            .filter((s) => s.trim())
            .map((s) => {
              const i = s.indexOf("=");
              return i < 0
                ? [s, undefined]
                : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
            });
          if (
            pairs.length > 16 ||
            pairs.some(
              ([k, v]) =>
                !/^[a-zA-Z0-9_.-]{1,40}$/.test(k!) ||
                v === undefined ||
                v.length > 80,
            ) ||
            new Set(pairs.map(([k]) => k)).size !== pairs.length
          ) {
            setError(
              t("Labels: one key=value per line.") +
                " " +
                t("Check label names and duplicate keys."),
            );
            return;
          }
          onChange(Object.fromEntries(pairs));
          setDraft(null);
          setError("");
        }}
      />
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
export function RuleEditor({
  value,
  cost = false,
  requestOnly = false,
  disabled = false,
  onChange,
}: {
  value?: MatchRule | CostRule;
  cost?: boolean;
  requestOnly?: boolean;
  disabled?: boolean;
  onChange: (v: CostRule) => void;
}) {
  const rule: CostRule = {
    enabled: false,
    source: "request",
    key: "az",
    match: 1,
    mismatch: 3,
    ...value,
  };
  const change = (v: Partial<CostRule>) => onChange({ ...rule, ...v });
  return (
    <fieldset className="rule-editor" disabled={disabled}>
      <Toggle
        label={cost ? "Adjust cost" : "Prefer matching labels"}
        value={rule.enabled}
        onChange={(enabled) => change({ enabled })}
      />
      {rule.enabled && (
        <>
          <Select
            label="Label source"
            value={rule.source}
            options={
              requestOnly
                ? [["request", "Request"]]
                : [
                    ["request", "Request"],
                    ["caller", "Calling box"],
                  ]
            }
            onChange={(source) => change({ source })}
          />
          <TextField
            label="Label key"
            value={rule.key}
            required
            pattern="[a-zA-Z0-9_.-]{1,40}"
            onChange={(key) => change({ key })}
          />
          {cost && (
            <>
              <NumberField
                label="Match ×"
                value={rule.match}
                max={100}
                onChange={(match) => change({ match })}
              />
              <NumberField
                label="Mismatch ×"
                value={rule.mismatch}
                max={100}
                onChange={(mismatch) => change({ mismatch })}
              />
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
export function RequestLocality({ config: c }: { config: Config }) {
  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    run(
      editConfig((c) => {
        c[key] = value;
      }),
    );
  const tag = c.requestTag;
  return (
    <details id="request-locality">
      <summary>{t("Request labels")}</summary>
      <LabelsField
        label="Fixed labels · key=value"
        value={c.requestLabels}
        onChange={(v) => set("requestLabels", v)}
      />
      <Toggle
        label="Distribute one label"
        value={!!tag}
        onChange={(v) =>
          set(
            "requestTag",
            v ? { key: "az", a: "a", b: "b", percent: 50 } : undefined,
          )
        }
      />
      {tag && (
        <>
          <TextField
            label="Key"
            value={tag.key}
            required
            pattern="[a-zA-Z0-9_.-]{1,40}"
            onChange={(key) => set("requestTag", { ...tag, key })}
          />
          <TextField
            label="Value A"
            value={tag.a}
            required
            maxLength={80}
            onChange={(a) => set("requestTag", { ...tag, a })}
          />
          <TextField
            label="Value B"
            value={tag.b}
            required
            maxLength={80}
            onChange={(b) => set("requestTag", { ...tag, b })}
          />
          <NumberField
            label="Share of A, %"
            value={tag.percent}
            max={100}
            slider
            onChange={(percent) => set("requestTag", { ...tag, percent })}
          />
          <p className="field-note">
            {t("Share of B = 100% − A. All child calls inherit the labels.")}
          </p>
        </>
      )}
      <h3>{t("Entry box selection")}</h3>
      <RuleEditor
        value={c.entryAffinity}
        requestOnly
        onChange={(v) =>
          set("entryAffinity", {
            enabled: v.enabled,
            source: "request",
            key: v.key,
          })
        }
      />
    </details>
  );
}
export function BoxLocality({
  config,
  group,
  path,
  box,
  all,
  one,
  views,
}: {
  config: Config;
  group: string;
  path: string;
  box: Box;
  all: boolean;
  one?: NodeView;
  views: NodeView[];
}) {
  const own = all ? box : config.overrides?.[one?.id || ""];
  const update = (
    key: "labels" | "cost",
    value: Record<string, string> | CostRule,
  ) =>
    run(
      editConfig((c) => {
        if (all)
          Object.assign(
            definition(
              c.groups.find((g) => g.id === group)!,
              path,
            ),
            { [key]: value },
          );
        else if (one) {
          c.overrides ??= {};
          c.overrides[one.id] ??= {};
          Object.assign(c.overrides[one.id], { [key]: value });
        }
      }),
    );
  const sum = (key: "costKnown" | "costRemote" | "hopKnown" | "hopRemote") =>
    views.reduce((a, n) => a + n[key], 0);
  return (
    <details id="box-locality">
      <summary>{t("Locality")}</summary>
      <fieldset className="rule-editor" disabled={!all && !!one?.draining}>
        <LabelsField
          label="Own labels · key=value"
          value={own?.labels}
          onChange={(v) => update("labels", v)}
        />
        <p className="field-note">
          {t(
            "Instances inherit group labels; owned resources inherit instance labels. key= removes an inherited label. Individual overrides take precedence.",
          )}
        </p>
        <p className="field-note">
          {t("Effective labels: ")}
          {Object.entries(one?.labels || {})
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ") || "—"}
          {all ? ` · ${t("first instance shown")}` : ""}
        </p>
        <h3>{t("Processing time of this box")}</h3>
        <RuleEditor
          value={own?.cost ?? (!all ? one?.cost : undefined)}
          cost
          onChange={(v) => update("cost", v)}
        />
        <p className="field-note">
          {t(
            "Base time × weight × multiplier. A missing label means ×1. Resources do not inherit their service’s processing multiplier.",
          )}
        </p>
        {!all && one && (
          <button
            onClick={() =>
              run(
                editConfig((c) => {
                  if (c.overrides?.[one.id]) {
                    delete c.overrides[one.id].labels;
                    delete c.overrides[one.id].cost;
                  }
                }),
              )
            }
          >
            {t("Inherit")}
          </button>
        )}
      </fieldset>
      <p className="field-note">
        {t("Mismatches since start. Processing: ")}
        {sum("costRemote")}/{sum("costKnown")}
        {t("; incoming attempts: ")}
        {sum("hopRemote")}/{sum("hopKnown")}
      </p>
      {box.stages.flatMap((stage, si) =>
        stage.calls.map((call, ci) => (
          <details className="call-locality" key={`${si}/${ci}`}>
            <summary>
              {t("Outgoing call")} {si + 1}.{ci + 1} →{" "}
              {call.target || call.resource} · {t("whole group")}
            </summary>
            <RuleEditor
              value={call.affinity}
              disabled={call.route === "broadcast"}
              onChange={(v) =>
                run(
                  editConfig((c) => {
                    definition(
                      c.groups.find((g) => g.id === group)!,
                      path,
                    ).stages[si].calls[ci].affinity = {
                      enabled: v.enabled,
                      source: v.source,
                      key: v.key,
                    };
                  }),
                )
              }
            />
            <p className="field-note">
              {t(
                "Preference ignores queue length: matching nodes first. On connection failure, retries try matching nodes, then others, within the call budget. Broadcast visits every node.",
              )}
            </p>
            <h3>{t("Link delay")}</h3>
            <RuleEditor
              value={call.networkCost}
              cost
              disabled={call.transport === "ideal"}
              onChange={(v) =>
                run(
                  editConfig((c) => {
                    definition(
                      c.groups.find((g) => g.id === group)!,
                      path,
                    ).stages[si].calls[ci].networkCost = v;
                  }),
                )
              }
            />
            <p className="field-note">
              {t(
                "Multiplier of this link’s one-way delay, including reply and handshake. With base delay 0, the penalty is also 0.",
              )}
            </p>
          </details>
        )),
      )}
    </details>
  );
}
