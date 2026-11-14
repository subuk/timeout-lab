import { useEffect, useRef, useState } from "react";
import { t } from "../locale";

export function ShareModel({ url, close }: { url: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function copy() {
    input.current?.select();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <dialog id="share-dialog" ref={dialog} onCancel={close}>
      <div className="modal-head">
        <h2>{t("Share model")}</h2>
        <button aria-label={t("Close")} onClick={close}>
          ×
        </button>
      </div>
      <div className="share-content">
        <p>
          {t(
            "This link opens a new experiment with the current configuration. It does not include history or traces.",
          )}
        </p>
        <textarea
          ref={input}
          aria-label={t("Model link")}
          value={url}
          readOnly
          onFocus={(e) => e.target.select()}
          rows={5}
        />
        <p className="field-note">
          {t(
            "Copy the link to share it. Anyone with the link can read the configuration.",
          )}
        </p>
      </div>
      <div className="modal-footer">
        <button onClick={() => void copy()}>
          {t(copied ? "Copied" : "Copy link")}
        </button>
      </div>
    </dialog>
  );
}
