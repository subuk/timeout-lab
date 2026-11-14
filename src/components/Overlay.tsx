import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../locale";

export function Dock({
  id,
  title,
  open,
  toggle,
  children,
  className = "",
}: {
  id: string;
  title: string;
  open: boolean;
  toggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`floating-block dock ${className} ${open ? "is-open" : "is-collapsed"}`}
    >
      <button
        id={`${id}-toggle`}
        className="dock-toggle"
        aria-expanded={open}
        aria-controls={`${id}-content`}
        onClick={toggle}
      >
        <span>{t(title)}</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <div id={`${id}-content`} className="dock-content" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export function SettingsWindow({
  children,
  close,
  label,
  open,
}: {
  children: ReactNode;
  close: () => void;
  label: string;
  open: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const dismiss = useRef(close);
  dismiss.current = close;
  useEffect(() => {
    if (!open) return;
    origin.current = document.activeElement as HTMLElement;
    root.current?.focus({ preventScroll: true });
    const keydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      dismiss.current();
      if (origin.current?.isConnected)
        origin.current.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [open]);
  return (
    <aside
      id="settings-window"
      hidden={!open}
      className="settings-window floating-block"
      role="dialog"
      aria-modal="false"
      aria-label={label}
      tabIndex={-1}
      ref={root}
    >
      <div className="settings-heading">
        <span>{t("Settings")}</span>
        <button
          id="close-settings"
          aria-label={t("Close settings")}
          onClick={() => {
            close();
            if (origin.current?.isConnected)
              origin.current.focus({ preventScroll: true });
          }}
        >
          ×
        </button>
      </div>
      <div className="settings-content">{children}</div>
    </aside>
  );
}
