import { useEffect, useRef, useState } from "react";
import type { Config, Group } from "../model";
import { editConfig } from "../engine";
import { mergeDraft } from "../drafts";
import { t } from "../locale";
import { NumberField } from "./Fields";
import { ProgramEditor } from "./ProgramEditor";
type JSONValue =
  null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
// A partially edited JSON document can always fall back to the generic form.
function isFormBox(value: JSONValue): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    [value.workers, value.service, value.queueLimit].every(
      (v) => typeof v === "number",
    ) &&
    Array.isArray(value.stages) &&
    value.stages.every(
      (stage) =>
        stage &&
        typeof stage === "object" &&
        !Array.isArray(stage) &&
        typeof stage.join === "string" &&
        Array.isArray(stage.calls) &&
        stage.calls.every(
          (call) =>
            call &&
            typeof call === "object" &&
            !Array.isArray(call) &&
            typeof call.calls === "number" &&
            typeof call.route === "string" &&
            typeof call.transport === "string" &&
            (call.target === undefined || typeof call.target === "string") &&
            (call.resource === undefined || typeof call.resource === "string"),
        ),
    ) &&
    (value.resources === undefined ||
      (Array.isArray(value.resources) && value.resources.every(isFormBox)))
  );
}
// A form for the complete wire schema keeps advanced model features accessible.
function TreeField({
  label,
  value,
  change,
}: {
  label: string;
  value: JSONValue;
  change: (value: JSONValue) => void;
}) {
  if (value === null) return <span>{label}: null</span>;
  if (typeof value === "number")
    return (
      <NumberField
        label={label}
        value={value}
        min={-Number.MAX_VALUE}
        onChange={change}
      />
    );
  if (typeof value === "object")
    return (
      <details className="schema-section">
        <summary>
          {t(label)}
          {Array.isArray(value) ? ` · ${value.length}` : ""}
        </summary>
        {Object.entries(value).map(([key, child]) => (
          <TreeField
            key={key}
            label={key}
            value={child}
            change={(next) => {
              const copy = structuredClone(value);
              if (Array.isArray(copy)) copy[Number(key)] = next;
              else copy[key] = next;
              change(copy);
            }}
          />
        ))}
      </details>
    );
  return (
    <label className="schema-field">
      {t(label)}
      <input
        type={typeof value === "boolean" ? "checkbox" : "text"}
        checked={typeof value === "boolean" ? value : undefined}
        value={typeof value === "boolean" ? undefined : value}
        step="any"
        onChange={(e) =>
          change(typeof value === "boolean" ? e.target.checked : e.target.value)
        }
      />
    </label>
  );
}
export function ModelEditor({
  config,
  group,
  close,
}: {
  config: Config;
  group?: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [base] = useState(() =>
    structuredClone(
      group ? config.groups.find((g) => g.id === group)! : config,
    ),
  );
  const [text, setText] = useState(() =>
    JSON.stringify(
      group ? config.groups.find((g) => g.id === group) : config,
      null,
      2,
    ),
  );
  const [mode, setMode] = useState<"form" | "json">("form"),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  async function apply(reset: boolean) {
    try {
      if (
        mode === "form" &&
        dialog.current?.querySelector('[aria-invalid="true"], input:invalid')
      )
        throw Error(t("Correct the highlighted fields before applying."));
      const parsed = JSON.parse(text);
      setError("");
      setPending(true);
      if (group)
        await editConfig((c) => {
          const i = c.groups.findIndex((g) => g.id === group);
          if (i < 0) throw Error("Group no longer exists");
          c.groups[i] = mergeDraft(base as Group, parsed as Group, c.groups[i]);
        }, reset);
      else
        await editConfig((c) => {
          const merged = mergeDraft(base as Config, parsed as Config, c);
          for (const key of Object.keys(c))
            if (!Object.hasOwn(merged, key))
              delete (c as unknown as Record<string, unknown>)[key];
          Object.assign(c, merged);
        }, reset);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }
  let tree: JSONValue | null = null;
  try {
    tree = JSON.parse(text);
  } catch {}
  return (
    <dialog id="config-dialog" ref={dialog} onCancel={close}>
      <div className="modal-head">
        <h2>
          {t(group ? "Boxes and request paths" : "System model")}
          {group ? " · " + group : ""}
        </h2>
        <button aria-label={t("Close")} onClick={close}>
          ×
        </button>
      </div>
      <div className="editor-tabs">
        <button onClick={() => setMode("form")}>{t("Settings")}</button>
        <button onClick={() => setMode("json")}>JSON</button>
      </div>
      <p className="field-note">
        {t(
          "Changing the structure restarts the experiment. Edit values and names live in the tabs.",
        )}
      </p>
      {mode === "form" && tree ? (
        <div className="schema-editor">
          {group && isFormBox(tree) ? (
            <ProgramEditor
              config={config}
              group={tree as unknown as Group}
              change={(v) => setText(JSON.stringify(v, null, 2))}
            />
          ) : (
            <TreeField
              label={group || "Model"}
              value={tree}
              change={(v) => setText(JSON.stringify(v, null, 2))}
            />
          )}
        </div>
      ) : (
        <textarea
          id="config-editor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      )}
      <div className="modal-footer">
        <span id="config-error" role="alert">
          {t(error)}
        </span>
        <button disabled={pending} onClick={() => void apply(false)}>
          {t("Apply without reset")}
        </button>
        <button
          id="apply-config"
          className="primary-button"
          disabled={pending}
          onClick={() => void apply(true)}
        >
          {t("Apply and restart →")}
        </button>
      </div>
    </dialog>
  );
}
