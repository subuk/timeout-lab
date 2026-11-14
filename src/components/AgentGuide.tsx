import { useEffect, useRef, useState } from "react";
import { t } from "../locale";

const promptText =
  "Read https://tmlab.krglv.com/skill.md and use it to build a Timeout Lab scenario.\n\nMy system: two API instances call one database. Total incoming traffic is 30 requests per second. I want to see how a slow database creates queues and timeouts.\n\nUse illustrative values where I have not provided measurements, and explain your assumptions. Return a clickable link that opens the finished model and suggest what to change and observe.";

export function AgentGuide({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState(() => t(promptText));
  const [copyState, setCopyState] = useState<"" | "copied" | "manual">("");
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    element.showModal();
    title.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      if (previousFocus instanceof HTMLElement)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      input.current?.focus();
      input.current?.select();
      setCopyState("manual");
    }
  }
  return (
    <dialog
      id="agent-guide"
      ref={dialog}
      aria-labelledby="agent-guide-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <h2 id="agent-guide-title" ref={title} tabIndex={-1}>
          {t("Create a scenario with an agent")}
        </h2>
        <button aria-label={t("Close")} onClick={close}>
          ×
        </button>
      </div>
      <div className="agent-guide-body">
        <p className="agent-guide-intro">
          {t(
            "Describe your system to your preferred AI agent. It can build a scenario and give you a link to open it here.",
          )}
        </p>
        <ol className="agent-guide-steps">
          <li>{t("Copy the prompt below and send it to your agent.")}</li>
          <li>
            {t(
              "Replace the example with your services, traffic and the behavior you want to explore.",
            )}
          </li>
          <li>
            {t(
              "Open the returned model link, run the experiment and adjust the settings.",
            )}
          </li>
        </ol>
        <label htmlFor="agent-prompt">{t("Your prompt")}</label>
        <textarea
          id="agent-prompt"
          ref={input}
          value={prompt}
          rows={8}
          onChange={(event) => {
            setPrompt(event.target.value);
            setCopyState("");
          }}
          spellCheck={false}
        />
        <p className="field-note">
          {t(
            "Use an agent that can read links. If it cannot open the instructions, open them yourself and paste their contents into the conversation.",
          )}
        </p>
        <a
          className="agent-instructions-link"
          href="https://tmlab.krglv.com/skill.md"
          target="_blank"
          rel="noreferrer"
        >
          {t("Open agent instructions ↗")}
        </a>
      </div>
      <div className="agent-guide-footer">
        <span role="status">
          {copyState === "copied"
            ? t("Prompt copied. Paste it into your agent's conversation.")
            : copyState === "manual"
              ? t("Select and copy the prompt manually.")
              : ""}
        </span>
        <button
          className="primary-button"
          disabled={!prompt.trim()}
          onClick={() => void copy()}
        >
          {t(copyState === "copied" ? "Copied" : "Copy prompt")}
        </button>
      </div>
    </dialog>
  );
}
