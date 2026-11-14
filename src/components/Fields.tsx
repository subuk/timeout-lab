import { useState, type ReactNode } from "react";
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
// Drafts survive snapshots and locale switches; only blur/Enter commits numbers.
export function NumberField({
  id,
  label,
  value,
  onChange,
  min = 0,
  max,
  step = "any",
  disabled = false,
}: {
  id?: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number | "any";
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="number-row">
      {t(label)}
      <input
        id={id}
        type="number"
        value={draft ?? value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          if (
            draft !== null &&
            e.target.value !== "" &&
            e.target.checkValidity()
          )
            onChange(e.target.valueAsNumber);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
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
}: {
  id?: string;
  label: string;
  value: string;
  options: (string | [string, string])[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="select-row">
      {t(label)}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const [v, l] = typeof o === "string" ? [o, o] : o;
          return (
            <option key={v} value={v}>
              {t(l)}
            </option>
          );
        })}
      </select>
    </label>
  );
}
