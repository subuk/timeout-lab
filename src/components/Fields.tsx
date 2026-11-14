import { useId, useState, type ReactNode } from "react";
import { t } from "../locale";
export function Panel({
  title,
  children,
  action,
  className = "",
  translateTitle = true,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  translateTitle?: boolean;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>{translateTitle ? t(title) : title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
// Drafts survive snapshots and locale switches; invalid input stays reviewable.
export function NumberField({
  id,
  label,
  value,
  onChange,
  min = 0,
  max,
  step = "any",
  disabled = false,
  slider = false,
  sliderMax,
  note,
}: {
  id?: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number | "any";
  disabled?: boolean;
  slider?: boolean;
  sliderMax?: number;
  note?: string;
}) {
  const uid = useId(),
    inputID = id || uid;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rangeMax = Math.max(value, sliderMax ?? max ?? 100);
  return (
    <div className={`number-field ${disabled ? "disabled-control" : ""}`}>
      <label className="number-row" htmlFor={inputID}>
        <span>{t(label)}</span>
        <input
          id={inputID}
          type="number"
          value={draft ?? value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${uid}-error` : note ? `${uid}-note` : undefined
          }
          onChange={(e) => {
            setDraft(e.target.value);
            setError("");
          }}
          onBlur={(e) => {
            if (draft === null) return;
            const input = e.currentTarget;
            if (input.value === "" || !Number.isFinite(input.valueAsNumber)) {
              setError(t("Enter a number."));
              return;
            }
            if (!input.checkValidity()) {
              setError(
                input.validity.stepMismatch
                  ? t(
                      step === 1
                        ? "Enter a whole number."
                        : "Use the allowed step.",
                    )
                  : `${t("Allowed range")}: ${min}–${max ?? "∞"}`,
              );
              return;
            }
            onChange(input.valueAsNumber);
            setDraft(null);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              setDraft(null);
              setError("");
            }
          }}
        />
      </label>
      {slider && (
        <input
          className="field-slider"
          type="range"
          aria-label={`${t(label)} · ${t("Slider")}`}
          min={min}
          max={rangeMax}
          step={step === "any" ? 0.1 : step}
          value={Math.min(rangeMax, value)}
          disabled={disabled}
          onChange={(e) => {
            setDraft(null);
            setError("");
            onChange(e.target.valueAsNumber);
          }}
        />
      )}
      {note && (
        <p className="field-note" id={`${uid}-note`}>
          {t(note)}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${uid}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function Toggle({
  id,
  label,
  value,
  onChange,
  disabled = false,
}: {
  id?: string;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="switch-row">
      <span>{t(label)}</span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function Select({
  id,
  label,
  value,
  options,
  onChange,
  translateOptions = true,
}: {
  id?: string;
  label: string;
  value: string;
  options: (string | [string, string])[];
  translateOptions?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="select-row">
      {t(label)}
      <select
        id={id}
        aria-label={t(label)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => {
          const [v, l] = typeof o === "string" ? [o, o] : o;
          return (
            <option key={v} value={v}>
              {translateOptions ? t(l) : l}
            </option>
          );
        })}
      </select>
    </label>
  );
}
